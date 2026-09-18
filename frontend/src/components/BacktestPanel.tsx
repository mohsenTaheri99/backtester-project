import { useMemo, useState } from 'react'
import EquityChart from './EquityChart'
import ForwardSection from './ForwardSection'
import RangeSelector, { type Range } from './RangeSelector'
import Stat from './Stat'
import { clock, num } from '../lib/format'
import { colors } from '../lib/theme'
import type {
  BacktestResult,
  ForwardState,
  ParamControl,
  ParamValue,
  StrategyInfo,
  SymbolInfo,
  Trade,
} from '../types'

interface Props {
  strategy: StrategyInfo | null
  params: Record<string, ParamValue>
  result: BacktestResult | null
  running: boolean
  error: string | null
  selectedTradeId: number | null
  symbol: string
  symbols: SymbolInfo[]
  range: Range
  onRangeChange: (range: Range) => void
  onDataDownloaded: () => void
  forward: ForwardState | null
  forwardStarting: boolean
  onParamChange: (name: string, value: ParamValue) => void
  onReset: () => void
  onRun: () => void
  onSelectTrade: (trade: Trade) => void
  onStartForward: () => void
  onStopForward: () => void
  onOpenSettings: () => void
}

const REJECTION_LABELS: Record<string, string> = {
  position_open: 'a trade was already open',
  no_bias: 'no 1h bias yet',
  no_active_sweep: 'no live 15m sweep',
  outside_session: 'outside London / New York',
  not_in_discount: 'not in discount',
  not_in_premium: 'not in premium',
  no_trigger: 'no pin or engulfing trigger',
  no_range: '1h range not formed yet',
  stop_too_tight: 'stop below minimum',
  size_below_one_unit: 'size rounded to zero',
  no_sweep_extreme: 'sweep extreme missing',
}

/** The pin timeframe is a parameter, so that row of the funnel is built per run. */
const rejectionLabel = (reason: string, pinTimeframe: string) =>
  reason === 'no_trigger' && pinTimeframe
    ? `no ${pinTimeframe} pin or 1m engulfing`
    : REJECTION_LABELS[reason] ?? reason

interface FunnelStage {
  reason: string
  rejected: number
  reached: number
  /** Share of the bars that got this far and were stopped here, 0-1. */
  share: number
}

/**
 * The gates in the order the strategy applies them, each with how many bars
 * actually reached it.
 *
 * Sorting by raw count instead is what the panel used to do, and it always
 * named the first gate in the chain: it sees every bar, so it rejects the most
 * of them however cheap it is. What costs setups is the gate that throws away
 * the largest *share* of what reaches it, which needs the running total.
 */
function funnelStages(result: BacktestResult): FunnelStage[] {
  const order = result.rejectionOrder?.length
    ? result.rejectionOrder
    : Object.keys(result.rejections)
  let reached = result.barsEvaluated || 0
  const stages: FunnelStage[] = []
  for (const reason of order) {
    const rejected = result.rejections[reason] ?? 0
    if (rejected > 0 || reached > 0) {
      stages.push({ reason, rejected, reached, share: reached > 0 ? rejected / reached : 0 })
    }
    reached -= rejected
  }
  return stages.filter((stage) => stage.rejected > 0)
}

/** The gate that threw away the largest share of what reached it. */
const tightestStage = (stages: FunnelStage[]): FunnelStage | null =>
  stages.reduce<FunnelStage | null>(
    (worst, stage) => (worst === null || stage.share > worst.share ? stage : worst),
    null,
  )

/** Trading days a run covered, weekends already dropped from the data. */
const testedDays = (result: BacktestResult) =>
  Math.max(1, Math.round((result.range.bars - result.range.warmupBars) / 1440))

/**
 * Why a run found nothing. Zero trades reads as a broken strategy, when it is
 * almost always a sample too short for a 1h break of structure, a 15m sweep and
 * a session window to coincide.
 */
function NoTrades({ result, pinTimeframe }: { result: BacktestResult; pinTimeframe: string }) {
  const days = testedDays(result)
  const worst = tightestStage(funnelStages(result))

  return (
    <div className="no-trades">
      <b>No setups matched.</b>
      {worst && (
        <p className="dim small">
          The tightest filter was <b>{rejectionLabel(worst.reason, pinTimeframe)}</b> — it
          stopped {worst.rejected.toLocaleString()} of the{' '}
          {worst.reached.toLocaleString()} bars that reached it (
          {Math.round(worst.share * 100)}%).
        </p>
      )}
      {days < 30 ? (
        <p className="warn small">
          Only {days} trading day{days === 1 ? '' : 's'} were tested. This strategy needs a 1h
          break of structure, a 15m liquidity sweep and a London or New York session window to
          line up, which rarely happens in a sample this short — 90 days or more is a fairer
          test. Download more history in <b>Chart data</b>.
        </p>
      ) : (
        <p className="dim small">
          {days} trading days were tested, so the sample is not the problem. Loosening a filter —
          the sweep window, the session filter or premium / discount — is the next thing to try.
        </p>
      )}
    </div>
  )
}

