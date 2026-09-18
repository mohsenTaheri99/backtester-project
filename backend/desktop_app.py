"""Gold Backtester desktop app.

One process does everything:

- runs the FastAPI backend (API + the built React UI) on a loopback port, in a
  background thread;
- opens a native window with pywebview on Microsoft Edge WebView2, which ships
  with Windows 10/11, so no browser engine has to be bundled.

    python desktop_app.py          # uses frontend/dist (run `npm run build` first)
    python desktop_app.py --dev    # loads the Vite dev server on :5173 instead

Packaged by desktop/scripts/build.mjs with PyInstaller, then wrapped in an NSIS
setup file.
"""
from __future__ import annotations

import argparse
import os
import shutil
import socket
import sys
import threading
import time
import types
import urllib.request
from pathlib import Path

# Cheap by design: version.py imports nothing, so the window is not waiting
# on pandas (which app.config would pull in) before it can be drawn.
from app.version import APP_VERSION

APP_NAME = "Gold Backtester"
# A fixed port keeps the page origin stable across launches, and WebView2 keys
# localStorage (saved drawings) by origin. Only if it is taken do we fall back.
PREFERRED_PORT = 17800
DEV_BACKEND_PORT = 8765
DEV_URL = "http://127.0.0.1:5173/"

FROZEN = getattr(sys, "frozen", False)
BUNDLE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
REPO_DIR = Path(__file__).resolve().parent.parent
USER_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "GoldBacktester"

LOADING_HTML = """<!doctype html><html><head><meta charset="utf-8"><style>
html,body{height:100%;margin:0}
body{display:grid;place-items:center;background:#0e1117;color:#c7d0dd;
font:13px/1.5 'Segoe UI',system-ui,sans-serif;user-select:none}
.box{display:flex;flex-direction:column;align-items:center;gap:14px}
.mark{width:18px;height:18px;border-radius:50%;background:#e0b64a;
box-shadow:0 0 18px rgba(224,182,74,.7);animation:p 1.4s ease-in-out infinite}
h1{margin:0;font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
p{margin:0;color:#7c879a}@keyframes p{50%{transform:scale(.7);opacity:.6}}
</style></head><body><div class="box"><span class="mark"></span>
<h1>Gold Backtester</h1><p>{message}</p></div></body></html>"""


def _loading_page(message: str) -> str:
    safe = message.replace("&", "&amp;").replace("<", "&lt;")
    return LOADING_HTML.replace("{message}", safe)


