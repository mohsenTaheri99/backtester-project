"""FastAPI app serving OHLCV candles, backtests, live data and forward tests.

When FRONTEND_DIR is set (the desktop app sets it), the built React UI is served
from `/` as well, so the page and `/api` share one origin and no CORS is needed.
"""
from __future__ import annotations

import os
import re
import threading
from contextlib import asynccontextmanager
from dataclasses import fields
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .backtest import run_backtest
from .config import DEFAULT_LIMIT, MAX_LIMIT, TIMEFRAMES, Symbol
from .forward import forward
from .live import feed
from .providers import TwelveData, TwelveDataError
from .settings import settings
from .store import store
from .strategies import REGISTRY


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.load()
    store.load()
    forward.restore()
    feed.start()
    yield
    feed.stop()


app = FastAPI(
    title="Backtester Data API",
    version="0.2.0",
    description="Serves OHLCV candles, backtests, live candles and forward tests.",
    lifespan=lifespan,
)


def _symbol_or_404(symbol_id: str) -> Symbol:
    symbol = store.symbol(symbol_id)
    if symbol is None:
        raise HTTPException(404, f"unknown symbol '{symbol_id}'")
    return symbol


def _provider() -> TwelveData:
    try:
        return TwelveData(str(settings.get("twelvedata_api_key") or ""))
    except TwelveDataError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "symbols": [s.id for s in store.loaded_symbols()],
    }


@app.get("/api/timeframes")
def timeframes() -> list[str]:
    return list(TIMEFRAMES)


def _symbol_payload(symbol: Symbol) -> dict:
    coverage = store.coverage(symbol.id)
    return {
        "id": symbol.id,
        "name": symbol.name,
        "exchange": symbol.exchange,
        "source": symbol.source,
        "provider": symbol.provider,
        "imported": symbol.imported,
        "live": bool(symbol.provider),
        "pricePrecision": symbol.price_precision,
        "bars": store.bar_count(symbol.id),
        "from": coverage[0] if coverage else None,
        "to": coverage[1] if coverage else None,
        "timeframes": list(TIMEFRAMES),
    }


@app.get("/api/symbols")
def symbols() -> list[dict]:
    return [_symbol_payload(symbol) for symbol in store.loaded_symbols()]


@app.get("/api/candles")
def candles(
    symbol: str = Query("XAUUSD", description="symbol id from /api/symbols"),
    tf: str = Query("1m", description="timeframe, e.g. 1m, 5m, 1h, 1d"),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    before: int | None = Query(None, description="unix seconds; return bars older than this"),
) -> dict:
    _symbol_or_404(symbol)
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
        "version": store.version(symbol),
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
# settings
# ---------------------------------------------------------------------------
class SettingsUpdate(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)


@app.get("/api/settings")
def read_settings() -> dict:
    return settings.describe()


@app.put("/api/settings")
def write_settings(update: SettingsUpdate) -> dict:
    try:
        settings.update(update.values)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    feed.nudge()  # a changed key or interval should take effect now, not next tick
    return settings.describe()


# ---------------------------------------------------------------------------
# data provider
# ---------------------------------------------------------------------------
@app.get("/api/provider/usage")
def provider_usage() -> dict:
    """Doubles as the modal's "Test connection", so a missing or rejected key is
    reported in the body rather than as an HTTP error the UI would render as red."""
    try:
        client = TwelveData(str(settings.get("twelvedata_api_key") or ""))
        return {"ok": True, **client.usage()}
    except TwelveDataError as exc:
        return {"ok": False, "message": str(exc), "code": exc.code}


@app.get("/api/provider/search")
def provider_search(q: str = Query(..., min_length=1, description="symbol or name")) -> list[dict]:
    try:
        return _provider().search(q)
    except TwelveDataError as exc:
        raise HTTPException(400, str(exc)) from exc


class ImportRequest(BaseModel):
    symbol: str = Field(..., description="provider ticker, e.g. XAU/USD")
    name: str = Field("", description="display name; defaults to the ticker")
    exchange: str = Field("", description="display exchange")
    bars: int | None = Field(None, description="1m bars to download; defaults to the setting")


