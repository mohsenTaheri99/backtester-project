"""Download real 1-minute gold candles from Yahoo Finance.

Yahoo only serves 1m bars for roughly the last 30 days, and at most ~7 days
per request, so we walk backwards in 7-day windows and merge the chunks.
Run it as a module:  python -m app.fetch_data  [--symbol GC=F] [--days 30]
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CSV_HEADER = ["time", "open", "high", "low", "close", "volume"]


def _fetch_window(symbol: str, start: datetime, end: datetime) -> dict[int, list]:
    params = {
        "interval": "1m",
        "period1": int(start.timestamp()),
        "period2": int(end.timestamp()),
        "includePrePost": "true",
    }
    url = f"{CHART_URL.format(symbol=urllib.parse.quote(symbol))}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=30) as resp:  # noqa: S310 - fixed host
        payload = json.load(resp)["chart"]
    if payload.get("error"):
        raise RuntimeError(payload["error"])

    results = payload.get("result") or []
    if not results:
        return {}

    result = results[0]
    stamps = result.get("timestamp") or []
    quote = result["indicators"]["quote"][0]
    rows: dict[int, list] = {}
    for i, ts in enumerate(stamps):
        o, h, l, c = quote["open"][i], quote["high"][i], quote["low"][i], quote["close"][i]
        if None in (o, h, l, c):
            continue
        vol = quote["volume"][i] or 0
        rows[int(ts)] = [int(ts), round(o, 4), round(h, 4), round(l, 4), round(c, 4), int(vol)]
    return rows


def _read_existing(path: Path) -> dict[int, list]:
    if not path.exists():
        return {}
    rows: dict[int, list] = {}
    with path.open(newline="") as fh:
        for row in csv.DictReader(fh):
            ts = int(row["time"])
            rows[ts] = [
                ts,
                float(row["open"]),
                float(row["high"]),
                float(row["low"]),
                float(row["close"]),
                int(float(row["volume"])),
            ]
    return rows


def download(symbol: str, days: int, out_path: Path) -> int:
    """Merge freshly downloaded bars into out_path. Returns total bar count."""
    rows = _read_existing(out_path)
    before = len(rows)

    now = datetime.now(timezone.utc)
    window_end = now
    oldest = now - timedelta(days=days)
    while window_end > oldest:
        window_start = max(window_end - timedelta(days=7), oldest)
        try:
            chunk = _fetch_window(symbol, window_start, window_end)
        except Exception as exc:  # noqa: BLE001 - keep partial data on network errors
            print(f"  ! {window_start:%Y-%m-%d} -> {window_end:%Y-%m-%d}: {exc}", file=sys.stderr)
            chunk = {}
        print(f"  {window_start:%Y-%m-%d} -> {window_end:%Y-%m-%d}: {len(chunk)} bars")
        rows.update(chunk)
        window_end = window_start
        time.sleep(0.5)  # be polite to the public endpoint

    if not rows:
        raise RuntimeError(f"no data returned for {symbol}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(CSV_HEADER)
        for ts in sorted(rows):
            writer.writerow(rows[ts])

    print(f"{out_path.name}: {len(rows)} bars (+{len(rows) - before} new)")
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", default="GC=F", help="Yahoo ticker (default GC=F)")
    parser.add_argument("--out", default=None, help="output CSV path")
    parser.add_argument("--days", type=int, default=30, help="days of history to request")
    args = parser.parse_args()

    slug = args.symbol.replace("=", "").replace("^", "")
    out = Path(args.out) if args.out else DATA_DIR / f"{slug}_1m.csv"
    download(args.symbol, args.days, out)


if __name__ == "__main__":
    main()
