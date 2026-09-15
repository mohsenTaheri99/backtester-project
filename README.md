# Gold Backtester

Dockerised backtesting platform for gold. A Python backend serves real OHLCV
candles and runs strategies through **backtesting.py**; a React + TypeScript
frontend draws the chart with TradingView's **lightweight-charts** and renders
the results — stats, equity curve, trade list and trade markers on the chart.

```
┌──────────────┐   /api/candles    ┌──────────────┐
│  frontend    │ ────────────────► │   backend    │
│ React + TS   │   /api/backtest   │   FastAPI    │
│ :5173 (vite) │ ◄──────────────── │   :8000      │
└──────────────┘  candles, stats,  └──────┬───────┘
                  trades, equity          │ resample + backtesting.py
                                   backend/data/GCF_1m.csv
                                      (25,791 real 1m bars)
```

**Documentation:** see [`docs/`](docs/README.md) for architecture, data,
backend, strategy, frontend, drawing tools and development guides.

## Quickstart

```bash
docker compose up --build
```

- UI: http://localhost:5173
- API docs (Swagger): http://localhost:8000/docs

Both services hot-reload: `backend/app` and `frontend/src` are bind-mounted.

> **Network note.** `pypi.org` is unreachable from some networks, so the pip
> index is a build arg set in `.env`. If you have direct access, set
> `PIP_INDEX_URL=https://pypi.org/simple` there.

## The data

Real COMEX gold futures (`GC=F`, front month) 1-minute candles pulled from
Yahoo Finance — **25,791 bars covering 2026-08-15 → 2026-09-12**, stored in
`backend/data/GCF_1m.csv` (`time,open,high,low,close,volume`, time = unix
seconds, UTC).

1 minute is the only resolution on disk. **Every other timeframe is resampled
from it at request time** (`1m 5m 15m 30m 1h 4h 1d 1w`), so adding a timeframe
means adding one line to `TIMEFRAMES` in `backend/app/config.py`. Resampled
bars are stamped with their *open* time (`label="left"`, `closed="left"`),
anchored to the unix epoch in UTC, and empty buckets (weekends, holidays) are
dropped rather than drawn flat.

### Refreshing / extending history

```bash
docker compose exec backend python -m app.fetch_data --symbol "GC=F" --days 30
docker compose restart backend
```

The fetcher walks backwards in 7-day windows and merges into the existing CSV,
so repeated runs extend coverage instead of overwriting it. Yahoo only keeps
**~30 days** of 1-minute data, so that is the practical ceiling from this
source; windows older than that return HTTP 422 and are skipped. For years of
1m history you would swap in a paid feed or Dukascopy tick archives — the CSV
format is the only contract the backend cares about.

## API

| Endpoint | Description |
|---|---|
| `GET /api/health` | liveness + loaded symbols |
| `GET /api/symbols` | instruments, bar counts, coverage, available timeframes |
| `GET /api/timeframes` | supported timeframe labels |
| `GET /api/candles` | the candles themselves |
| `GET /api/strategies` | available strategies, their parameters and defaults |
| `POST /api/backtest` | run a strategy, get stats + trades + equity curve |

`/api/candles` parameters:

| Param | Default | Meaning |
|---|---|---|
| `symbol` | `XAUUSD` | id from `/api/symbols` |
| `tf` | `1m` | timeframe label |
| `limit` | `1500` | max bars returned (cap 20000) |
| `before` | – | unix seconds; return the bars *older* than this |

```bash
curl "http://localhost:8000/api/candles?symbol=XAUUSD&tf=1h&limit=3"
```

```json
{
  "symbol": "XAUUSD", "timeframe": "1h", "count": 3, "total": 432, "hasMore": true,
  "candles": [{ "time": 1789149600, "open": 4400.5, "high": 4402.4,
                "low": 4385.8, "close": 4389.1, "volume": 6728 }]
}
```

`before` + `hasMore` are what make the chart's scroll-back paging work: the
frontend loads the newest 1500 bars, then requests the previous page whenever
you scroll within 20 bars of the left edge, splicing it in without moving the
viewport.

## Backtesting

`POST /api/backtest` runs the strategy over the full 1m history and returns
everything the UI needs in one response.

```bash
curl -X POST http://localhost:8000/api/backtest \
  -H "Content-Type: application/json" \
  -d '{"strategyId":"ict_sweep","symbol":"XAUUSD","params":{"risk_pct":1.0}}'
```

```json
{
  "summary": { "trades": 21, "winRatePct": 14.3, "returnPct": -7.71,
               "profitFactor": 0.28, "maxDrawdownPct": -8.62, "sharpe": -7.52 },
  "trades":  [{ "id": 3, "direction": "long", "entryTime": 1787815560,
                "entryPrice": 4649.1, "initialSl": 4644.1, "tp": 4659.1,
                "rMultiple": 2.0, "exitReason": "take_profit", "pattern": "pin" }],
  "equity":  [{ "time": 1786918200, "equity": 10000.0, "drawdownPct": 0.0 }],
  "rejections": { "no_active_sweep": 19262, "outside_session": 3656 }
}
```

Any field of the strategy's parameter dataclass can be overridden in `params`;
unknown keys are ignored. Identical requests are served from a small in-memory
cache. `rejections` counts, per 1m bar and in filter order, why a setup did not
become a trade — it is the funnel shown in the Results tab.

### The strategy: ICT multi-timeframe liquidity sweep

