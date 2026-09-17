import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BacktestPanel from './components/BacktestPanel'
import Chart from './components/Chart'
import DrawingToolbar from './components/DrawingToolbar'
import Legend from './components/Legend'
import DataModal from './components/DataModal'
import type { Range } from './components/RangeSelector'
import SettingsModal from './components/SettingsModal'
import Toolbar from './components/Toolbar'
import {
  fetchCandles,
  fetchForward,
  fetchLiveStatus,
  fetchStrategies,
  fetchSymbols,
  runBacktest,
  setLiveEnabled,
  startForward,
  stopForward,
} from './api'
import type { ToolId } from './lib/drawings/types'
import { useDrawings } from './lib/drawings/useDrawings'
import { TIMEFRAME_SECONDS, tradeMarkers } from './lib/markers'
import type {
  BacktestResult,
  Candle,
  ForwardState,
  LiveStatus,
  ParamValue,
  StrategyInfo,
  SymbolInfo,
  Trade,
} from './types'

const PAGE_SIZE = 1500
const FALLBACK_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']
const MAX_FETCH = 20000 // server-side cap on bars per request
const MAX_JUMP_REQUESTS = 3

/** TradingView's Alt-key drawing shortcuts, by KeyboardEvent.code. */
const TOOL_SHORTCUTS: Record<string, ToolId> = {
  KeyT: 'trendline',
  KeyH: 'hline',
  KeyJ: 'hray',
  KeyV: 'vline',
  KeyF: 'fib',
  KeyM: 'measure',
}

