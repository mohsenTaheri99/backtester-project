# Frontend

React 19, TypeScript (strict), Vite 8, lightweight-charts 5. No state library
and no router: one screen, with state held in `App.tsx`. It is built into the
desktop app, served by its local backend, and knows nothing about the window
it runs in.

## Layout

```
┌──────────────────────── Toolbar ─────────────────────────┐
│ brand · symbol · timeframes · Volume · Trades · meta     │
├────┬──────────────────────────────────┬──────────────────┤
│ D  │ Legend (OHLC, selected trade)    │ BacktestPanel    │
│ r  │                                  │  Setup           │
│ a  │ Chart                            │  Results         │
│ w  │  candles, volume, trade zones,   │  Trades          │
│    │  user drawings                   │                  │
├────┴──────────────────────────────────┴──────────────────┤
│ status: bars loaded · history · backtest summary         │
└──────────────────────────────────────────────────────────┘
```

Below 1100px the backtest panel moves under the chart.

## Files

| File | Role |
|---|---|
| `main.tsx` | Mounts `<App />` |
| `App.tsx` | All top-level state: symbol, timeframe, candles, paging, backtest, selected trade, drawing tool |
| `api.ts` | `fetchSymbols`, `fetchCandles`, `fetchStrategies`, `runBacktest` — relative `/api` URLs on the same local server that serves the UI (Vite proxies them in dev) |
| `types.ts` | Types mirroring the API JSON |
| `components/Toolbar.tsx` | Symbol picker, timeframe buttons, Volume/Trades toggles |
| `components/Chart.tsx` | The main lightweight-charts instance |
| `components/Legend.tsx` | OHLC under the crosshair (or the last bar), plus the selected trade |
| `components/BacktestPanel.tsx` | Parameter form, stats, win/loss bar, equity, rejection funnel, trade table |
| `components/EquityChart.tsx` | Small area chart of the equity curve |
| `components/DrawingToolbar.tsx` | Left rail of drawing tools, see [Drawing tools](drawing-tools.md) |
| `lib/theme.ts` | Colour tokens and shared chart options |
| `lib/markers.ts` | `TIMEFRAME_SECONDS`, and trades → entry/exit markers |
| `lib/tradeZones.ts` | Series primitive that paints trade outcome boxes and the position tool |
| `lib/drawings/` | Drawing tools |
| `styles.css` | All styles, dark theme via CSS variables |

## State in `App.tsx`

- **Series**: `symbol`, `timeframe`, `candles`, `hasMore`, `loading`, `error`.
  Changing symbol or timeframe loads the newest 1,500 bars; a late response for
  an old series is ignored.
- **Paging**: `loadOlder()` requests the page before `candles[0].time` and
  prepends it. A ref guards against overlapping requests, and a response that no
  longer lines up with the current first bar is dropped.
- **Backtest**: `strategy`, `params`, `result`, `running`, `backtestError`.
  Params start at the strategy's defaults and can be reset.
- **Trade focus**: `selectedTrade`, `focusTime`. Selecting a trade loads the
  missing history in large requests, then sets `focusTime`.
- **Drawings**: `drawingTool`, `magnet`, `drawingsVisible`, plus `useDrawings(symbol)`.
- **Keyboard**: Ctrl+Z undoes a drawing change; Alt+T/H/J/V/F and Alt+Shift+R
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
| `candles`, `seriesKey` | `setData`; keeps the viewport still when bars were **prepended**, otherwise shows the last 320 bars |
| `markers` | trade entry/exit markers |
| `trades`, `selectedTrade`, `showTrades` | trade zones |
| `selectedTrade` | dashed entry / stop / target price lines |
| `focusTime` | scrolls ~90 bars around a trade |
| drawings props | forwards drawings, tool, magnet and visibility to the drawing controller |

Why prepends matter: when older bars arrive, every logical index shifts right
by the number of new bars. The effect saves the visible logical range before
`setData` and restores it shifted by that amount, so the chart does not jump.

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
