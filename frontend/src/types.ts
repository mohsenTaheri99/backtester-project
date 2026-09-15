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
  source: string
  pricePrecision: number
  bars: number
  from: number | null
  to: number | null
  timeframes: string[]
}

// ---------------------------------------------------------------------------
// backtesting
// ---------------------------------------------------------------------------
export type ParamType = 'bool' | 'int' | 'float'

export interface ParamControl {
  name: string
  label: string
  group: string
  type: ParamType
  default: number | boolean
  unit?: string
  min?: number
  max?: number
  step?: number
}

export interface StrategyInfo {
  id: string
  name: string
  description: string
  timeframes: { bias: string; liquidity: string; trigger: string }
  defaults: Record<string, number | boolean>
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
  params: Record<string, number | boolean>
  range: { from: number; to: number; bars: number }
  summary: BacktestSummary
  trades: Trade[]
  equity: EquityPoint[]
  rejections: Record<string, number>
  elapsedMs: number
  cached: boolean
}
