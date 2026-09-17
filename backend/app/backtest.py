"""Runs a strategy through backtesting.py and shapes the result for the API."""
from __future__ import annotations

import math
import time
from dataclasses import asdict, fields
from typing import Any

import pandas as pd
from backtesting import Backtest

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


def run_backtest(
    strategy_id: str,
    symbol: str,
    overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if strategy_id not in REGISTRY:
        raise KeyError(f"unknown strategy '{strategy_id}'")
    info = REGISTRY[strategy_id]
    params = _params_from_request(info.params, overrides)

    started = time.perf_counter()
    m1 = store.frame(symbol, info.timeframes["trigger"])
    m15 = store.frame(symbol, info.timeframes["liquidity"])
    h1 = store.frame(symbol, info.timeframes["bias"])
    pin = store.frame(symbol, params.pin_timeframe)

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
        },
        "summary": _summary(stats, trades),
        "trades": _trades_payload(trades, params.pip_size),
        "equity": _equity_payload(equity),
        "rejections": getattr(strategy_instance, "rejections", {}),
        "elapsedMs": round((time.perf_counter() - started) * 1000, 1),
    }
