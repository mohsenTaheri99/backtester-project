# Frontend

React 19, TypeScript (strict), Vite 8, lightweight-charts 5. No state library
and no router: one screen, with state held in `App.tsx`. It is built into the
desktop app, served by its local backend, and knows nothing about the window
it runs in.

## Layout

```
┌──────────────────────── Toolbar ─────────────────────────┐
│ brand · symbol · timeframes · Volume · Trades · Live     │
│ · Chart data · Settings · meta                           │
├────┬──────────────────────────────────┬──────────────────┤
│ D  │ Legend (OHLC, selected trade)    │ BacktestPanel    │
│ r  │                                  │  Setup           │
│ a  │ Chart                            │  Results         │
│ w  │  candles, volume, trade zones,   │  Trades          │
│    │  user drawings                   │  Forward         │
├────┴──────────────────────────────────┴──────────────────┤
│ status: bars loaded · history · backtest summary         │
└──────────────────────────────────────────────────────────┘
```

Below 1100px the backtest panel moves under the chart. **Chart data** and
**Settings** open as modals over it.

## Files

| File | Role |
|---|---|
| `main.tsx` | Mounts `<App />` |
| `App.tsx` | All top-level state: symbol, timeframe, candles, paging, backtest, selected trade, drawing tool, live status, modals |
| `api.ts` | Typed client — relative `/api` URLs on the same local server that serves the UI (Vite proxies them in dev) |
| `types.ts` | Types mirroring the API JSON |
| `components/Toolbar.tsx` | Symbol picker, timeframe buttons, Volume/Trades toggles, the Live switch, Chart data and Settings |
| `components/Chart.tsx` | The main lightweight-charts instance |
| `components/Legend.tsx` | OHLC under the crosshair (or the last bar), plus the selected trade |
| `components/BacktestPanel.tsx` | Parameter form, range selector, stats, win/loss bar, equity, rejection funnel, trade table, forward tab |
| `components/RangeSelector.tsx` | The test range (`7d / 30d / 90d / All` or explicit UTC dates) and what it would cost |
| `components/DataModal.tsx` | Chart data: what is downloaded, adding, updating, extending and removing a symbol, with live job progress |
| `components/SettingsModal.tsx` | Schema-driven settings form, *Test connection*, and the app version in its footer |
| `components/ForwardSection.tsx` | Paper-trading session: start / stop, open position, trades, equity |
| `components/EquityChart.tsx` | Small area chart of the equity curve |
| `components/Stat.tsx` | One labelled number in the stats grid |
| `components/DrawingToolbar.tsx` | Left rail of drawing tools, see [Drawing tools](drawing-tools.md) |
| `lib/theme.ts` | Colour tokens and shared chart options |
| `lib/markers.ts` | `TIMEFRAME_SECONDS`, and trades → entry/exit markers |
| `lib/tradeZones.ts` | Series primitive that paints trade outcome boxes and the position tool |
| `lib/format.ts` | Numbers, prices, durations and byte sizes |
| `lib/useDataJob.ts` | Polls `/api/data/job` while a download runs, so any view can show its progress |
| `lib/useTicker.ts` | A clock for "3s ago" style labels |
| `lib/drawings/` | Drawing tools |
| `styles.css` | All styles, dark theme via CSS variables |

## State in `App.tsx`

- **Series**: `symbol`, `timeframe`, `candles`, `candlesKey`, `hasMore`,
  `loading`, `error`. Changing symbol or timeframe loads the newest 1,500 bars;
  a late response for an old series is ignored.

  `candlesKey` is deliberately separate from `symbol` / `timeframe`, which
  change the instant the user clicks. It is set *with* the candles, when they
  arrive, so the chart is never told the series changed while it is still
  holding the previous one's bars — which used to make a timeframe switch look
  like a prepend and leave the viewport at an arbitrary position.
- **Paging**: `loadOlder()` requests the page before `candles[0].time` and
  prepends it. A ref guards against overlapping requests, and a response that no
  longer lines up with the current first bar is dropped.
