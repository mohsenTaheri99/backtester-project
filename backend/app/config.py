"""Static configuration: where data lives and which instruments we serve."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

# Re-exported so importers keep getting the version from config, where it used
# to live; see version.py for why it now sits in a module of its own.
from .version import APP_VERSION as APP_VERSION

DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))

# Everything the user creates - settings, downloaded candles - lives outside the
# installation, so an upgrade never overwrites it and no admin rights are needed.
USER_DIR = Path(
    os.getenv("USER_DIR")
    or Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "GoldBacktester"
)
USER_DATA_DIR = USER_DIR / "data"

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
    source: str        # ticker at the provider (Yahoo for the bundled sample)
    csv: str           # file name inside DATA_DIR, or USER_DATA_DIR when imported
    price_precision: int = 2
    provider: str = ""  # "twelvedata" for imported symbols; "" cannot go live
    imported: bool = False  # user-added: candles live in USER_DATA_DIR and are ours to write
    market: str = "always"  # trading calendar; see app.market_hours
    # What has been *asked* of the provider, which is wider than the candles we
    # kept: a closed weekend is fetched once and then correctly comes back empty.
    fetched_from: int = 0
    fetched_to: int = 0

    @property
    def path(self) -> Path:
        return (USER_DATA_DIR if self.imported else DATA_DIR) / self.csv

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "exchange": self.exchange,
            "source": self.source,
            "csv": self.csv,
            "price_precision": self.price_precision,
            "provider": self.provider,
            "imported": self.imported,
            "market": self.market,
            "fetched_from": self.fetched_from,
            "fetched_to": self.fetched_to,
        }


# Symbols that ship with the app: none. Every instrument is imported from a
# data provider in Settings -> Market data and cached under USER_DATA_DIR, so
# the app carries no sample dataset and nothing that cannot stream or forward
# test. DATA_DIR stays for the non-imported side of Symbol.path.
SYMBOLS: dict[str, Symbol] = {}
