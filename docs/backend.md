# Backend

FastAPI, pandas and backtesting.py, running in a background thread of the
desktop app. Everything lives in `backend/`. Python 3.12+; dependencies in
`backend/requirements.txt` (including pywebview and PyInstaller for the app).

| Module | Role |
|---|---|
| `desktop_app.py` | App entry point: starts the backend thread and the WebView2 window, see [Architecture](architecture.md) |
| `app/config.py` | Static config: `DATA_DIR`, `TIMEFRAMES`, `DEFAULT_LIMIT` / `MAX_LIMIT`, the `Symbol` dataclass |
| `app/settings.py` | `SETTINGS` definitions, validation, and the JSON file in `%LOCALAPPDATA%` |
| `app/store.py` | `CandleStore`: loads CSVs, merges downloads, resamples, slices pages |
| `app/providers/twelvedata.py` | The Twelve Data client: search, paged history, rate limiting, usage |
| `app/market_hours.py` | Detects and removes the candles a provider invents while a market is shut |
| `app/jobs.py` | One background download at a time, with progress the UI can watch |
| `app/live.py` | Poller that keeps the followed symbol's candles current |
| `app/forward.py` | Paper trading forward on live candles, using the backtest engine |
| `app/main.py` | FastAPI app and routes, backtest result cache |
| `app/backtest.py` | Runs a strategy with backtesting.py and turns the output into JSON |
| `app/strategies/` | Strategy registry and implementations, see [Strategy](strategy.md) |

## Configuration and settings

`config.py` holds what the code needs to agree on: `DATA_DIR` (the `DATA_DIR`
env var, else `backend/data`), `TIMEFRAMES` (label to pandas offset, in UI
order), `DEFAULT_LIMIT = 1500` / `MAX_LIMIT = 20000` bars per candles request,
and the `Symbol` dataclass - id, display name, source ticker, provider,
precision, and whether it was imported.

`settings.py` holds what the *user* can change. Each entry is a `SettingDef`
with a key, label, type, default, range and help text; the file
`%LOCALAPPDATA%\GoldBacktester\settings.json` stores the values, outside the
installation so upgrades and uninstalls leave them alone. Adding a setting is
one `SettingDef` - validation, storage and the control in the modal all follow
from it.

| Key | Is |
|---|---|
| `twelvedata_api_key` | The provider key |
| `history_days` | Default history an import downloads |
| `provider_credits_per_minute` | Requests a minute the plan allows; downloads are paced to it |
| `live_enabled`, `live_interval_seconds`, `live_symbol` | The live feed |
| `forward_cash`, `forward_autostart` | The forward test |

The same file also carries the catalogue of imported symbols and, per symbol,
which spans have been fetched - so symbols and their coverage survive restarts.

## The candle store (`store.py`)

A single module-level `store = CandleStore()`, loaded in FastAPI's `lifespan`.

- `_base[symbol]` - the 1m DataFrame (UTC `DatetimeIndex`, float OHLC, int volume).
- `_derived[(symbol, tf)]` - resampled frames, built lazily under a lock and
  dropped whenever the base frame changes.
- `candles(symbol, tf, limit, before)` - filters to bars strictly older than
  `before` (if given), takes the last `limit` rows, and reports `total` (bars in
  that timeframe) and `has_more` (whether older bars exist before the slice).
  `before` + `hasMore` are what make the chart's infinite scroll-back work.
- `version(symbol)` - bumped on every merge. It rides along on `/api/candles`
  and is part of the backtest cache key, so a result can never outlive the
  candles it was computed from.
- `merge_bars()`, `add_symbol()`, `remove_symbol()` - the writes, each
  persisting the CSV and the catalogue.
- `clean(symbol)` - drops out-of-hours padding (below) and returns how many went.
- `record_fetch()` / `missing_ranges()` - what has been downloaded, and what a
  requested range would still need.
- `coverage()`, `bar_count()`, `trading_days()`, `last_bar_time()` - what the
  Chart data window reports.

### What counts as missing

