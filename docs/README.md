# Documentation

How the Gold Backtester is put together, one part per page. The top-level
[README](../README.md) is the quickstart; these pages go one level deeper, into
*why* the code is shaped the way it is and where to change things.

| Page | Covers |
|---|---|
| [Architecture](architecture.md) | The two services, how a request flows through them, Docker setup |
| [Data](data.md) | The 1-minute CSV, resampling to other timeframes, downloading more history |
| [Backend](backend.md) | FastAPI routes, the candle store, the backtest runner, caching |
| [Strategy](strategy.md) | The ICT liquidity-sweep strategy, the no-lookahead rule, adding a strategy |
| [Frontend](frontend.md) | React app state, components, the chart, scroll-back paging, trade overlays |
| [Drawing tools](drawing-tools.md) | TradingView-style drawing tools: how they are stored, drawn and edited |
| [Development](development.md) | Running locally, checks, conventions, common tasks |

## Repository map

```
backtester project/
├── README.md                  quickstart + API reference
├── docs/                      you are here
├── docker-compose.yml         backend :8000, frontend :5173
├── .env                       package mirrors used at image build time
├── backend/
│   ├── app/
│   │   ├── main.py            FastAPI routes
│   │   ├── config.py          symbols, timeframes, limits
│   │   ├── store.py           CSV loading + resampling cache
│   │   ├── backtest.py        runs backtesting.py, shapes the JSON result
│   │   ├── fetch_data.py      Yahoo Finance 1m downloader
│   │   └── strategies/
│   │       ├── __init__.py    strategy registry
│   │       ├── signals.py     fractals, ATR, session windows
│   │       └── ict_sweep.py   the ICT strategy
│   ├── data/GCF_1m.csv        1-minute gold candles
│   └── strategy-description.md  the strategy spec (Persian)
└── frontend/
    └── src/
        ├── App.tsx            top-level state and wiring
        ├── api.ts, types.ts   typed API client
        ├── components/        Chart, Toolbar, Legend, BacktestPanel, EquityChart, DrawingToolbar
        └── lib/
            ├── theme.ts       colours + chart options
            ├── markers.ts     trade markers, timeframe seconds
            ├── tradeZones.ts  risk/reward boxes for backtest trades
            └── drawings/      drawing tools (types, layer, controller, persistence)
```
