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
