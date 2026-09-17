"""Twelve Data REST client: history, latest bars and key/plan checks.

Only the standard library is used, like app.fetch_data, so the packaged app
gains no new dependency.

Twelve Data returns HTTP 200 even for failures, with the real status in the body
(`{"code": 401, "status": "error", "message": ...}`), so every response goes
through `_request`, which turns that into a TwelveDataError carrying the code.
The UI shows `message` verbatim - their wording about plan limits and symbol
spelling is more useful than anything we could invent.
"""
from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Callable

import pandas as pd

BASE_URL = "https://api.twelvedata.com"
TIMEOUT = 30
# Their hard cap per time_series call; longer history is paged with end_date.
MAX_OUTPUTSIZE = 5000

# app timeframe label -> Twelve Data interval
INTERVALS = {
    "1m": "1min",
    "5m": "5min",
    "15m": "15min",
    "30m": "30min",
    "1h": "1h",
    "4h": "4h",
    "1d": "1day",
    "1w": "1week",
}


class RateLimiter:
    """Paces requests to a plan's credits-per-minute, shared by every client.

    Downloading a month of 1-minute candles takes several pages, and a Basic
    plan allows 8 a minute; without pacing the download dies part-way through
    with a 429 and the credits are spent for nothing.
    """

    def __init__(self) -> None:
        self._times: list[float] = []
        self._lock = threading.Lock()

    def take(self, per_minute: int, on_wait: Callable[[float], None] | None = None) -> float:
        """Block until a credit is free. Returns how long it waited.

        `on_wait` is told how long the block will last, so a download can say
        "paused for the rate limit" instead of appearing to hang.
        """
        waited = 0.0
        while True:
            with self._lock:
                now = time.monotonic()
                self._times = [t for t in self._times if now - t < 60.0]
                if per_minute <= 0 or len(self._times) < per_minute:
                    self._times.append(now)
                    return waited
                sleep_for = 60.0 - (now - self._times[0]) + 0.05
            if on_wait:
                on_wait(sleep_for)
            time.sleep(min(sleep_for, 60.0))
            waited += sleep_for


limiter = RateLimiter()


class TwelveDataError(RuntimeError):
    """A refusal from the provider, with their own code and message."""

    def __init__(self, message: str, code: int = 0) -> None:
        super().__init__(message)
        self.code = code

    @property
    def is_auth(self) -> bool:
        return self.code in (401, 403)

    @property
    def is_rate_limit(self) -> bool:
        return self.code == 429


