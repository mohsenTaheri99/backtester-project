"""FastAPI app serving OHLCV candles, backtests, live data and forward tests.

When FRONTEND_DIR is set (the desktop app sets it), the built React UI is served
from `/` as well, so the page and `/api` share one origin and no CORS is needed.
"""
from __future__ import annotations

import os
import re
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import fields
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .backtest import run_backtest
from .config import APP_VERSION, DEFAULT_LIMIT, MAX_LIMIT, TIMEFRAMES, Symbol
from .forward import forward
from .jobs import Job, jobs
from .jobs import Job, jobs
from .live import feed
from .market_hours import market_for
from .providers import TwelveData, TwelveDataError
from .providers.twelvedata import pages_for
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
    version=APP_VERSION,
    description="Serves OHLCV candles, backtests, live candles and forward tests.",
    lifespan=lifespan,
)


# The desktop window is WebView2, which keeps a disk cache beside the app, and
# the app always serves on the same loopback port. So anything cacheable stored
# under that origin outlives the build that stored it: after an upgrade the
# window would show the previous version's page and its previous answers - the
# old UI, the old symbol list, the old /api/health version. Nothing we serve is
# worth caching, because it all changes underneath the app, so every API answer
# says no-store; the frontend mount at the bottom of this file does the same for
# the page and keeps only Vite's content-hashed assets.
@app.middleware("http")
async def _no_store_api(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["cache-control"] = "no-store"
    return response


def _symbol_or_404(symbol_id: str) -> Symbol:
    symbol = store.symbol(symbol_id)
    if symbol is None:
        raise HTTPException(404, f"unknown symbol '{symbol_id}'")
    return symbol


def _provider() -> TwelveData:
    try:
        return TwelveData(
            str(settings.get("twelvedata_api_key") or ""),
            int(settings.get("provider_credits_per_minute") or 8),
        )
    except TwelveDataError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "version": APP_VERSION,
        "symbols": [s.id for s in store.loaded_symbols()],
    }


@app.get("/api/timeframes")
def timeframes() -> list[str]:
    return list(TIMEFRAMES)


def _symbol_payload(symbol: Symbol) -> dict:
    coverage = store.coverage(symbol.id)
    return {
        "bytes": symbol.path.stat().st_size if symbol.path.exists() else 0,
        "days": store.trading_days(symbol.id),
        "id": symbol.id,
        "name": symbol.name,
        "exchange": symbol.exchange,
        "source": symbol.source,
        "provider": symbol.provider,
        "imported": symbol.imported,
        "market": symbol.market,
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
    symbol: str = Query(..., description="symbol id from /api/symbols"),
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
        client = TwelveData(
            str(settings.get("twelvedata_api_key") or ""),
            int(settings.get("provider_credits_per_minute") or 8),
        )
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
    type: str = Field("", description="provider instrument type, e.g. 'Precious Metal'")
    days: int | None = Field(None, description="days of history; defaults to the setting")


def _slug(ticker: str) -> str:
    """XAU/USD -> XAUUSD. Re-importing the same ticker reuses its id."""
    base = re.sub(r"[^A-Za-z0-9]", "", ticker).upper() or "SYMBOL"
    existing = store.symbol(base)
    if existing is not None and not existing.imported:
        return f"{base}-TD"  # a built-in symbol already owns that id
    return base


def _precision_for(frame) -> int:
    """Gold and indices want 2 decimals, forex majors 5. Judge by price level."""
    price = float(frame["close"].iloc[-1])
    return 2 if price >= 100 else 4 if price >= 1 else 5


@app.post("/api/symbols")
def import_symbol(request: ImportRequest) -> dict:
    """Start the download. Progress and the result arrive via /api/data/job."""
    ticker = request.symbol.strip()
    if not ticker:
        raise HTTPException(400, "symbol is required")
    days = int(request.days or settings.get("history_days") or 30)
    end = pd.Timestamp.now(tz="UTC")
    start = end - pd.Timedelta(days=days)

    try:
        return jobs.start(
            "import",
            ticker,
            f"Importing {ticker} - {days} days",
            lambda job: _run_import(job, request, ticker, start, end),
        )
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc


def _run_import(job: Job, request: ImportRequest, ticker: str, start, end) -> dict:
    client = _provider()
    client.on_wait = lambda seconds: setattr(job, "waiting_until", time.time() + seconds)
    job.pages_total = pages_for(start.to_pydatetime(), end.to_pydatetime())

    def progress(pages: int, bars: int) -> None:
        job.pages_done, job.bars, job.credits = pages, bars, client.requests
        job.message = f"Downloaded {bars:,} candles"

    frame = client.range(
        ticker, start.to_pydatetime(), end.to_pydatetime(), "1min", on_page=progress
    )
    job.credits = client.requests
    if frame.empty:
        raise ValueError(f"no 1-minute candles available for {ticker}")

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
        market=market_for(ticker, request.type),
        fetched_from=int(start.timestamp()),
        fetched_to=int(end.timestamp()),
    )
    raw = len(frame)
    store.add_symbol(symbol, frame)
    kept = store.bar_count(symbol_id)
    job.bars, job.padded = kept, raw - kept
    job.message = f"Imported {kept:,} candles"
    if job.padded:
        job.message += f", dropped {job.padded:,} from the closed market"
    return _symbol_payload(symbol)


