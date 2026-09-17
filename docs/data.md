# Data

## The source file

Every instrument is imported from Twelve Data in Settings → Market data and
cached as 1-minute CSV under `%LOCALAPPDATA%\GoldBacktester\data`. The app
carries no market data of its own; a fresh install has an empty chart until
something is imported. Historically a COMEX gold futures sample (`GC=F`) shipped
in `backend/data/`, downloaded by a `fetch_data.py` CLI — both were removed once
every symbol could come from a provider with live and forward-test support.
1-minute
bars from Yahoo Finance.

```csv
time,open,high,low,close,volume
1786918200,4380.1,4381.0,4379.6,4380.4,152
```

| Column | Type | Meaning |
|---|---|---|
| `time` | int | unix seconds, UTC, bar **open** time |
| `open` `high` `low` `close` | float | prices in USD |
| `volume` | int | contracts traded in the minute |

This format is the only contract the backend relies on. Any source that can
produce it (a paid feed, Dukascopy exports, a broker) can replace Yahoo.

On load (`store.py`) rows are sorted by time and duplicate timestamps are
dropped, keeping the last one.

## One resolution on disk, every timeframe on demand

Only 1m is stored. Other timeframes are resampled from it the first time they
are requested and then kept in memory:

```python
base.resample(rule, label="left", closed="left", origin="epoch").agg({
    "open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum",
})
```

- `label="left"`, `closed="left"` — a 1h bar covering 10:00–10:59 is stamped
  10:00, which is what charts and backtesters expect.
- `origin="epoch"` — buckets are aligned to the unix epoch in UTC, so they are
  stable no matter where the data starts.
- Empty buckets (weekends, holidays) are **dropped**, not drawn as flat bars.

Supported timeframes live in `TIMEFRAMES` in `backend/app/config.py`
(`1m 5m 15m 30m 1h 4h 1d 1w`). Adding one is one line there, plus its length in
seconds in `TIMEFRAME_SECONDS` in `frontend/src/lib/markers.ts`.

## Getting more history

Pick a range in the **setup** tab (`7d / 30d / 90d / All`, or explicit UTC
dates). The panel prices it before you run: a range already cached spends
nothing, and only genuinely missing spans are downloaded. Gaps *inside* the
cached span are weekends and market closures, so they are never re-fetched.

Downloads page backwards in requests of 5,000 candles, paced to the
requests-a-minute your plan allows (Settings -> Data provider -> Rate limit), and
retry once on a 429. Thirty days of 1-minute candles is about nine requests.

## Adding an instrument

1. Settings -> Data provider: paste a Twelve Data API key and press
   **Test connection**.
2. Settings -> Market data: search for the instrument (`XAU/USD`, `EUR/USD`,
   `AAPL`) and press **Import**. It downloads `history_days` of 1-minute
   candles, caches them under `%LOCALAPPDATA%\GoldBacktester\data`, and the
   chart switches to it.
3. **Update** tops it up to now; **Remove** deletes it and its cached candles.

The catalogue of imported symbols lives in `settings.json` beside the candles,
so symbols survive restarts and app upgrades. A symbol whose CSV has gone
missing is skipped at startup with a note to re-import it.
