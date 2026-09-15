# Development

## Run with Docker (recommended)

```bash
docker compose up --build
```

- UI: http://localhost:5173
- API + Swagger: http://localhost:8000/docs

`backend/app` and `frontend/src` are bind-mounted, so edits reload
automatically. Changing `requirements.txt` or `package.json` needs a rebuild
(`docker compose up --build`).

If `pip install` fails during the build, check `PIP_INDEX_URL` in `.env`. It
points at a mirror by default; use `https://pypi.org/simple` if you can reach it.

## Run without Docker

```bash
# backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# frontend (second terminal)
cd frontend
npm install
VITE_API_TARGET=http://localhost:8000 npm run dev
```

On Windows PowerShell set the variable first:
`$env:VITE_API_TARGET = "http://localhost:8000"; npm run dev`.

## Checks

```bash
cd frontend
npm run typecheck   # tsc in strict mode
npm run build       # typecheck + production bundle in dist/
```

There is no automated test suite yet. For backend changes, the quickest check
is to run a backtest from Swagger or with curl and compare the summary with the
previous run:

```bash
curl -X POST http://localhost:8000/api/backtest \
  -H "Content-Type: application/json" \
  -d '{"strategyId":"ict_sweep","symbol":"XAUUSD","params":{}}'
```

Remember that identical requests are cached until the backend restarts.

## Conventions

- **Time** is unix seconds, UTC, bar-open time — everywhere.
- **Backend** never leaks future data into a bar's decision. See
  [Strategy → No lookahead](strategy.md#no-lookahead).
- **Frontend** builds lightweight-charts objects once and updates them through
  effects; callbacks the chart holds read props through refs.
- Chart overlays are **series primitives** (`tradeZones.ts`,
  `drawings/DrawingLayer.ts`) rather than DOM elements, so they pan and zoom
  with the chart for free.
- Comments explain *why*, not *what*.

## Common tasks

| Task | Where |
|---|---|
| Add a timeframe | `TIMEFRAMES` in `backend/app/config.py` + `TIMEFRAME_SECONDS` in `frontend/src/lib/markers.ts` |
| Add an instrument | CSV in `backend/data/` + `SYMBOLS` in `config.py` — see [Data](data.md) |
| Refresh data | `docker compose exec backend python -m app.fetch_data --days 30` |
| Expose a strategy parameter in the UI | `PARAM_UI` in `ict_sweep.py` |
| Add a strategy | [Strategy → Adding a strategy](strategy.md#adding-a-strategy) |
| Add a drawing tool | [Drawing tools → Adding a tool](drawing-tools.md#adding-a-tool) |
| Change colours | CSS variables in `styles.css` and `colors` in `lib/theme.ts` |

## Git

Generated and local-only files are ignored (`node_modules/`, `dist/`,
`__pycache__/`, `*.tsbuildinfo`, `.venv/`). The data CSV **is** committed, so a
fresh clone runs without downloading anything.