@app.post("/api/symbols/{symbol_id}/refresh")
def refresh_symbol(symbol_id: str) -> dict:
    """Top a symbol up to now, downloading only what is missing at the end."""
    symbol = _symbol_or_404(symbol_id)
    if not symbol.provider:
        raise HTTPException(400, f"'{symbol_id}' has no data provider to refresh from")
    last = store.last_bar_time(symbol_id)
    end = pd.Timestamp.now(tz="UTC")
    start = pd.Timestamp(last, unit="s", tz="UTC") if last else end - pd.Timedelta(
        days=int(settings.get("history_days") or 30)
    )
    return _start_download(symbol_id, start, end, f"Updating {symbol_id}")


class RangeRequest(BaseModel):
    start: int = Field(..., description="unix seconds, inclusive")
    end: int = Field(..., description="unix seconds, inclusive")


@app.get("/api/symbols/{symbol_id}/range")
def range_plan(symbol_id: str, start: int = Query(...), end: int = Query(...)) -> dict:
    """What a range would cost before spending anything on it."""
    symbol = _symbol_or_404(symbol_id)
    first, last = pd.Timestamp(start, unit="s", tz="UTC"), pd.Timestamp(end, unit="s", tz="UTC")
    if last <= first:
        raise HTTPException(400, "end must be after start")

    gaps = store.missing_ranges(symbol_id, first, last) if symbol.provider else []
    coverage = store.coverage(symbol_id)
    return {
        "symbol": symbol_id,
        "cached": {"from": coverage[0], "to": coverage[1]} if coverage else None,
        "canDownload": bool(symbol.provider),
        "missing": [
            {"from": int(a.timestamp()), "to": int(b.timestamp()), "credits": pages_for(a, b)}
            for a, b in gaps
        ],
        "credits": sum(pages_for(a, b) for a, b in gaps),
    }


@app.post("/api/symbols/{symbol_id}/range")
def download_range(symbol_id: str, request: RangeRequest) -> dict:
    """Download only the parts of a range that are not cached yet."""
    _symbol_or_404(symbol_id)
    first = pd.Timestamp(request.start, unit="s", tz="UTC")
    last = pd.Timestamp(request.end, unit="s", tz="UTC")
    if last <= first:
        raise HTTPException(400, "end must be after start")
    return _start_download(symbol_id, first, last, f"Downloading {symbol_id}")


