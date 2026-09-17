"""Runs a strategy through backtesting.py and shapes the result for the API."""
from __future__ import annotations

import math
import time
from dataclasses import asdict, fields, replace
from typing import Any

import pandas as pd
from backtesting import Backtest

from .config import TIMEFRAMES
from .store import store
from .strategies import REGISTRY, build_context

# Columns backtesting.py expects, and the timeframes the strategy layer needs.
_OHLCV_RENAME = {
    "open": "Open",
    "high": "High",
    "low": "Low",
    "close": "Close",
    "volume": "Volume",
}

MAX_EQUITY_POINTS = 1500

_RESAMPLE = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}


def _resampler(m1: pd.DataFrame):
    """Derive higher timeframes from this slice, not from the store's full frame.

    Resampling the slice is what makes a ranged backtest independent: the store's
    cached frames cover everything, and using them would feed the strategy bars
    from outside the window.
    """

    def at(timeframe: str) -> pd.DataFrame:
        if timeframe == "1m":
            return m1
        out = m1.resample(TIMEFRAMES[timeframe], label="left", closed="left", origin="epoch").agg(_RESAMPLE)
        return out.dropna(subset=["open"]).astype({"volume": "int64"})

    return at


def _clean(value: Any) -> Any:
    """JSON-safe: numpy scalars out, NaN/inf to None, timestamps to unix seconds."""
    if value is None:
        return None
    if isinstance(value, pd.Timestamp):
        return int(value.timestamp())
    if isinstance(value, pd.Timedelta):
        return str(value)
    if isinstance(value, (bool,)):
        return value
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else round(value, 6)
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    return value


def _params_from_request(param_class, overrides: dict[str, Any] | None):
    """Build the params dataclass, ignoring unknown keys from the client."""
    allowed = {f.name: f.type for f in fields(param_class)}
    clean: dict[str, Any] = {}
    for key, value in (overrides or {}).items():
        if key in allowed and value is not None:
            clean[key] = value
    return param_class(**clean)


def _summary(stats: pd.Series, trades: pd.DataFrame) -> dict[str, Any]:
    wins = trades[trades["PnL"] > 0]
    losses = trades[trades["PnL"] < 0]
    scratches = trades[trades["PnL"] == 0]
    gross_win = float(wins["PnL"].sum())
    gross_loss = float(-losses["PnL"].sum())

    return {
        "trades": int(stats["# Trades"]),
        "wins": len(wins),
        "losses": len(losses),
        "breakEven": len(scratches),
        "winRatePct": _clean(stats["Win Rate [%]"]),
        "returnPct": _clean(stats["Return [%]"]),
        "buyHoldReturnPct": _clean(stats["Buy & Hold Return [%]"]),
        "equityFinal": _clean(stats["Equity Final [$]"]),
        "equityPeak": _clean(stats["Equity Peak [$]"]),
        "pnl": _clean(float(trades["PnL"].sum()) if len(trades) else 0.0),
        "profitFactor": _clean(stats["Profit Factor"]),
        "expectancyPct": _clean(stats["Expectancy [%]"]),
        "expectancyUsd": _clean(float(trades["PnL"].mean()) if len(trades) else 0.0),
        "avgWinUsd": _clean(float(wins["PnL"].mean()) if len(wins) else 0.0),
        "avgLossUsd": _clean(float(losses["PnL"].mean()) if len(losses) else 0.0),
        "grossWinUsd": _clean(gross_win),
        "grossLossUsd": _clean(gross_loss),
        "maxDrawdownPct": _clean(stats["Max. Drawdown [%]"]),
        "maxDrawdownDuration": _clean(stats["Max. Drawdown Duration"]),
        "sharpe": _clean(stats["Sharpe Ratio"]),
        "sortino": _clean(stats["Sortino Ratio"]),
        "calmar": _clean(stats["Calmar Ratio"]),
        "sqn": _clean(stats["SQN"]),
        "exposurePct": _clean(stats["Exposure Time [%]"]),
        "bestTradePct": _clean(stats["Best Trade [%]"]),
        "worstTradePct": _clean(stats["Worst Trade [%]"]),
        "avgTradeDuration": _clean(stats["Avg. Trade Duration"]),
    }


def _exit_reason(row: pd.Series) -> str:
    """Why the trade ended, inferred from where it closed relative to sl/tp."""
    sl, tp, exit_price = row["SL"], row["TP"], row["ExitPrice"]
    entry = row["EntryPrice"]
    long = row["Size"] > 0
    tolerance = max(abs(entry) * 1e-5, 0.01)

    if pd.notna(tp) and abs(exit_price - tp) <= tolerance:
        return "take_profit"
    if pd.notna(sl) and abs(exit_price - sl) <= tolerance:
        # A stop sitting at entry means break-even was triggered first.
        return "break_even" if abs(sl - entry) <= tolerance else "stop_loss"
    if long and exit_price > entry or (not long) and exit_price < entry:
        return "closed_win"
    return "closed_loss"


