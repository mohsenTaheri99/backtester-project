/**
 * Draws backtest trades the way TradingView's strategy tester does: a green
 * reward box from entry to target, a red risk box from entry to stop, both
 * spanning the life of the trade, with the entry-to-exit path on top.
 *
 * Implemented as a lightweight-charts series primitive, so it paints straight
 * onto the chart canvas and pans/zooms with the price scale.
 */
import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'
import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import { TIMEFRAME_SECONDS } from './markers'
import type { Trade } from '../types'

const UP = '38, 166, 154'
const DOWN = '239, 83, 80'
const GOLD = '224, 182, 74'

/** One trade resolved to canvas coordinates; null fields mean "off the chart". */
interface Box {
  trade: Trade
  selected: boolean
  x1: number
  x2: number
  entryY: number
  stopY: number | null
  targetY: number | null
  exitY: number
}

class TradeZonesRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly boxes: () => Box[],
    private readonly layer: 'fills' | 'overlay',
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context
      for (const box of this.boxes()) {
        if (this.layer === 'fills') this.drawZones(ctx, box)
        else this.drawPath(ctx, box)
      }
    })
  }

  private drawZones(ctx: CanvasRenderingContext2D, box: Box): void {
    // Unselected trades get a single outcome box (entry -> exit, tinted by
    // result). The selected trade gets the full position tool instead: reward
    // zone up to the target, risk zone down to the stop.
    if (box.selected) this.drawPositionTool(ctx, box)
    else this.drawOutcomeBox(ctx, box)
  }

  private drawOutcomeBox(ctx: CanvasRenderingContext2D, box: Box): void {
    const { trade } = box
    if (trade.pnl === 0) return // break-even: the path alone is enough

    const rgb = trade.pnl > 0 ? UP : DOWN
    const top = Math.min(box.entryY, box.exitY)
    const height = Math.max(Math.abs(box.exitY - box.entryY), 1)
    const width = Math.max(box.x2 - box.x1, 1)

    ctx.fillStyle = `rgba(${rgb}, 0.1)`
    ctx.fillRect(box.x1, top, width, height)
  }

  private drawPositionTool(ctx: CanvasRenderingContext2D, box: Box): void {
    const width = Math.max(box.x2 - box.x1, 1)

    const zone = (edgeY: number | null, rgb: string) => {
      if (edgeY === null) return
      const top = Math.min(box.entryY, edgeY)
      const height = Math.abs(edgeY - box.entryY)
      ctx.fillStyle = `rgba(${rgb}, 0.18)`
      ctx.fillRect(box.x1, top, width, height)
      ctx.strokeStyle = `rgba(${rgb}, 0.7)`
      ctx.lineWidth = 1
      ctx.strokeRect(box.x1, top, width, height)
    }

    zone(box.targetY, UP)
    zone(box.stopY, DOWN)
  }

  private drawPath(ctx: CanvasRenderingContext2D, box: Box): void {
    const { trade, selected } = box
    const won = trade.pnl > 0
    const flat = trade.pnl === 0
    const rgb = flat ? '150, 160, 175' : won ? UP : DOWN

    // entry -> exit path
    ctx.save()
    ctx.beginPath()
    ctx.setLineDash(selected ? [] : [4, 3])
    ctx.strokeStyle = selected ? `rgb(${GOLD})` : `rgba(${rgb}, 0.85)`
    ctx.lineWidth = selected ? 2 : 1.25
    ctx.moveTo(box.x1, box.entryY)
    ctx.lineTo(box.x2, box.exitY)
    ctx.stroke()
    ctx.setLineDash([])

    // entry and exit dots
    for (const [x, y] of [
      [box.x1, box.entryY],
      [box.x2, box.exitY],
    ] as const) {
      ctx.beginPath()
      ctx.arc(x, y, selected ? 4 : 3, 0, Math.PI * 2)
      ctx.fillStyle = selected ? `rgb(${GOLD})` : `rgba(${rgb}, 0.95)`
      ctx.fill()
      ctx.strokeStyle = '#0e1117'
      ctx.lineWidth = 1
      ctx.stroke()
    }

    if (selected) this.drawLabel(ctx, box, rgb)
    ctx.restore()
  }

  /** Small result badge above the exit dot, for the selected trade only. */
  private drawLabel(ctx: CanvasRenderingContext2D, box: Box, rgb: string): void {
    const { trade } = box
    const r = trade.rMultiple === null ? '' : `${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}R`
    const text = `#${trade.id} ${trade.direction.toUpperCase()}  ${r}  ${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}`

    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif'
    const padding = 6
    const width = ctx.measureText(text).width + padding * 2
    const height = 19
    const x = Math.min(box.x2 + 8, ctx.canvas.width - width - 4)
    const y = box.exitY - height - 8

    ctx.fillStyle = 'rgba(14, 17, 23, 0.92)'
    ctx.strokeStyle = `rgba(${rgb}, 0.9)`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(x, y, width, height, 4)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#e6ecf5'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x + padding, y + height / 2)
  }
}