class TwelveData:
    def __init__(self, api_key: str, credits_per_minute: int = 8) -> None:
        self.api_key = (api_key or "").strip()
        self.credits_per_minute = max(1, int(credits_per_minute))
        self.requests = 0  # spent by this client, for reporting a download's cost
        # Called with the seconds a request is about to wait for the rate limit.
        self.on_wait: Callable[[float], None] | None = None
        if not self.api_key:
            raise TwelveDataError("No Twelve Data API key set - add one in Settings.", 401)

    # -- plumbing -----------------------------------------------------------
    def _request(self, path: str, **params: object) -> dict:
        limiter.take(self.credits_per_minute, self.on_wait)
        self.requests += 1
        try:
            return self._send(path, **params)
        except TwelveDataError as exc:
            if not exc.is_rate_limit:
                raise
            # Our pacing and the server's accounting can disagree; give the
            # window time to roll over and spend one more credit on a retry.
            time.sleep(61)
            limiter.take(self.credits_per_minute)
            self.requests += 1
            return self._send(path, **params)

    def _send(self, path: str, **params: object) -> dict:
        query = {k: v for k, v in params.items() if v is not None}
        query["apikey"] = self.api_key
        url = f"{BASE_URL}/{path}?{urllib.parse.urlencode(query)}"
        request = urllib.request.Request(url, headers={"User-Agent": "GoldBacktester/1.0"})

        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:  # noqa: S310 - fixed host
                payload = json.load(response)
        except urllib.error.HTTPError as exc:
            raise TwelveDataError(f"provider returned HTTP {exc.code}", exc.code) from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise TwelveDataError(f"could not reach Twelve Data: {exc}") from exc

        if isinstance(payload, dict) and payload.get("status") == "error":
            raise TwelveDataError(str(payload.get("message", "unknown error")), int(payload.get("code", 0)))
        return payload

    # -- account ------------------------------------------------------------
    def usage(self) -> dict:
        """Plan name and how much of today's quota is gone. Doubles as a key test."""
        payload = self._request("api_usage")
        return {
            "plan": payload.get("plan_category") or payload.get("plan") or "unknown",
            "used": payload.get("current_usage"),
            "limit": payload.get("plan_limit"),
            "timestamp": payload.get("timestamp"),
        }

    # -- candles ------------------------------------------------------------
    def time_series(
        self,
        symbol: str,
        interval: str = "1min",
        outputsize: int = MAX_OUTPUTSIZE,
        end_date: datetime | None = None,
        start_date: datetime | None = None,
    ) -> pd.DataFrame:
        """One page of candles, oldest first, indexed by UTC bar-open time."""
        payload = self._request(
            "time_series",
            symbol=symbol,
            interval=interval,
            outputsize=max(1, min(outputsize, MAX_OUTPUTSIZE)),
            order="ASC",
            timezone="UTC",
            start_date=_stamp(start_date),
            end_date=_stamp(end_date),
        )
        return _to_frame(payload.get("values") or [])

    def range(
        self,
        symbol: str,
        start: datetime,
        end: datetime,
        interval: str = "1min",
        max_pages: int = 60,
        on_page: Callable[[int, int], None] | None = None,
    ) -> pd.DataFrame:
        """Every candle in [start, end], paged backwards from `end`.

        Each page is one credit, so the caller decides whether a range is worth
        downloading before calling this - see `pages_for`. `on_page` is called
        after each one with (pages so far, candles so far) so a long download can
        report progress instead of going quiet for a minute.
        """
        frames: list[pd.DataFrame] = []
        cursor = end
        collected = 0

        for _ in range(max_pages):
            if cursor <= start:
                break
            page = self.time_series(symbol, interval, MAX_OUTPUTSIZE, cursor, start)
            if page.empty:
                break
            frames.append(page)
            collected += len(page)
            if on_page:
                on_page(len(frames), collected)
            oldest = page.index[0].to_pydatetime().astimezone(timezone.utc)
            # A short page means the provider has nothing older in this window.
            if len(page) < MAX_OUTPUTSIZE or oldest <= start:
                break
            cursor = oldest - timedelta(seconds=1)

        if not frames:
            return _to_frame([])
        out = pd.concat(frames).sort_index()
        out = out[~out.index.duplicated(keep="last")]
        return out[(out.index >= pd.Timestamp(start)) & (out.index <= pd.Timestamp(end))]

    def history(
        self,
        symbol: str,
        bars: int,
        interval: str = "1min",
        max_pages: int = 20,
        pause: float = 0.2,
    ) -> pd.DataFrame:
        """Walk `end_date` backwards until `bars` candles are collected.

        Stops early when a page comes back short, which is how the provider says
        "that is all the history this plan has for this symbol".
        """
        frames: list[pd.DataFrame] = []
        collected = 0
        end: datetime | None = None

        for _ in range(max_pages):
            page = self.time_series(symbol, interval, min(bars - collected, MAX_OUTPUTSIZE), end)
            if page.empty:
                break
            frames.append(page)
            collected += len(page)
            if collected >= bars or len(page) < MAX_OUTPUTSIZE:
                break
            # Next page ends one second before the oldest bar we already have.
            end = page.index[0].to_pydatetime().astimezone(timezone.utc) - pd.Timedelta(seconds=1)
            time.sleep(pause)  # stay inside the per-minute request limit

        if not frames:
            return _to_frame([])
        out = pd.concat(frames).sort_index()
        return out[~out.index.duplicated(keep="last")].iloc[-bars:]

    def latest(self, symbol: str, interval: str = "1min", bars: int = 200) -> pd.DataFrame:
        """The most recent candles, used by the live poller."""
        return self.time_series(symbol, interval, bars)

    def search(self, query: str, limit: int = 12) -> list[dict]:
        """Symbol lookup for the settings modal. This endpoint needs no key."""
        payload = self._request("symbol_search", symbol=query, outputsize=limit)
        return [
            {
                "symbol": item.get("symbol", ""),
                "name": item.get("instrument_name", ""),
                "exchange": item.get("exchange", "") or item.get("country", ""),
                "type": item.get("instrument_type", ""),
            }
            for item in (payload.get("data") or [])[:limit]
        ]


def pages_for(start: datetime, end: datetime, interval_minutes: int = 1) -> int:
    """Credits a `range` download would cost, at worst: markets close, so a real
    download usually needs fewer pages than a wall-clock estimate suggests."""
    minutes = max(0.0, (end - start).total_seconds() / 60.0)
    return max(1, int(-(-minutes // (MAX_OUTPUTSIZE * max(1, interval_minutes)))))


def _stamp(moment: datetime | None) -> str | None:
    return moment.strftime("%Y-%m-%d %H:%M:%S") if moment else None


def _to_frame(values: list[dict]) -> pd.DataFrame:
    """Their string-typed rows into the OHLCV frame the store expects."""
    columns = ["open", "high", "low", "close", "volume"]
    if not values:
        empty = pd.DataFrame(columns=columns, index=pd.DatetimeIndex([], tz="UTC", name="time"))
        return empty.astype({c: "float64" for c in columns[:4]} | {"volume": "int64"})

    frame = pd.DataFrame(values)
    frame["time"] = pd.to_datetime(frame["datetime"], utc=True)
    frame = frame.set_index("time").sort_index()
    # Volume is absent for spot forex and metals; treat it as zero rather than NaN.
    if "volume" not in frame:
        frame["volume"] = 0
    frame = frame[columns].apply(pd.to_numeric, errors="coerce")
    frame = frame.dropna(subset=["open", "high", "low", "close"])
    frame["volume"] = frame["volume"].fillna(0)
    return frame.astype({"open": "float64", "high": "float64", "low": "float64", "close": "float64", "volume": "int64"})
