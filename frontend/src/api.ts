import type { BacktestResult, CandleResponse, ParamValue, StrategyInfo, SymbolInfo } from './types'

// Same-origin: the desktop app's backend serves both the UI and /api (Vite proxies it in dev).
const BASE = '/api'

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value))
  }
  const url = `${BASE}${path}${query.size ? `?${query}` : ''}`

  const response = await fetch(url)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`)
  }
  return response.json() as Promise<T>
}

export const fetchSymbols = () => get<SymbolInfo[]>('/symbols')

export const fetchCandles = (
  symbol: string,
  tf: string,
  opts: { limit?: number; before?: number } = {},
) => get<CandleResponse>('/candles', { symbol, tf, limit: opts.limit, before: opts.before })

export const fetchStrategies = () => get<StrategyInfo[]>('/strategies')

export async function runBacktest(
  strategyId: string,
  symbol: string,
  params: Record<string, ParamValue>,
): Promise<BacktestResult> {
  const response = await fetch(`${BASE}/backtest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ strategyId, symbol, params }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`)
  }
  return response.json() as Promise<BacktestResult>
}
