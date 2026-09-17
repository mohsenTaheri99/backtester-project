"""Finds and removes the candles a provider invents while a market is shut.

Spot FX and metals close for the weekend, but some feeds - Twelve Data among
them - keep emitting 1-minute candles through it, holding the last price and
jittering it by a few cents. A weekend of that is ~2,880 candles whose total
range is under a dollar. Left in, they hand the strategy fake swing points, fake
liquidity sweeps and a deflated ATR, and they draw as a long flat stretch on the
chart.

The padding is *detected* rather than assumed from a calendar. Providers do not
agree on when the week ends - this one closes at 22:00 UTC, an hour after New
York's 17:00 - and a calendar cannot know about Good Friday or Christmas. What
padding always is, whatever the reason, is a long run of hours in which the
price does not move.

Measured on 90 days of XAU/USD, the two populations do not overlap: quiet spells
inside a trading week last at most 3 hours, while every weekend runs 19 hours or
more. `MIN_DEAD_HOURS` sits in that gap.
"""
from __future__ import annotations

import re

import numpy as np
import pandas as pd

# Markets whose feed we are willing to second-guess. An equity's thin pre-market
# hour is real trading, so those are left exactly as delivered.
FX = "fx"            # spot FX, gold, silver: closed over the weekend
ALWAYS = "always"    # crypto, equities, anything we should not touch

# An hour is dead if it moves less than this much of a typical hour.
DEAD_RATIO = 0.10
# ... and only a run this long counts as the market being shut.
MIN_DEAD_HOURS = 6
# Below this there is not enough data to know what "typical" means.
MIN_HOURS_TO_JUDGE = 72

_METALS = ("XAU", "XAG", "XPT", "XPD")
_FX_TYPES = ("precious metal", "physical currency", "forex", "currency")
_ALWAYS_TYPES = ("digital currency", "cryptocurrency", "crypto")


def market_for(ticker: str, instrument_type: str = "") -> str:
    """Whether a symbol's feed pads, from the provider's own classification.

    Falls back to the ticker's shape, because a symbol can be imported without
    ever going through search.
    """
    kind = (instrument_type or "").strip().lower()
    if any(word in kind for word in _ALWAYS_TYPES):
        return ALWAYS
    if any(word in kind for word in _FX_TYPES):
        return FX

    symbol = (ticker or "").upper()
    if symbol.startswith(_METALS):
        return FX
    if re.fullmatch(r"[A-Z]{3}/[A-Z]{3}", symbol):
        return FX  # a currency pair; crypto pairs were caught by type above
    return ALWAYS


def _dead_runs(dead: np.ndarray) -> np.ndarray:
    """Keep only the True values that belong to a run of MIN_DEAD_HOURS or more."""
    out = np.zeros_like(dead)
    start = None
    for i, is_dead in enumerate(dead):
        if is_dead and start is None:
            start = i
        elif not is_dead and start is not None:
            if i - start >= MIN_DEAD_HOURS:
                out[start:i] = True
            start = None
    if start is not None and len(dead) - start >= MIN_DEAD_HOURS:
        out[start:] = True
    return out


def padding_mask(frame: pd.DataFrame) -> np.ndarray:
    """True for each 1m candle that belongs to a shut market."""
    if frame.empty:
        return np.zeros(len(frame), dtype=bool)

    hourly = frame.resample("1h").agg({"high": "max", "low": "min"})
    span = (hourly["high"] - hourly["low"]).dropna()
    if len(span) < MIN_HOURS_TO_JUDGE:
        return np.zeros(len(frame), dtype=bool)

    median = float(span.median())
    if median <= 0:
        return np.zeros(len(frame), dtype=bool)

    shut = pd.Series(_dead_runs((span < median * DEAD_RATIO).to_numpy()), index=span.index)
    return shut.reindex(frame.index.floor("h"), fill_value=False).to_numpy()


def drop_padding(frame: pd.DataFrame, market: str) -> pd.DataFrame:
    """The frame with every invented candle removed."""
    if market != FX or frame.empty:
        return frame
    return frame[~padding_mask(frame)]