def _trades_payload(trades: pd.DataFrame, pip_size: float) -> list[dict[str, Any]]:
    payload = []
    for _, row in trades.iterrows():
        tag = row["Tag"] if isinstance(row["Tag"], dict) else {}
        long = row["Size"] > 0
        payload.append(
            {
                "id": int(row.name) + 1,
                "direction": "long" if long else "short",
                "entryTime": _clean(row["EntryTime"]),
                "exitTime": _clean(row["ExitTime"]),
                "entryPrice": _clean(row["EntryPrice"]),
                "exitPrice": _clean(row["ExitPrice"]),
                "sl": _clean(row["SL"]),          # final stop (entry price once moved to BE)
                "initialSl": _clean(tag.get("initialSl")),
                "tp": _clean(row["TP"]),
                "size": int(abs(row["Size"])),
                "pnl": _clean(row["PnL"]),
                "returnPct": _clean(row["ReturnPct"] * 100),
                "rMultiple": _clean(
                    row["PnL"] / (abs(row["Size"]) * tag["riskPerUnit"])
                    if tag.get("riskPerUnit")
                    else None
                ),
                "durationMinutes": _clean(row["Duration"].total_seconds() / 60),
                "exitReason": _exit_reason(row),
                "pattern": tag.get("pattern"),
                "sweepLevel": _clean(tag.get("sweepLevel")),
                "slPips": _clean(tag.get("slPips")),
                "pipSize": pip_size,
            }
        )
    return payload


def _equity_payload(curve: pd.DataFrame) -> list[dict[str, Any]]:
    """Equity sampled down to something a chart can draw without choking."""
    step = max(1, len(curve) // MAX_EQUITY_POINTS)
    sampled = curve.iloc[::step]
    if len(curve) and sampled.index[-1] != curve.index[-1]:
        sampled = pd.concat([sampled, curve.iloc[[-1]]])
    return [
        {
            "time": int(ts.timestamp()),
            "equity": _clean(row["Equity"]),
            "drawdownPct": _clean(row["DrawdownPct"] * 100),
        }
        for ts, row in sampled.iterrows()
    ]


def _warmup_bars(params) -> int:
    """1m bars of context to keep before the first bar that may be traded.

    The 1h bias needs `h1_fractal` bars either side of a swing plus room for a
    break of structure, and a 15m pool stays relevant for `sweep_lookback` bars.
    Whichever reaches back further wins, doubled for headroom.

    Counted in bars rather than wall-clock: a window that opens after a weekend
    would otherwise take its warm-up from a closed market and get none at all.
    """
    bias = 60 * (2 * getattr(params, "h1_fractal", 5) + 1)
    sweeps = 15 * getattr(params, "sweep_lookback", 40)
    return max(bias, sweeps, 12 * 60) * 2


def run_backtest(
    strategy_id: str,
    symbol: str,
    overrides: dict[str, Any] | None = None,
    range_from: int | None = None,
    range_to: int | None = None,
) -> dict[str, Any]:
    if strategy_id not in REGISTRY:
        raise KeyError(f"unknown strategy '{strategy_id}'")
    info = REGISTRY[strategy_id]
    params = _params_from_request(info.params, overrides)

    started = time.perf_counter()
    full = store.frame(symbol, info.timeframes["trigger"])
    if full.empty:
        raise ValueError(f"'{symbol}' has no candles to test")

    # A range keeps the warm-up bars in the data but bars them from trading, so
    # the bias and sweeps entering the window are as complete as any other bar's.
    trade_from = None
    if range_from is not None or range_to is not None:
        begin = pd.Timestamp(range_from, unit="s", tz="UTC") if range_from else full.index[0]
        finish = pd.Timestamp(range_to, unit="s", tz="UTC") if range_to else full.index[-1]
        if finish <= begin:
            raise ValueError("the backtest range ends before it starts")
        inside = full[(full.index >= begin) & (full.index <= finish)]
        if inside.empty:
            raise ValueError(
                f"no candles between {begin:%Y-%m-%d %H:%M} and {finish:%Y-%m-%d %H:%M} UTC"
            )
        first = full.index.searchsorted(inside.index[0])
        full = full.iloc[max(0, first - _warmup_bars(params)) : first + len(inside)]
        if range_from is not None:
            trade_from = float(begin.timestamp())

    m1 = full
    resample = _resampler(m1)
    m15 = resample(info.timeframes["liquidity"])
    h1 = resample(info.timeframes["bias"])
    pin = resample(params.pin_timeframe)

    if trade_from is not None:
        params = replace(params, start_trading_at=max(params.start_trading_at, trade_from))

    context = build_context(m1, m15, h1, params, pin)

    data = m1.rename(columns=_OHLCV_RENAME)
    spread_rel = params.spread_usd / float(data["Close"].mean())

    # The strategy class is shared, so subclass per run to keep params isolated.
    runner = type(
        info.strategy.__name__,
        (info.strategy,),
        {"params": params, "context": context, "spread_rel": spread_rel},
    )

    backtest = Backtest(
        data,
        runner,
        cash=params.cash,
        margin=1 / params.leverage,
        spread=spread_rel,
        trade_on_close=True,   # entries land on the close of the trigger candle
        finalize_trades=True,  # count the position still open at the last bar
    )
    stats = backtest.run()

    trades = stats["_trades"]
    equity = stats["_equity_curve"]
    strategy_instance = stats["_strategy"]

    return {
        "strategy": {
            "id": info.id,
            "name": info.name,
            # The pin timeframe is a parameter, so report what this run used.
            "timeframes": {**info.timeframes, "pin": params.pin_timeframe},
        },
        "symbol": symbol,
        "params": asdict(params),
        "range": {
            "from": int(m1.index[0].timestamp()),
            "to": int(m1.index[-1].timestamp()),
            "bars": len(m1),
            "tradedFrom": int(trade_from) if trade_from else int(m1.index[0].timestamp()),
            "warmupBars": int((m1.index < pd.Timestamp(trade_from, unit="s", tz="UTC")).sum())
            if trade_from
            else 0,
        },
        "summary": _summary(stats, trades),
        "trades": _trades_payload(trades, params.pip_size),
        "equity": _equity_payload(equity),
        "rejections": getattr(strategy_instance, "rejections", {}),
        "elapsedMs": round((time.perf_counter() - started) * 1000, 1),
    }
