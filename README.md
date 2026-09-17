# Gold Backtester

A Windows desktop app for backtesting gold strategies on real 1-minute data. It
shows a TradingView-style chart with drawing tools, runs strategies through
**backtesting.py**, and presents the results: stats, equity curve, rejection
funnel, a trade list, and every trade drawn on the chart.

```
┌──────────────────── GoldBacktester.exe (one process) ────────────────────┐
│                                                                           │
│  native window (pywebview)              backend thread (uvicorn)          │
│  Microsoft Edge WebView2 ── http ──►    FastAPI: /api/*  + built React UI │
│  (built into Windows)    127.0.0.1:17800    pandas · backtesting.py       │
│                                                  │                        │
└──────────────────────────────────────────────────┼────────────────────────┘
                                                   ▼
                                  data/GCF_1m.csv (25,791 real 1m bars)
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

Output: `desktop/release/Gold Backtester-Setup-0.1.0.exe`, a single file to send
to customers. It installs per user (no admin prompt), adds Start menu and
desktop shortcuts, and appears in Windows **Apps** with an uninstaller.

The build is unsigned, so Windows SmartScreen shows "Windows protected your
PC" on first run: click **More info → Run anyway**.

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
- **Market data** - search for a symbol (`XAU/USD`, `EUR/USD`, `AAPL`), import
  its 1-minute history, then update or remove it later. Imported candles live in
  `%LOCALAPPDATA%\GoldBacktester\data`. Downloads are paced to the plan's
  requests-a-minute so a long one cannot die half way with a 429.
- **Live data** - polls the provider for new 1-minute candles and appends them
  to the chart. A free plan allows 8 requests a minute and 800 a day, so the
  default 60s interval costs 60 credits an hour.
- **Forward test** - paper-trades the strategy on candles that arrive *after*
  you press Start, on the **forward** tab of the strategy panel.

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
  rectangle, brush, text, Fib retracement, long / short position, price range,
  with magnet, undo and per-symbol saving
- **Backtest panel**: editable parameters, stats, equity curve, rejection
  funnel and trade list
- **Trades on the chart**: entry / exit markers, outcome boxes, and the full
  risk / reward position tool for the selected trade

## The strategy

An ICT multi-timeframe liquidity sweep: a 1h break of structure sets the bias,
a 15m liquidity sweep opens a 30-minute window, and a 1m pin bar or engulfing
candle triggers the entry, with premium / discount and London / New York
session filters, a 1:2 target and break-even at 1R. It is written so no bar
ever sees future data. Details in [docs/strategy.md](docs/strategy.md).

On the shipped month of data it takes 21 trades (−7.71%) — far too small a
sample to judge the strategy. It proves the engine, not the edge.

## Documentation

| Page | Covers |
|---|---|
| [Architecture](docs/architecture.md) | The single-process app: window, backend thread, startup and shutdown |
| [Desktop build](docs/desktop.md) | PyInstaller + NSIS packaging, dev mode, size, troubleshooting |
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
  data/GCF_1m.csv      1-minute source data (bundled into the app)
frontend/    React + TypeScript UI (bundled into the app)
desktop/     build scripts, NSIS installer script, icon
docs/        documentation
```
