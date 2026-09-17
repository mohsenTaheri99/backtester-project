"""Paper trading a strategy forward on live candles.

The forward test deliberately runs *the same engine as the backtest* rather than
a second, live-only copy of the rules that could drift away from it. Every time
new candles arrive the strategy is replayed over the full history, with
`start_trading_at` set to the moment the session began: earlier bars still build
the 1h bias and the 15m sweeps, but no trade may open on a bar that had already
printed when the user pressed Start.

That makes the session reproducible - nothing but the session's start time, the
parameters and the candles is state - so only those go to disk, and the results
are recomputed from them.
"""
from __future__ import annotations

import threading
import time
from typing import Any

from .backtest import run_backtest
from .live import feed
from .settings import settings
from .store import store
from .strategies import REGISTRY

STATE_KEY = "forward"


class ForwardTester:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        # Held for the whole replay so a live tick and a status request cannot
        # run the same backtest twice at once.
        self._compute_lock = threading.Lock()
        self._session: dict[str, Any] | None = None
        self._result: dict[str, Any] | None = None
        self._computed_version: int | None = None
        self._error: str | None = None

    # -- lifecycle ----------------------------------------------------------
    def restore(self) -> None:
        """Pick a session back up after a restart, if the user asked us to."""
        saved = settings.get_state(STATE_KEY)
        if not saved or not settings.get("forward_autostart"):
            return
        if store.symbol(saved.get("symbol")) is None:
            print(f"[forward] saved session dropped: symbol '{saved.get('symbol')}' is gone")
            settings.set_state(STATE_KEY, None)
            return
        self._session = saved
        feed.pin(saved["symbol"])
        print(f"[forward] resumed {saved['strategyId']} on {saved['symbol']}")

    def start(self, strategy_id: str, symbol_id: str, params: dict[str, Any] | None) -> dict:
        if strategy_id not in REGISTRY:
            raise KeyError(f"unknown strategy '{strategy_id}'")
        symbol = store.symbol(symbol_id)
        if symbol is None:
            raise KeyError(f"unknown symbol '{symbol_id}'")
        if not symbol.provider:
            raise ValueError(
                f"'{symbol_id}' has no data provider, so it cannot receive live candles. "
                "Import a symbol from Twelve Data in Settings → Market data."
            )

        # Start from the last candle already on disk: everything up to here is
        # history, everything after it is the forward test.
        started_at = store.last_bar_time(symbol_id) or int(time.time())
        with self._lock:
            self._session = {
                "strategyId": strategy_id,
                "symbol": symbol_id,
                "params": dict(params or {}),
                "startedAt": int(started_at),
                "startedRealAt": int(time.time()),
            }
            self._result = None
            self._computed_version = None
            self._error = None
        settings.set_state(STATE_KEY, self._session)

        feed.pin(symbol_id)  # keep its candles coming whatever the chart shows
        feed.nudge()
        return self.snapshot()

    def stop(self) -> dict:
        with self._lock:
            self._session = None
            self._result = None
            self._computed_version = None
            self._error = None
        settings.set_state(STATE_KEY, None)
        feed.pin(None)
        return self.snapshot()

    # -- computation --------------------------------------------------------
    def on_new_bars(self, symbol_id: str, _added: int) -> None:
        """Live feed callback: recompute if the session is on this symbol."""
        session = self._session
        if session and session["symbol"] == symbol_id:
            self._recompute(session)

    def _recompute(self, session: dict[str, Any]) -> None:
        with self._compute_lock:
            self._replay(session)

    def _replay(self, session: dict[str, Any]) -> None:
        symbol_id = session["symbol"]
        version = store.version(symbol_id)
        overrides = {
            **session["params"],
            "start_trading_at": float(session["startedAt"]),
            "cash": float(settings.get("forward_cash") or 10_000),
        }
        try:
            result = run_backtest(session["strategyId"], symbol_id, overrides)
            error = None
        except Exception as exc:  # noqa: BLE001 - surfaced in the panel, not fatal
            result, error = None, str(exc)

        with self._lock:
            if self._session is not session:
                return  # stopped or restarted while we were computing
            if result is not None:
                self._result = _for_session(result, session, store.last_bar_time(symbol_id))
                self._computed_version = version
            self._error = error

    def refresh(self) -> None:
        """Recompute if the candles have moved since the cached result."""
        session = self._session
        if session is None:
            return
        if self._computed_version != store.version(session["symbol"]):
            self._recompute(session)

    # -- reporting ----------------------------------------------------------
    def snapshot(self) -> dict:
        self.refresh()
        with self._lock:
            session, result, error = self._session, self._result, self._error
        return {
            "running": session is not None,
            "session": session,
            "live": feed.status(),
            "result": result,
            "error": error,
        }


def _for_session(result: dict[str, Any], session: dict[str, Any], last_bar: int | None) -> dict:
    """Trim a full backtest result down to the forward session's own window."""
    started = session["startedAt"]
    equity = [point for point in result["equity"] if point["time"] >= started]
    trades = result["trades"]

    # backtesting.py closes a position still open on the final bar so it counts
    # in the stats; here that trade is the live one, so label it as still open.
    open_trade = None
    if trades and last_bar is not None:
        last = trades[-1]
        if last["exitTime"] == last_bar and last["exitReason"] in ("closed_win", "closed_loss"):
            open_trade = {**last, "open": True}
            trades = [*trades[:-1], open_trade]

    return {
        **result,
        "trades": trades,
        "equity": equity,
        "openTrade": open_trade,
        "startedAt": started,
        "lastBarTime": last_bar,
    }


forward = ForwardTester()
feed.subscribe(forward.on_new_bars)