`missing_ranges()` compares the request against the spans already fetched, not
against the candles on disk: gaps *inside* a fetched span are weekends and
market closures, and re-fetching them would spend credits to learn nothing. A
remaining gap narrower than two bars is dropped as well - it cannot contain a
complete candle, and asking for one is an error rather than an empty answer (see
[the provider client](#the-provider-client-providerstwelvedatapy)). That is why
**Update** on a symbol downloaded seconds ago answers "Already up to date - no
credits spent" instead of failing.

### Invented candles (`market_hours.py`)

Spot FX and metals close for the weekend, but the feed keeps emitting 1-minute
candles through it, holding the last price and jittering it by a few cents. On
90 days of `XAU/USD` that was 28% of the file. Left in, they hand the strategy
fake swing points, fake sweeps and a deflated ATR.

They are detected rather than taken from a calendar: an hour is *dead* if it
moves less than `DEAD_RATIO` of a typical hour, and a run of `MIN_DEAD_HOURS`
(6) dead hours is the market being shut. Measured on real data the two
populations do not overlap - quiet spells inside a trading week last at most 3
hours, every weekend at least 19 - and holidays are caught for free. Only
symbols classified as FX or metals are touched; an equity's thin pre-market hour
is real trading and is left alone.

## The provider client (`providers/twelvedata.py`)

- `search(q)` - instrument lookup for the Chart data window.
- `range(ticker, start, end, interval, on_page)` - pages backwards in requests
  of 5,000 candles, calling `on_page` as each one lands.
- `usage()` - plan and today's credit use; doubles as *Test connection*.
- Rate limiting - requests are paced to `provider_credits_per_minute`, and the
  wait is announced through `on_wait` so a job can count it down instead of
  looking frozen. A 429 is retried once.
- Errors - the body's `message` is parsed out and raised, because the reason
  ("No data is available on the specified dates") is the whole explanation and
  the status code alone is not. That particular refusal is treated as an empty
  page rather than a failure, so a download over a closed market returns what it
  found instead of dying part way through.

## Background downloads (`jobs.py`)

One download runs at a time - the rate limiter serialises them anyway, and two
competing for the same credits is never what anyone wants. A job runs on its own
thread and reports `state`, `message`, `pagesDone` / `pagesTotal`, `bars`,
`padded`, `credits`, `waitingSeconds`, `elapsedSeconds` and, when it finishes,
`result`. The countdown is its own field rather than part of the message, so the
text stays factual and a wait cannot be left on screen after it has passed.
Closing the window cancels nothing; the UI simply polls `/api/data/job` again. A
range that is already cached is answered as a job that is already `done`, so the
UI has one shape to render either way.

## Live and forward (`live.py`, `forward.py`)

`feed` is one daemon thread for the life of the process. It idles while live
data is off, so toggling the setting takes effect on the next tick with nothing
to restart. Each tick asks for the last 200 1-minute candles of the followed
symbol and merges them; the newest one is still forming, so it is overwritten
until it closes. Polling REST rather than the websocket is deliberate: the
socket needs a paid plan, and at the default 60s interval a session costs 60
credits an hour.

`forward` paper-trades **through the backtest engine** rather than a second copy
of the rules. On new candles the strategy is replayed over the full history with
`start_trading_at` pinned to the moment the session began: earlier bars still
build the 1h bias and 15m sweeps, but no trade can open on a bar that had
already printed. Only the start time, the parameters and the candles are state,
so the session is reproducible and survives a restart.

## API (`main.py`)

| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | `{status, symbols}` - the app polls this before showing the UI |
| GET | `/api/timeframes` | timeframe labels |
| GET | `/api/symbols` | instruments with bar count, coverage (`from`/`to`), precision, provider, size on disk |
| GET | `/api/candles` | `{symbol, timeframe, count, total, hasMore, version, candles[]}` |
| GET PUT | `/api/settings` | setting definitions with their current values; `PUT` validates and saves |
| GET | `/api/provider/usage` | plan and credits used today; a missing or rejected key is reported as `{ok: false, message}` in the body rather than as an HTTP error |
| GET | `/api/provider/search` | instruments matching a query |
| POST | `/api/symbols` | starts an import (provider ticker + days); progress via `/api/data/job` |
| POST | `/api/symbols/{id}/refresh` | tops the symbol up to now |
| GET | `/api/symbols/{id}/range` | what a range would cost: what is cached, what is missing, credits |
| POST | `/api/symbols/{id}/range` | downloads only the missing parts of a range |
| DELETE | `/api/symbols/{id}` | removes the symbol and its cached candles |
| GET | `/api/data/job` | the running download, the last finished one, or nothing |
| POST | `/api/data/job/dismiss` | forgets a finished job |
| GET POST | `/api/live`, `/api/live/poll` | feed status; `poll` forces a tick now |
| GET | `/api/forward` | session status, trades and equity |
| POST | `/api/forward/start`, `/api/forward/stop` | start / stop a paper session |
| GET | `/api/strategies` | each strategy's id, name, description, timeframes, defaults and UI controls |
| POST | `/api/backtest` | summary, trades, equity curve, rejection funnel |
| GET | `/` | the built React UI - only when `FRONTEND_DIR` is set (the desktop app sets it) |

Interactive docs: while the app is running, open http://127.0.0.1:17800/docs in
a browser (8765 in dev mode).

There is no CORS middleware: the UI is served by this same server (or proxied
by Vite in dev), so requests are always same-origin.

Errors: unknown symbol -> 404, unknown timeframe -> 400, unknown strategy -> 404,
parameters the dataclass rejects -> 400, a symbol with no provider asked to
download -> 400, a second download while one is running -> 409.

### How `/api/strategies` describes parameters

`_describe()` combines the strategy's params dataclass (for defaults and types)
with its `PARAM_UI` list (label, group, unit, min/max/step, description). Every
key of a `PARAM_UI` entry is passed through as-is, so a new one - `description`
is rendered under the control - needs no change here. Types are reduced to
`bool`, `int`, `float` or `select` (a dropdown over the entry's `options`), which
is all the frontend form needs. Only fields in `PARAM_UI` get a control, but
**every** dataclass field is accepted by `/api/backtest`.

### Backtest cache

Results are cached by `(strategyId, symbol, store version, rangeFrom, rangeTo,
sorted params)`, up to 16 entries, oldest evicted first. A cached response has
`"cached": true`. The store version is part of the key so an arriving live
candle invalidates the cache instead of serving a run computed from older data.
The cache is in-process, so it resets when the app restarts.

## The backtest runner (`backtest.py`)

`run_backtest(strategy_id, symbol, overrides, range_from, range_to)`:

1. **Params** - builds the strategy's params dataclass from the request,
   silently dropping unknown keys and `null` values.
2. **Frames** - fetches the timeframes the strategy declares
   (`info.timeframes`: `trigger`, `liquidity`, `bias`) from the store.
3. **Range** - with `range_from` / `range_to` the run is trimmed to that window
   plus **warm-up**: roughly a day of extra bars before the first tradable one,
   so the 1h bias and 15m sweeps entering the window are as complete as any
   other bar's. Warm-up is counted in bars rather than wall-clock, because a
   window opening after a weekend would otherwise take its warm-up from a closed
   market and get none at all.
4. **Context** - `build_context(m1, m15, h1, params)` precomputes every
   higher-timeframe fact on the 1m grid (see [Strategy](strategy.md)).
5. **Run** - creates a per-run subclass of the strategy carrying `params`,
   `context` and `spread_rel`, so concurrent runs never share state, then runs
   `Backtest(...)` with:
   - `cash`, `margin = 1 / leverage`, `spread` as a fraction of the mean price;
   - `trade_on_close=True` - entries fill on the trigger candle's close;
   - `finalize_trades=True` - a position still open at the end is counted.
6. **Shape** - converts backtesting.py's output into JSON:
   - `range` - `from`, `to`, `bars`, `tradedFrom` and `warmupBars`, so the UI can
     report the warm-up separately and say how many trading days were tested;
   - `summary` - its stats plus wins / losses / break-evens and gross P&L;
   - `trades` - one object per trade, with extras the strategy put in the trade
     `tag` (`initialSl`, `riskPerUnit`, `pattern`, `sweepLevel`, `slPips`), an
     `rMultiple`, and an `exitReason` inferred from where it closed
     (`take_profit`, `stop_loss`, `break_even`, `closed_win`, `closed_loss`);
   - `equity` - the curve sampled down to about 1,500 points (last point kept);
   - `rejections` - the strategy's funnel counters, which the UI also uses to
     explain a run that found nothing;
   - `params`, `elapsedMs`.

`_clean()` makes every value JSON-safe: numpy scalars become Python numbers,
NaN/inf become `null`, timestamps become unix seconds, timedeltas become strings.
