# Gold Backtester

A Windows desktop app for backtesting trading strategies on real 1-minute data.
It shows a TradingView-style chart with drawing tools, runs strategies through
**backtesting.py**, and presents the results: stats, equity curve, rejection
funnel, a trade list, and every trade drawn on the chart. Instruments are
imported from [Twelve Data](https://twelvedata.com) with your own API key, so
the app ships with no market data of its own.

```
┌──────────────────── GoldBacktester.exe (one process) ────────────────────┐
│                                                                           │
│  native window (pywebview)              backend thread (uvicorn)          │
│  Microsoft Edge WebView2 ── http ──►    FastAPI: /api/*  + built React UI │
│  (built into Windows)    127.0.0.1:17800    pandas · backtesting.py       │
│                                                  │                        │
└──────────────────────────────────────────────────┼────────────────────────┘
                                                   ▼
                       %LOCALAPPDATA%\GoldBacktester\data (imported 1m candles)
```

The window uses the WebView2 engine that ships with Windows 10/11 instead of
bundling a browser, so the **setup file is about 27 MB** and the machine needs
no Python or Node.

## Build the setup file

Requirements (build machine only): Node 22+, Python 3.12+, and
[NSIS](https://nsis.sourceforge.io) (`winget install NSIS.NSIS`).

```bash
cd frontend && npm install
cd ../desktop && npm run dist
```

Output: `desktop/release/Gold Backtester-Setup-0.2.0.exe`, a single file to send
to customers. It installs per user (no admin prompt), adds Start menu and
desktop shortcuts, and appears in Windows **Apps** with an uninstaller.

The build is unsigned, so Windows SmartScreen shows "Windows protected your
PC" on first run: click **More info → Run anyway**.

## Release a new version

Bump `APP_VERSION` in `backend/app/config.py`, commit, then push a matching
`v<version>` tag:

```bash
git tag v0.3.0
git push origin v0.3.0
```

The [Release workflow](.github/workflows/release.yml) builds the setup file on a
Windows runner and attaches it to the GitHub release for that tag. The tag has
to match `APP_VERSION`, or the build stops before it starts.

## Develop

```bash
cd desktop
npm run dev      # app window + Vite hot reload + backend from source
```

Or run the app directly from source with the production UI build:

```bash
cd frontend && npm run build
cd ../backend && .venv/Scripts/python desktop_app.py
```

## Settings, live data and forward testing

The gear in the toolbar opens **Settings**, stored as JSON in
`%LOCALAPPDATA%\GoldBacktester\settings.json` - outside the installation, so
upgrades and uninstalls leave it alone.

- **Data provider** - paste a [Twelve Data](https://twelvedata.com) API key and
  press *Test connection* to see the plan and today's credit use.
- **Rate limit** - requests a minute your plan allows. Downloads are paced to
  it, so a long one cannot die half way with a 429.

The footer of that modal shows the version you are running, so a bug report can
name the build.

## Chart data

The second toolbar icon opens **Chart data**, which owns everything downloaded:
a row per symbol with its candle count, the number of days actually holding
candles, the coverage dates, **its size on disk**, and a running total across
all of them. From there you can search and add an instrument (7 / 30 / 90 / 180
days), **Update** one to now, extend it further back, or remove it and its
cached candles - behind a confirmation naming how many candles would go.

Downloading is the slow part - a month of 1-minute candles is nine requests
paced to your plan's rate limit - so it runs on the backend and the window
watches it: a progress bar over requests done, candles so far, credits spent,
elapsed time, and, when the limiter holds a request back, a countdown saying so
rather than a bar that appears to have frozen. Closing the window does not
cancel it, and reopening picks the progress back up.
- **Live data** - the **Live** button in the toolbar starts and stops streaming,
  with the last price, its direction and the age of the last update beside it.
  It is greyed out for a symbol with no data provider, since there is nothing to
  stream. The interval lives in Settings; at the default 60s a session costs 60
  credits an hour.
- **Forward test** - paper-trades the strategy on candles that arrive *after*
  you press Start, on the **forward** tab of the strategy panel.

### Invented candles

Spot FX and metals close for the weekend, but the feed keeps emitting 1-minute
candles through it, holding the last price and jittering it by a few cents. On
90 days of `XAU/USD` that was **28% of the file** - 36,360 candles whose whole
weekend moves less than a dollar. Left in, they draw as a flat stretch on the
chart and hand the strategy fake swing points, fake liquidity sweeps and a
deflated ATR.

They are detected rather than assumed from a calendar: providers disagree about
when the week ends (this one closes at 22:00 UTC, an hour after New York's
17:00) and no calendar knows about Good Friday. What padding always is, whatever
the reason, is a long run of hours in which price does not move. Measured on
that data the two populations do not overlap - quiet spells inside a trading
week last at most 3 hours, every weekend at least 19 - so a run of 6 dead hours
is the cut. Holidays are caught for free; July 4th showed up as an extended
weekend.

Only symbols classified as FX or metals are touched. An equity's thin
pre-market hour is real trading and is left alone.

### Test range

The **setup** tab takes a range - `7d / 30d / 90d / All`, or explicit UTC dates -
and the backtest runs on that window only. Before you run it, the panel says what
the range would cost: a range already cached spends nothing, and only the parts
that are genuinely missing are downloaded. Gaps *inside* the cached span are
weekends and market closures, not missing data, so they are never re-fetched.

Warm-up is handled for you. The window keeps roughly a day of extra candles
before its first tradable bar, so the 1h bias and 15m sweeps entering the window
are as complete as any other bar's, and the results report the warm-up
separately. Those bars are counted in bars rather than wall-clock, because a
window opening after a weekend would otherwise take its warm-up from a closed
market and get none at all.

Adding a setting is one `SettingDef` entry in `backend/app/settings.py`;
validation, storage and the control in the modal all follow from it.

The forward test runs the same engine as the backtest rather than a second copy
of the rules: on every new candle the strategy is replayed over the full
history, with `start_trading_at` pinned to the moment the session began. Earlier
bars still build the 1h bias and 15m sweeps, but no trade can open on a bar that
had already printed - so the result is what the rules would really have done
from that moment on, and the session survives a restart because nothing but its
start time, parameters and candles is state.

## Features

- Candlesticks and volume on `1m 5m 15m 30m 1h 4h 1d 1w`, resampled from 1m
- Infinite scroll-back, OHLC legend, times in UTC
- **Drawing tools**: trend line, ray, extended / horizontal / vertical lines,
  rectangle, brush, text, Fib retracement, long / short position, and a measure
  tool (Alt+M) that reports the price change, percentage, bars and duration -
  with magnet, undo and per-symbol saving
- **Backtest panel**: editable parameters, a test range, stats, equity curve,
  rejection funnel and trade list
- **Trades on the chart**: entry / exit markers, outcome boxes, and the full
  risk / reward position tool for the selected trade
- **Live data and forward testing**: stream the latest candles and paper-trade
  the strategy on the ones that arrive from now on
- **Says why a run found nothing**: which filter rejected the most bars, and
  whether the sample was simply too short

## The strategy

An ICT multi-timeframe liquidity sweep: a 1h break of structure sets the bias,
a 15m liquidity sweep opens a 30-minute window, and a 1m pin bar or engulfing
candle triggers the entry, with premium / discount and London / New York
session filters, a 1:2 target and break-even at 1R. It is written so no bar
ever sees future data. Details in [docs/strategy.md](docs/strategy.md).

A month of data produces roughly 20 trades — far too small a sample to judge the
strategy, and a week often produces none at all. Ninety days or more is a fairer
test; the Results tab says which filter is doing the rejecting. It proves the
engine, not the edge.

## Documentation

| Page | Covers |
|---|---|
| [Architecture](docs/architecture.md) | The single-process app: window, backend thread, startup and shutdown |
| [Desktop build](docs/desktop.md) | PyInstaller + NSIS packaging, dev mode, releases, size, troubleshooting |
| [Data](docs/data.md) | The CSV, resampling, getting more history |
| [Backend](docs/backend.md) | API routes, candle store, backtest runner |
| [Strategy](docs/strategy.md) | Rules, no-lookahead design, adding a strategy |
| [Frontend](docs/frontend.md) | App state, chart, trade overlays |
| [Drawing tools](docs/drawing-tools.md) | Using and extending the drawing tools |
| [Development](docs/development.md) | Checks, conventions, common tasks |

## Layout

```
backend/     Python app: API, strategies, and the desktop window
  desktop_app.py       app entry point (window + backend thread)
  app/                 FastAPI app, candle store, backtest runner, strategies
frontend/    React + TypeScript UI (bundled into the app)
desktop/     build scripts, NSIS installer script, icon
docs/        documentation
```
