"""ICT multi-timeframe liquidity-sweep strategy for gold.

Three timeframes, each with one job:

  1h   direction  - fractal structure; a *close* beyond the last confirmed swing
                    is a break of structure and sets the bias.
  15m  liquidity  - a sweep is a wick through a swing level with the body
                    closing back inside. It opens a 30 minute entry window.
  1m   trigger    - pin bar or engulfing in the bias direction, entered on the
                    close of that candle.

The pin bar may be read on any timeframe (`pin_timeframe`): the pattern is
evaluated on that timeframe's closed candles and fires on the 1m bar where such
a candle completes, so a 5m pin still enters at the 5m close. Engulfing always
stays on the 1m execution grid.

Filters: only buy in discount / sell in premium of the 1h range, and only
during the first 2.5h of the London and New York sessions.

Risk: fixed % of equity per trade, stop under the swept extreme (capped at 100
pips), target at 1:2, stop to break-even once price has travelled 1R.
"""
from __future__ import annotations

from dataclasses import dataclass, fields

import numpy as np
import pandas as pd
from backtesting import Strategy

from ..config import BASE_TIMEFRAME, TIMEFRAMES, timeframe_delta
from .signals import atr, fractal_swings_by_close, fractal_swings_by_extreme, session_mask

LONDON = ("Europe/London", "08:00")
NEW_YORK = ("America/New_York", "08:00")


@dataclass(frozen=True)
class IctParams:
    # --- structure ---
    h1_fractal: int = 5           # candles either side of a 1h swing
    m15_fractal: int = 2          # candles either side of a 15m liquidity pool
    sweep_lookback: int = 40      # how many 15m bars back a pool stays relevant
    sweep_window_min: int = 30    # minutes a sweep stays tradable
    # --- trigger ---
    pin_timeframe: str = "1m"         # timeframe the pin bar is read on
    pin_wick_ratio: float = 2.0       # signal wick >= ratio * body
    pin_opposite_ratio: float = 0.3   # opposite wick <= ratio * signal wick
    allow_pin: bool = True
    allow_engulfing: bool = True
    # --- filters ---
    use_premium_discount: bool = True
    use_sessions: bool = True
    session_minutes: int = 150
    # --- risk ---
    risk_pct: float = 1.0
    reward_ratio: float = 2.0
    max_sl_pips: float = 100.0
    min_sl_pips: float = 10.0
    sl_buffer_atr: float = 0.5
    atr_period: int = 14
    breakeven_at_r: float = 1.0
    pip_size: float = 0.1         # gold: 1 pip = $0.10
    # --- account ---
    start_trading_at: float = 0.0  # unix seconds; 0 = trade the whole dataset
    cash: float = 10_000.0
    leverage: float = 100.0
    spread_usd: float = 0.30

    def __post_init__(self) -> None:
        if self.pin_timeframe not in TIMEFRAMES:
            raise ValueError(
                f"pin_timeframe '{self.pin_timeframe}' is not a known timeframe "
                f"(have: {', '.join(TIMEFRAMES)})"
            )

    @property
    def session_windows(self) -> list[tuple[str, str, int]]:
        return [(tz, start, self.session_minutes) for tz, start in (LONDON, NEW_YORK)]


