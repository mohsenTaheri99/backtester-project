export interface Candle {
  time: number // unix seconds, bar open time (UTC)
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface CandleResponse {
  symbol: string
  timeframe: string
  count: number
  total: number
  hasMore: boolean
  candles: Candle[]
}

export interface SymbolInfo {
  id: string
  name: string
  exchange: string
  mic: string // the listing the candles come from; empty for an unlisted pair
  source: string
  provider: string
  imported: boolean
  market: string // trading calendar: 'fx' drops out-of-hours padding
  live: boolean // has a data provider, so it can stream and be forward tested
  pricePrecision: number
  bars: number
  bytes: number // size of the cached CSV on disk
  days: number // distinct UTC dates holding candles
  from: number | null
  to: number | null
  timeframes: string[]
}

// ---------------------------------------------------------------------------
// backtesting
// ---------------------------------------------------------------------------
export type ParamType = 'bool' | 'int' | 'float' | 'select'

export type ParamValue = number | boolean | string

export interface ParamControl {
  name: string
  label: string
  group: string
  type: ParamType
  default: ParamValue
  unit?: string
  min?: number
  max?: number
  step?: number
  options?: string[] // choices for a 'select' control
}

export interface StrategyInfo {
  id: string
  name: string
  description: string
  timeframes: { bias: string; liquidity: string; trigger: string }
  defaults: Record<string, ParamValue>
  params: ParamControl[]
}

export type ExitReason = 'take_profit' | 'stop_loss' | 'break_even' | 'closed_win' | 'closed_loss'

export interface Trade {
  id: number
  direction: 'long' | 'short'
  entryTime: number
  exitTime: number
  entryPrice: number
  exitPrice: number
  sl: number | null
  initialSl: number | null
  tp: number | null
  size: number
  pnl: number
  returnPct: number
  rMultiple: number | null
  durationMinutes: number
  exitReason: ExitReason
  pattern: string | null
  sweepLevel: number | null
  slPips: number | null
  pipSize: number
}

export interface EquityPoint {
  time: number
  equity: number
  drawdownPct: number
}

export interface BacktestSummary {
  trades: number
  wins: number
  losses: number
  breakEven: number
  winRatePct: number | null
  returnPct: number | null
  buyHoldReturnPct: number | null
  equityFinal: number | null
  equityPeak: number | null
  pnl: number | null
  profitFactor: number | null
  expectancyPct: number | null
  expectancyUsd: number | null
  avgWinUsd: number | null
  avgLossUsd: number | null
  grossWinUsd: number | null
  grossLossUsd: number | null
  maxDrawdownPct: number | null
  maxDrawdownDuration: string | null
  sharpe: number | null
  sortino: number | null
  calmar: number | null
  sqn: number | null
  exposurePct: number | null
  bestTradePct: number | null
  worstTradePct: number | null
  avgTradeDuration: string | null
}

export interface BacktestResult {
  strategy: { id: string; name: string; timeframes: Record<string, string> }
  symbol: string
  params: Record<string, ParamValue>
  range: {
    from: number
    to: number
    bars: number
    tradedFrom: number // first bar allowed to trade; earlier bars are warm-up
    warmupBars: number
  }
  summary: BacktestSummary
  trades: Trade[]
  equity: EquityPoint[]
  rejections: Record<string, number>
  elapsedMs: number
  cached: boolean
}

// ---------------------------------------------------------------------------
// settings, live data and forward testing
// ---------------------------------------------------------------------------
export type SettingType = 'text' | 'password' | 'number' | 'bool' | 'select'

/** One row in the settings modal, described by the backend's SETTINGS list. */
export interface SettingDef {
  key: string
  label: string
  type: SettingType
  help: string
  placeholder: string
  default: ParamValue
  value: ParamValue
  options?: string[]
  min?: number
  max?: number
  step?: number
  isSet?: boolean // password only: whether one is stored
  hint?: string // password only: last 4 characters
}

export interface SettingsGroup {
  name: string
  settings: SettingDef[]
}

export interface SettingsSchema {
  file: string
  groups: SettingsGroup[]
}

/** What a backtest range would cost before any credit is spent on it. */
export interface RangePlan {
  symbol: string
  cached: { from: number; to: number } | null
  canDownload: boolean
  missing: { from: number; to: number; credits: number }[]
  credits: number
}

/** A download running in the background, or the last one that finished. */
export interface DataJob {
  kind: 'import' | 'download' | 'update'
  symbol: string
  label: string
  state: 'running' | 'done' | 'error'
  message: string
  pagesDone: number
  pagesTotal: number
  bars: number
  padded: number
  credits: number
  waitingSeconds: number // >0 while paced by the provider's rate limit
  startedAt: number | null
  finishedAt: number | null
  elapsedSeconds: number
  error: string | null
  result: (SymbolInfo & { added?: number; upToDate?: boolean }) | null
}

export interface ProviderUsage {
  ok: boolean
  plan?: string
  used?: number
  limit?: number
  message?: string
  code?: number
}

export interface ProviderSymbol {
  symbol: string
  name: string
  exchange: string
  mic: string      // Market Identifier Code: which listing of this ticker
  currency: string
  country: string
  type: string
  plan: string     // cheapest provider plan that may download it
  // Whether this account's plan reaches it. null when either plan name is one
  // the backend does not rank, where a guess would be worse than silence.
  available: boolean | null
}

export interface ProviderSearch {
  plan: string     // the account's own plan, for explaining a blocked row
  results: ProviderSymbol[]
}

export interface LiveStatus {
  enabled: boolean
  symbol: string | null
  pinned: string | null // symbol a running forward test holds the feed on
  intervalSeconds: number
  lastPollAt: number | null
  nextPollAt: number | null
  lastError: string | null
  lastAdded: number
  polls: number
  lastBarTime: number | null
  catchingUp: boolean // downloading the span missed while the app was closed
}

export interface ForwardSession {
  strategyId: string
  symbol: string
  params: Record<string, ParamValue>
  startedAt: number
  startedRealAt: number
}

export interface ForwardResult extends BacktestResult {
  openTrade: (Trade & { open: true }) | null
  startedAt: number
  lastBarTime: number | null
}

export interface ForwardState {
  running: boolean
  session: ForwardSession | null
  live: LiveStatus
  result: ForwardResult | null
  error: string | null
}