class TradeZonesPaneView implements IPrimitivePaneView {
  private readonly paneRenderer: TradeZonesRenderer

  constructor(boxes: () => Box[], private readonly layer: 'fills' | 'overlay') {
    this.paneRenderer = new TradeZonesRenderer(boxes, layer)
  }

  zOrder(): PrimitivePaneViewZOrder {
    // Zones sit behind the candles, the trade path in front of them.
    return this.layer === 'fills' ? 'bottom' : 'top'
  }

  renderer(): IPrimitivePaneRenderer {
    return this.paneRenderer
  }
}

export class TradeZones implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null
  private series: ISeriesApi<'Candlestick'> | null = null
  private requestUpdate: (() => void) | null = null

  private trades: Trade[] = []
  private selectedId: number | null = null
  private timeframe = '1m'
  private visible = true

  private readonly views: IPrimitivePaneView[] = [
    new TradeZonesPaneView(() => this.computeBoxes(), 'fills'),
    new TradeZonesPaneView(() => this.computeBoxes(), 'overlay'),
  ]

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

  setTrades(trades: Trade[], selectedId: number | null, timeframe: string, visible: boolean): void {
    this.trades = trades
    this.selectedId = selectedId
    this.timeframe = timeframe
    this.visible = visible
    this.requestUpdate?.()
  }

  /**
   * Resolve trades to pixels. Times are snapped to the bar that contains them
   * so they line up on any timeframe; a trade outside the loaded range simply
   * has no coordinate and is skipped.
   */
  private computeBoxes(): Box[] {
    const chart = this.chart
    const series = this.series
    if (!chart || !series || !this.visible || !this.trades.length) return []

    const timeScale = chart.timeScale()
    const seconds = TIMEFRAME_SECONDS[this.timeframe] ?? 60
    const bucket = (time: number) => (Math.floor(time / seconds) * seconds) as UTCTimestamp
    const barWidth = timeScale.options().barSpacing

    const boxes: Box[] = []
    for (const trade of this.trades) {
      const x1 = timeScale.timeToCoordinate(bucket(trade.entryTime))
      const x2 = timeScale.timeToCoordinate(bucket(trade.exitTime))
      const entryY = series.priceToCoordinate(trade.entryPrice)
      const exitY = series.priceToCoordinate(trade.exitPrice)
      if (x1 === null || x2 === null || entryY === null || exitY === null) continue

      boxes.push({
        trade,
        selected: this.selectedId === trade.id,
        // Entry and exit on the same bar still needs a visible box.
        x1,
        x2: Math.max(x2, x1 + Math.max(barWidth, 2)),
        entryY,
        stopY: trade.initialSl === null ? null : series.priceToCoordinate(trade.initialSl),
        targetY: trade.tp === null ? null : series.priceToCoordinate(trade.tp),
        exitY,
      })
    }

    // Draw the selected trade last so it lands on top of its neighbours.
    return boxes.sort((a, b) => Number(a.selected) - Number(b.selected))
  }
}
