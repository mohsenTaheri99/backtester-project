import { useEffect, useRef, useState } from 'react'
import {
  CandlestickSeries,
  HistogramSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type LogicalRange,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { DrawingController } from '../lib/drawings/DrawingController'
import { DrawingLayer } from '../lib/drawings/DrawingLayer'
import { DRAWING_COLORS, TOOLS, type Drawing, type ToolId } from '../lib/drawings/types'
import { TIMEFRAME_SECONDS } from '../lib/markers'
import { chartOptions, colors } from '../lib/theme'
import { TradeZones } from '../lib/tradeZones'
import type { Candle, Trade } from '../types'

interface Props {
  /** Changes whenever the loaded series changes (symbol + timeframe). */
  seriesKey: string
  candles: Candle[]
  pricePrecision: number
  showVolume: boolean
  markers?: SeriesMarker<UTCTimestamp>[]
  /** Backtest trades drawn as risk/reward zones on the chart. */
  trades?: Trade[]
  selectedTrade?: Trade | null
  showTrades?: boolean
  timeframe: string
  /** Bar time to scroll into view, e.g. the trade selected in the results table. */
  focusTime?: number | null
  /** Called when the user scrolls near the left edge and older bars are needed. */
  onReachLeftEdge: () => void
  onHover: (candle: Candle | null) => void
  /** User drawings for this symbol. */
  drawings: Drawing[]
  drawingTool: ToolId
  magnet: boolean
  drawingsVisible: boolean
  onDrawingsChange: (drawings: Drawing[]) => void
  /** The armed tool placed its drawing or was cancelled. */
  onDrawingToolDone: () => void
}

const INITIAL_BARS = 320 // bars shown when a series first loads

const toCandlestick = (c: Candle): CandlestickData<UTCTimestamp> => ({
  time: c.time as UTCTimestamp,
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close,
})

const toVolume = (c: Candle): HistogramData<UTCTimestamp> => ({
  time: c.time as UTCTimestamp,
  value: c.volume,
  color: c.close >= c.open ? `${colors.up}66` : `${colors.down}66`,
})

export default function Chart({
  seriesKey,
  candles,
  pricePrecision,
  showVolume,
  markers,
  trades,
  selectedTrade,
  showTrades = true,
  timeframe,
  focusTime,
  onReachLeftEdge,
  onHover,
  drawings,
  drawingTool,
  magnet,
  drawingsVisible,
  onDrawingsChange,
  onDrawingToolDone,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const zonesRef = useRef<TradeZones | null>(null)
  const priceLinesRef = useRef<IPriceLine[]>([])

  // Kept in refs so the chart is built once and never torn down on prop changes.
  const candlesRef = useRef<Candle[]>(candles)
  const onReachLeftEdgeRef = useRef(onReachLeftEdge)
  const onHoverRef = useRef(onHover)
  const prevFirstTimeRef = useRef<number | null>(null)
  const prevLengthRef = useRef(0)
  const prevSeriesKeyRef = useRef<string | null>(null)

  const layerRef = useRef<DrawingLayer | null>(null)
  const controllerRef = useRef<DrawingController | null>(null)
  const drawingsRef = useRef(drawings)
  const onDrawingsChangeRef = useRef(onDrawingsChange)
  const onDrawingToolDoneRef = useRef(onDrawingToolDone)
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)

  candlesRef.current = candles
  onReachLeftEdgeRef.current = onReachLeftEdge
  onHoverRef.current = onHover
  drawingsRef.current = drawings
  onDrawingsChangeRef.current = onDrawingsChange
  onDrawingToolDoneRef.current = onDrawingToolDone

  // --- build the chart once -------------------------------------------------
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, {
      ...chartOptions,
      width: container.clientWidth,
      height: container.clientHeight,
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: colors.up,
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
    })

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    })
    // Pin volume to the bottom quarter as an overlay pane.
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } })

    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    volumeSeriesRef.current = volumeSeries
    markersRef.current = createSeriesMarkers(candleSeries, [])

    const zones = new TradeZones()
    candleSeries.attachPrimitive(zones)
    zonesRef.current = zones

    const layer = new DrawingLayer()
    candleSeries.attachPrimitive(layer)
    layerRef.current = layer
    controllerRef.current = new DrawingController(layer, container, {
      onCommit: (next) => onDrawingsChangeRef.current(next),
      onSelect: setSelectedDrawingId,
      onToolDone: () => onDrawingToolDoneRef.current(),
      onEditText: setEditingTextId,
    })

    const handleRange = (range: LogicalRange | null) => {
      if (!range) return
      // Fewer than ~20 bars left to the start of the buffer: ask for more.
      if (range.from < 20) onReachLeftEdgeRef.current()
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleRange)

    chart.subscribeCrosshairMove((param) => {
      if (param.time === undefined) {
        onHoverRef.current(null)
        return
      }
      const time = param.time as number
      const hit = candlesRef.current.find((c) => c.time === time) ?? null
      onHoverRef.current(hit)
    })

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      chart.applyOptions({ width: Math.floor(width), height: Math.floor(height) })
    })
    observer.observe(container)

    return () => {
      controllerRef.current?.destroy()
      controllerRef.current = null
      layerRef.current = null
      observer.disconnect()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRange)
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      markersRef.current = null
      zonesRef.current = null
      priceLinesRef.current = []
    }
  }, [])

  // --- price formatting follows the instrument ------------------------------
  useEffect(() => {
    candleSeriesRef.current?.applyOptions({
      priceFormat: { type: 'price', precision: pricePrecision, minMove: 1 / 10 ** pricePrecision },
    })
  }, [pricePrecision])

  useEffect(() => {
    volumeSeriesRef.current?.applyOptions({ visible: showVolume })
  }, [showVolume])

  // --- push data ------------------------------------------------------------
  useEffect(() => {
    const chart = chartRef.current
    const candleSeries = candleSeriesRef.current
    const volumeSeries = volumeSeriesRef.current
    if (!chart || !candleSeries || !volumeSeries) return

    // Three different things can land here, and each wants the viewport treated
    // differently. `seriesKey` names the series these candles belong to, not the
    // one being loaded, so a switch is only seen once its data has arrived.
    const seriesChanged = prevSeriesKeyRef.current !== seriesKey
    const firstTime = candles.length ? candles[0].time : null
    const prepended =
      !seriesChanged &&
      prevFirstTimeRef.current !== null &&
      firstTime !== null &&
      firstTime < prevFirstTimeRef.current
    const added = candles.length - prevLengthRef.current

    const visibleBefore = prepended ? chart.timeScale().getVisibleLogicalRange() : null

    candleSeries.setData(candles.map(toCandlestick))
    volumeSeries.setData(candles.map(toVolume))

    if (seriesChanged) {
      // Open on the most recent slice rather than fitting everything, so the
      // first paint does not sit at the left edge and trigger a page load.
      const visible = Math.min(candles.length, INITIAL_BARS)
      chart.timeScale().setVisibleLogicalRange({
        from: candles.length - visible,
        to: candles.length + 4,
      })
    } else if (prepended && visibleBefore) {
      // Older bars shift every logical index right by `added`; keep the viewport still.
      chart.timeScale().setVisibleLogicalRange({
        from: visibleBefore.from + added,
        to: visibleBefore.to + added,
      })
    }
    // Otherwise a bar was appended or the forming one was revised: leave the
    // viewport exactly where the user put it, rather than snapping to the end.

    prevFirstTimeRef.current = firstTime
    prevLengthRef.current = candles.length
    prevSeriesKeyRef.current = seriesKey
  }, [candles, seriesKey])

  // --- trade markers --------------------------------------------------------
  useEffect(() => {
    markersRef.current?.setMarkers(markers ?? [])
  }, [markers])

  // --- trade risk / reward zones --------------------------------------------
  useEffect(() => {
    zonesRef.current?.setTrades(trades ?? [], selectedTrade?.id ?? null, timeframe, showTrades)
  }, [trades, selectedTrade, timeframe, showTrades])

  // --- entry / stop / target lines for the selected trade -------------------
  useEffect(() => {
    const series = candleSeriesRef.current
    if (!series) return

    for (const line of priceLinesRef.current) series.removePriceLine(line)
    priceLinesRef.current = []

    if (!selectedTrade || !showTrades) return

    const lines: { price: number | null; color: string; title: string }[] = [
      { price: selectedTrade.entryPrice, color: colors.accent, title: `entry #${selectedTrade.id}` },
      { price: selectedTrade.initialSl, color: colors.down, title: 'stop' },
      { price: selectedTrade.tp, color: colors.up, title: 'target' },
    ]

    priceLinesRef.current = lines
      .filter((line): line is { price: number; color: string; title: string } => line.price !== null)
      .map(({ price, color, title }) =>
        series.createPriceLine({
          price,
          color,
          title,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
        }),
      )
  }, [selectedTrade, showTrades])

  // --- scroll a trade into view ---------------------------------------------
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || focusTime == null || !candles.length) return

    const index = candles.findIndex((c) => c.time >= focusTime)
    if (index < 0) return

    const span = 90 // bars of context around the trade
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, index - span / 2),
      to: Math.min(candles.length + 5, index + span / 2),
    })
  }, [focusTime, candles])

  // --- drawings -------------------------------------------------------------
  useEffect(() => {
    layerRef.current?.setCandles(candles, TIMEFRAME_SECONDS[timeframe] ?? 60)
  }, [candles, timeframe])

  useEffect(() => {
    controllerRef.current?.setDrawings(drawings)
  }, [drawings])

  useEffect(() => {
    controllerRef.current?.setTool(drawingTool)
  }, [drawingTool])

  useEffect(() => {
    if (controllerRef.current) controllerRef.current.magnet = magnet
  }, [magnet])

  useEffect(() => {
    controllerRef.current?.setVisible(drawingsVisible)
  }, [drawingsVisible])

  const updateDrawing = (id: string, patch: Partial<Drawing>) =>
    onDrawingsChange(drawings.map((d) => (d.id === id ? { ...d, ...patch } : d)))

  const removeDrawing = (id: string) => onDrawingsChange(drawings.filter((d) => d.id !== id))

  const selectedDrawing = drawings.find((d) => d.id === selectedDrawingId) ?? null
  const editingText = drawings.find((d) => d.id === editingTextId) ?? null
  const editingPx = editingText ? layerRef.current?.toPixel(editingText.points[0]) : null

  const finishTextEdit = (value: string) => {
    if (!editingText) return
    setEditingTextId(null)
    const text = value.trim()
    if (!text) removeDrawing(editingText.id)
    else if (text !== editingText.text) updateDrawing(editingText.id, { text })
  }

  return (
    <>
      <div className="chart" ref={containerRef} />

      {selectedDrawing && drawingsVisible && (
        <div className="draw-options" role="toolbar" aria-label="Drawing options">
          <span className="draw-options-name">{TOOLS[selectedDrawing.type].label}</span>
          {selectedDrawing.type !== 'long' && selectedDrawing.type !== 'short' && selectedDrawing.type !== 'measure' && (
            <div className="swatches">
              {DRAWING_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={color === selectedDrawing.color ? 'swatch active' : 'swatch'}
                  style={{ background: color }}
                  title={color}
                  aria-label={`Color ${color}`}
                  onClick={() => updateDrawing(selectedDrawing.id, { color })}
                />
              ))}
            </div>
          )}
          {selectedDrawing.type === 'text' && (
            <button type="button" className="draw-options-btn" onClick={() => setEditingTextId(selectedDrawing.id)}>
              Edit text
            </button>
          )}
          <button
            type="button"
            className="draw-options-btn danger"
            title="Delete (Del)"
            onClick={() => removeDrawing(selectedDrawing.id)}
          >
            Delete
          </button>
        </div>
      )}

      {editingText && editingPx && (
        <input
          key={editingText.id}
          className="draw-text-input"
          style={{ left: editingPx.x, top: editingPx.y - 13, color: editingText.color }}
          defaultValue={editingText.text ?? ''}
          placeholder="Text"
          autoFocus
          onBlur={(e) => finishTextEdit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              // Cancel: restore the old text (a new, empty drawing is dropped on blur).
              e.currentTarget.value = editingText.text ?? ''
              e.currentTarget.blur()
            }
          }}
        />
      )}
    </>
  )
}
