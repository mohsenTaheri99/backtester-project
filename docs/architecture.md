# Architecture

Two services, one CSV.

```
 browser
   │  http://localhost:5173
   ▼
┌──────────────────────┐   /api/*  (vite proxy)   ┌──────────────────────────┐
│ frontend             │ ───────────────────────► │ backend                  │
│ React 19 + TS + Vite │                          │ FastAPI + pandas         │
│ lightweight-charts 5 │ ◄─────────────────────── │ backtesting.py           │
└──────────────────────┘   JSON: candles, stats,  └────────────┬─────────────┘
         │                  trades, equity                     │ loaded once at startup
         │ localStorage                                        ▼
         ▼                                            backend/data/GCF_1m.csv
   user drawings (per symbol)
```

## Responsibilities

**Backend** — owns the data and all computation.

- Reads the 1-minute CSV into memory at startup.
- Resamples it to any other timeframe on first request, then caches the result.
- Serves candles in pages (`limit` + `before`) so the chart never loads everything.
- Runs strategies over the full 1m history and returns stats, trades and an
  equity curve in one response.

**Frontend** — owns presentation and interaction; it never computes a signal.

- Draws candles, volume and backtest trades with lightweight-charts.
- Pages older history in as you scroll left.
- Lets you edit strategy parameters, run backtests and inspect trades.
- Provides TradingView-style drawing tools, stored in the browser only.

## Request flows

### Opening the chart

1. `GET /api/symbols` and `GET /api/strategies` — static lists for the toolbar
   and the backtest form.
2. `GET /api/candles?symbol=XAUUSD&tf=5m&limit=1500` — the newest page.
3. When the visible range gets within 20 bars of the left edge:
   `GET /api/candles?...&before=<oldest bar time>` — the previous page, spliced in
   front without moving the viewport.

### Running a backtest

1. `POST /api/backtest {strategyId, symbol, params}`.
2. The backend builds the strategy's higher-timeframe context (1h bias, 15m
   sweeps), runs `backtesting.py` bar by bar on 1m, and shapes the result.
3. Identical requests come from a small in-memory cache (16 entries).
4. The frontend turns trades into markers and risk/reward zones on the chart,
   and fills the Results and Trades tabs.

### Selecting a trade

Clicking a trade row asks for the whole gap between the loaded history and the
trade's entry in one request (up to 3 requests of at most 20,000 bars), then
centres the chart on it.

## Time conventions

- Every timestamp on the wire is **unix seconds, UTC**.
- A bar is stamped with its **open** time.
- The chart renders times in UTC so the axis matches the data.

## Docker

`docker-compose.yml` runs both services with hot reload:

| Service | Port | Bind mounts | Notes |
|---|---|---|---|
| `backend` | 8000 | `backend/app`, `backend/data` | `uvicorn --reload`; healthcheck on `/api/health` |
| `frontend` | 5173 | `frontend/src`, `frontend/index.html` | Vite dev server; waits for a healthy backend; proxies `/api` to `http://backend:8000` |

The frontend image keeps its own `node_modules` (an anonymous volume) so the
host folder never shadows it.

Build-time package sources come from `.env` (`PIP_INDEX_URL`, `NPM_REGISTRY`),
because `pypi.org` is unreachable on some networks.