def _start_download(symbol_id: str, start: pd.Timestamp, end: pd.Timestamp, label: str) -> dict:
    symbol = _symbol_or_404(symbol_id)
    if not symbol.provider:
        raise HTTPException(400, f"{symbol_id} has no data provider to download from")

    gaps = store.missing_ranges(symbol_id, start, end)
    if not gaps:
        # Nothing to do and nothing to watch: answer as a job that already ended,
        # so the UI has one shape to render whether or not work was needed.
        return {
            "kind": "download",
            "symbol": symbol_id,
            "label": label,
            "state": "done",
            "message": "Already up to date - no credits spent",
            "pagesDone": 0,
            "pagesTotal": 0,
            "bars": store.bar_count(symbol_id),
            "padded": 0,
            "credits": 0,
            "startedAt": None,
            "finishedAt": None,
            "elapsedSeconds": 0,
            "error": None,
            "result": {**_symbol_payload(symbol), "added": 0, "upToDate": True},
        }

    try:
        return jobs.start("download", symbol_id, label, lambda job: _run_download(job, symbol, gaps))
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc


def _run_download(job: Job, symbol: Symbol, gaps: list) -> dict:
    client = _provider()
    client.on_wait = lambda seconds: setattr(job, "waiting_until", time.time() + seconds)
    job.pages_total = sum(pages_for(a, b) for a, b in gaps)
    added = 0
    done_pages = 0

    try:
        for gap_start, gap_end in gaps:

            def progress(pages: int, bars: int, base: int = done_pages, so_far: int = added) -> None:
                job.pages_done, job.credits = base + pages, client.requests
                job.message = f"Downloaded {so_far + bars:,} candles"

            frame = client.range(
                symbol.source,
                gap_start.to_pydatetime(),
                gap_end.to_pydatetime(),
                "1min",
                on_page=progress,
            )
            added += store.merge_bars(symbol.id, frame)
            store.record_fetch(symbol.id, gap_start, gap_end)
            done_pages = job.pages_done
    except TwelveDataError as exc:
        # Keep whatever arrived before the failure; the range can be retried.
        store.clean(symbol.id)
        raise ValueError(f"{exc} - {added:,} candles were saved before it failed") from exc

    padded = store.clean(symbol.id)
    job.bars, job.padded, job.credits = added - padded, padded, client.requests
    job.message = f"Added {job.bars:,} candles"
    if padded:
        job.message += f", dropped {padded:,} from the closed market"
    return {**_symbol_payload(symbol), "added": job.bars, "padded": padded, "upToDate": False}


@app.get("/api/data/job")
def data_job() -> dict:
    """The running download, or the last finished one, or nothing."""
    return {"job": jobs.current()}


@app.post("/api/data/job/dismiss")
def dismiss_job() -> dict:
    jobs.clear()
    return {"job": jobs.current()}


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
    symbol: str = Field(..., description="symbol id from /api/symbols")
    params: dict[str, Any] = Field(default_factory=dict, description="parameter overrides")
    rangeFrom: int | None = Field(None, description="unix seconds; test from here")
    rangeTo: int | None = Field(None, description="unix seconds; test up to here")


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
        request.rangeFrom,
        request.rangeTo,
        tuple(sorted((k, str(v)) for k, v in request.params.items())),
    )
    with _CACHE_LOCK:
        cached = _CACHE.get(key)
    if cached is not None:
        return {**cached, "cached": True}

    try:
        result = run_backtest(
            request.strategyId, request.symbol, request.params, request.rangeFrom, request.rangeTo
        )
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
class _Frontend(StaticFiles):
    """The built UI, with the cache rules Vite's output asks for.

    index.html is never cached: it names the bundle for this build, and a stale
    copy of it loads a build that is no longer installed. Everything in assets/
    is content-hashed by Vite - the name changes whenever the bytes do - so it
    can be kept for good.
    """

    def file_response(self, full_path, stat_result, scope, status_code: int = 200):
        response = super().file_response(full_path, stat_result, scope, status_code)
        hashed = Path(full_path).parent.name == "assets"
        response.headers["cache-control"] = (
            "public, max-age=31536000, immutable" if hashed else "no-store"
        )
        return response


if os.getenv("FRONTEND_DIR"):
    app.mount("/", _Frontend(directory=os.environ["FRONTEND_DIR"], html=True), name="frontend")