- **Backtest**: `strategy`, `params`, `range`, `result`, `running`,
  `backtestError`. Params start at the strategy's defaults and can be reset.
- **Trade focus**: `selectedTrade`, `focusTime`. Selecting a trade loads the
  missing history in large requests, then sets `focusTime`.
- **Live**: the feed's status is polled while it is on; new candles are appended
  to the series in place, without moving the viewport.
- **Drawings**: `drawingTool`, `magnet`, `drawingsVisible`, plus `useDrawings(symbol)`.
- **Keyboard**: Ctrl+Z undoes a drawing change; Alt+T/H/J/V/F/M and Alt+Shift+R
  pick drawing tools.

## The chart (`Chart.tsx`)

The chart is **created once** and never rebuilt on prop changes. Anything the
chart's callbacks need (candles, callbacks from props) is read through refs.
Separate effects push each prop into the chart:

| Effect | Does |
|---|---|
| build (mount) | create chart, candle + volume series, markers plugin, `TradeZones` and `DrawingLayer` primitives, `DrawingController`, crosshair and range subscriptions, `ResizeObserver` |
| `pricePrecision` | price format of the candle series |
| `showVolume` | volume series visibility |
| `candles`, `seriesKey` | `setData`, then one of three viewport rules (below) |
| `markers` | trade entry/exit markers |
| `trades`, `selectedTrade`, `showTrades` | trade zones |
| `selectedTrade` | dashed entry / stop / target price lines |
| `focusTime` | scrolls ~90 bars around a trade |
| drawings props | forwards drawings, tool, magnet and visibility to the drawing controller |

### The three viewport cases

Setting data, prepending older bars and appending a live one are different
things, and treating them alike made the chart jump:

- **New series** (`seriesKey` changed) — reset the view to the last 320 bars.
- **Prepend** (same series, older bars in front) — every logical index shifts
  right by the number of new bars, so the visible logical range is saved before
  `setData` and restored shifted by that amount. The view does not move.
- **Append** (a live candle) — leave the viewport exactly where it is. It used
  to be snapped back to the newest bars, throwing away the user's scroll
  position once a minute.

While a new series is loading the chart keeps showing the old one rather than
blanking.

Volume is an overlay price scale pinned to the bottom 22% of the pane.

## Trade overlays

- **Markers** (`markers.ts`) — an arrow at entry labelled `L3`/`S3`, a square at
  exit labelled with the R multiple. Times are snapped to the bar that contains
  them, so trades from the 1m backtest line up on any timeframe. Markers must be
  sorted by time.
- **Zones** (`tradeZones.ts`) — a series primitive with two pane views:
  - behind the candles: a faint green/red box from entry to exit for every
    trade, or the full reward (to target) and risk (to stop) zones for the
    selected trade;
  - in front: the entry → exit path, entry/exit dots and a result badge on the
    selected trade.

Primitives draw on the chart canvas in media (CSS pixel) coordinates and are
re-rendered by the chart on every pan or zoom, so they never drift.

## When a run finds nothing

Zero trades reads as a broken strategy, when it is almost always a sample too
short for a 1h break of structure, a 15m sweep and a session window to coincide.
So the **results** tab leads with the reason instead of an empty table: the
filter that rejected the most bars and its share, and how many trading days were
actually tested (`range.bars - range.warmupBars`, over 1,440). Under thirty days
it says the sample is the likely cause and points at Chart data; above it, that
the sample is not the problem and a filter is the thing to loosen. The **trades**
tab sends people to that explanation rather than dead-ending.

The same warning appears where the mistake is made: the import presets in Chart
data translate days into trading days — weekends are dropped, so 7 days is 5 —
and flag anything under thirty before a credit is spent on it.

## Downloads in progress

`useDataJob()` polls `/api/data/job` while a download runs and hands back the
job, so the Chart data window can show a progress bar over requests done,
candles so far, credits spent and elapsed time. When the rate limiter is holding
the next request the job reports `waitingSeconds` and the UI counts it down,
because a bar that sits still for forty seconds reads as a hang. Closing the
window does not cancel the download; reopening picks the progress back up.
