# Documentation

How the Gold Backtester desktop app is put together, one part per page. The
top-level [README](../README.md) is the quickstart; these pages go one level deeper, into
*why* the code is shaped the way it is and where to change things.

| Page | Covers |
|---|---|
| [Architecture](architecture.md) | One process: WebView2 window + backend thread, startup, shutdown, how requests flow |
| [Desktop build](desktop.md) | PyInstaller + NSIS setup file, scripts, dev mode, size, troubleshooting |
| [Data](data.md) | The 1-minute CSV, resampling, importing and updating instruments, invented candles |
| [Backend](backend.md) | FastAPI routes, settings, the candle store, downloads, live and forward, the backtest runner |
| [Strategy](strategy.md) | The ICT liquidity-sweep strategy, the no-lookahead rule, adding a strategy |
| [Frontend](frontend.md) | React app state, components, the chart's viewport rules, trade overlays |
| [Drawing tools](drawing-tools.md) | TradingView-style drawing tools: how they are stored, drawn and edited |
| [Development](development.md) | Setup, running, checks, conventions, common tasks |

## Repository map

```
backtester project/
├── README.md                  overview, build + dev quickstart
├── docs/                      you are here
├── desktop/
│   ├── installer.nsi          NSIS setup file script
│   ├── assets/                icon.ico, icon.png
│   ├── scripts/               build (npm run dist), dev, make-icon
│   └── package.json           npm scripts; its version is synced from config.py
├── backend/
│   ├── desktop_app.py         app entry point: WebView2 window + backend thread
│   ├── requirements.txt       incl. pywebview and PyInstaller
│   ├── app/
│   │   ├── main.py            FastAPI routes
│   │   ├── config.py          APP_VERSION, paths, timeframes, limits
│   │   ├── settings.py        user settings + the symbol catalogue on disk
│   │   ├── store.py           CSV loading, merging, resampling cache
│   │   ├── providers/         market data clients (twelvedata.py)
│   │   ├── market_hours.py    drops candles invented while the market is shut
│   │   ├── jobs.py            one background download, with progress
│   │   ├── live.py            live candle poller
│   │   ├── forward.py         forward (paper) testing on live candles
│   │   ├── backtest.py        runs backtesting.py, shapes the JSON result
│   │   └── strategies/
│   │       ├── __init__.py    strategy registry
│   │       ├── signals.py     fractals, ATR, session windows
│   │       └── ict_sweep.py   the ICT strategy
│   └── strategy-description.md  the strategy spec (Persian)
└── frontend/
    └── src/
        ├── App.tsx            top-level state and wiring
        ├── api.ts, types.ts   typed API client
        ├── components/        Chart, Toolbar, Legend, BacktestPanel, RangeSelector,
        │                      DataModal, SettingsModal, ForwardSection, EquityChart,
        │                      DrawingToolbar, Stat
        └── lib/
            ├── theme.ts       colours + chart options
            ├── markers.ts     trade markers, timeframe seconds
            ├── tradeZones.ts  risk/reward boxes for backtest trades
            ├── format.ts      numbers, prices, durations, sizes
            ├── useDataJob.ts  watches a running download
            ├── useTicker.ts   clock for "3s ago" labels
            └── drawings/      drawing tools (types, layer, controller, persistence)
```
