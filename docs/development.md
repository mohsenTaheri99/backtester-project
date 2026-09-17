# Development

## Setup

```bash
cd frontend && npm install
```

`desktop/` has no npm dependencies. Python: the first `npm run dist` creates
`backend/.venv` with everything in `backend/requirements.txt`. To set it up by
hand instead:

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # Windows
```

## Run

```bash
cd desktop
npm run dev     # hot reload for the UI; restart for backend changes
```

Closest to the installed app, with the production UI build:

```bash
cd frontend && npm run build
cd ../backend && .venv/Scripts/python desktop_app.py   # add --debug for DevTools
```

Build the setup file with `npm run dist` — see [Desktop build](desktop.md).

## Checks

```bash
cd frontend
npm run typecheck   # tsc in strict mode
npm run build       # typecheck + production bundle
```

There is no automated test suite yet. For backend changes, run a backtest
directly and compare with the previous result. Pass whichever symbol you have
imported - nothing ships with the app, so there is no fixed expected number:

```bash
cd backend
.venv/Scripts/python -c "from app.settings import settings; settings.load(); from app.store import store; store.load(); from app.backtest import run_backtest; r = run_backtest('ict_sweep', 'XAUUSD-TD', {}); print(r['summary']['trades'], r['summary']['returnPct'])"
```

To poke at the API, open its Swagger page in a browser while the app runs:
http://127.0.0.1:17800/docs (http://127.0.0.1:8765/docs in dev mode).

Identical backtest requests are cached until the app restarts.

## Conventions

- **Time** is unix seconds, UTC, bar-open time — everywhere.
- **Backend** never leaks future data into a bar's decision. See
  [Strategy → No lookahead](strategy.md#no-lookahead).
- **Frontend** only uses relative `/api` URLs, so it runs the same in the app
  and in Vite dev mode.
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
| Add an instrument | Toolbar -> **Chart data** -> search and **Add** — see [Data](data.md) |
| Refresh data | Toolbar -> **Chart data** -> **Update**, or pick a range in the setup tab |
| Expose a strategy parameter in the UI | `PARAM_UI` in `ict_sweep.py` |
| Add a strategy | [Strategy → Adding a strategy](strategy.md#adding-a-strategy) |
| Add a drawing tool | [Drawing tools → Adding a tool](drawing-tools.md#adding-a-tool) |
| Change colours | CSS variables in `styles.css` and `colors` in `lib/theme.ts` |
| Change window size or title | `webview.create_window(...)` in `backend/desktop_app.py` |
| Change the icon | `desktop/scripts/make-icon.mjs`, then `npm run icon` |
| Change installer text, shortcuts, publisher | `desktop/installer.nsi` |
| Add a setting | one `SettingDef` in `backend/app/settings.py` |
| Add a market data provider | a client in `backend/app/providers/`, shaped like `twelvedata.py` |
| Release a new version | bump `APP_VERSION` in `backend/app/config.py`, then `npm run dist` |

## Versioning

`APP_VERSION` in `backend/app/config.py` is the only place the version is
written. The running app reports it on `/api/health` and shows it in the footer
of the Settings modal, and `npm run dist` reads it for the setup file name and
the installer, rewriting `desktop/package.json` when it has fallen behind. Tag a
release as `v<version>`.

## Git

Ignored: `node_modules/`, `dist/`, `__pycache__/`, `*.tsbuildinfo`, `.venv/`,
`desktop/build/`, `desktop/release/`. No market data is committed - a clone
builds the app, and a Twelve Data key fills the chart.
