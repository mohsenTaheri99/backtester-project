import Stat from './Stat'
import { colors } from '../lib/theme'
import { clock, num, since } from '../lib/format'
import { useTicker } from '../lib/useTicker'
import type { ForwardState, SymbolInfo, Trade } from '../types'

interface Props {
  state: ForwardState | null
  symbol: string
  symbols: SymbolInfo[]
  starting: boolean
  onStart: () => void
  onStop: () => void
  onOpenSettings: () => void
  onSelectTrade: (trade: Trade) => void
  selectedTradeId: number | null
}

const EXIT_LABELS: Record<string, string> = {
  take_profit: 'TP',
  stop_loss: 'SL',
  break_even: 'BE',
  closed_win: 'end +',
  closed_loss: 'end -',
}

export default function ForwardSection({
  state,
  symbol,
  symbols,
  starting,
  onStart,
  onStop,
  onOpenSettings,
  onSelectTrade,
  selectedTradeId,
}: Props) {
  const running = Boolean(state?.running)
  useTicker(running)

  const active = symbols.find((s) => s.id === symbol)
  const live = state?.live
  const result = state?.result
  const open = result?.openTrade ?? null
  const closed = (result?.trades ?? []).filter((trade) => trade.id !== open?.id)
  const profitable = (result?.summary.pnl ?? 0) > 0

  if (!running) {
    return (
      <div className="panel-body">
        <p className="dim small">
          A forward test paper-trades the strategy on candles that arrive <em>after</em> you start
          it. Earlier bars still build the 1h bias and 15m sweeps, but no trade can open on a bar
          that had already printed — so the result is what the rules would really have done from
          here on.
        </p>

        {active?.live ? (
          <>
            <div className="field-actions">
              <button type="button" className="run" onClick={onStart} disabled={starting}>
                {starting ? 'Starting…' : `Start on ${symbol}`}
              </button>
            </div>
            {!live?.enabled && (
              <p className="warn small">
                Live prices are switched off, so no new candles will arrive. Press{' '}
                <b>Live</b> in the toolbar to start streaming.
              </p>
            )}
          </>
        ) : (
          <p className="warn small">
            <b>{symbol}</b> has no data provider, so it cannot receive live candles.{' '}
            <button type="button" className="link-button inline" onClick={onOpenSettings}>
              Import a symbol from Twelve Data
            </button>{' '}
            and select it on the chart.
          </p>
        )}

        {state?.error && <div className="panel-error">{state.error}</div>}
      </div>
    )
  }

  return (
    <div className="panel-body">
      <div className="forward-head">
        <div>
          <span className={live?.enabled && !live?.lastError ? 'pulse on' : 'pulse'} />
          <b>{state?.session?.symbol}</b>
          <span className="dim small">
            {' '}
            since {state?.session ? clock(state.session.startedAt) : '—'} UTC
          </span>
        </div>
        <button type="button" className="ghost danger" onClick={onStop}>
          Stop
        </button>
      </div>

      <p className="dim small">
        {live?.enabled
          ? `Polling every ${live.intervalSeconds}s · last ${since(live.lastPollAt)} · ${
              live.polls
            } polls`
          : 'Live prices are off — press Live in the toolbar to resume the session.'}
        {result?.lastBarTime ? ` · last bar ${clock(result.lastBarTime)} UTC` : ''}
      </p>

      {live?.lastError && <div className="panel-error">{live.lastError}</div>}
      {state?.error && <div className="panel-error">{state.error}</div>}

      {open ? (
        <div className={open.direction === 'long' ? 'open-trade long' : 'open-trade short'}>
          <div className="open-head">
            <b>{open.direction === 'long' ? 'LONG' : 'SHORT'}</b>
            <span className="dim small">{open.pattern} · opened {clock(open.entryTime)} UTC</span>
          </div>
          <div className="open-grid">
            <span>
              entry <b>{num(open.entryPrice)}</b>
            </span>
            <span>
              stop <b>{num(open.sl)}</b>
            </span>
            <span>
              target <b>{num(open.tp)}</b>
            </span>
            <span>
              now <b>{num(open.exitPrice)}</b>
            </span>
            <span style={{ color: open.pnl >= 0 ? colors.up : colors.down }}>
              open P&L <b>{num(open.pnl, 2, ' $')}</b>
            </span>
            <span>
              R <b>{num(open.rMultiple)}</b>
            </span>
          </div>
        </div>
      ) : (
        <p className="dim small">No position open — waiting for a setup.</p>
      )}

      <div className="stat-grid">
        <Stat label="Net P&L" value={num(result?.summary.pnl, 2, ' $')} tone={profitable ? 'up' : 'down'} />
        <Stat label="Return" value={num(result?.summary.returnPct, 2, '%')} tone={profitable ? 'up' : 'down'} />
        <Stat label="Trades" value={String(result?.summary.trades ?? 0)} />
        <Stat label="Win rate" value={num(result?.summary.winRatePct, 1, '%')} />
        <Stat label="Profit factor" value={num(result?.summary.profitFactor)} />
        <Stat label="Max drawdown" value={num(result?.summary.maxDrawdownPct, 2, '%')} tone="down" />
      </div>

      <h3>Closed trades</h3>
      {closed.length === 0 ? (
        <p className="dim small">Nothing has closed yet.</p>
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
            {[...closed].reverse().map((trade) => (
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
                <td style={{ color: trade.pnl >= 0 ? colors.up : colors.down }}>{num(trade.pnl, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
