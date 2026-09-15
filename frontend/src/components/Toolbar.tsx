import type { SymbolInfo } from '../types'

interface Props {
  symbols: SymbolInfo[]
  symbol: string
  timeframe: string
  timeframes: string[]
  showVolume: boolean
  showTrades: boolean
  hasTrades: boolean
  loading: boolean
  onSymbolChange: (id: string) => void
  onTimeframeChange: (tf: string) => void
  onToggleVolume: () => void
  onToggleTrades: () => void
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
  onSymbolChange,
  onTimeframeChange,
  onToggleVolume,
  onToggleTrades,
}: Props) {
  const active = symbols.find((s) => s.id === symbol)

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
    </header>
  )
}
