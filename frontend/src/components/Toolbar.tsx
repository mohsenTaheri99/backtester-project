import { since } from '../lib/format'
import type { LiveStatus, SymbolInfo } from '../types'

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
  onSymbolChange: (id: string) => void
  onTimeframeChange: (tf: string) => void
  onToggleVolume: () => void
  onToggleTrades: () => void
  onOpenSettings: () => void
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
  onSymbolChange,
  onTimeframeChange,
  onToggleVolume,
  onToggleTrades,
  onOpenSettings,
}: Props) {
  const active = symbols.find((s) => s.id === symbol)
  const streaming = Boolean(live?.enabled && live.symbol === symbol)
  // A forward test can hold the feed on another symbol; say which, so a quiet
  // chart does not read as a broken feed.
  const elsewhere = Boolean(live?.enabled && live.symbol && live.symbol !== symbol)
  // Live is possible here but switched off: say so, rather than showing nothing.
  const dormant = Boolean(active?.live && !live?.enabled)
  const liveTitle = !live?.enabled
    ? 'Live prices are off - turn them on in Settings'
    : live.lastError
      ? live.lastError
      : `Last poll ${since(live.lastPollAt)}, every ${live.intervalSeconds}s`

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

      {elsewhere && (
        <span className="live-badge other" title={`Live feed is on ${live?.symbol} for the forward test`}>
          <span className="pulse on" />
          live: {live?.symbol}
        </span>
      )}

      {dormant && (
        <button
          type="button"
          className="live-badge off"
          onClick={onOpenSettings}
          title="Live prices are off - click to turn them on"
        >
          <span className="pulse" />
          live off
        </button>
      )}

      {streaming && (
        <span className={live?.lastError ? 'live-badge error' : 'live-badge'} title={liveTitle}>
          <span className={live?.lastError ? 'pulse' : 'pulse on'} />
          {live?.lastError ? 'live error' : 'live'}
        </span>
      )}

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
