# Backend

Python 3.12, FastAPI, pandas and backtesting.py. Everything lives in
`backend/app/`.

| Module | Role |
|---|---|
| `config.py` | Static config: `DATA_DIR`, `TIMEFRAMES`, `DEFAULT_LIMIT` / `MAX_LIMIT`, `SYMBOLS` |
| `store.py` | `CandleStore`: loads CSVs, resamples, slices pages |
| `main.py` | FastAPI app and routes, backtest result cache |
| `backtest.py` | Runs a strategy with backtesting.py and turns the output into JSON |
| `fetch_data.py` | CLI downloader, see [Data](data.md) |
| `strategies/` | Strategy registry and implementations, see [Strategy](strategy.md) |

## Configuration (`config.py`)

- `DATA_DIR` — from the `DATA_DIR` env var, else `backend/data`.
- `TIMEFRAMES` — label → pandas offset. Order is the order shown in the UI.
- `DEFAULT_LIMIT = 1500`, `MAX_LIMIT = 20000` — bars per candles request.
- `SYMBOLS` — one `Symbol` dataclass per instrument.

## The candle store (`store.py`)

A single module-level `store = CandleStore()`, loaded in FastAPI's `lifespan`.

- `_base[symbol]` — the 1m DataFrame (UTC `DatetimeIndex`, float OHLC, int volume).
- `_derived[(symbol, tf)]` — resampled frames, built lazily under a lock.
- `candles(symbol, tf, limit, before)` — filters to bars strictly older than
  `before` (if given), takes the last `limit` rows, and reports:
  - `total` — bars in that timeframe overall;
  - `has_more` — whether older bars exist before the returned slice.

`before` + `hasMore` are what make the chart's infinite scroll-back work.

## API (`main.py`)

| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | `{status, symbols}` — used by the Docker healthcheck |
| GET | `/api/symbols` | instruments with bar count, coverage (`from`/`to`), precision, timeframes |
| GET | `/api/timeframes` | timeframe labels |
| GET | `/api/candles` | `{symbol, timeframe, count, total, hasMore, candles[]}` |
| GET | `/api/strategies` | each strategy's id, name, description, timeframes, defaults and UI controls |
| POST | `/api/backtest` | summary, trades, equity curve, rejection funnel |

Interactive docs: http://localhost:8000/docs.

Errors: unknown symbol → 404, unknown timeframe → 400, unknown strategy → 404,
parameters the dataclass rejects → 400.

### How `/api/strategies` describes parameters

`_describe()` combines the strategy's params dataclass (for defaults and types)
with its `PARAM_UI` list (label, group, unit, min/max/step). Types are reduced to
`bool`, `int` or `float`, which is all the frontend form needs. Only fields in
`PARAM_UI` get a control, but **every** dataclass field is accepted by
`/api/backtest`.

### Backtest cache

Results are cached by `(strategyId, symbol, sorted params)`, up to 16 entries,
oldest evicted first. A cached response has `"cached": true`. The cache is
in-process, so it resets when the backend restarts (including on hot reload).

## The backtest runner (`backtest.py`)

`run_backtest(strategy_id, symbol, overrides)`:

1. **Params** — builds the strategy's params dataclass from the request,
   silently dropping unknown keys and `null` values.
2. **Frames** — fetches the timeframes the strategy declares
   (`info.timeframes`: `trigger`, `liquidity`, `bias`) from the store.
3. **Context** — `build_context(m1, m15, h1, params)` precomputes every
   higher-timeframe fact on the 1m grid (see [Strategy](strategy.md)).
4. **Run** — creates a per-run subclass of the strategy carrying `params`,
   `context` and `spread_rel`, so concurrent runs never share state, then runs
   `Backtest(...)` with:
   - `cash`, `margin = 1 / leverage`, `spread` as a fraction of the mean price;
   - `trade_on_close=True` — entries fill on the trigger candle's close;
   - `finalize_trades=True` — a position still open at the end is counted.
5. **Shape** — converts backtesting.py's output into JSON:
   - `summary` — its stats plus wins / losses / break-evens and gross P&L;
   - `trades` — one object per trade, with extras the strategy put in the
     trade `tag` (`initialSl`, `riskPerUnit`, `pattern`, `sweepLevel`, `slPips`),
     an `rMultiple`, and an `exitReason` inferred from where it closed
     (`take_profit`, `stop_loss`, `break_even`, `closed_win`, `closed_loss`);
   - `equity` — the curve sampled down to about 1,500 points (last point kept);
   - `rejections` — the strategy's funnel counters;
   - `range`, `params`, `elapsedMs`.

`_clean()` makes every value JSON-safe: numpy scalars become Python numbers,
NaN/inf become `null`, timestamps become unix seconds, timedeltas become strings.
