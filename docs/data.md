# Data

## The source file

Every instrument is imported from Twelve Data in the **Chart data** window and
cached as 1-minute CSV under `%LOCALAPPDATA%\GoldBacktester\data`. The app
carries no market data of its own; a fresh install has an empty chart until
something is imported. Historically a COMEX gold futures sample (`GC=F`) shipped
in `backend/data/`, downloaded by a `fetch_data.py` CLI - both were removed once
every symbol could come from a provider with live and forward-test support.

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
produce it (another paid feed, Dukascopy exports, a broker) can replace Twelve
Data by adding a client under `backend/app/providers/`.

On load (`store.py`) rows are sorted by time and duplicate timestamps are
dropped, keeping the last one.

A symbol's id comes from its provider ticker - `XAU/USD` becomes `XAUUSD` - and
the CSV is named after it. A ticker is only unique per listing, though: a search
for *gold* returns a dozen instruments all called `GOLD`, so when a second one of
those is imported the exchange is appended (`GOLD-NYSE`). Importing the same
listing again keeps its id and updates it in place.

Which listing is settled at import and stored on the symbol as its MIC, and every
later request for its candles - a range download, the live poller - carries that
MIC. Asked for a bare ticker the provider does not answer "which one?": it picks
its own default listing, so `GOLD` imported from Stuttgart came back as candles
for Barrick Gold on the NYSE, US trading hours and all, with nothing to say
anything was wrong. A listing the plan does not cover now fails with the
provider's own message instead.

## Picking something worth backtesting

The provider matches on letters, not on usefulness. "BTC" answers with nine
thinly traded stocks and ETFs before it reaches BTC/USD, and the first row - a
$30 ETF listed on one exchange - is the worst instrument in the list: a fifth of
its minutes hold a single price and every night is an 17-hour gap. So the data
window sorts continuous instruments first, tags them `24h`, shows each row's
instrument type, and offers the handful this app is built around - gold, silver,
the major pairs - as one-click chips.

Search also asks for `show_plan`, so every row carries the cheapest plan that may
download it, compared against the account's own plan (cached per key from
`api_usage`). A listing out of reach is tagged and its button disabled, rather
than costing a download that ends in an upgrade notice. When either plan name is
one the backend does not rank, no claim is made either way.

Beside the candles, `settings.json` holds the catalogue of imported symbols and,
per symbol, the spans that have been fetched - so symbols and their coverage
survive restarts and app upgrades. A symbol whose CSV has gone missing is
skipped at startup with a note to re-import it.

## One resolution on disk, every timeframe on demand

Only 1m is stored. Other timeframes are resampled from it the first time they
are requested and then kept in memory:

```python
base.resample(rule, label="left", closed="left", origin="epoch").agg({
    "open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum",
})
```

- `label="left"`, `closed="left"` - a 1h bar covering 10:00-10:59 is stamped
  10:00, which is what charts and backtesters expect.
- `origin="epoch"` - buckets are aligned to the unix epoch in UTC, so they are
  stable no matter where the data starts.
- Empty buckets (weekends, holidays) are **dropped**, not drawn as flat bars.

The cached frames are thrown away whenever the base frame changes - an import,
an update, or a live candle - so a resampled bar can never be stale.

Supported timeframes live in `TIMEFRAMES` in `backend/app/config.py`
(`1m 5m 15m 30m 1h 4h 1d 1w`). Adding one is one line there, plus its length in
seconds in `TIMEFRAME_SECONDS` in `frontend/src/lib/markers.ts`.

## Candles the provider invents

Spot FX and metals stop trading for the weekend, but the feed keeps emitting
1-minute candles through it at a held price. Those are detected by how long
price stands still - not by a calendar, which cannot know when a provider ends
its week or that Good Friday exists - and dropped on import and on every update.
Only FX and metals are touched. See
[Backend -> Invented candles](backend.md#invented-candles-market_hourspy).

Downloads report the drop: "Added 41,203 candles, dropped 12,180 from the closed
market".

## Getting more history

Pick a range in the **setup** tab (`7d / 30d / 90d / All`, or explicit UTC
dates). The panel prices it before you run: a range already cached spends
nothing, and only genuinely missing spans are downloaded. Gaps *inside* the
cached span are weekends and market closures, so they are never re-fetched, and
a gap too narrow to hold a complete candle is not requested at all.

Downloads page backwards in requests of 5,000 candles, paced to the
requests-a-minute your plan allows (Settings -> Data provider -> Rate limit), and
retry once on a 429. Thirty days of 1-minute candles is about nine requests.

## Adding an instrument

1. Settings -> Data provider: paste a Twelve Data API key and press
   **Test connection**.
2. Toolbar -> **Chart data**: search for the instrument (`XAU/USD`, `EUR/USD`,
   `AAPL`), pick how much history, and press **Add**. It caches 1-minute candles
   under `%LOCALAPPDATA%\GoldBacktester\data` and the chart switches to it.
3. **Update** tops it up to now, **+180d** extends it backwards, and **Remove**
   deletes it and its cached candles after a confirmation naming how many
   candles would go.

The preset lengths (7 / 30 / 90 / 180 days) say what they cost in credits *and*
what they are worth as a sample: weekends are dropped, so 7 days holds about 5
trading days, and anything under thirty is flagged as a short sample before a
credit is spent on it. A strategy waiting on a 1h break of structure, a 15m
sweep and a session window may find nothing at all in a week of data.

Downloads run on the backend so the window can show progress instead of
blocking: `GET /api/data/job` reports the running one - requests done of an
estimate, candles so far, credits spent, and a countdown whenever the rate
limiter is holding the next request back. Only one runs at a time, since they
would be serialised by that limiter anyway. Closing the window does not cancel a
download; reopening picks the progress back up.

## How much is on disk

The Chart data window answers it per symbol: candles, the number of days
actually holding candles, the coverage dates, its size on disk, and a running
total across every symbol, with a note when a symbol has fallen behind.
