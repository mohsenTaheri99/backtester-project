"""Loads the 1-minute CSVs once and derives every other timeframe from them.

Two kinds of symbol share the cache. The bundled sample ships with the app and
its CSV is read-only. Symbols the user imports from a data provider live in
USER_DATA_DIR: the store owns those files and rewrites them whenever history is
downloaded or a live bar arrives, so a restart picks up where the app left off.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass

import pandas as pd

from .config import MAX_LIMIT, SYMBOLS, TIMEFRAMES, Symbol
from .settings import settings

_OHLCV = {
    "open": "first",
    "high": "max",
    "low": "min",
    "close": "last",
    "volume": "sum",
}

_COLUMNS = ["open", "high", "low", "close", "volume"]
_DTYPES = {"open": "float64", "high": "float64", "low": "float64", "close": "float64", "volume": "int64"}


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
        self._symbols: dict[str, Symbol] = {}
        self._base: dict[str, pd.DataFrame] = {}
        self._derived: dict[tuple[str, str], pd.DataFrame] = {}
        # Bumped whenever a symbol's candles change, so caches keyed on it - the
        # backtest cache - cannot serve a result computed from older bars.
        self._versions: dict[str, int] = {}
        self._lock = threading.Lock()

    # -- loading -----------------------------------------------------------
    def load(self) -> None:
        self._symbols = dict(SYMBOLS)
        for entry in settings.get_state("symbols", []) or []:
            try:
                symbol = Symbol(**entry)
            except TypeError as exc:
                print(f"[store] skipping malformed symbol entry: {exc}")
                continue
            self._symbols[symbol.id] = symbol

        for symbol in self._symbols.values():
            path = symbol.path
            if not path.exists():
                hint = (
                    "re-import it in Settings"
                    if symbol.imported
                    else f"run: python -m app.fetch_data --symbol {symbol.source}"
                )
                print(f"[store] missing {path} - {hint}")
                continue
            self._base[symbol.id] = self._read_csv(path)
            print(f"[store] {symbol.id}: {len(self._base[symbol.id])} 1m bars from {path.name}")

    @staticmethod
    def _read_csv(path) -> pd.DataFrame:
        df = pd.read_csv(path)
        df["time"] = pd.to_datetime(df["time"], unit="s", utc=True)
        df = df.set_index("time").sort_index()
        df = df[~df.index.duplicated(keep="last")]
        return df[_COLUMNS].astype(_DTYPES)

    @staticmethod
    def _write_csv(path, frame: pd.DataFrame) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        out = frame.copy()
        out.insert(0, "time", out.index.astype("int64") // 1_000_000_000)
        temp = path.with_suffix(".csv.tmp")
        out.to_csv(temp, index=False)
        temp.replace(path)

    # -- symbols -----------------------------------------------------------
    def symbols(self) -> dict[str, Symbol]:
        return dict(self._symbols)

    def symbol(self, symbol_id: str) -> Symbol | None:
        return self._symbols.get(symbol_id)

    def loaded_symbols(self) -> list[Symbol]:
        return [s for s in self._symbols.values() if s.id in self._base]

    def _persist_catalog(self) -> None:
        settings.set_state(
            "symbols", [s.as_dict() for s in self._symbols.values() if s.imported]
        )

    def add_symbol(self, symbol: Symbol, frame: pd.DataFrame) -> Symbol:
        """Register an imported symbol and write its candles to the user's data dir."""
        if frame.empty:
            raise ValueError(f"no candles returned for {symbol.source}")
        with self._lock:
            self._symbols[symbol.id] = symbol
            self._base[symbol.id] = frame.astype(_DTYPES)
            self._drop_derived(symbol.id)
            self._write_csv(symbol.path, self._base[symbol.id])
        self._persist_catalog()
        return symbol

    def remove_symbol(self, symbol_id: str) -> None:
        symbol = self._symbols.get(symbol_id)
        if symbol is None:
            raise KeyError(f"unknown symbol '{symbol_id}'")
        if not symbol.imported:
            raise ValueError(f"'{symbol_id}' ships with the app and cannot be removed")
        with self._lock:
            self._symbols.pop(symbol_id, None)
            self._base.pop(symbol_id, None)
            self._drop_derived(symbol_id)
            symbol.path.unlink(missing_ok=True)
        self._persist_catalog()

    def merge_bars(self, symbol_id: str, frame: pd.DataFrame) -> int:
        """Fold fresh candles into a symbol. Returns how many bars are new.

        The newest bar of a live poll is still forming, so later copies of the
        same timestamp win.
        """
        symbol = self._symbols.get(symbol_id)
        if symbol is None:
            raise KeyError(f"unknown symbol '{symbol_id}'")
        if frame.empty:
            return 0

        with self._lock:
            current = self._base.get(symbol_id)
            before = 0 if current is None else len(current)
            merged = frame if current is None else pd.concat([current, frame])
            merged = merged[~merged.index.duplicated(keep="last")].sort_index()
            self._base[symbol_id] = merged.astype(_DTYPES)
            self._drop_derived(symbol_id)
            if symbol.imported:
                self._write_csv(symbol.path, self._base[symbol_id])
        return len(self._base[symbol_id]) - before

    def _drop_derived(self, symbol_id: str) -> None:
        """Every resampled timeframe of this symbol is now stale. Caller holds the lock."""
        for key in [k for k in self._derived if k[0] == symbol_id]:
            self._derived.pop(key, None)
        self._versions[symbol_id] = self._versions.get(symbol_id, 0) + 1

    def version(self, symbol_id: str) -> int:
        """Changes every time this symbol's candles do."""
        return self._versions.get(symbol_id, 0)

    # -- access ------------------------------------------------------------
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

    def last_bar_time(self, symbol_id: str) -> int | None:
        df = self._base.get(symbol_id)
        return None if df is None or df.empty else int(df.index[-1].timestamp())


store = CandleStore()
