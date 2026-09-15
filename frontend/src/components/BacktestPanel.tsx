import { useMemo, useState } from 'react'
import EquityChart from './EquityChart'
import { colors } from '../lib/theme'
import type { BacktestResult, ParamControl, StrategyInfo, Trade } from '../types'

interface Props {
  strategy: StrategyInfo | null
  params: Record<string, number | boolean>
  result: BacktestResult | null
  running: boolean
  error: string | null
  selectedTradeId: number | null
  onParamChange: (name: string, value: number | boolean) => void
  onReset: () => void
  onRun: () => void
  onSelectTrade: (trade: Trade) => void
}

const REJECTION_LABELS: Record<string, string> = {
  no_active_sweep: 'no live 15m sweep',
  outside_session: 'outside London / New York',
  not_in_discount: 'not in discount',
  not_in_premium: 'not in premium',
  no_trigger: 'no 1m pin or engulfing',
  no_range: '1h range not formed yet',
  stop_too_tight: 'stop below minimum',
  size_below_one_unit: 'size rounded to zero',
  no_sweep_extreme: 'sweep extreme missing',
}

const EXIT_LABELS: Record<string, string> = {
  take_profit: 'TP',
  stop_loss: 'SL',
  break_even: 'BE',
  closed_win: 'end +',
  closed_loss: 'end -',
}

const num = (value: number | null | undefined, digits = 2, suffix = '') =>
  value === null || value === undefined ? '—' : `${value.toFixed(digits)}${suffix}`

const clock = (unix: number) =>
  new Date(unix * 1000).toLocaleString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={tone ? { color: tone === 'up' ? colors.up : colors.down } : undefined}>
        {value}
      </span>
    </div>
  )
}

function Control({
  control,
  value,
  onChange,
}: {
  control: ParamControl
  value: number | boolean
  onChange: (value: number | boolean) => void
}) {
  if (control.type === 'bool') {
    return (
      <label className="control checkbox">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        <span>{control.label}</span>
      </label>
    )
  }
  return (
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
  )
}

export default function BacktestPanel({
  strategy,
  params,
  result,
  running,
  error,
  selectedTradeId,
  onParamChange,
  onReset,
  onRun,
  onSelectTrade,
}: Props) {
  const [tab, setTab] = useState<'setup' | 'results' | 'trades'>('setup')

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

  return (
    <aside className="panel">
      <div className="panel-head">
        <div>
          <h2>{strategy?.name ?? 'Backtest'}</h2>
          {strategy && (
            <p className="dim small">
              {strategy.timeframes.bias} bias · {strategy.timeframes.liquidity} sweep ·{' '}
              {strategy.timeframes.trigger} trigger
            </p>
          )}
        </div>
        <button type="button" className="run" onClick={onRun} disabled={running || !strategy}>
          {running ? 'Running…' : 'Run backtest'}
        </button>
      </div>

      <nav className="tabs">
        {(['setup', 'results', 'trades'] as const).map((name) => (
          <button
            key={name}
            type="button"
            className={tab === name ? 'tab active' : 'tab'}
            onClick={() => setTab(name)}
          >
            {name}
            {name === 'trades' && result ? ` (${result.trades.length})` : ''}
          </button>
        ))}
      </nav>

      {error && <div className="panel-error">{error}</div>}

      {tab === 'setup' && (
        <div className="panel-body">
          {strategy && <p className="dim small strategy-note">{strategy.description}</p>}
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
                {Object.entries(result.rejections)
                  .sort((a, b) => b[1] - a[1])
                  .map(([reason, count]) => (
                    <li key={reason}>
                      <span>{REJECTION_LABELS[reason] ?? reason}</span>
                      <b>{count.toLocaleString()}</b>
                    </li>
                  ))}
              </ul>
              <p className="dim small">
                Counted per 1m bar, in filter order — a bar rejected early is not counted again later.
              </p>
              <p className="dim small">
                {result.range.bars.toLocaleString()} bars · {result.elapsedMs} ms
                {result.cached ? ' · cached' : ''}
              </p>
            </>
          )}
        </div>
      )}

      {tab === 'trades' && (
        <div className="panel-body">
          {!result ? (
            <p className="dim small">Run the backtest to see trades.</p>
          ) : result.trades.length === 0 ? (
            <p className="dim small">No setups matched these rules on this data.</p>
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
