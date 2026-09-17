import type {
  BacktestResult,
  CandleResponse,
  ForwardState,
  LiveStatus,
  ParamValue,
  ProviderSymbol,
  ProviderUsage,
  RangePlan,
  SettingsSchema,
  StrategyInfo,
  SymbolInfo,
} from './types'

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
    throw new Error(detail ? describe(detail) : `${response.status} ${response.statusText}`)
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

async function send<T>(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail ? describe(detail) : `${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<T>
}

/** FastAPI wraps errors as {"detail": "..."}; show the message, not the envelope. */
function describe(body: string): string {
  try {
    const parsed = JSON.parse(body) as { detail?: string }
    return parsed.detail ?? body
  } catch {
    return body
  }
}

// --- settings ---------------------------------------------------------------
export const fetchSettings = () => get<SettingsSchema>('/settings')

export const saveSettings = (values: Record<string, ParamValue>) =>
  send<SettingsSchema>('/settings', 'PUT', { values })

// --- data provider ----------------------------------------------------------
export const fetchProviderUsage = () => get<ProviderUsage>('/provider/usage')

export const searchProvider = (q: string) => get<ProviderSymbol[]>('/provider/search', { q })

export const importSymbol = (symbol: string, name: string, exchange: string, type: string) =>
  send<SymbolInfo>('/symbols', 'POST', { symbol, name, exchange, type })

export const refreshSymbol = (id: string) =>
  send<SymbolInfo & { added: number }>(`/symbols/${encodeURIComponent(id)}/refresh`, 'POST')

export const fetchRangePlan = (id: string, start: number, end: number) =>
  get<RangePlan>(`/symbols/${encodeURIComponent(id)}/range`, { start, end })

export const downloadRange = (id: string, start: number, end: number) =>
  send<SymbolInfo & { added: number; padded: number; credits: number; upToDate: boolean }>(
    `/symbols/${encodeURIComponent(id)}/range`,
    'POST',
    { start, end },
  )

export const deleteSymbol = (id: string) =>
  send<{ removed: string }>(`/symbols/${encodeURIComponent(id)}`, 'DELETE')

// --- live data --------------------------------------------------------------
export const fetchLiveStatus = (symbol?: string) => get<LiveStatus>('/live', { symbol })

/** The toolbar's LIVE switch. Settings is the single source of truth for it. */
export const setLiveEnabled = (enabled: boolean) =>
  send<SettingsSchema>('/settings', 'PUT', { values: { live_enabled: enabled } })

export const pollLive = (symbol?: string) =>
  send<LiveStatus & { added: number }>(`/live/poll${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ''}`, 'POST')

// --- forward testing --------------------------------------------------------
export const fetchForward = () => get<ForwardState>('/forward')

export const startForward = (strategyId: string, symbol: string, params: Record<string, ParamValue>) =>
  send<ForwardState>('/forward/start', 'POST', { strategyId, symbol, params })

export const stopForward = () => send<ForwardState>('/forward/stop', 'POST')

export async function runBacktest(
  strategyId: string,
  symbol: string,
  params: Record<string, ParamValue>,
  range?: { from: number | null; to: number | null },
): Promise<BacktestResult> {
  const response = await fetch(`${BASE}/backtest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      strategyId,
      symbol,
      params,
      rangeFrom: range?.from ?? null,
      rangeTo: range?.to ?? null,
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail ? describe(detail) : `${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<BacktestResult>
}
