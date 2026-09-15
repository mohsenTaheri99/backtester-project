"""Price-action primitives shared by the strategies.

Everything here is written so a value is only ever produced at the moment it
could really be known: a fractal swing needs `k` candles to its right, so it is
stamped with the close time of that k-th candle, never the swing's own time.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

Swing = tuple[pd.Timestamp, float, pd.Timestamp]  # (confirmed_at, level, swing_time)


def bar_close_times(df: pd.DataFrame, minutes: int) -> pd.DatetimeIndex:
    """Bars are stamped at their open, so they are only known `minutes` later."""
    return df.index + pd.Timedelta(minutes=minutes)


def fractal_swings_by_close(df: pd.DataFrame, k: int, minutes: int) -> tuple[list[Swing], list[Swing]]:
    """Swings where the k candles on each side *closed* beyond the pivot's close.

    This follows the strategy document ("five candles left and right closed
    lower"). The level handed back is the pivot's high/low, since that is the
    price that actually gets broken or swept.
    """
    close = df["close"].to_numpy()
    high = df["high"].to_numpy()
    low = df["low"].to_numpy()
    closes = bar_close_times(df, minutes)

    highs: list[Swing] = []
    lows: list[Swing] = []
    for i in range(k, len(df) - k):
        left, right = close[i - k : i], close[i + 1 : i + k + 1]
        if (left < close[i]).all() and (right < close[i]).all():
            highs.append((closes[i + k], float(high[i]), df.index[i]))
        elif (left > close[i]).all() and (right > close[i]).all():
            lows.append((closes[i + k], float(low[i]), df.index[i]))
    return highs, lows


def fractal_swings_by_extreme(df: pd.DataFrame, k: int, minutes: int) -> tuple[list[Swing], list[Swing]]:
    """Classic fractal: the pivot's high/low is the extreme of its +/-k window.

    Used for liquidity pools, where what matters is the wick that stops are
    resting under, not where the candles closed.
    """
    high = df["high"].to_numpy()
    low = df["low"].to_numpy()
    closes = bar_close_times(df, minutes)

    highs: list[Swing] = []
    lows: list[Swing] = []
    for i in range(k, len(df) - k):
        window_h = high[i - k : i + k + 1]
        window_l = low[i - k : i + k + 1]
        if high[i] == window_h.max() and (high[i] > np.delete(window_h, k)).all():
            highs.append((closes[i + k], float(high[i]), df.index[i]))
        if low[i] == window_l.min() and (low[i] < np.delete(window_l, k)).all():
            lows.append((closes[i + k], float(low[i]), df.index[i]))
    return highs, lows


def atr(df: pd.DataFrame, period: int) -> pd.Series:
    """Wilder ATR, shifted so a bar only sees ranges that already completed."""
    high, low, close = df["high"], df["low"], df["close"]
    prev_close = close.shift(1)
    true_range = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)
    return true_range.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()


def session_mask(index: pd.DatetimeIndex, windows: list[tuple[str, str, int]]) -> np.ndarray:
    """True where the timestamp falls inside one of the (tz, "HH:MM", minutes) windows.

    Each window is evaluated in its own timezone so DST shifts follow the local
    market rather than a fixed UTC offset.
    """
    inside = np.zeros(len(index), dtype=bool)
    for tz, start, minutes in windows:
        local = index.tz_convert(tz)
        start_h, start_m = (int(part) for part in start.split(":"))
        minute_of_day = local.hour * 60 + local.minute
        begin = start_h * 60 + start_m
        inside |= (minute_of_day >= begin) & (minute_of_day < begin + minutes)
    return inside