# ---------------------------------------------------------------------------
# context: everything the 1m loop needs to know, stamped with when it was known
# ---------------------------------------------------------------------------
def htf_context(h1: pd.DataFrame, p: IctParams) -> pd.DataFrame:
    """Bias and the premium/discount range, as known at each 1h close."""
    highs, lows = fractal_swings_by_close(h1, p.h1_fractal, minutes=60)
    closes = h1.index + pd.Timedelta(minutes=60)

    pending_h, pending_l = list(highs), list(lows)
    confirmed_high: float | None = None
    confirmed_low: float | None = None
    bias = 0
    rows = []

    for i, close_time in enumerate(closes):
        close = float(h1["close"].iloc[i])

        # Swings whose right-hand confirmation lands on this bar become usable now.
        while pending_h and pending_h[0][0] <= close_time:
            confirmed_high = pending_h.pop(0)[1]
        while pending_l and pending_l[0][0] <= close_time:
            confirmed_low = pending_l.pop(0)[1]

        # Break of structure needs a close beyond the level, not just a touch.
        if confirmed_high is not None and close > confirmed_high:
            bias = 1
        elif confirmed_low is not None and close < confirmed_low:
            bias = -1

        rows.append(
            {
                "available_at": close_time,
                "bias": bias,
                "range_high": confirmed_high if confirmed_high is not None else np.nan,
                "range_low": confirmed_low if confirmed_low is not None else np.nan,
            }
        )

    ctx = pd.DataFrame(rows).set_index("available_at")
    ctx["equilibrium"] = (ctx["range_high"] + ctx["range_low"]) / 2
    # A range only makes sense while the high really is above the low.
    ctx.loc[~(ctx["range_high"] > ctx["range_low"]), "equilibrium"] = np.nan
    return ctx


def m15_sweeps(m15: pd.DataFrame, p: IctParams) -> pd.DataFrame:
    """Liquidity sweeps: wick through a pool, body closing back inside it."""
    highs, lows = fractal_swings_by_extreme(m15, p.m15_fractal, minutes=15)
    closes = m15.index + pd.Timedelta(minutes=15)
    positions = {ts: i for i, ts in enumerate(m15.index)}
    high = m15["high"].to_numpy()
    low = m15["low"].to_numpy()
    close = m15["close"].to_numpy()

    pool_highs: list[tuple[int, float]] = []  # (bar index of the pool, level)
    pool_lows: list[tuple[int, float]] = []
    next_h, next_l = 0, 0
    rows = []

    for i, close_time in enumerate(closes):
        while next_h < len(highs) and highs[next_h][0] <= close_time:
            _, level, swing_time = highs[next_h]
            pool_highs.append((positions[swing_time], level))
            next_h += 1
        while next_l < len(lows) and lows[next_l][0] <= close_time:
            _, level, swing_time = lows[next_l]
            pool_lows.append((positions[swing_time], level))
            next_l += 1

        oldest = i - p.sweep_lookback

        # Bearish sweep: ran the stops above a high, then closed back under it.
        swept_high = next(
            (
                lvl
                for idx, lvl in reversed(pool_highs)
                if oldest <= idx < i and high[i] > lvl and close[i] < lvl
            ),
            None,
        )
        # Bullish sweep: the mirror image below a low.
        swept_low = next(
            (
                lvl
                for idx, lvl in reversed(pool_lows)
                if oldest <= idx < i and low[i] < lvl and close[i] > lvl
            ),
            None,
        )

        direction, level, extreme = 0, np.nan, np.nan
        if swept_low is not None and swept_high is None:
            direction, level, extreme = 1, swept_low, float(low[i])
        elif swept_high is not None and swept_low is None:
            direction, level, extreme = -1, swept_high, float(high[i])
        # A bar that swept both sides is noise, not a setup: leave it at 0.

        if direction:
            rows.append(
                {
                    "available_at": close_time,
                    "sweep_dir": direction,
                    "sweep_level": level,
                    "sweep_extreme": extreme,
                    "sweep_expires": close_time + pd.Timedelta(minutes=p.sweep_window_min),
                }
            )

    if not rows:
        return pd.DataFrame(
            columns=["sweep_dir", "sweep_level", "sweep_extreme", "sweep_expires"],
            index=pd.DatetimeIndex([], tz="UTC", name="available_at"),
        )
    return pd.DataFrame(rows).set_index("available_at")


