# Data

## The source file

`backend/data/GCF_1m.csv` — COMEX gold futures (`GC=F`, front month), 1-minute
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

```bash
docker compose exec backend python -m app.fetch_data --symbol "GC=F" --days 30
docker compose restart backend
```

`fetch_data.py` (standard library only):

- walks backwards from now in **7-day windows**, the most Yahoo serves per
  1m request;
- **merges** into the existing CSV, so repeated runs extend coverage rather than
  overwrite it;
- keeps partial data if a window fails (logged to stderr).

Yahoo only keeps about **30 days** of 1m data, so that is the ceiling from this
source. Older windows are rejected and skipped.

Options: `--symbol` (Yahoo ticker, default `GC=F`), `--days` (default 30),
`--out` (default `data/<ticker>_1m.csv`).

## Adding an instrument

1. Put a 1m CSV in `backend/data/`, e.g. with
   `python -m app.fetch_data --symbol "SI=F"`.
2. Register it in `SYMBOLS` in `backend/app/config.py`: `id`, `name`,
   `exchange`, `source` (Yahoo ticker), `csv` (file name), `price_precision`.
3. Restart the backend. It appears in `/api/symbols` and the toolbar picker.

A symbol whose CSV is missing is skipped at startup with a hint on how to
download it.
