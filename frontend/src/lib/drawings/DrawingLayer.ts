/**
 * Paints user drawings (trend lines, fibs, position tools, ...) onto the
 * candle pane as a lightweight-charts series primitive, and answers the
 * geometry questions the interaction controller needs: pixel <-> anchor
 * conversion and hit testing.
 *
 * Anchors are stored as bar time + price rather than logical indexes, so
 * drawings survive history being prepended and switching timeframe.
 */
import type {
  Coordinate,
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  Logical,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts'
import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import type { Candle } from '../../types'
import { FIB_LEVELS, type Anchor, type Drawing } from './types'

const FONT = '500 11px ui-sans-serif, system-ui, sans-serif'
const TEXT_FONT = '500 13px ui-sans-serif, system-ui, sans-serif'
const BG = '#0e1117'
const HANDLE_RADIUS = 4.5
const HIT_TOLERANCE = 6
const FIB_BAND_COLORS = ['#ef5350', '#ff9800', '#e0b64a', '#26a69a', '#2962ff', '#ab47bc']

export interface Hit {
  id: string
  /** Index into `points`, or -1 when the body was hit. */
  handle: number
}

interface Px {
  x: number
  y: number
}

/** `#rrggbb` -> `rgba(r, g, b, a)` */
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function distToSegment(p: Px, a: Px, b: Px, clampStart = true, clampEnd = true): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  if (clampStart) t = Math.max(0, t)
  if (clampEnd) t = Math.min(1, t)
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Push `b` out along a->b until it leaves a `width` x `height` box. */
function extendToEdge(a: Px, b: Px, width: number, height: number): Px {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (dx === 0 && dy === 0) return b
  const far = (width + height) * 4 / Math.hypot(dx, dy)
  return { x: a.x + dx * far, y: a.y + dy * far }
}

function formatDuration(seconds: number): string {
  const s = Math.abs(seconds)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  return `${m}m`
}

class DrawingRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly layer: DrawingLayer) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context
      const { width, height } = scope.mediaSize
      ctx.save()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const drawing of this.layer.renderList()) {
        this.layer.paint(ctx, drawing, width, height)
      }
      ctx.restore()
    })
  }
}

class DrawingPaneView implements IPrimitivePaneView {
  private readonly paneRenderer: DrawingRenderer

  constructor(layer: DrawingLayer) {
    this.paneRenderer = new DrawingRenderer(layer)
  }

  zOrder() {
    return 'top' as const
  }

  renderer(): IPrimitivePaneRenderer {
    return this.paneRenderer
  }
}

class AxisLabel implements ISeriesPrimitiveAxisView {
  constructor(
    private readonly at: number,
    private readonly label: string,
    private readonly color: string,
  ) {}

  coordinate() {
    return this.at
  }
  text() {
    return this.label
  }
  textColor() {
    return '#0e1117'
  }
  backColor() {
    return this.color
  }
}