def build_context(
    m1: pd.DataFrame,
    m15: pd.DataFrame,
    h1: pd.DataFrame,
    p: IctParams,
    pin: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Project every higher-timeframe fact onto the 1m grid, without leaking.

    A 1m bar opening at T is matched with the newest context whose
    `available_at` is <= T, i.e. information that was already public before the
    bar even started. `pin` holds the candles of `p.pin_timeframe`; it defaults
    to the 1m frame, which is what "1m" resamples to anyway.
    """
    ctx = pd.DataFrame(index=m1.index)

    htf = htf_context(h1, p).reindex(m1.index, method="ffill")
    ctx["bias"] = htf["bias"].fillna(0).astype(int)
    ctx["range_high"] = htf["range_high"]
    ctx["range_low"] = htf["range_low"]
    ctx["equilibrium"] = htf["equilibrium"]

    sweeps = m15_sweeps(m15, p)
    if len(sweeps):
        aligned = sweeps.reindex(m1.index, method="ffill")
        expired = aligned["sweep_expires"].isna() | (aligned["sweep_expires"] < m1.index)
        ctx["sweep_dir"] = aligned["sweep_dir"].where(~expired, 0).fillna(0).astype(int)
        ctx["sweep_level"] = aligned["sweep_level"].where(~expired)
        ctx["sweep_extreme"] = aligned["sweep_extreme"].where(~expired)
    else:
        ctx["sweep_dir"] = 0
        ctx["sweep_level"] = np.nan
        ctx["sweep_extreme"] = np.nan

    triggers = pin_triggers(m1 if pin is None else pin, m1.index, p)
    ctx["pin_bull"] = triggers["pin_bull"]
    ctx["pin_bear"] = triggers["pin_bear"]

    ctx["in_session"] = (
        session_mask(m1.index, p.session_windows)
        if p.use_sessions
        else np.ones(len(m1), dtype=bool)
    )
    ctx["atr"] = atr(m1, p.atr_period)
    return ctx


# ---------------------------------------------------------------------------
# 1m entry triggers
# ---------------------------------------------------------------------------
def pin_flags(df: pd.DataFrame, p: IctParams) -> tuple[np.ndarray, np.ndarray]:
    """(bullish, bearish) pin bar per candle of `df`, whatever its timeframe."""
    o = df["open"].to_numpy()
    h = df["high"].to_numpy()
    l = df["low"].to_numpy()
    c = df["close"].to_numpy()

    body = np.abs(c - o)
    upper = h - np.maximum(o, c)
    lower = np.minimum(o, c) - l

    has_body = body > 0
    bullish = has_body & (lower >= p.pin_wick_ratio * body) & (upper <= p.pin_opposite_ratio * lower)
    bearish = has_body & (upper >= p.pin_wick_ratio * body) & (lower <= p.pin_opposite_ratio * upper)
    return bullish, bearish


def pin_triggers(pin: pd.DataFrame, m1_index: pd.DatetimeIndex, p: IctParams) -> pd.DataFrame:
    """Pin bars of `pin_timeframe`, stamped on the 1m bar that closes with them.

    A candle covering [T, T + tf) is only complete at T + tf, so the entry lands
    on the 1m bar closing at that instant - the bar opening one minute earlier.
    When the data has a gap there and no such 1m bar exists, the trigger is
    dropped rather than pulled backwards, which would be reading the future.
    """
    bullish, bearish = pin_flags(pin, p)
    fired = bullish | bearish
    if not fired.any():
        return pd.DataFrame({"pin_bull": False, "pin_bear": False}, index=m1_index)

    closes = pin.index[fired] + timeframe_delta(p.pin_timeframe)
    entries = closes - timeframe_delta(BASE_TIMEFRAME)

    at = pd.DataFrame(
        {"pin_bull": bullish[fired], "pin_bear": bearish[fired]}, index=entries
    )
    # Exact match only: an entry time missing from the 1m grid is a data gap.
    return at.reindex(m1_index, fill_value=False).astype(bool)


def engulfing_at(o: float, c: float, po: float, pc: float, direction: int) -> bool:
    """A 1m candle in `direction` that swallows the previous candle's body."""
    prev_low, prev_high = min(po, pc), max(po, pc)
    if direction == 1:
        return c > o and pc < po and o <= prev_low and c >= prev_high
    return c < o and pc > po and o >= prev_high and c <= prev_low


# ---------------------------------------------------------------------------
# the strategy itself (runs bar by bar on 1m)
# ---------------------------------------------------------------------------
class IctSweepStrategy(Strategy):
    params: IctParams = IctParams()
    context: pd.DataFrame | None = None
    spread_rel: float = 0.0  # broker spread as a fraction of price, set by the runner

    def init(self) -> None:
        p, ctx = self.params, self.context
        assert ctx is not None, "context must be attached before running"

        self._bias = ctx["bias"].to_numpy()
        self._sweep_dir = ctx["sweep_dir"].to_numpy()
        self._sweep_extreme = ctx["sweep_extreme"].to_numpy()
        self._sweep_level = ctx["sweep_level"].to_numpy()
        self._equilibrium = ctx["equilibrium"].to_numpy()
        self._in_session = ctx["in_session"].to_numpy()
        self._pin_bull = ctx["pin_bull"].to_numpy()
        self._pin_bear = ctx["pin_bear"].to_numpy()
        self._atr = ctx["atr"].to_numpy()

        self._trade_from = (
            pd.Timestamp(p.start_trading_at, unit="s", tz="UTC") if p.start_trading_at else None
        )
        self._max_sl = p.max_sl_pips * p.pip_size
        self._min_sl = p.min_sl_pips * p.pip_size
        self._warmup = max(p.atr_period, 2)
        self.rejections: dict[str, int] = {}

    def _reject(self, reason: str) -> None:
        self.rejections[reason] = self.rejections.get(reason, 0) + 1

    def next(self) -> None:
        i = len(self.data) - 1
        if i < self._warmup:
            return
        # Forward testing replays the full history for context but must not open
        # a trade on a bar that had already printed when the session started.
        if self._trade_from is not None and self.data.index[-1] < self._trade_from:
            return

        p = self.params
        price = float(self.data.Close[-1])

        # --- manage the open trade first ------------------------------------
        if self.position:
            for trade in self.trades:
                risk = abs(trade.entry_price - trade.sl) if trade.sl else 0.0
                if not risk or p.breakeven_at_r <= 0:
                    continue
                moved_1r = (
                    float(self.data.High[-1]) - trade.entry_price >= p.breakeven_at_r * risk
                    if trade.is_long
                    else trade.entry_price - float(self.data.Low[-1]) >= p.breakeven_at_r * risk
                )
                safe = trade.sl >= trade.entry_price if trade.is_long else trade.sl <= trade.entry_price
                if moved_1r and not safe:
                    trade.sl = trade.entry_price  # risk-free from here on
            return  # one position at a time

        # --- filters ---------------------------------------------------------
        bias = int(self._bias[i])
        if bias == 0:
            return
        if self._sweep_dir[i] != bias:
            self._reject("no_active_sweep")
            return
        if not self._in_session[i]:
            self._reject("outside_session")
            return

        equilibrium = self._equilibrium[i]
        if p.use_premium_discount:
            if np.isnan(equilibrium):
                self._reject("no_range")
                return
            if bias == 1 and price >= equilibrium:
                self._reject("not_in_discount")
                return
            if bias == -1 and price <= equilibrium:
                self._reject("not_in_premium")
                return

        # The pin bar closed on its own timeframe together with this 1m bar;
        # engulfing is read on the 1m bar itself.
        pin_fired = bool(self._pin_bull[i] if bias == 1 else self._pin_bear[i])
        pattern = None
        if p.allow_pin and pin_fired:
            pattern = "pin"
        elif p.allow_engulfing and engulfing_at(
            float(self.data.Open[-1]),
            price,
            float(self.data.Open[-2]),
            float(self.data.Close[-2]),
            bias,
        ):
            pattern = "engulfing"
        if pattern is None:
            self._reject("no_trigger")
            return

        # --- stop, target, size ----------------------------------------------
        extreme = self._sweep_extreme[i]
        if np.isnan(extreme):
            self._reject("no_sweep_extreme")
            return

        # Measure risk from the price we will actually be filled at (the close
        # plus the spread), so 1R really is 1R and the 1:2 target is exact.
        fill = price * (1 + self.spread_rel) if bias == 1 else price * (1 - self.spread_rel)

        buffer = p.sl_buffer_atr * (0.0 if np.isnan(self._atr[i]) else self._atr[i])
        stop = extreme - buffer if bias == 1 else extreme + buffer
        distance = abs(fill - stop)
        if distance < self._min_sl:
            self._reject("stop_too_tight")
            return
        distance = min(distance, self._max_sl)  # hard 100 pip cap
        stop = fill - distance if bias == 1 else fill + distance
        target = fill + p.reward_ratio * distance if bias == 1 else fill - p.reward_ratio * distance

        units = int(round((self.equity * p.risk_pct / 100) / distance))
        if units < 1:
            self._reject("size_below_one_unit")
            return

        tag = {
            "pattern": pattern,
            "initialSl": round(stop, 4),
            "target": round(target, 4),
            "sweepLevel": float(self._sweep_level[i]),
            "sweepExtreme": float(extreme),
            "entryRef": round(fill, 4),
            "riskPerUnit": round(distance, 4),
            "slPips": round(distance / p.pip_size, 1),
        }
        (self.buy if bias == 1 else self.sell)(size=units, sl=stop, tp=target, tag=tag)


# Curated controls for the UI. Every dataclass field is still accepted by the
# API; these are just the ones worth putting a knob on.
PARAM_UI: list[dict] = [
    {"name": "risk_pct", "label": "Risk per trade", "group": "Risk", "unit": "%", "min": 0.1, "max": 5, "step": 0.1},
    {"name": "reward_ratio", "label": "Reward ratio", "group": "Risk", "unit": "R", "min": 0.5, "max": 10, "step": 0.5},
    {"name": "max_sl_pips", "label": "Max stop", "group": "Risk", "unit": "pips", "min": 10, "max": 500, "step": 10},
    {"name": "breakeven_at_r", "label": "Break-even at", "group": "Risk", "unit": "R", "min": 0, "max": 3, "step": 0.25},
    {"name": "sl_buffer_atr", "label": "Stop buffer", "group": "Risk", "unit": "x ATR", "min": 0, "max": 3, "step": 0.1},
    {"name": "sweep_window_min", "label": "Sweep window", "group": "Setup", "unit": "min", "min": 5, "max": 240, "step": 5},
    {"name": "sweep_lookback", "label": "Pool lookback", "group": "Setup", "unit": "15m bars", "min": 5, "max": 200, "step": 5},
    {"name": "h1_fractal", "label": "1h fractal", "group": "Setup", "unit": "bars", "min": 2, "max": 10, "step": 1},
    {"name": "m15_fractal", "label": "15m fractal", "group": "Setup", "unit": "bars", "min": 1, "max": 10, "step": 1},
    {"name": "use_sessions", "label": "London + New York only", "group": "Filters"},
    {"name": "use_premium_discount", "label": "Premium / discount", "group": "Filters"},
    {"name": "allow_pin", "label": "Pin bar trigger", "group": "Filters"},
    {
        "name": "pin_timeframe",
        "label": "Pin bar timeframe",
        "group": "Filters",
        "options": list(TIMEFRAMES),
    },
    {"name": "allow_engulfing", "label": "Engulfing trigger", "group": "Filters"},
    {"name": "cash", "label": "Starting cash", "group": "Account", "unit": "$", "min": 1000, "max": 1_000_000, "step": 1000},
    {"name": "pip_size", "label": "Pip size", "group": "Account", "unit": "$", "min": 0.00001, "max": 1, "step": 0.00001},
    {"name": "spread_usd", "label": "Spread", "group": "Account", "unit": "$", "min": 0, "max": 2, "step": 0.05},
]


class StrategyInfo:
    id = "ict_sweep"
    name = "ICT multi-timeframe liquidity sweep"
    description = (
        "1h break of structure sets the bias, a 15m liquidity sweep opens a 30 minute "
        "window, and a pin bar or engulfing candle triggers the entry. The pin bar is "
        "read on the timeframe you pick; engulfing stays on 1m. Buys only in discount, "
        "sells only in premium, London and New York openings only."
    )
    timeframes = {"bias": "1h", "liquidity": "15m", "trigger": "1m"}
    strategy = IctSweepStrategy
    params = IctParams
    param_names = [f.name for f in fields(IctParams)]
    param_ui = PARAM_UI


ICT_SWEEP = StrategyInfo()