export default function App() {
  const [symbols, setSymbols] = useState<SymbolInfo[]>([])
  const [symbolsLoaded, setSymbolsLoaded] = useState(false)
  const [symbol, setSymbol] = useState('')  // nothing until a symbol is imported
  const [timeframe, setTimeframe] = useState('5m')
  const [candles, setCandles] = useState<Candle[]>([])
  // Which series the candles in hand belong to. Kept apart from `symbol`/
  // `timeframe`, which change the moment the user clicks: the chart must not be
  // told a series changed while it is still holding the previous one's bars.
  const [candlesKey, setCandlesKey] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showVolume, setShowVolume] = useState(true)
  const [showTrades, setShowTrades] = useState(true)
  const [hovered, setHovered] = useState<Candle | null>(null)

  const [strategy, setStrategy] = useState<StrategyInfo | null>(null)
  const [params, setParams] = useState<Record<string, ParamValue>>({})
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [running, setRunning] = useState(false)
  const [backtestError, setBacktestError] = useState<string | null>(null)
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null)
  const [range, setRange] = useState<Range>({ from: null, to: null })
  const [focusTime, setFocusTime] = useState<number | null>(null)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dataOpen, setDataOpen] = useState(false)
  const [live, setLive] = useState<LiveStatus | null>(null)
  const [forward, setForward] = useState<ForwardState | null>(null)
  const [forwardStarting, setForwardStarting] = useState(false)
  const [liveBusy, setLiveBusy] = useState(false)
  const [liveError, setLiveError] = useState<string | null>(null)
  // Bumped by the live poller so the chart reloads only when candles changed.
  const [liveTick, setLiveTick] = useState(0)
  // Bumped after a download, when history changed and the chart must reload.
  const [dataVersion, setDataVersion] = useState(0)

  const [drawingTool, setDrawingTool] = useState<ToolId>('cursor')
  const [magnet, setMagnet] = useState(false)
  const [drawingsVisible, setDrawingsVisible] = useState(true)
  const { drawings, canUndo, commit: commitDrawings, undo: undoDrawing, clear: clearDrawings } = useDrawings(symbol)

  // Guards the scroll-back loader against overlapping requests.
  const loadingMoreRef = useRef(false)
  // Read inside callbacks that outlive the render that created them.
  const candlesKeyRef = useRef('')
  candlesKeyRef.current = candlesKey

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyZ') {
        e.preventDefault()
        undoDrawing()
        return
      }
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      const tool = e.shiftKey ? (e.code === 'KeyR' ? 'rect' : undefined) : TOOL_SHORTCUTS[e.code]
      if (tool) {
        e.preventDefault()
        setDrawingsVisible(true)
        setDrawingTool(tool)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undoDrawing])

  useEffect(() => {
    fetchSymbols()
      .then((list) => {
        setSymbols(list)
        setSymbolsLoaded(true)
        if (list.length && !list.some((s) => s.id === symbol)) setSymbol(list[0].id)
      })
      .catch((err: Error) => {
        setSymbolsLoaded(true)
        setError(err.message)
      })

    fetchStrategies()
      .then((list) => {
        if (!list.length) return
        setStrategy(list[0])
        setParams(Object.fromEntries(list[0].params.map((p) => [p.name, p.default])))
      })
      .catch((err: Error) => setBacktestError(err.message))
    // Symbol and strategy lists are static for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Ask the backend where live data and the forward test stand. */
  const syncLive = useCallback(
    (chartSymbol: string) =>
      Promise.all([fetchLiveStatus(chartSymbol), fetchForward()])
        .then(([liveStatus, forwardState]) => {
          setLive(liveStatus)
          setForward(forwardState)
          return liveStatus
        })
        .catch(() => null),
    [],
  )

  // One timer drives both the live badge and the forward panel. It follows the
  // backend's own poll interval, and a changed bar count triggers a chart reload.
  useEffect(() => {
    let cancelled = false
    let timer = 0
    let lastBar: number | null = null

    const tick = async () => {
      const status = await syncLive(symbol)
      if (cancelled) return
      if (status && status.symbol === symbol && status.lastBarTime !== lastBar) {
        if (lastBar !== null) setLiveTick((n) => n + 1)
        lastBar = status.lastBarTime
      }
      const seconds = status?.enabled ? Math.max(5, status.intervalSeconds) : 20
      timer = window.setTimeout(tick, seconds * 1000)
    }

    tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [symbol, syncLive])

  // Load the most recent page whenever the series changes.
  useEffect(() => {
    let cancelled = false
    const key = `${symbol}:${timeframe}`
    if (!symbol) {
      setCandles([])
      setCandlesKey('')
      setHasMore(false)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    setHovered(null)

    fetchCandles(symbol, timeframe, { limit: PAGE_SIZE })
      .then((res) => {
        if (cancelled) return
        setCandles(res.candles)
        setCandlesKey(key)
        setHasMore(res.hasMore)
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message)
          setCandles([])
          setCandlesKey(key) // stay consistent: no candles, but for this series
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [symbol, timeframe, dataVersion])

  // Live candles: fold the newest few bars into what is already drawn, rather
  // than refetching the page, so scrolled-back history and the view are kept.
  useEffect(() => {
    if (!liveTick) return
    let cancelled = false

    const key = `${symbol}:${timeframe}`
    fetchCandles(symbol, timeframe, { limit: 3 })
      .then((res) => {
        // A timeframe switch may have landed meanwhile; merging 1m bars into an
        // hourly series would corrupt it.
        if (cancelled || !res.candles.length || key !== candlesKeyRef.current) return
        setCandles((current) => {
          if (!current.length) return res.candles
          const merged = [...current]
          for (const candle of res.candles) {
            const at = merged.findIndex((existing) => existing.time === candle.time)
            // The newest bar is still forming, so an existing one is replaced.
            if (at >= 0) merged[at] = candle
            else if (candle.time > merged[merged.length - 1].time) merged.push(candle)
          }
          return merged
        })
      })
      .catch(() => undefined) // a missed tick is corrected by the next one

    return () => {
      cancelled = true
    }
    // `symbol`/`timeframe` changes are handled by the loader above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTick])

  const loadOlder = useCallback(() => {
    if (!symbol || loadingMoreRef.current || !hasMore || candles.length === 0) return
    loadingMoreRef.current = true

    const oldest = candles[0].time
    fetchCandles(symbol, timeframe, { limit: PAGE_SIZE, before: oldest })
      .then((res) => {
        setHasMore(res.hasMore)
        if (!res.candles.length) return
        setCandles((current) => {
          // Ignore a late response that no longer lines up with what is shown.
          if (!current.length || current[0].time !== oldest) return current
          return [...res.candles, ...current]
        })
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => {
        loadingMoreRef.current = false
      })
  }, [candles, hasMore, symbol, timeframe])

  // --- backtesting ----------------------------------------------------------
  const handleRun = useCallback(() => {
    if (!strategy) return
    setRunning(true)
    setBacktestError(null)

    runBacktest(strategy.id, symbol, params, range)
      .then((res) => {
        setResult(res)
        setSelectedTrade(null)
      })
      .catch((err: Error) => setBacktestError(err.message))
      .finally(() => setRunning(false))
  }, [params, range, strategy, symbol])

  /** The toolbar's LIVE switch. Flip it optimistically so the click feels instant. */
  const handleToggleLive = useCallback(() => {
    const next = !live?.enabled
    setLiveBusy(true)
    setLiveError(null)
    setLive((current) => (current ? { ...current, enabled: next } : current))
    setLiveEnabled(next)
      .then(() => syncLive(symbol))
      .catch((err: Error) => {
        // Not the chart's error state: a refused toggle must not blank the chart.
        setLiveError(err.message)
        return syncLive(symbol) // put the switch back where the backend has it
      })
      .finally(() => setLiveBusy(false))
  }, [live, symbol, syncLive])

  /** A symbol was imported, updated or removed: adopt the new list. */
  const handleSymbolsChanged = useCallback(
    (list: SymbolInfo[], select?: string) => {
      setSymbols(list)
      setSymbol((current) => {
        if (select && list.some((s) => s.id === select)) return select
        if (list.some((s) => s.id === current)) return current
        return list.length ? list[0].id : ''
      })
      setDataVersion((n) => n + 1)
    },
    [],
  )

  const handleStartForward = useCallback(() => {
    if (!strategy) return
    setForwardStarting(true)
    setBacktestError(null)
    startForward(strategy.id, symbol, params)
      .then(setForward)
      .catch((err: Error) => setBacktestError(err.message))
      .finally(() => setForwardStarting(false))
  }, [params, strategy, symbol])

  const handleStopForward = useCallback(() => {
    stopForward()
      .then(setForward)
      .catch((err: Error) => setBacktestError(err.message))
  }, [])

  /** Bring the trade's entry bar into the buffer, then focus it. */
  const handleSelectTrade = useCallback(
    async (trade: Trade) => {
      setSelectedTrade(trade)

      const seconds = TIMEFRAME_SECONDS[timeframe] ?? 60
      let loaded = candles

      // Ask for the whole gap in one request rather than paging 1500 at a time.
      // Market gaps mean this over-estimates, which is the safe direction.
      for (let attempt = 0; attempt < MAX_JUMP_REQUESTS; attempt += 1) {
        if (!loaded.length || loaded[0].time <= trade.entryTime) break
        const missing = Math.ceil((loaded[0].time - trade.entryTime) / seconds) + 200
        const res = await fetchCandles(symbol, timeframe, {
          limit: Math.min(Math.max(missing, PAGE_SIZE), MAX_FETCH),
          before: loaded[0].time,
        }).catch((err: Error) => {
          setError(err.message)
          return null
        })
        if (!res || !res.candles.length) break
        loaded = [...res.candles, ...loaded]
        setCandles(loaded)
        setHasMore(res.hasMore)
      }

      setFocusTime(trade.entryTime)
    },
    [candles, symbol, timeframe],
  )

  const markers = useMemo(
    () =>
      result && showTrades ? tradeMarkers(result.trades, timeframe, selectedTrade?.id ?? null) : [],
    [result, selectedTrade, showTrades, timeframe],
  )

  const active = symbols.find((s) => s.id === symbol)
  const precision = active?.pricePrecision ?? 2
  const timeframes = active?.timeframes ?? FALLBACK_TIMEFRAMES

  return (
    <div className="app">
      <Toolbar
        symbols={symbols}
        symbol={symbol}
        timeframe={timeframe}
        timeframes={timeframes}
        showVolume={showVolume}
        showTrades={showTrades}
        hasTrades={Boolean(result?.trades.length)}
        loading={loading}
        live={live}
        lastCandle={candles[candles.length - 1] ?? null}
        previousClose={candles[candles.length - 2]?.close ?? null}
        liveBusy={liveBusy}
        liveError={liveError}
        onToggleLive={handleToggleLive}
        onSymbolChange={setSymbol}
        onTimeframeChange={setTimeframe}
        onToggleVolume={() => setShowVolume((v) => !v)}
        onToggleTrades={() => setShowTrades((v) => !v)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenData={() => setDataOpen(true)}
      />

      <div className="workspace">
        <main className="chart-panel">
          <DrawingToolbar
            tool={drawingTool}
            magnet={magnet}
            visible={drawingsVisible}
            hasDrawings={drawings.length > 0}
            canUndo={canUndo}
            onToolChange={(tool) => {
              if (tool !== 'cursor') setDrawingsVisible(true)
              setDrawingTool(tool)
            }}
            onToggleMagnet={() => setMagnet((m) => !m)}
            onToggleVisible={() => setDrawingsVisible((v) => !v)}
            onUndo={undoDrawing}
            onClear={clearDrawings}
          />

          <div className="chart-area">
            <Legend
              symbol={symbol}
              timeframe={timeframe}
              candle={hovered ?? candles[candles.length - 1] ?? null}
              precision={precision}
              trade={selectedTrade}
            />

            {error ? (
              <div className="state error">
                <p>Could not load candles.</p>
                <code>{error}</code>
                <p className="dim">The backtesting engine may have stopped — restart the app.</p>
              </div>
            ) : symbolsLoaded && symbols.length === 0 ? (
              <div className="state empty">
                <h2>No symbols yet</h2>
                <p className="dim">
                  Add a Twelve Data API key, then import an instrument to download its
                  1-minute history. Imported symbols can be charted, backtested, streamed
                  live and forward tested.
                </p>
                <button type="button" className="run" onClick={() => setDataOpen(true)}>
                  Add a symbol
                </button>
              </div>
            ) : (
              <Chart
                seriesKey={candlesKey}
                candles={candles}
                pricePrecision={precision}
                showVolume={showVolume}
                markers={markers}
                trades={result?.trades ?? []}
                selectedTrade={selectedTrade}
                showTrades={showTrades}
                timeframe={timeframe}
                focusTime={focusTime}
                onReachLeftEdge={loadOlder}
                onHover={setHovered}
                drawings={drawings}
                drawingTool={drawingTool}
                magnet={magnet}
                drawingsVisible={drawingsVisible}
                onDrawingsChange={commitDrawings}
                onDrawingToolDone={() => setDrawingTool('cursor')}
              />
            )}
          </div>
        </main>

        <BacktestPanel
          strategy={strategy}
          params={params}
          result={result}
          running={running}
          error={backtestError}
          selectedTradeId={selectedTrade?.id ?? null}
          symbol={symbol}
          symbols={symbols}
          range={range}
          onRangeChange={setRange}
          onDataDownloaded={() => {
            fetchSymbols().then(setSymbols).catch(() => undefined)
            setDataVersion((n) => n + 1)
          }}
          forward={forward}
          forwardStarting={forwardStarting}
          onStartForward={handleStartForward}
          onStopForward={handleStopForward}
          onOpenSettings={() => setSettingsOpen(true)}
          onParamChange={(name, value) => setParams((current) => ({ ...current, [name]: value }))}
          onReset={() =>
            setParams(Object.fromEntries((strategy?.params ?? []).map((p) => [p.name, p.default])))
          }
          onRun={handleRun}
          onSelectTrade={handleSelectTrade}
        />
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => syncLive(symbol)}
        onOpenData={() => {
          setSettingsOpen(false)
          setDataOpen(true)
        }}
      />

      <DataModal
        open={dataOpen}
        symbols={symbols}
        activeSymbol={symbol}
        onClose={() => setDataOpen(false)}
        onOpenSettings={() => {
          setDataOpen(false)
          setSettingsOpen(true)
        }}
        onSymbolsChanged={handleSymbolsChanged}
      />

      <footer className="status">
        <span>{candles.length.toLocaleString()} bars loaded</span>
        <span className="dim">{hasMore ? 'scroll left for more history' : 'start of history'}</span>
        {result && (
          <span className="dim">
            {result.trades.length} trades · {result.summary.returnPct?.toFixed(2)}% ·{' '}
            {result.summary.winRatePct?.toFixed(0)}% win
          </span>
        )}
      </footer>
    </div>
  )
}