Implemented from `backend/strategy-description.md`, in
`backend/app/strategies/ict_sweep.py`:

| Layer | Timeframe | Rule |
|---|---|---|
| Direction | 1h | Fractal swings (5 bars either side, by close). A **close** beyond the last confirmed swing is a break of structure and sets the bias. Longs only in a bullish bias, shorts only in a bearish one. |
| Liquidity | 15m | A sweep is a wick through a confirmed swing level with the **body closing back inside**. It opens a 30 minute entry window; no trigger in that window and the setup expires. |
| Trigger | 1m | Pin bar (signal wick >= 2x body, opposite wick almost absent) or engulfing candle, entered **on that candle's close**. |

Filters: buy only in **discount** / sell only in **premium** of the 1h range
(equilibrium = midpoint), and only in the first 2.5h of the **London** and
**New York** sessions — each window pinned to its own timezone so DST follows
the local market.

Risk: stop under the swept extreme plus an ATR buffer, capped at **100 pips**
(gold pip = $0.10); target at **1:2**; stop moves to **break-even at 1R**; size
is whatever makes the stop cost a fixed **1% of equity**; one position at a time.

**No lookahead.** Every higher-timeframe fact carries the timestamp at which it
could really be known — a fractal needs its 5 right-hand bars, a 1h bar is only
known at its close — and is then forward-filled onto the 1m grid. A 1m bar
opening at T only ever sees context stamped at or before T.

Stops and targets are measured from the *expected fill* (close plus spread), so
losers come out at exactly -1.00R, winners at +2.00R and break-evens at 0.00R.

### Results on the shipped data

21 trades over 18 days: 3 wins, 4 break-evens, 14 losses, -7.71% return, 0.28
profit factor, -8.62% max drawdown. That is a **sample far too small to judge
the strategy** — the description itself notes that with 1:2 the break-even win
rate is ~33-38% and that several hundred trades are needed for a verdict. It is
a working engine, not a verdict. Load more history before drawing conclusions.

## UI

- Candlesticks + volume overlay, timeframe switcher, volume toggle
- OHLC legend that follows the crosshair (last bar when not hovering)
- Infinite scroll-back through the full history
- Times rendered in UTC to match the stored bars
- **Backtest panel**: editable parameters, stat grid, equity curve, rejection
  funnel and a trade list
- **Trades drawn on the chart**, TradingView style (toggle in the toolbar):
  - every trade gets an entry arrow, an exit marker labelled with its R multiple,
    a path from entry to exit and an outcome box tinted green or red
  - the **selected** trade additionally gets the position tool — a green reward
    zone up to the target, a red risk zone down to the stop, a result badge and
    dashed entry / stop / target price lines with axis labels
  - everything is snapped to the active timeframe's bars, so it lines up on 1m
    or 1d, and it pans and zooms with the chart
- Clicking a trade in the list fetches the history around it in one request and
  centres the chart on it
- **Drawing tools**, TradingView style, on a left-hand rail: trend line, ray,
  extended / horizontal / vertical lines, rectangle, brush, text, Fib
  retracement, long / short position and price range, with magnet, undo and
  per-symbol persistence — see [docs/drawing-tools.md](docs/drawing-tools.md)

## Layout

```
backend/
  app/config.py             symbols, timeframes, limits
  app/store.py              CSV load + resampling cache
  app/main.py               FastAPI routes
  app/backtest.py           runs backtesting.py, shapes the JSON result
  app/fetch_data.py         Yahoo 1m downloader (stdlib only)
  app/strategies/
    signals.py              fractals, ATR, session windows
    ict_sweep.py            the strategy: context, triggers, risk
  data/GCF_1m.csv           the 1-minute source data
  strategy-description.md   the spec this strategy implements
frontend/
  src/api.ts                typed fetch helpers
  src/types.ts              Candle / SymbolInfo / BacktestResult
  src/App.tsx               state, paging, backtest wiring
  src/components/           Chart, Toolbar, Legend, BacktestPanel, EquityChart, DrawingToolbar
  src/lib/theme.ts          chart + colour tokens
  src/lib/markers.ts        trades -> chart markers
  src/lib/tradeZones.ts     canvas primitive: risk/reward zones, paths, badges
  src/lib/drawings/         drawing tools: model, canvas layer, interaction, persistence
docs/                       per-part documentation
docker-compose.yml   backend :8000, frontend :5173 (proxies /api)
```

## Developing outside Docker

```bash
cd backend  && pip install -r requirements.txt && uvicorn app.main:app --reload
cd frontend && npm install && VITE_API_TARGET=http://localhost:8000 npm run dev
```

`npm run typecheck` and `npm run build` both run TypeScript in strict mode.

## Adding a strategy

1. Write a `backtesting.Strategy` subclass plus a params dataclass (copy
   `ict_sweep.py` as the shape).
2. Give it a `StrategyInfo` with an `id`, the timeframes it needs and a
   `PARAM_UI` list for the controls worth exposing.
3. Register it in `app/strategies/__init__.py` — the API and the UI form pick it
   up automatically.

## Next steps

1. Bar-replay mode — step the chart forward one candle at a time.
2. Parameter sweeps / optimisation over a grid, plotted as a heatmap.
3. Hover a trade zone on the chart to select it, instead of only via the list.
4. More instruments: drop another 1m CSV into `backend/data/` and register it in
   `config.py`.
