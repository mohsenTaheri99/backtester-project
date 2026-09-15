import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts'
import { colors } from './theme'
import type { Trade } from '../types'

/** Seconds per bar, so a 1m trade time can be snapped onto a 1h chart. */
export const TIMEFRAME_SECONDS: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800,
}

const bucket = (time: number, seconds: number) => (Math.floor(time / seconds) * seconds) as UTCTimestamp

/**
 * Entry and exit markers for every trade, snapped to the bar that contains
 * them. Markers must be sorted by time or lightweight-charts drops them.
 */
export function tradeMarkers(
  trades: Trade[],
  timeframe: string,
  selectedId: number | null,
): SeriesMarker<UTCTimestamp>[] {
  const seconds = TIMEFRAME_SECONDS[timeframe] ?? 60
  const markers: SeriesMarker<UTCTimestamp>[] = []

  for (const trade of trades) {
    const long = trade.direction === 'long'
    const highlighted = selectedId === trade.id
    const won = trade.pnl > 0
    const flat = trade.pnl === 0

    markers.push({
      time: bucket(trade.entryTime, seconds),
      position: long ? 'belowBar' : 'aboveBar',
      shape: long ? 'arrowUp' : 'arrowDown',
      color: highlighted ? colors.accent : long ? colors.up : colors.down,
      text: `${long ? 'L' : 'S'}${trade.id}`,
      size: highlighted ? 2 : 1,
    })

    markers.push({
      time: bucket(trade.exitTime, seconds),
      position: long ? 'aboveBar' : 'belowBar',
      shape: 'square',
      color: flat ? colors.textDim : won ? colors.up : colors.down,
      text: trade.rMultiple === null ? '' : `${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple.toFixed(1)}R`,
      size: highlighted ? 2 : 1,
    })
  }

  return markers.sort((a, b) => (a.time as number) - (b.time as number))
}