# ---------------------------------------------------------------------------
# environment
# ---------------------------------------------------------------------------
def _redirect_output_when_windowed() -> None:
    """A windowed PyInstaller exe has no console: stdout/stderr are None, which
    breaks uvicorn's logging setup. Send both to a log file instead."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    log_dir = USER_DIR / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log = open(log_dir / "app.log", "w", encoding="utf-8", buffering=1)  # noqa: SIM115 - lives for the process
    sys.stdout = sys.stdout or log
    sys.stderr = sys.stderr or log


def log(message: str) -> None:
    """Timestamped line in app.log (or the console when run from source)."""
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def _stub_backtesting_plotting() -> None:
    """Keep bokeh (and its deps: PIL, tornado, jinja2, ...) out of the bundle.

    backtesting.py imports its bokeh-based `_plotting` module at package import,
    but only uses it for `Backtest.plot()`, which this app never calls - the
    frontend draws everything. Registering a stand-in first skips that import,
    and the build excludes bokeh, which cuts ~35 MB.
    """

    def unavailable(*_args, **_kwargs):
        raise RuntimeError("bokeh plotting is not included in the desktop build")

    stub = types.ModuleType("backtesting._plotting")
    stub.plot = unavailable
    stub.plot_heatmaps = unavailable
    stub.set_bokeh_output = unavailable
    sys.modules["backtesting._plotting"] = stub


def _single_instance() -> bool:
    """False if another copy is already running (Windows named mutex)."""
    if sys.platform != "win32":
        return True
    import ctypes

    ERROR_ALREADY_EXISTS = 183
    kernel32 = ctypes.windll.kernel32
    # Keep a reference so the handle lives as long as the process.
    _single_instance.handle = kernel32.CreateMutexW(None, False, "Local\\GoldBacktesterSingleInstance")
    return kernel32.GetLastError() != ERROR_ALREADY_EXISTS


def _message_box(text: str) -> None:
    if sys.platform == "win32":
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, text, APP_NAME, 0x10)  # MB_ICONERROR
    else:
        print(text, file=sys.stderr)


def _port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        return sock.connect_ex(("127.0.0.1", port)) != 0


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


# ---------------------------------------------------------------------------
# backend
# ---------------------------------------------------------------------------
class Backend:
    def __init__(self, port: int, serve_frontend: bool) -> None:
        self.port = port
        self.serve_frontend = serve_frontend
        self.error: BaseException | None = None
        self.server = None

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def start(self) -> None:
        threading.Thread(target=self._run, name="backend", daemon=True).start()

    def _run(self) -> None:
        try:
            # config.py reads these at import time.
            os.environ["DATA_DIR"] = str(BUNDLE_DIR / "data" if FROZEN else REPO_DIR / "backend" / "data")
            if self.serve_frontend:
                os.environ["FRONTEND_DIR"] = str(
                    BUNDLE_DIR / "frontend" if FROZEN else REPO_DIR / "frontend" / "dist"
                )

            _stub_backtesting_plotting()
            import uvicorn

            from app.main import app

            config = uvicorn.Config(app, host="127.0.0.1", port=self.port, log_level="warning", access_log=False)
            self.server = uvicorn.Server(config)
            self.server.install_signal_handlers = lambda: None  # not the main thread
            self.server.run()
        except BaseException as exc:  # noqa: BLE001 - surfaced to the user in the window
            import traceback

            log(f"backend crashed:\n{traceback.format_exc()}")
            self.error = exc

    def wait_until_ready(self, timeout: float = 180.0) -> None:
        """Block until uvicorn is accepting connections.

        Readiness comes from uvicorn's own `started` flag, not an HTTP probe: an
        HTTP client picks up the Windows system proxy, and a VPN/proxy client
        without a loopback exception made the probe fail forever even though the
        server was up. The health request afterwards bypasses proxies explicitly.
        """
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.error:
                raise RuntimeError(f"The backtesting engine failed to start: {self.error}")
            if self.server is not None and self.server.started:
                break
            time.sleep(0.1)
        else:
            raise RuntimeError(f"The backtesting engine did not start within {int(timeout)} seconds.")

        no_proxy = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with no_proxy.open(f"{self.base_url}/api/health", timeout=10) as resp:
            if resp.status != 200:
                raise RuntimeError(f"The backtesting engine is not healthy (HTTP {resp.status}).")

    def stop(self) -> None:
        if self.server:
            self.server.should_exit = True


# ---------------------------------------------------------------------------
# window
# ---------------------------------------------------------------------------
def _drop_web_cache_from_older_build(storage: Path) -> None:
    """Throw away a web cache that an earlier version of the app filled.

    The app serves on a fixed port, so every build shares one origin with the
    one before it, and WebView2 was happy to answer this build's requests with
    the previous build's page and API replies - an upgrade that still showed the
    old UI. Responses now say no-store, but an install upgrading from a build
    that did not has the stale entries on disk already, so drop them once, the
    first time a new version runs. Only the HTTP caches go; Local Storage, which
    holds the drawings, is left alone.
    """
    stamp = storage / "cached-by.txt"
    try:
        if stamp.read_text(encoding="utf-8").strip() == APP_VERSION:
            return
    except OSError:
        pass  # no stamp yet: first run of a build that writes one
    caches = [storage / "EBWebView" / "Default" / name for name in ("Cache", "Code Cache")]
    stale = [cache for cache in caches if cache.exists()]
    for cache in stale:
        shutil.rmtree(cache, ignore_errors=True)
    try:
        stamp.write_text(APP_VERSION, encoding="utf-8")
    except OSError as exc:  # not worth failing a launch over
        log(f"could not record the cache stamp: {exc}")
    if stale:
        log(f"cleared the web cache left by an earlier version (now {APP_VERSION})")


def main() -> None:
    parser = argparse.ArgumentParser(description=APP_NAME)
    parser.add_argument("--dev", action="store_true", help="load the Vite dev server (hot reload)")
    parser.add_argument("--debug", action="store_true", help="enable WebView2 DevTools (F12)")
    args = parser.parse_args()

    _redirect_output_when_windowed()
    log(f"{APP_NAME} {APP_VERSION} starting (frozen={FROZEN}, python {sys.version.split()[0]}, {sys.platform})")

    # Never send the window's requests to 127.0.0.1 through a system proxy.
    # Chromium already exempts loopback by default; this keeps it that way even
    # if a proxy tool's settings say otherwise.
    extra = os.environ.get("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "")
    if "--proxy-bypass-list" not in extra:
        os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = f"{extra} --proxy-bypass-list=127.0.0.1;localhost".strip()

    if not _single_instance():
        _message_box(f"{APP_NAME} is already running.")
        return

    import webview

    if args.dev:
        port = DEV_BACKEND_PORT
    else:
        port = PREFERRED_PORT if _port_is_free(PREFERRED_PORT) else _free_port()
        index = BUNDLE_DIR / "frontend" / "index.html" if FROZEN else REPO_DIR / "frontend" / "dist" / "index.html"
        if not index.exists():
            _message_box(f"Frontend build not found:\n{index}\n\nRun `npm run build` in frontend/.")
            return

    backend = Backend(port, serve_frontend=not args.dev)
    backend.start()

    window = webview.create_window(
        APP_NAME,
        html=_loading_page("Starting the backtesting engine…"),
        width=1440,
        height=900,
        min_size=(1000, 640),
        background_color="#0E1117",
        text_select=True,
    )

    def load_app() -> None:
        started = time.monotonic()
        try:
            backend.wait_until_ready()
        except (RuntimeError, OSError) as exc:
            log(f"startup failed: {exc!r}")
            window.load_html(_loading_page(f"{exc}  —  details: {USER_DIR / 'logs' / 'app.log'}"))
            return
        log(f"backend ready on port {backend.port} after {time.monotonic() - started:.1f}s")
        window.load_url(DEV_URL if args.dev else f"{backend.base_url}/")

    storage = USER_DIR / "webview"
    storage.mkdir(parents=True, exist_ok=True)
    _drop_web_cache_from_older_build(storage)
    try:
        webview.start(
            load_app,
            gui="edgechromium",
            debug=args.debug,
            private_mode=False,  # keep localStorage (drawings) between launches
            storage_path=str(storage),
        )
    except Exception as exc:  # noqa: BLE001
        _message_box(
            "Could not open the app window. Gold Backtester needs the Microsoft Edge "
            "WebView2 Runtime, which is included with Windows 11 and most Windows 10 PCs.\n\n"
            "Download: https://go.microsoft.com/fwlink/p/?LinkId=2124703\n\n"
            f"Details: {exc}"
        )
    finally:
        backend.stop()


if __name__ == "__main__":
    main()
