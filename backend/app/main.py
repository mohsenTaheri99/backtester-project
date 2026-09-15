"""FastAPI app serving OHLCV candles and backtests to the desktop app.

When FRONTEND_DIR is set (the desktop app sets it), the built React UI is served
from `/` as well, so the page and `/api` share one origin and no CORS is needed.
"""
from __future__ import annotations

import os
import threading
from contextlib import asynccontextmanager
from dataclasses import fields
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .backtest import run_backtest
from .config import DEFAULT_LIMIT, MAX_LIMIT, SYMBOLS, TIMEFRAMES
from .store import store
from .strategies import REGISTRY


@asynccontextmanager
async def lifespan(app: FastAPI):
    store.load()
    yield


app = FastAPI(
    title="Backtester Data API",
    version="0.1.0",
    description="Serves gold OHLCV candles resampled from 1-minute data.",
    lifespan=lifespan,
)


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "symbols": [s.id for s in store.loaded_symbols()],
    }


@app.get("/api/timeframes")
def timeframes() -> list[str]:
    return list(TIMEFRAMES)


@app.get("/api/symbols")
def symbols() -> list[dict]:
    out = []
    for symbol in store.loaded_symbols():
        coverage = store.coverage(symbol.id)
        out.append(
            {
                "id": symbol.id,
                "name": symbol.name,
                "exchange": symbol.exchange,
                "source": symbol.source,
                "pricePrecision": symbol.price_precision,
                "bars": store.bar_count(symbol.id),
                "from": coverage[0] if coverage else None,
                "to": coverage[1] if coverage else None,
                "timeframes": list(TIMEFRAMES),
            }
        )
    return out


@app.get("/api/candles")
def candles(
    symbol: str = Query("XAUUSD", description="symbol id from /api/symbols"),
    tf: str = Query("1m", description="timeframe, e.g. 1m, 5m, 1h, 1d"),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    before: int | None = Query(None, description="unix seconds; return bars older than this"),
) -> dict:
    if symbol not in SYMBOLS:
        raise HTTPException(404, f"unknown symbol '{symbol}'")
    if tf not in TIMEFRAMES:
        raise HTTPException(400, f"unknown timeframe '{tf}' (have: {', '.join(TIMEFRAMES)})")

    try:
        result = store.candles(symbol, tf, limit=limit, before=before)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc

    rows = result.rows
    return {
        "symbol": result.symbol,
        "timeframe": result.timeframe,
        "count": len(rows),
        "total": result.total,
        "hasMore": result.has_more,
        "candles": [
            {
                "time": int(ts.timestamp()),
                "open": float(o),
                "high": float(h),
                "low": float(l),
                "close": float(c),
                "volume": int(v),
            }
            for ts, o, h, l, c, v in zip(
                rows.index,
                rows["open"],
                rows["high"],
                rows["low"],
                rows["close"],
                rows["volume"],
            )
        ],
    }


# ---------------------------------------------------------------------------
# backtesting
# ---------------------------------------------------------------------------
_CACHE: dict[tuple, dict] = {}
_CACHE_LOCK = threading.Lock()
_CACHE_MAX = 16


class BacktestRequest(BaseModel):
    strategyId: str = Field("ict_sweep", description="id from /api/strategies")
    symbol: str = Field("XAUUSD", description="symbol id from /api/symbols")
    params: dict[str, Any] = Field(default_factory=dict, description="parameter overrides")


def _describe(info) -> dict:
    defaults = info.params()
    types = {f.name: f.type for f in fields(info.params)}
    ui = {entry["name"]: entry for entry in info.param_ui}

    def kind(name: str) -> str:
        raw = str(types.get(name, "float"))
        return "bool" if "bool" in raw else "int" if "int" in raw else "float"

    return {
        "id": info.id,
        "name": info.name,
        "description": info.description,
        "timeframes": info.timeframes,
        "defaults": {name: getattr(defaults, name) for name in info.param_names},
        "params": [
            {**entry, "type": kind(entry["name"]), "default": getattr(defaults, entry["name"])}
            for entry in ui.values()
        ],
    }


@app.get("/api/strategies")
def strategies() -> list[dict]:
    return [_describe(info) for info in REGISTRY.values()]


@app.post("/api/backtest")
def backtest(request: BacktestRequest) -> dict:
    if request.symbol not in SYMBOLS:
        raise HTTPException(404, f"unknown symbol '{request.symbol}'")

    key = (request.strategyId, request.symbol, tuple(sorted(request.params.items())))
    with _CACHE_LOCK:
        cached = _CACHE.get(key)
    if cached is not None:
        return {**cached, "cached": True}

    try:
        result = run_backtest(request.strategyId, request.symbol, request.params)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, f"invalid parameters: {exc}") from exc

    with _CACHE_LOCK:
        if len(_CACHE) >= _CACHE_MAX:
            _CACHE.pop(next(iter(_CACHE)))
        _CACHE[key] = result
    return {**result, "cached": False}


# ---------------------------------------------------------------------------
# frontend - mounted last so every /api route above takes precedence
# ---------------------------------------------------------------------------
if os.getenv("FRONTEND_DIR"):
    app.mount("/", StaticFiles(directory=os.environ["FRONTEND_DIR"], html=True), name="frontend")
