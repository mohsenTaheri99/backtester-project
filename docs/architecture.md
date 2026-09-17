# Architecture

The app is **one Python process**: a background thread runs the FastAPI
backend, and the main thread shows a native window that renders the React UI
with Microsoft Edge WebView2.

```
┌─────────────────────────── GoldBacktester.exe ────────────────────────────┐
│                                                                            │
│  main thread: pywebview window (WinForms + WebView2)                        │
│    1. shows a loading page                                                 │
│    2. waits for GET /api/health                                            │
│    3. navigates to http://127.0.0.1:17800/                                 │
│         │                                                                  │
│         │  page + fetch('/api/…')   (same origin)                          │
│         ▼                                                                  │
│  backend thread: uvicorn → FastAPI (backend/app/main.py)                   │
│    /api/*  candles, strategies, backtests                                  │
│    /       built React UI (StaticFiles, FRONTEND_DIR)                      │
│    USER_DATA_DIR ─► imported 1m CSVs loaded at startup                     │
└────────────────────────────────────────────────────────────────────────────┘
   %LOCALAPPDATA%\GoldBacktester\webview   WebView2 profile: localStorage (drawings)
   %LOCALAPPDATA%\GoldBacktester\logs      app.log (the exe has no console)
```

WebView2 runs as its own `msedgewebview2.exe` helper processes, managed by the
Windows runtime; they close with the window.

## Entry point (`backend/desktop_app.py`)

Startup, in order:

1. **Output** — a windowed exe has no console, so `stdout`/`stderr` are
   redirected to `%LOCALAPPDATA%\GoldBacktester\logs\app.log`.
2. **Single instance** — a named Windows mutex. A second launch shows "already
   running" and exits.
3. **Port** — `17800` if free, otherwise a random free port (see below).
4. **Backend thread** — sets `DATA_DIR` and `FRONTEND_DIR` (bundle paths when
   frozen, repo paths from source), stubs out backtesting.py's bokeh plotting,
   and runs uvicorn on `127.0.0.1`.
5. **Window** — `webview.create_window` with a loading page, then
   `webview.start(gui="edgechromium", private_mode=False, storage_path=…)`.
   Once uvicorn reports `started` (and a proxy-free `/api/health` succeeds),
   the window navigates to the app. If the backend fails, the error and the
   log path are shown in the window instead.

   Readiness deliberately avoids an ordinary HTTP probe: Python's HTTP client
   follows the Windows system proxy, and VPN/proxy tools without a loopback
   exception made the app hang on the loading screen (fixed in 0.1.1).
   WebView2 is also started with `--proxy-bypass-list=127.0.0.1;localhost`.
6. **Shutdown** — closing the window returns from `webview.start`; the backend
   is a daemon thread, so the process simply ends. Nothing can be orphaned.

If WebView2 is missing, a message box explains how to install it. The setup
file checks for it before installing, too.

## Why a fixed port

WebView2 stores localStorage **per origin**, and the origin includes the port.
Using `127.0.0.1:17800` every time keeps saved drawings across launches. If
something else holds that port, the app still starts on a random port, but
drawings saved under the usual port won't be visible for that session.

## Why the backend serves the UI

- **Same origin** for page and API: the frontend's relative `/api` URLs work
  unchanged, and no CORS is needed.
- **No `file://` quirks**: absolute asset paths from the Vite build just work.

`app/main.py` mounts `StaticFiles(html=True)` at `/` only when `FRONTEND_DIR`
is set, and after all `/api` routes, so the API always wins.

## Why no bokeh

backtesting.py imports its bokeh-based plotting module when the package is
imported, but this app never calls `Backtest.plot()`. `desktop_app.py` registers
a stub `backtesting._plotting` before the import, and the build excludes bokeh
and everything only it needs (PIL, tornado, jinja2, …), saving about 35 MB.

## Security

- The backend listens on `127.0.0.1` only.
- The window only ever loads the local app (or the Vite dev server in dev mode).
- DevTools are off unless started with `--debug`.

## Request flows

### Opening the chart

1. `GET /api/symbols` and `GET /api/strategies`.
2. `GET /api/candles?symbol=XAUUSD-TD&tf=5m&limit=1500` — the newest page.
3. Near the left edge: `GET /api/candles?...&before=<oldest bar time>`, spliced
   in front without moving the viewport.

### Running a backtest

1. `POST /api/backtest {strategyId, symbol, params}`.
2. The backend builds the strategy's higher-timeframe context, runs
   backtesting.py bar by bar on 1m, and shapes the result.
3. Identical requests come from an in-memory cache.
4. The UI draws trades on the chart and fills the Results and Trades tabs.

## Time conventions

- Every timestamp on the wire is **unix seconds, UTC**, stamped at bar **open**.
- The chart renders times in UTC so the axis matches the data.
