import { colors } from '../lib/theme'
import type { Candle, Trade } from '../types'

interface Props {
  symbol: string
  timeframe: string
  candle: Candle | null
  precision: number
  /** Selected backtest trade, shown as a second line. */
  trade?: Trade | null
}

const formatTime = (unix: number) =>
  `${new Date(unix * 1000).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false })} UTC`

export default function Legend({ symbol, timeframe, candle, precision, trade }: Props) {
  const tradeLine = trade ? (
    <div className="legend trade-legend">
      <span className={trade.direction === 'long' ? 'long' : 'short'}>
        #{trade.id} {trade.direction.toUpperCase()}
      </span>
      <span className="dim">entry</span>
      <b>{trade.entryPrice.toFixed(precision)}</b>
      <span className="dim">stop</span>
      <b>{trade.initialSl?.toFixed(precision) ?? '—'}</b>
      <span className="dim">target</span>
      <b>{trade.tp?.toFixed(precision) ?? '—'}</b>
      <span style={{ color: trade.pnl >= 0 ? colors.up : colors.down }}>
        {trade.rMultiple === null ? '' : `${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}R`}{' '}
        ({trade.pnl >= 0 ? '+' : ''}
        {trade.pnl.toFixed(2)})
      </span>
      <span className="dim">{trade.pattern}</span>
    </div>
  ) : null

  if (!candle) {
    return (
      <>
        <div className="legend">
          <strong>{symbol}</strong>
          <span className="tf-badge">{timeframe}</span>
          <span className="dim">hover the chart for OHLC</span>
        </div>
        {tradeLine}
      </>
    )
  }

  const up = candle.close >= candle.open
  const change = candle.close - candle.open
  const changePct = candle.open ? (change / candle.open) * 100 : 0
  const px = (v: number) => v.toFixed(precision)

  return (
    <>
      <div className="legend">
      <strong>{symbol}</strong>
      <span className="tf-badge">{timeframe}</span>
      <span className="dim">{formatTime(candle.time)}</span>
      <span>
        O <b>{px(candle.open)}</b>
      </span>
      <span>
        H <b>{px(candle.high)}</b>
      </span>
      <span>
        L <b>{px(candle.low)}</b>
      </span>
      <span>
        C <b>{px(candle.close)}</b>
      </span>
      <span style={{ color: up ? colors.up : colors.down }}>
        {change >= 0 ? '+' : ''}
        {px(change)} ({changePct.toFixed(2)}%)
      </span>
      <span className="dim">Vol {candle.volume.toLocaleString()}</span>
      </div>
      {tradeLine}
    </>
  )
}