const EXIT_LABELS: Record<string, string> = {
  take_profit: 'TP',
  stop_loss: 'SL',
  break_even: 'BE',
  closed_win: 'end +',
  closed_loss: 'end -',
}

function Control({
  control,
  value,
  onChange,
}: {
  control: ParamControl
  value: ParamValue
  onChange: (value: ParamValue) => void
}) {
  const hint = control.description ? (
    <span className="control-hint">{control.description}</span>
  ) : null

  if (control.type === 'select') {
    return (
      <div className="control-row">
        <label className="control">
          <span className="control-label">{control.label}</span>
          <select className="select" value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {(control.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        {hint}
      </div>
    )
  }
  if (control.type === 'bool') {
    return (
      <div className="control-row">
        <label className="control checkbox">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          <span>{control.label}</span>
        </label>
        {hint}
      </div>
    )
  }
  return (
    <div className="control-row">
      <label className="control">
        <span className="control-label">
          {control.label}
          {control.unit ? <em> {control.unit}</em> : null}
        </span>
        <input
          type="number"
          value={String(value)}
          min={control.min}
          max={control.max}
          step={control.step ?? (control.type === 'int' ? 1 : 0.1)}
          onChange={(e) => {
            const parsed = control.type === 'int' ? parseInt(e.target.value, 10) : parseFloat(e.target.value)
            if (!Number.isNaN(parsed)) onChange(parsed)
          }}
        />
      </label>
      {hint}
    </div>
  )
}

export default function BacktestPanel({
  strategy,
  params,
  result,
  running,
  error,
  selectedTradeId,
  symbol,
  symbols,
  range,
  onRangeChange,
  onDataDownloaded,
  forward,
  forwardStarting,
  onParamChange,
  onReset,
  onRun,
  onSelectTrade,
  onStartForward,
  onStopForward,
  onOpenSettings,
}: Props) {
  const [tab, setTab] = useState<'setup' | 'results' | 'trades' | 'forward'>('setup')

  const groups = useMemo(() => {
    const byGroup = new Map<string, ParamControl[]>()
    for (const control of strategy?.params ?? []) {
      const list = byGroup.get(control.group) ?? []
      list.push(control)
      byGroup.set(control.group, list)
    }
    return [...byGroup.entries()]
  }, [strategy])

  const summary = result?.summary
  const profitable = (summary?.returnPct ?? 0) > 0
  // What the panel currently describes: the picked pin timeframe, not the default.
  const pinTimeframe = String(params.pin_timeframe ?? strategy?.timeframes.trigger ?? '1m')
  const resultPinTimeframe = String(result?.strategy.timeframes.pin ?? '')

  return (
    <aside className="panel">
      <div className="panel-head">
        <div>
          <h2>{strategy?.name ?? 'Backtest'}</h2>
          {strategy && (
            <p className="dim small">
              {strategy.timeframes.bias} bias · {strategy.timeframes.liquidity} sweep ·{' '}
              {pinTimeframe} pin · {strategy.timeframes.trigger} execution
            </p>
          )}
        </div>
        <button
          type="button"
          className="run"
          onClick={onRun}
          disabled={running || !strategy || !symbol}
          title={symbol ? undefined : 'Import a symbol first'}
        >
          {running ? 'Running…' : 'Run backtest'}
        </button>
      </div>

      <nav className="tabs">
        {(['setup', 'results', 'trades', 'forward'] as const).map((name) => (
          <button
            key={name}
            type="button"
            className={tab === name ? 'tab active' : 'tab'}
            onClick={() => setTab(name)}
          >
            {name}
            {name === 'trades' && result ? ` (${result.trades.length})` : ''}
            {name === 'forward' && forward?.running ? <span className="pulse on" /> : ''}
          </button>
        ))}
      </nav>

      {error && <div className="panel-error">{error}</div>}

      {tab === 'setup' && (
        <div className="panel-body">
          {strategy && <p className="dim small strategy-note">{strategy.description}</p>}

          <RangeSelector
            symbol={symbols.find((s) => s.id === symbol)}
            range={range}
            onChange={onRangeChange}
            onDownloaded={onDataDownloaded}
          />

          {groups.map(([group, controls]) => (
            <section key={group} className="param-group">
              <h3>{group}</h3>
              {controls.map((control) => (
                <Control
                  key={control.name}
                  control={control}
                  value={params[control.name] ?? control.default}
                  onChange={(value) => onParamChange(control.name, value)}
                />
              ))}
            </section>
          ))}
          <button type="button" className="link-button" onClick={onReset}>
            reset to defaults
          </button>
        </div>
      )}

      {tab === 'results' && (
        <div className="panel-body">
          {!summary ? (
            <p className="dim small">Run the backtest to see results.</p>
          ) : (
            <>
              {summary.trades === 0 && (
                <NoTrades result={result} pinTimeframe={resultPinTimeframe} />
              )}

              <div className="stat-grid">
                <Stat
                  label="Return"
                  value={num(summary.returnPct, 2, '%')}
                  tone={profitable ? 'up' : 'down'}
                />
                <Stat label="Net P&L" value={num(summary.pnl, 2, ' $')} tone={profitable ? 'up' : 'down'} />
                <Stat label="Trades" value={String(summary.trades)} />
                <Stat label="Win rate" value={num(summary.winRatePct, 1, '%')} />
                <Stat label="Profit factor" value={num(summary.profitFactor)} />
                <Stat label="Expectancy" value={num(summary.expectancyUsd, 2, ' $')} />
                <Stat label="Max drawdown" value={num(summary.maxDrawdownPct, 2, '%')} tone="down" />
                <Stat label="Sharpe" value={num(summary.sharpe)} />
                <Stat label="Exposure" value={num(summary.exposurePct, 1, '%')} />
              </div>

              <div className="wl-bar" title="wins / break-even / losses">
                <span className="wl win" style={{ flex: Math.max(summary.wins, 0.01) }}>
                  {summary.wins}W
                </span>
                <span className="wl flat" style={{ flex: Math.max(summary.breakEven, 0.01) }}>
                  {summary.breakEven}BE
                </span>
                <span className="wl loss" style={{ flex: Math.max(summary.losses, 0.01) }}>
                  {summary.losses}L
                </span>
              </div>

              <h3>Equity</h3>
              <EquityChart equity={result.equity} startingCash={Number(result.params.cash ?? 10000)} />

              <h3>Where setups were rejected</h3>
              <ul className="funnel">
                {funnelStages(result).map((stage) => (
                  <li key={stage.reason}>
                    <span>{rejectionLabel(stage.reason, resultPinTimeframe)}</span>
                    <span
                      className="funnel-share"
                      title={`${stage.rejected.toLocaleString()} of the ${stage.reached.toLocaleString()} bars that got this far`}
                    >
                      {Math.round(stage.share * 100)}%
                    </span>
                    <b>{stage.rejected.toLocaleString()}</b>
                  </li>
                ))}
              </ul>
              <p className="dim small">
                Counted per 1m bar, in filter order — a bar rejected early is not counted again later.
              </p>
              <p className="dim small">
                Tested {clock(result.range.tradedFrom)} → {clock(result.range.to)} UTC ·{' '}
                {(result.range.bars - result.range.warmupBars).toLocaleString()} bars
                {result.range.warmupBars > 0
                  ? ` (+${result.range.warmupBars.toLocaleString()} warm-up)`
                  : ''}{' '}
                · {result.elapsedMs} ms{result.cached ? ' · cached' : ''}
              </p>
            </>
          )}
        </div>
      )}

      {tab === 'forward' && (
        <ForwardSection
          state={forward}
          symbol={symbol}
          symbols={symbols}
          starting={forwardStarting}
          onStart={onStartForward}
          onStop={onStopForward}
          onOpenSettings={onOpenSettings}
          onSelectTrade={onSelectTrade}
          selectedTradeId={selectedTradeId}
        />
      )}

      {tab === 'trades' && (
        <div className="panel-body">
          {!result ? (
            <p className="dim small">Run the backtest to see trades.</p>
          ) : result.trades.length === 0 ? (
            <p className="dim small">
              No setups matched these rules on this data — the <b>results</b> tab says which
              filter rejected the most bars.
            </p>
          ) : (
            <table className="trades">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Entry (UTC)</th>
                  <th>Side</th>
                  <th>Exit</th>
                  <th>R</th>
                  <th>P&L</th>
                </tr>
              </thead>
              <tbody>
                {result.trades.map((trade) => (
                  <tr
                    key={trade.id}
                    className={selectedTradeId === trade.id ? 'selected' : undefined}
                    onClick={() => onSelectTrade(trade)}
                  >
                    <td>{trade.id}</td>
                    <td>{clock(trade.entryTime)}</td>
                    <td className={trade.direction === 'long' ? 'long' : 'short'}>
                      {trade.direction === 'long' ? 'LONG' : 'SHORT'}
                    </td>
                    <td>{EXIT_LABELS[trade.exitReason] ?? trade.exitReason}</td>
                    <td>{num(trade.rMultiple, 2)}</td>
                    <td style={{ color: trade.pnl >= 0 ? colors.up : colors.down }}>
                      {num(trade.pnl, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </aside>
  )
}