export class DrawingLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null
  private series: ISeriesApi<'Candlestick'> | null = null
  private requestUpdate: (() => void) | null = null

  private candles: Candle[] = []
  private seconds = 60

  drawings: Drawing[] = []
  /** In-progress drawing that is not committed yet. */
  draft: Drawing | null = null
  selectedId: string | null = null
  hoveredId: string | null = null
  /** Cursor to show while a drawing tool is armed. */
  armed = false
  visible = true

  private readonly views = [new DrawingPaneView(this)]
  private priceLabels: ISeriesPrimitiveAxisView[] = []
  private timeLabels: ISeriesPrimitiveAxisView[] = []
  /** Text bounding boxes from the last paint, for hit testing. */
  private readonly textBoxes = new Map<string, { x: number; y: number; w: number; h: number }>()

  // --- ISeriesPrimitive -----------------------------------------------------
  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart as IChartApi
    this.series = param.series as ISeriesApi<'Candlestick'>
    this.requestUpdate = param.requestUpdate
  }

  detached(): void {
    this.chart = null
    this.series = null
    this.requestUpdate = null
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.priceLabels
  }

  timeAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.timeLabels
  }

  updateAllViews(): void {
    this.priceLabels = []
    this.timeLabels = []
    const series = this.series
    if (!series || !this.visible) return

    const fmt = series.priceFormatter()
    const priceLabel = (price: number, color: string) => {
      const y = series.priceToCoordinate(price)
      if (y !== null) this.priceLabels.push(new AxisLabel(y, fmt.format(price), color))
    }
    const timeLabel = (time: number, color: string) => {
      const x = this.timeToX(time)
      if (x !== null) this.timeLabels.push(new AxisLabel(x, this.formatTime(time), color))
    }

    for (const d of this.renderList()) {
      const active = d.id === this.selectedId || d === this.draft
      if (d.type === 'hline' || d.type === 'hray') priceLabel(d.points[0].price, d.color)
      else if (d.type === 'vline') timeLabel(d.points[0].time, d.color)
      else if (active && d.type !== 'brush' && d.type !== 'text') {
        for (const p of d.points) priceLabel(p.price, d.color)
        timeLabel(d.points[0].time, d.color)
        if (d.points.length > 1) timeLabel(d.points[1].time, d.color)
      }
    }
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    if (this.armed) return { externalId: 'drawing-tool', zOrder: 'top', cursorStyle: 'crosshair' }
    const hit = this.hit(x, y)
    if (!hit) return null
    return {
      externalId: hit.id,
      zOrder: 'top',
      cursorStyle: hit.handle >= 0 ? 'pointer' : 'move',
    }
  }

  // --- data -----------------------------------------------------------------
  setCandles(candles: Candle[], seconds: number): void {
    this.candles = candles
    this.seconds = seconds
    this.update()
  }

  update(): void {
    this.requestUpdate?.()
  }

  renderList(): Drawing[] {
    if (!this.visible) return []
    return this.draft ? [...this.drawings, this.draft] : this.drawings
  }

  // --- coordinates ------------------------------------------------------------
  /** Logical bar index containing `time`; extrapolated past either end of the data. */
  timeToLogical(time: number): number | null {
    const c = this.candles
    const n = c.length
    if (!n) return null
    if (time < c[0].time) return Math.floor((time - c[0].time) / this.seconds)
    if (time >= c[n - 1].time) return n - 1 + Math.floor((time - c[n - 1].time) / this.seconds)

    let lo = 0
    let hi = n - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (c[mid].time <= time) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  logicalToTime(logical: number): number {
    const c = this.candles
    const n = c.length
    const i = Math.round(logical)
    if (!n) return 0
    if (i < 0) return c[0].time + i * this.seconds
    if (i >= n) return c[n - 1].time + (i - (n - 1)) * this.seconds
    return c[i].time
  }

  timeToX(time: number): number | null {
    const logical = this.timeToLogical(time)
    if (logical === null || !this.chart) return null
    return this.chart.timeScale().logicalToCoordinate(logical as Logical)
  }

  toPixel(a: Anchor): Px | null {
    const x = this.timeToX(a.time)
    const y = this.series?.priceToCoordinate(a.price) ?? null
    return x === null || y === null ? null : { x, y }
  }

  /** Pixel -> anchor, snapped to a bar. With `magnet`, price snaps to the nearest OHLC value. */
  fromPixel(x: number, y: number, magnet = false): Anchor | null {
    const chart = this.chart
    const series = this.series
    if (!chart || !series || !this.candles.length) return null
    const logical = chart.timeScale().coordinateToLogical(x as Coordinate)
    const price = series.coordinateToPrice(y as Coordinate)
    if (logical === null || price === null) return null

    const index = Math.round(logical)
    const anchor: Anchor = { time: this.logicalToTime(index), price }
    const bar = this.candles[index]
    if (magnet && bar) {
      let best = anchor.price
      let bestDist = Infinity
      for (const value of [bar.open, bar.high, bar.low, bar.close]) {
        const vy = series.priceToCoordinate(value)
        if (vy !== null && Math.abs(vy - y) < bestDist) {
          bestDist = Math.abs(vy - y)
          best = value
        }
      }
      anchor.price = best
    }
    return anchor
  }

  priceAtY(y: number): number | null {
    return this.series?.coordinateToPrice(y as Coordinate) ?? null
  }

  logicalAtX(x: number): number | null {
    return this.chart?.timeScale().coordinateToLogical(x as Coordinate) ?? null
  }

  paneWidth(): number {
    return this.chart?.timeScale().width() ?? 0
  }

  paneHeight(): number {
    return this.chart?.paneSize(0).height ?? 0
  }

  private formatTime(time: number): string {
    return new Date(time * 1000).toLocaleString('en-GB', {
      timeZone: 'UTC',
      day: '2-digit',
      month: 'short',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }

  private formatPrice(price: number): string {
    return this.series?.priceFormatter().format(price) ?? price.toFixed(2)
  }

  // --- hit testing ------------------------------------------------------------
  /** Handle positions for a drawing, in the same order as its points. */
  handlePixels(d: Drawing, width: number, height: number): (Px | null)[] {
    return d.points.map((p) => {
      if (d.type === 'hline') {
        const y = this.series?.priceToCoordinate(p.price)
        return y == null ? null : { x: width / 2, y }
      }
      if (d.type === 'vline') {
        const x = this.timeToX(p.time)
        return x === null ? null : { x, y: height / 2 }
      }
      return this.toPixel(p)
    })
  }

  hit(x: number, y: number): Hit | null {
    if (!this.visible) return null
    const width = this.paneWidth()
    const height = this.paneHeight()
    const p = { x, y }

    // Handles of the selected drawing take priority over everything else.
    const ordered = [...this.drawings].reverse()
    const selected = ordered.find((d) => d.id === this.selectedId)
    if (selected && selected.type !== 'brush') {
      const handles = this.handlePixels(selected, width, height)
      const index = handles.findIndex((h) => h && Math.hypot(h.x - x, h.y - y) <= HANDLE_RADIUS + 3)
      if (index >= 0) return { id: selected.id, handle: index }
    }

    for (const d of ordered) {
      if (this.hitBody(d, p, height)) return { id: d.id, handle: -1 }
    }
    return null
  }

  private hitBody(d: Drawing, p: Px, height: number): boolean {
    const px = d.points.map((a) => this.toPixel(a))
    const [a, b] = px

    switch (d.type) {
      case 'trendline':
        return !!a && !!b && distToSegment(p, a, b) <= HIT_TOLERANCE
      case 'ray':
        return !!a && !!b && distToSegment(p, a, b, true, false) <= HIT_TOLERANCE
      case 'extended':
        return !!a && !!b && distToSegment(p, a, b, false, false) <= HIT_TOLERANCE
      case 'hline': {
        const y = this.series?.priceToCoordinate(d.points[0].price)
        return y != null && Math.abs(p.y - y) <= HIT_TOLERANCE
      }
      case 'hray':
        return !!a && p.x >= a.x - HIT_TOLERANCE && Math.abs(p.y - a.y) <= HIT_TOLERANCE
      case 'vline': {
        const x = this.timeToX(d.points[0].time)
        return x !== null && Math.abs(p.x - x) <= HIT_TOLERANCE && p.y <= height
      }
      case 'rect':
      case 'measure':
      case 'fib':
        return !!a && !!b && inBox(p, a, b)
      case 'long':
      case 'short': {
        const c = px[2]
        if (!a || !b || !c) return false
        return inBox(p, a, b) || inBox(p, a, c)
      }
      case 'text': {
        const box = this.textBoxes.get(d.id)
        return !!box && p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h
      }
      case 'brush':
        for (let i = 1; i < px.length; i += 1) {
          const s = px[i - 1]
          const e = px[i]
          if (s && e && distToSegment(p, s, e) <= HIT_TOLERANCE) return true
        }
        return false
    }
  }

  // --- painting ---------------------------------------------------------------
  paint(ctx: CanvasRenderingContext2D, d: Drawing, width: number, height: number): void {
    const px = d.points.map((a) => this.toPixel(a))
    const active = d.id === this.selectedId || d === this.draft
    const hovered = d.id === this.hoveredId
    const lineWidth = active || hovered ? 2 : 1.5

    ctx.save()
    ctx.strokeStyle = d.color
    ctx.fillStyle = d.color
    ctx.lineWidth = lineWidth
    ctx.font = FONT

    const [a, b] = px
    switch (d.type) {
      case 'trendline':
        if (a && b) line(ctx, a, b)
        break
      case 'ray':
        if (a && b) line(ctx, a, extendToEdge(a, b, width, height))
        break
      case 'extended':
        if (a && b) line(ctx, extendToEdge(b, a, width, height), extendToEdge(a, b, width, height))
        break
      case 'hline': {
        const y = this.series?.priceToCoordinate(d.points[0].price)
        if (y != null) line(ctx, { x: 0, y }, { x: width, y })
        break
      }
      case 'hray':
        if (a) line(ctx, a, { x: width, y: a.y })
        break
      case 'vline': {
        const x = this.timeToX(d.points[0].time)
        if (x !== null) line(ctx, { x, y: 0 }, { x, y: height })
        break
      }
      case 'rect':
        if (a && b) {
          ctx.fillStyle = withAlpha(d.color, 0.14)
          ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
          ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
        }
        break
      case 'fib':
        if (a && b) this.paintFib(ctx, d, a, b)
        break
      case 'long':
      case 'short':
        this.paintPosition(ctx, d, px)
        break
      case 'measure':
        if (a && b) this.paintMeasure(ctx, d, a, b)
        break
      case 'text':
        if (a) this.paintText(ctx, d, a, active || hovered)
        break
      case 'brush': {
        ctx.beginPath()
        let started = false
        for (const p of px) {
          if (!p) continue
          if (started) ctx.lineTo(p.x, p.y)
          else ctx.moveTo(p.x, p.y)
          started = true
        }
        ctx.stroke()
        break
      }
    }

    if ((active || hovered) && d.type !== 'brush') {
      for (const h of this.handlePixels(d, width, height)) {
        if (!h) continue
        ctx.beginPath()
        ctx.arc(h.x, h.y, HANDLE_RADIUS, 0, Math.PI * 2)
        ctx.fillStyle = BG
        ctx.fill()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = d.color
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  private paintFib(ctx: CanvasRenderingContext2D, d: Drawing, a: Px, b: Px): void {
    const [start, end] = d.points
    const left = Math.min(a.x, b.x)
    const right = Math.max(a.x, b.x)
    const series = this.series
    if (!series) return

    // Level 0 sits at the end point, 1 at the start - same as TradingView.
    const levels = FIB_LEVELS.map((level) => {
      const price = end.price + (start.price - end.price) * level
      return { level, price, y: series.priceToCoordinate(price) }
    })

    for (let i = 1; i < levels.length; i += 1) {
      const top = levels[i - 1].y
      const bottom = levels[i].y
      if (top === null || bottom === null) continue
      ctx.fillStyle = withAlpha(FIB_BAND_COLORS[(i - 1) % FIB_BAND_COLORS.length], 0.1)
      ctx.fillRect(left, Math.min(top, bottom), right - left, Math.abs(bottom - top))
    }

    ctx.textBaseline = 'middle'
    ctx.textAlign = 'right'
    levels.forEach(({ level, price, y }, i) => {
      if (y === null) return
      const color = FIB_BAND_COLORS[Math.min(i, FIB_BAND_COLORS.length - 1)]
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      line(ctx, { x: left, y }, { x: right, y })
      ctx.fillStyle = color
      ctx.fillText(`${level} (${this.formatPrice(price)})`, left - 6, y)
    })

    ctx.setLineDash([4, 4])
    ctx.strokeStyle = withAlpha(d.color, 0.8)
    line(ctx, a, b)
    ctx.setLineDash([])
  }

  private paintPosition(ctx: CanvasRenderingContext2D, d: Drawing, px: (Px | null)[]): void {
    const [entryPx, targetPx, stopPx] = px
    if (!entryPx || !targetPx || !stopPx) return
    const [entry, target, stop] = d.points
    const left = Math.min(entryPx.x, targetPx.x)
    const w = Math.max(Math.abs(targetPx.x - entryPx.x), 2)

    const zone = (edgeY: number, rgb: string) => {
      const top = Math.min(entryPx.y, edgeY)
      const h = Math.abs(edgeY - entryPx.y)
      ctx.fillStyle = withAlpha(rgb, 0.2)
      ctx.fillRect(left, top, w, h)
    }
    zone(targetPx.y, '#26a69a')
    zone(stopPx.y, '#ef5350')

    ctx.lineWidth = 1
    ctx.strokeStyle = '#9aa4b5'
    line(ctx, { x: left, y: entryPx.y }, { x: left + w, y: entryPx.y })

    const reward = Math.abs(target.price - entry.price)
    const risk = Math.abs(entry.price - stop.price)
    const pct = (p: number) => ((Math.abs(p - entry.price) / entry.price) * 100).toFixed(2)
    const rr = risk === 0 ? '-' : (reward / risk).toFixed(2)

    const cx = left + w / 2
    const tag = (text: string, y: number, color: string) => {
      ctx.font = FONT
      const tw = ctx.measureText(text).width + 12
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(cx - tw / 2, y - 9, tw, 18, 3)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, cx, y)
    }

    const targetAbove = targetPx.y < entryPx.y
    tag(`Target: ${this.formatPrice(target.price)} (${pct(target.price)}%)`, targetPx.y + (targetAbove ? -12 : 12), '#1f8a80')
    tag(`Stop: ${this.formatPrice(stop.price)} (${pct(stop.price)}%)`, stopPx.y + (targetAbove ? 12 : -12), '#c94340')
    tag(`${d.type === 'long' ? 'Long' : 'Short'} ${this.formatPrice(entry.price)}  R:R ${rr}`, entryPx.y + (targetAbove ? 12 : -12), '#39455a')
  }

  private paintMeasure(ctx: CanvasRenderingContext2D, d: Drawing, a: Px, b: Px): void {
    const [start, end] = d.points
    const up = end.price >= start.price
    // Green up, red down, as TradingView's ruler reads - the direction is the
    // first thing you want from a measurement, so it carries the colour rather
    // than the drawing's own palette entry.
    const color = up ? '#26a69a' : '#ef5350'
    const left = Math.min(a.x, b.x)
    const top = Math.min(a.y, b.y)
    const w = Math.abs(b.x - a.x)
    const h = Math.abs(b.y - a.y)

    ctx.fillStyle = withAlpha(color, 0.16)
    ctx.fillRect(left, top, w, h)
    ctx.strokeStyle = withAlpha(color, 0.9)
    ctx.lineWidth = 1
    ctx.strokeRect(left + 0.5, top + 0.5, w, h)

    // Arrows along the middle of each axis.
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    const midX = left + w / 2
    const midY = top + h / 2
    arrow(ctx, { x: midX, y: a.y }, { x: midX, y: b.y })
    arrow(ctx, { x: a.x, y: midY }, { x: b.x, y: midY })

    const change = end.price - start.price
    const pct = start.price === 0 ? 0 : (change / start.price) * 100
    const startLogical = this.timeToLogical(start.time) ?? 0
    const endLogical = this.timeToLogical(end.time) ?? 0
    const bars = endLogical - startLogical
    const lines = [
      `${change >= 0 ? '+' : ''}${this.formatPrice(change)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`,
      `${bars} bars, ${formatDuration(end.time - start.time)}`,
    ]

    ctx.font = FONT
    const boxW = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 16
    const boxH = 38
    const boxY = b.y + (up ? -boxH - 8 : 8)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(midX - boxW / 2, boxY, boxW, boxH, 4)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(lines[0], midX, boxY + 12)
    ctx.fillText(lines[1], midX, boxY + 27)
  }

  private paintText(ctx: CanvasRenderingContext2D, d: Drawing, a: Px, outlined: boolean): void {
    const text = d.text || 'Text'
    ctx.font = TEXT_FONT
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    const w = ctx.measureText(text).width + 12
    const h = 22
    const box = { x: a.x, y: a.y - h / 2, w, h }
    this.textBoxes.set(d.id, box)

    if (outlined) {
      ctx.strokeStyle = withAlpha(d.color, 0.6)
      ctx.lineWidth = 1
      ctx.strokeRect(box.x, box.y, box.w, box.h)
    }
    ctx.fillStyle = d.text ? d.color : withAlpha(d.color, 0.5)
    ctx.fillText(text, a.x + 6, a.y)
  }
}

function inBox(p: Px, a: Px, b: Px): boolean {
  return (
    p.x >= Math.min(a.x, b.x) - HIT_TOLERANCE / 2 &&
    p.x <= Math.max(a.x, b.x) + HIT_TOLERANCE / 2 &&
    p.y >= Math.min(a.y, b.y) - HIT_TOLERANCE / 2 &&
    p.y <= Math.max(a.y, b.y) + HIT_TOLERANCE / 2
  )
}

function line(ctx: CanvasRenderingContext2D, a: Px, b: Px): void {
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
}

function arrow(ctx: CanvasRenderingContext2D, a: Px, b: Px): void {
  if (Math.hypot(b.x - a.x, b.y - a.y) < 12) return
  line(ctx, a, b)
  const angle = Math.atan2(b.y - a.y, b.x - a.x)
  ctx.beginPath()
  ctx.moveTo(b.x, b.y)
  ctx.lineTo(b.x - 7 * Math.cos(angle - 0.45), b.y - 7 * Math.sin(angle - 0.45))
  ctx.moveTo(b.x, b.y)
  ctx.lineTo(b.x - 7 * Math.cos(angle + 0.45), b.y - 7 * Math.sin(angle + 0.45))
  ctx.stroke()
}
