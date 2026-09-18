# Strategy

The shipped strategy is an ICT / smart-money multi-timeframe liquidity sweep
on gold. The human-written spec is `backend/strategy-description.md` (Persian);
the implementation is `backend/app/strategies/ict_sweep.py`, with shared
price-action helpers in `signals.py`.

## The three layers

| Layer | TF | Rule | Code |
|---|---|---|---|
| Direction | 1h | Fractal swings, 5 bars either side, compared by **close**. A close beyond the last confirmed swing high/low is a break of structure and flips the bias. | `htf_context()` |
| Liquidity | 15m | A pool is a fractal high/low (2 bars either side, by wick) from the last 40 bars. A sweep is a wick through the pool with the body **closing back inside**. It opens a 30-minute window. A bar that sweeps both sides is ignored. | `m15_sweeps()` |
| Trigger | 1m | Pin bar (signal wick ≥ 2× body, opposite wick ≤ 0.3× signal wick) or engulfing candle, in the bias direction. Entry on that candle's close. | `trigger_at()` |

### Filters

- **Premium / discount** — the 1h range is the last confirmed swing high and
  low; equilibrium is their midpoint. Longs only below it, shorts only above it.
- **Sessions** — only the first 150 minutes after 08:00 London and 08:00 New
  York. Both openings and the window length are parameters; each window uses
  its own timezone, so daylight-saving changes follow the local market, and a
  window that runs past local midnight wraps into the next day
  (`session_mask()` in `signals.py`).

### Risk and trade management

- **Stop** — beyond the swept extreme plus `0.5 × ATR(14)`, capped at 100 pips
  (gold: 1 pip = $0.10). The `min_sl_pips` floor is only there to keep the stop
  off the entry price and defaults to 1 pip: a stop may be as tight as the
  structure makes it, it just may not be wider than the cap.
- **Target** — `reward_ratio × risk`, 2R by default.
- **Break-even** — once price has moved 1R in favour, the stop moves to entry.
- **Size** — units such that hitting the stop loses `risk_pct` (1%) of equity,
  then capped at what `leverage` lets the account carry. A very tight stop asks
  for a position the broker would refuse outright, and a refused order leaves
  nothing in the funnel to explain the missing trade, so it is sized down to fit
  instead.
- **One position at a time.**
- Risk is measured from the **expected fill** (close ± spread), so a stopped
  trade is exactly −1.00R and a target hit is exactly +2.00R.

All of these are fields on the `IctParams` dataclass, and every one of them
except `start_trading_at` (which the range picker and forward testing set) has a
control in the setup tab, grouped as Structure, Trigger, Filters, Risk and
Account. Each control carries a one-line `description` explaining what the rule
does, so the rules live next to the knob rather than only in this file.

## No lookahead

The most important property of the implementation: **a 1m bar that opens at
time T only sees information that was public at T.**

- Bars are stamped at their open, so a bar is only *known* at open + its length
  (`bar_close_times()`).
- A fractal swing needs `k` bars to its right, so it is stamped with the close
  time of the k-th bar — not the swing's own time.
- `htf_context()` and `m15_sweeps()` emit rows indexed by `available_at`.
- `build_context()` forward-fills those rows onto the 1m index with
  `reindex(method="ffill")`, so each 1m bar gets the newest fact whose
  `available_at ≤ T`. Expired sweeps are masked out.
- ATR is a Wilder EMA over completed true ranges.

If you add a signal, give it an `available_at` timestamp in the same way before
it touches the 1m grid.

## Bar-by-bar loop (`IctSweepStrategy.next`)

```
open position?  → maybe move stop to break-even; stop
bias == 0?      → stop
no live sweep in bias direction   → reject "no_active_sweep"
outside session                   → reject "outside_session"
no 1h range yet                   → reject "no_range"
long above / short below eq.      → reject "not_in_discount" / "not_in_premium"
no pin or engulfing               → reject "no_trigger"
sweep extreme missing             → reject "no_sweep_extreme"
stop tighter than minimum         → reject "stop_too_tight"
size rounds to 0 units            → reject "size_below_one_unit"
otherwise                         → buy/sell with sl, tp and a tag
```

The rejection counters are returned as `rejections` and shown in the Results
tab as a funnel. Each 1m bar is counted once, at the first filter that stops it -
which is also what lets the UI explain a run that found nothing by naming the
filter that rejected the most bars.

A forward test runs this same loop, with `start_trading_at` set to the moment the
session began: earlier bars build the bias and the sweeps, but no trade may open
on a bar that had already printed.

## A word on results

How much data you test on decides what the output is worth. A month of 1m bars
produces roughly 20 trades - far too few to judge anything. With a 1:2 target
the break-even win rate is about 33-38%, and hundreds of trades are needed for a
verdict. Treat the output as proof the engine works, not as evidence about the
edge.

A short sample often produces **no** trades at all, because a 1h break of
structure, a 15m sweep and a session window rarely coincide inside a week. That
is not a broken strategy, and the Results tab says so: it names the filter that
rejected the most bars and how many trading days were actually tested. Ninety
days is a fairer test.

## Adding a strategy

1. **Params** — a frozen dataclass with every tunable value and its default.
2. **Context** (optional) — a function that precomputes higher-timeframe facts
   onto the base grid, respecting the no-lookahead rule.
3. **Strategy** — a `backtesting.Strategy` subclass. Read `self.params` and
   `self.context`; call `self.buy` / `self.sell` with `sl`, `tp`, and a `tag`
   dict containing at least `initialSl` and `riskPerUnit` (used for R multiples
   and the chart's position tool). Optionally keep `self.rejections`.
4. **Info** — an object with `id`, `name`, `description`, `timeframes`
   (`bias`, `liquidity`, `trigger`), `strategy`, `params`, `param_names` and a
   `param_ui` list for the controls worth exposing.
5. **Register** it in `strategies/__init__.py`'s `REGISTRY`.

The API and the UI form pick it up automatically.

> Note: `backtest.py` currently calls `build_context` from the strategies
> package and fetches three timeframes by role. A strategy with a different
> shape will need a small change there, e.g. letting the info object provide
> its own context builder.
