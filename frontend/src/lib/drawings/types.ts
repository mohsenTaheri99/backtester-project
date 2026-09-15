/** A point on the chart: bar time (unix seconds, UTC) and price. */
export interface Anchor {
  time: number
  price: number
}

export type DrawingType =
  | 'trendline'
  | 'ray'
  | 'extended'
  | 'hline'
  | 'hray'
  | 'vline'
  | 'rect'
  | 'fib'
  | 'long'
  | 'short'
  | 'measure'
  | 'text'
  | 'brush'

export type ToolId = 'cursor' | DrawingType

export interface Drawing {
  id: string
  type: DrawingType
  /**
   * Anchors, by type:
   * - lines, rect, fib, measure: [start, end]
   * - hline, hray, vline, text: [point]
   * - long / short: [entry, target, stop] - target and stop share the end time
   * - brush: every sampled point
   */
  points: Anchor[]
  color: string
  text?: string
}

/** How a tool is placed with the mouse. */
export type Placement = 'one-click' | 'two-point' | 'freehand'

export interface ToolSpec {
  id: ToolId
  label: string
  shortcut?: string
  placement?: Placement
  defaultColor?: string
}

export const DRAWING_COLORS = ['#2962ff', '#e0b64a', '#26a69a', '#ef5350', '#ab47bc', '#ff9800', '#e6ecf5'] as const

export const TOOLS: Record<ToolId, ToolSpec> = {
  cursor: { id: 'cursor', label: 'Cursor', shortcut: 'Esc' },
  trendline: { id: 'trendline', label: 'Trend line', shortcut: 'Alt+T', placement: 'two-point', defaultColor: '#2962ff' },
  ray: { id: 'ray', label: 'Ray', placement: 'two-point', defaultColor: '#2962ff' },
  extended: { id: 'extended', label: 'Extended line', placement: 'two-point', defaultColor: '#2962ff' },
  hline: { id: 'hline', label: 'Horizontal line', shortcut: 'Alt+H', placement: 'one-click', defaultColor: '#e0b64a' },
  hray: { id: 'hray', label: 'Horizontal ray', shortcut: 'Alt+J', placement: 'one-click', defaultColor: '#e0b64a' },
  vline: { id: 'vline', label: 'Vertical line', shortcut: 'Alt+V', placement: 'one-click', defaultColor: '#7c879a' },
  rect: { id: 'rect', label: 'Rectangle', shortcut: 'Alt+Shift+R', placement: 'two-point', defaultColor: '#ab47bc' },
  fib: { id: 'fib', label: 'Fib retracement', shortcut: 'Alt+F', placement: 'two-point', defaultColor: '#7c879a' },
  long: { id: 'long', label: 'Long position', placement: 'one-click', defaultColor: '#26a69a' },
  short: { id: 'short', label: 'Short position', placement: 'one-click', defaultColor: '#ef5350' },
  measure: { id: 'measure', label: 'Price / date range', placement: 'two-point', defaultColor: '#2962ff' },
  text: { id: 'text', label: 'Text', placement: 'one-click', defaultColor: '#e6ecf5' },
  brush: { id: 'brush', label: 'Brush', placement: 'freehand', defaultColor: '#ff9800' },
}

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const
