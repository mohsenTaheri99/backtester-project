"""Loads the 1-minute CSVs once and derives every other timeframe from them."""
from __future__ import annotations

import threading
from dataclasses import dataclass

import pandas as pd

from .config import DATA_DIR, MAX_LIMIT, SYMBOLS, TIMEFRAMES, Symbol

_OHLCV = {
    "open": "first",
    "high": "max",
    "low": "min",
    "close": "last",
    "volume": "sum",
}


@dataclass(frozen=True)
class Candles:
    symbol: str
    timeframe: str
    rows: pd.DataFrame     # the requested slice
    total: int             # bars available in that timeframe
    has_more: bool         # older bars exist before the returned slice


class CandleStore:
    """In-memory candle cache.

    The 1m frame is read from disk at startup; higher timeframes are resampled
    lazily on first request and then kept, since a backtest UI hits the same
    handful of timeframes over and over.
    """

    def __init__(self) -> None:
        self._base: dict[str, pd.DataFrame] = {}
        self._derived: dict[tuple[str, str], pd.DataFrame] = {}
        self._lock = threading.Lock()

    # -- loading -----------------------------------------------------------
    def load(self) -> None:
        for symbol in SYMBOLS.values():
            path = DATA_DIR / symbol.csv
            if not path.exists():
                print(f"[store] missing {path} - run: python -m app.fetch_data --symbol {symbol.source}")
                continue
            self._base[symbol.id] = self._read_csv(path)
            print(f"[store] {symbol.id}: {len(self._base[symbol.id])} 1m bars from {path.name}")

    @staticmethod
    def _read_csv(path) -> pd.DataFrame:
        df = pd.read_csv(path)
        df["time"] = pd.to_datetime(df["time"], unit="s", utc=True)
        df = df.set_index("time").sort_index()
        df = df[~df.index.duplicated(keep="last")]
        return df[["open", "high", "low", "close", "volume"]].astype(
            {"open": "float64", "high": "float64", "low": "float64", "close": "float64", "volume": "int64"}
        )

    # -- access ------------------------------------------------------------
    def loaded_symbols(self) -> list[Symbol]:
        return [s for s in SYMBOLS.values() if s.id in self._base]

    def frame(self, symbol_id: str, timeframe: str) -> pd.DataFrame:
        if symbol_id not in self._base:
            raise KeyError(f"unknown or unloaded symbol '{symbol_id}'")
        if timeframe not in TIMEFRAMES:
            raise KeyError(f"unknown timeframe '{timeframe}'")

        base = self._base[symbol_id]
        if timeframe == "1m":
            return base

        key = (symbol_id, timeframe)
        with self._lock:
            cached = self._derived.get(key)
            if cached is None:
                cached = self._resample(base, TIMEFRAMES[timeframe])
                self._derived[key] = cached
        return cached

    @staticmethod
    def _resample(base: pd.DataFrame, rule: str) -> pd.DataFrame:
        # label/closed="left" => a bar is stamped with the time it opened,
        # which is what charting libraries and backtesters expect.
        out = base.resample(rule, label="left", closed="left", origin="epoch").agg(_OHLCV)
        # Markets close; drop the empty buckets instead of drawing flat gaps.
        return out.dropna(subset=["open"]).astype({"volume": "int64"})

    def candles(
        self,
        symbol_id: str,
        timeframe: str,
        limit: int,
        before: int | None = None,
    ) -> Candles:
        """Return up to `limit` bars, ending at the last bar strictly before `before`."""
        df = self.frame(symbol_id, timeframe)
        limit = max(1, min(limit, MAX_LIMIT))

        if before is not None:
            cutoff = pd.to_datetime(before, unit="s", utc=True)
            df = df[df.index < cutoff]

        total = len(df)
        rows = df.iloc[-limit:] if total else df
        return Candles(
            symbol=symbol_id,
            timeframe=timeframe,
            rows=rows,
            total=len(self.frame(symbol_id, timeframe)),
            has_more=total > len(rows),
        )

    def coverage(self, symbol_id: str) -> tuple[int, int] | None:
        df = self._base.get(symbol_id)
        if df is None or df.empty:
            return None
        return int(df.index[0].timestamp()), int(df.index[-1].timestamp())

    def bar_count(self, symbol_id: str) -> int:
        df = self._base.get(symbol_id)
        return 0 if df is None else len(df)


store = CandleStore()
