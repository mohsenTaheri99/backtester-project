# Drawing tools

TradingView-style tools for marking up the chart. They live in
`frontend/src/lib/drawings/` and `frontend/src/components/DrawingToolbar.tsx`,
and are wired up in `Chart.tsx` and `App.tsx`.

## For users

| Group | Tool | Placement | Shortcut |
|---|---|---|---|
| Cursor | Select / move / reshape | — | Esc |
| Lines | Trend line | two points | Alt+T |
| | Ray (extends past the 2nd point) | two points | |
| | Extended line (both directions) | two points | |
| | Horizontal line | one click | Alt+H |
| | Horizontal ray | one click | Alt+J |
| | Vertical line | one click | Alt+V |
| Fibonacci | Fib retracement (0, .236, .382, .5, .618, .786, 1) | two points | Alt+F |
| Shapes | Rectangle | two points | Alt+Shift+R |
| | Brush (freehand) | drag | |
| Text | Text label | one click, then type | |
| Prediction | Long position | one click (2R box) | |
| | Short position | one click (2R box) | |
| | Price / date range | two points | |

- **Two-point tools**: click, move, click — or press, drag, release.
- After placing a drawing the tool returns to the cursor.
- **Select** by clicking a drawing. Drag the body to move it, drag a handle to
  reshape it. **Delete / Backspace** removes it. A small bar at the top of the
  chart changes its colour, edits text or deletes it.
- **Double-click** a text label to edit it. Enter saves, Esc cancels; an empty
  label is removed.
- **Magnet** snaps points to the nearest open/high/low/close of the bar.
- **Eye** hides or shows all drawings. **Undo** (Ctrl+Z) reverts the last
  change. **Trash** removes every drawing on the symbol.
- Drawings are saved **per symbol** in the browser (`localStorage`) and are
  shared across timeframes. They are not sent to the backend.

## How it works

```
App.tsx
  useDrawings(symbol)  ── drawings[], commit, undo, clear  (localStorage)
  drawingTool, magnet, drawingsVisible
        │ props
        ▼
Chart.tsx
  DrawingLayer        ← attached to the candle series as a primitive (paints)
  DrawingController   ← listens to pointer / keyboard events on the container
  options bar + text input (React overlays)
```

### Data model (`types.ts`)

```ts
interface Anchor  { time: number; price: number }   // unix seconds, UTC
interface Drawing { id: string; type: DrawingType; points: Anchor[]; color: string; text?: string }
```

Points per type:

| Type | `points` |
|---|---|
| trendline, ray, extended, rect, fib, measure | `[start, end]` |
| hline, hray, vline, text | `[point]` |
| long, short | `[entry, target, stop]` — target and stop share the right-edge time |
| brush | every sampled point |

`TOOLS` holds each tool's label, shortcut, placement style
(`one-click` / `two-point` / `freehand`) and default colour.

### Why anchors are time + price, not bar index

lightweight-charts positions things by *logical index*, but indexes shift every
time older history is prepended, and differ between timeframes. Storing the bar
time keeps a drawing in place through both. `DrawingLayer` converts on every
paint:

- `timeToLogical(time)` — binary search for the last bar with `time ≤ t`.
  Before the first bar or after the last, it extrapolates using the timeframe's
  seconds, so drawings can extend into the future or past loaded history.
- `logicalToTime(index)` — the reverse, with the same extrapolation.
- `toPixel(anchor)` / `fromPixel(x, y, magnet)` — through the time scale and the
  candle series' price scale. `fromPixel` snaps to a bar and, with the magnet
  on, to that bar's nearest OHLC price.

### Painting (`DrawingLayer.ts`)

A `ISeriesPrimitive` with one pane view at `zOrder: 'top'`:

- `paint()` switches on the drawing type and draws in CSS pixels. Rays and
  extended lines are pushed far past the pane edge; the canvas clips them.
- The selected or hovered drawing gets a thicker line and round handles.
- `updateAllViews()` builds **axis labels**: price labels for horizontal
  lines/rays, time labels for vertical lines, and price + time labels for the
  points of the selected drawing.
- `hitTest()` tells the chart which cursor to show: `crosshair` while a tool is
  armed, `move` over a body, `pointer` over a handle.
- `hit(x, y)` is the geometry used by the controller: handles of the selected
  drawing first, then bodies from top-most down (distance to segment/ray/line,
  inside box, near horizontal/vertical line, text bounding box from the last
  paint, brush segments).

### Interaction (`DrawingController.ts`)

The chart pans on `mousedown` / `touchstart`. On `pointerdown` the controller
decides whether the press is *ours* — a tool is armed, or the pointer is on a
drawing — and sets `claimed`. Capture-phase listeners on the container then
stop the following `mousedown` / `touchstart` from reaching the chart, so it
does not pan. `mousemove` is left alone, so the crosshair keeps tracking.
Presses on the price or time axis are never claimed, so axis scaling still works.

State machine:

- **Tool armed, one-click** → create the drawing, commit, select it, return to
  cursor (text also opens the editor).
- **Tool armed, two-point** → a draft with both points at the press; the second
  point follows the pointer. Release after a drag, or a second click, commits.
- **Tool armed, freehand** → append points ≥ 3 px apart while dragging; commit
  on release.
- **Cursor on a drawing** → select it and start a drag. Handle drags replace
  one point (position tools keep target and stop on the same edge). Body drags
  shift every point by whole bars and by a price delta.
- **Cursor on empty chart** → deselect and let the chart pan.

During a drag, changes live only in the layer. The controller commits once, on
release, so React (and the whole app) re-renders once per edit, not per mouse
move. `setDrawings()` from React is ignored mid-drag for the same reason.

### Persistence and undo (`useDrawings.ts`)

- Key: `backtester:drawings:<symbol>`. Reads and writes are wrapped in
  try/catch, so blocked storage only means drawings don't survive a reload.
- Switching symbol swaps in that symbol's drawings and clears undo history.
- Every commit pushes the previous list onto a history of up to 100 steps.

## Adding a tool

1. Add the type to `DrawingType` and an entry to `TOOLS` in `types.ts`.
2. In `DrawingLayer.ts`, add a `paint()` case and a `hitBody()` case (and a
   handle rule in `handlePixels()` if the points are not plain anchors).
3. If it needs special placement or drag constraints, handle it in
   `DrawingController.placeAt()` / `dragTo()`.
4. Add an icon to `TOOL_ICONS` and put it in a group in `DrawingToolbar.tsx`.
5. Optional: a shortcut in `TOOL_SHORTCUTS` in `App.tsx`.
