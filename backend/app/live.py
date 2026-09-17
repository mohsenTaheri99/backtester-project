"""Background poller that keeps a symbol's candles current.

One daemon thread runs for the life of the process and idles while live data is
switched off, so toggling the setting takes effect on the next tick with nothing
to restart. Each tick asks the provider for the last few hundred 1-minute
candles and folds them into the store; the newest one is still forming, so it is
overwritten on every poll until it closes.

Twelve Data's websocket needs a paid plan, and their free plan allows 8 requests
a minute, so polling REST is both the compatible and the cheaper option: at the
default 60s interval a session costs 60 of the 800 daily credits per hour.
"""
from __future__ import annotations

import threading
import time
from typing import Callable

from .providers import TwelveData, TwelveDataError
from .settings import settings
from .store import store

Listener = Callable[[str, int], None]  # (symbol_id, bars_added)

# Enough overlap to heal a short outage without asking for real history.
POLL_BARS = 200
IDLE_SECONDS = 5.0


class LiveFeed:
    def __init__(self) -> None:
        self._thread: threading.Thread | None = None
        self._wake = threading.Event()
        self._stopping = threading.Event()
        self._listeners: list[Listener] = []
        self._lock = threading.Lock()
        self._status: dict = {
            "enabled": False,
            "symbol": None,
            "lastPollAt": None,
            "nextPollAt": None,
            "lastError": None,
            "lastAdded": 0,
            "polls": 0,
            "lastBarTime": None,
        }
        # Set by the UI: whichever symbol the chart is showing.
        self._chart_symbol: str | None = None
        # Set by a running forward test, which must keep receiving candles even
        # while the user looks at a different symbol on the chart.
        self._pinned: str | None = None

    # -- wiring -------------------------------------------------------------
    def subscribe(self, listener: Listener) -> None:
        self._listeners.append(listener)

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stopping.clear()
        self._thread = threading.Thread(target=self._run, name="live-feed", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stopping.set()
        self._wake.set()

    def follow(self, symbol_id: str | None) -> None:
        """Tell the feed which symbol the chart is on; polled unless overridden."""
        if symbol_id != self._chart_symbol:
            self._chart_symbol = symbol_id
            self._wake.set()  # re-evaluate immediately instead of after a full interval

    def pin(self, symbol_id: str | None) -> None:
        """Poll this symbol regardless of what the chart is showing."""
        self._pinned = symbol_id
        self._wake.set()

    def nudge(self) -> None:
        """Poll now rather than waiting out the current interval."""
        self._wake.set()

    # -- what gets polled ---------------------------------------------------
    def target(self) -> str | None:
        """The symbol to poll, most deliberate choice first.

        A forward test outranks the chart: the user scrolling to another symbol
        must not quietly starve a running session of the candles it needs.
        """
        chosen = str(settings.get("live_symbol") or "").strip()
        for candidate in (chosen, self._pinned, self._chart_symbol):
            symbol = store.symbol(candidate) if candidate else None
            if symbol is not None and symbol.provider:
                return symbol.id
        return None

    @property
    def enabled(self) -> bool:
        return bool(settings.get("live_enabled"))

    def status(self) -> dict:
        with self._lock:
            current = dict(self._status)
        current["enabled"] = self.enabled
        target = self.target()
        current["symbol"] = target
        current["intervalSeconds"] = int(settings.get("live_interval_seconds") or 60)
        current["lastBarTime"] = store.last_bar_time(target) if target else None
        current["pinned"] = self._pinned
        if not target and self.enabled:
            current["lastError"] = (
                "No live-capable symbol. Import one from Twelve Data in Settings → Market data."
            )
        return current

    def _set(self, **fields) -> None:
        with self._lock:
            self._status.update(fields)

    # -- the loop -----------------------------------------------------------
    def _run(self) -> None:
        while not self._stopping.is_set():
            interval = float(settings.get("live_interval_seconds") or 60)
            if not self.enabled:
                self._set(nextPollAt=None)
                self._wait(IDLE_SECONDS)
                continue

            symbol_id = self.target()
            if symbol_id is None:
                self._wait(IDLE_SECONDS)
                continue

            added = self.poll_once(symbol_id)
            self._set(nextPollAt=time.time() + interval)
            if added:
                for listener in list(self._listeners):
                    try:
                        listener(symbol_id, added)
                    except Exception as exc:  # noqa: BLE001 - a listener must not kill the feed
                        print(f"[live] listener failed: {exc}")
            self._wait(interval)

    def _wait(self, seconds: float) -> None:
        self._wake.wait(seconds)
        self._wake.clear()

    def poll_once(self, symbol_id: str) -> int:
        """One request. Returns how many candles were new; never raises."""
        symbol = store.symbol(symbol_id)
        if symbol is None or not symbol.provider:
            self._set(lastError=f"'{symbol_id}' has no data provider")
            return 0

        try:
            client = TwelveData(
                str(settings.get("twelvedata_api_key") or ""),
                int(settings.get("provider_credits_per_minute") or 8),
            )
            frame = client.latest(symbol.source, "1min", POLL_BARS)
            added = store.merge_bars(symbol_id, frame)
        except TwelveDataError as exc:
            self._set(lastError=str(exc), lastPollAt=time.time())
            return 0
        except Exception as exc:  # noqa: BLE001 - the feed outlives any single failure
            self._set(lastError=f"live poll failed: {exc}", lastPollAt=time.time())
            return 0

        with self._lock:
            self._status.update(
                {
                    "lastPollAt": time.time(),
                    "lastError": None,
                    "lastAdded": added,
                    "polls": self._status["polls"] + 1,
                }
            )
        return added


feed = LiveFeed()
