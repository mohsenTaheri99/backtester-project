"""Static configuration: where data lives and which instruments we serve."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))

# Base resolution of every CSV on disk. Everything else is resampled from it.
BASE_TIMEFRAME = "1m"

# label -> pandas offset alias. Order matters: it is the order shown in the UI.
TIMEFRAMES: dict[str, str] = {
    "1m": "1min",
    "5m": "5min",
    "15m": "15min",
    "30m": "30min",
    "1h": "1h",
    "4h": "4h",
    "1d": "1D",
    "1w": "1W",
}


def timeframe_delta(label: str) -> pd.Timedelta:
    """How long one bar of `label` lasts, e.g. "15m" -> 15 minutes."""
    if label not in TIMEFRAMES:
        raise KeyError(f"unknown timeframe '{label}'")
    return pd.Timedelta(TIMEFRAMES[label])


# Bars returned when the client does not ask for a specific amount.
DEFAULT_LIMIT = 1500
MAX_LIMIT = 20000


@dataclass(frozen=True)
class Symbol:
    id: str            # id used by the API / frontend
    name: str          # human readable
    exchange: str
    source: str        # Yahoo ticker used by app.fetch_data
    csv: str           # file inside DATA_DIR
    price_precision: int = 2


SYMBOLS: dict[str, Symbol] = {
    s.id: s
    for s in [
        Symbol(
            id="XAUUSD",
            name="Gold Futures (front month)",
            exchange="COMEX",
            source="GC=F",
            csv="GCF_1m.csv",
            price_precision=2,
        ),
    ]
}