def _slug(ticker: str) -> str:
    """XAU/USD -> XAUUSD, kept unique against the symbols that ship with the app."""
    base = re.sub(r"[^A-Za-z0-9]", "", ticker).upper() or "SYMBOL"
    existing = store.symbol(base)
    if existing is not None and not existing.imported:
        return f"{base}-TD"  # the bundled sample already owns that id
    return base


def _precision_for(frame) -> int:
    """Gold and indices want 2 decimals, forex majors 5. Judge by price level."""
    price = float(frame["close"].iloc[-1])
    return 2 if price >= 100 else 4 if price >= 1 else 5


@app.post("/api/symbols")
def import_symbol(request: ImportRequest) -> dict:
    ticker = request.symbol.strip()
    if not ticker:
        raise HTTPException(400, "symbol is required")
    bars = int(request.bars or settings.get("history_bars") or 5000)

    try:
        frame = _provider().history(ticker, bars, "1min")
    except TwelveDataError as exc:
        raise HTTPException(400, str(exc)) from exc
    if frame.empty:
        raise HTTPException(400, f"no 1-minute candles available for '{ticker}'")

    symbol_id = _slug(ticker)
    symbol = Symbol(
        id=symbol_id,
        name=request.name.strip() or ticker,
        exchange=request.exchange.strip() or "Twelve Data",
        source=ticker,
        csv=f"{symbol_id}_1m.csv",
        price_precision=_precision_for(frame),
        provider="twelvedata",
        imported=True,
    )
    try:
        store.add_symbol(symbol, frame)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _symbol_payload(symbol)


@app.post("/api/symbols/{symbol_id}/refresh")
def refresh_symbol(symbol_id: str) -> dict:
    symbol = _symbol_or_404(symbol_id)
    if not symbol.provider:
        raise HTTPException(400, f"'{symbol_id}' has no data provider to refresh from")
    bars = int(settings.get("history_bars") or 5000)
    try:
        frame = _provider().history(symbol.source, bars, "1min")
        added = store.merge_bars(symbol_id, frame)
    except TwelveDataError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {**_symbol_payload(symbol), "added": added}


@app.delete("/api/symbols/{symbol_id}")
def delete_symbol(symbol_id: str) -> dict:
    _symbol_or_404(symbol_id)
    try:
        store.remove_symbol(symbol_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"removed": symbol_id}


# ---------------------------------------------------------------------------
# live data
# ---------------------------------------------------------------------------
@app.get("/api/live")
def live_status(symbol: str | None = Query(None, description="symbol the chart is showing")) -> dict:
    if symbol:
        feed.follow(symbol)
    return feed.status()


@app.post("/api/live/poll")
def live_poll(symbol: str | None = Query(None)) -> dict:
    target = symbol or feed.target()
    if target is None:
        raise HTTPException(400, "no live-capable symbol; import one from Twelve Data first")
    added = feed.poll_once(target)
    return {**feed.status(), "added": added}


# ---------------------------------------------------------------------------
# forward testing
# ---------------------------------------------------------------------------
class ForwardStart(BaseModel):
    strategyId: str = Field("ict_sweep")
    symbol: str = Field(...)
    params: dict[str, Any] = Field(default_factory=dict)


@app.get("/api/forward")
def forward_status() -> dict:
    return forward.snapshot()


@app.post("/api/forward/start")
def forward_start(request: ForwardStart) -> dict:
    try:
        return forward.start(request.strategyId, request.symbol, request.params)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/forward/stop")
def forward_stop() -> dict:
    return forward.stop()


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
        if "bool" in raw:
            return "bool"
        if "str" in raw:
            return "select"  # rendered as a dropdown over the entry's "options"
        return "int" if "int" in raw else "float"

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
    _symbol_or_404(request.symbol)

    # The candles change when live data arrives, so they are part of the key.
    key = (
        request.strategyId,
        request.symbol,
        store.version(request.symbol),
        tuple(sorted((k, str(v)) for k, v in request.params.items())),
    )
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
