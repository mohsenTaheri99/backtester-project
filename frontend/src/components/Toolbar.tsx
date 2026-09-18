import { since } from '../lib/format'
import { colors } from '../lib/theme'
import { useTicker } from '../lib/useTicker'
import type { Candle, LiveStatus, SymbolInfo } from '../types'

interface Props {
  symbols: SymbolInfo[]
  symbol: string
  timeframe: string
  timeframes: string[]
  showVolume: boolean
  showTrades: boolean
  hasTrades: boolean
  loading: boolean
  live: LiveStatus | null
  lastCandle: Candle | null
  previousClose: number | null
  liveBusy: boolean
  liveError: string | null
  onToggleLive: () => void
  onSymbolChange: (id: string) => void
  onTimeframeChange: (tf: string) => void
  onToggleVolume: () => void
  onToggleTrades: () => void
  onOpenSettings: () => void
  onOpenData: () => void
}

export default function Toolbar({
  symbols,
  symbol,
  timeframe,
  timeframes,
  showVolume,
  showTrades,
  hasTrades,
  loading,
  live,
  lastCandle,
  previousClose,
  liveBusy,
  liveError,
  onToggleLive,
  onSymbolChange,
  onTimeframeChange,
  onToggleVolume,
  onToggleTrades,
  onOpenSettings,
  onOpenData,
}: Props) {
  const active = symbols.find((s) => s.id === symbol)
  const canGoLive = Boolean(active?.live)
  const enabled = Boolean(live?.enabled)
  const streaming = enabled && live?.symbol === symbol
  // A forward test can hold the feed on another symbol; say which, so a quiet
  // chart does not read as a broken feed.
  const elsewhere = enabled && Boolean(live?.symbol) && live?.symbol !== symbol

  // Only tick the clock while it is showing something that ages.
  useTicker(enabled)

  const liveTitle = liveError
    ? liveError
    : !canGoLive
    ? `${symbol} has no data provider - import a symbol from Twelve Data to stream it`
    : !enabled
      ? 'Start streaming live candles'
      : live?.catchingUp
        ? 'Downloading the candles missed while the app was closed'
        : live?.lastError
          ? live.lastError
          : elsewhere
            ? `Streaming ${live?.symbol} for the forward test, not the chart's symbol`
            : `Streaming every ${live?.intervalSeconds}s - last update ${since(live?.lastPollAt)}`

  const price = lastCandle?.close ?? null
  const change = price !== null && previousClose !== null ? price - previousClose : null
  const liveClass = [
    'toggle',
    'live-toggle',
    enabled ? 'active' : '',
    liveError || (enabled && live?.lastError) ? 'error' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark" />
        <span className="brand-name">Backtester</span>
      </div>

      <select
        className="select"
        value={symbol}
        onChange={(e) => onSymbolChange(e.target.value)}
        disabled={symbols.length <= 1}
      >
        {symbols.length === 0 && <option value="">no symbols</option>}
        {symbols.map((s) => (
          <option key={s.id} value={s.id}>
            {s.id} - {s.name}
          </option>
        ))}
      </select>

      <div className="tf-group" role="group" aria-label="Timeframe">
        {timeframes.map((tf) => (
          <button
            key={tf}
            type="button"
            className={tf === timeframe ? 'tf active' : 'tf'}
            onClick={() => onTimeframeChange(tf)}
          >
            {tf}
          </button>
        ))}
      </div>

      <button type="button" className={showVolume ? 'toggle active' : 'toggle'} onClick={onToggleVolume}>
        Volume
      </button>

      <button
        type="button"
        className={showTrades ? 'toggle active' : 'toggle'}
        onClick={onToggleTrades}
        disabled={!hasTrades}
        title={hasTrades ? 'Show backtest trades on the chart' : 'Run a backtest first'}
      >
        Trades
      </button>

      <div className="spacer" />

      {active && (
        <span className="meta">
          {active.exchange} - {active.bars.toLocaleString()} 1m bars
        </span>
      )}
      {loading && <span className="meta loading">loading...</span>}

      <button
        type="button"
        className={liveClass}
        onClick={onToggleLive}
        disabled={!canGoLive || liveBusy}
        title={liveTitle}
        aria-pressed={enabled}
      >
        <span className={streaming && !live?.lastError ? 'pulse on' : 'pulse'} />
        {liveBusy ? '…' : 'Live'}
      </button>

      {enabled && price !== null && (
        <span className="live-price" title={liveTitle}>
          <b style={change ? { color: change > 0 ? colors.up : colors.down } : undefined}>
            {price.toFixed(active?.pricePrecision ?? 2)}
          </b>
          {change !== null && change !== 0 && (
            <span className="live-arrow" style={{ color: change > 0 ? colors.up : colors.down }}>
              {change > 0 ? '▲' : '▼'}
            </span>
          )}
          <span className="dim">
            {live?.catchingUp ? 'catching up' : live?.lastError ? 'error' : since(live?.lastPollAt)}
          </span>
        </span>
      )}

      {elsewhere && (
        <span className="meta" title={liveTitle}>
          on {live?.symbol}
        </span>
      )}

      <button
        type="button"
        className="icon-button"
        onClick={onOpenData}
        title="Chart data - downloaded history, sizes, updates"
        aria-label="Chart data"
      >
        &#9783;
      </button>

      <button
        type="button"
        className="icon-button"
        onClick={onOpenSettings}
        title="Settings"
        aria-label="Settings"
      >
        &#9881;
      </button>
    </header>
  )
}
