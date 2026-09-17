import { useCallback, useEffect, useState } from 'react'
import { downloadRange, fetchRangePlan } from '../api'
import type { RangePlan, SymbolInfo } from '../types'

export interface Range {
  from: number | null // unix seconds; null = from the start of the data
  to: number | null
}

interface Props {
  symbol: SymbolInfo | undefined
  range: Range
  onChange: (range: Range) => void
  onDownloaded: () => void
}

/** Presets, in days back from now. `null` means every candle there is. */
const PRESETS: { label: string; days: number | null }[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All', days: null },
]

const DAY = 86400

/** <input type="datetime-local"> speaks local time; the app speaks UTC. */
const toInput = (unix: number | null) =>
  unix === null ? '' : new Date(unix * 1000).toISOString().slice(0, 16)

const fromInput = (value: string) =>
  value ? Math.floor(Date.parse(`${value}:00Z`) / 1000) : null

const day = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  })

export default function RangeSelector({ symbol, range, onChange, onDownloaded }: Props) {
  const [plan, setPlan] = useState<RangePlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const from = range.from
  const to = range.to

  // Ask the backend what this range would cost. A fully cached range is free,
  // which is the whole point of showing this before the Run button.
  const refreshPlan = useCallback(() => {
    if (!symbol || from === null) {
      setPlan(null)
      return
    }
    fetchRangePlan(symbol.id, from, to ?? Math.floor(Date.now() / 1000))
      .then(setPlan)
      .catch(() => setPlan(null))
  }, [symbol, from, to])

  useEffect(refreshPlan, [refreshPlan])

  const choose = (days: number | null) => {
    setNote(null)
    setError(null)
    if (days === null) {
      onChange({ from: null, to: null })
      return
    }
    const now = Math.floor(Date.now() / 1000)
    onChange({ from: now - days * DAY, to: null })
  }

  const handleDownload = () => {
    if (!symbol || from === null) return
    setBusy(true)
    setError(null)
    setNote(null)
    downloadRange(symbol.id, from, to ?? Math.floor(Date.now() / 1000))
      .then((result) => {
        setNote(
          result.upToDate
            ? 'Already cached — no credits spent.'
            : `Downloaded ${result.added.toLocaleString()} bars for ${result.credits} credit${
                result.credits === 1 ? '' : 's'
              }.`,
        )
        onDownloaded()
        refreshPlan()
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false))
  }

  const activePreset = (days: number | null) => {
    if (days === null) return from === null
    if (from === null) return false
    const now = Math.floor(Date.now() / 1000)
    return Math.abs(now - days * DAY - from) < DAY / 2 && to === null
  }

  return (
    <section className="param-group">
      <h3>Test range</h3>

      <div className="tf-group range-presets" role="group" aria-label="Backtest range">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={activePreset(preset.days) ? 'tf active' : 'tf'}
            onClick={() => choose(preset.days)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <label className="control">
        <span className="control-label">From</span>
        <input
          type="datetime-local"
          value={toInput(from)}
          onChange={(e) => onChange({ from: fromInput(e.target.value), to })}
        />
      </label>
      <label className="control">
        <span className="control-label">
          To <em>UTC</em>
        </span>
        <input
          type="datetime-local"
          value={toInput(to)}
          placeholder="now"
          onChange={(e) => onChange({ from, to: fromInput(e.target.value) })}
        />
      </label>

      {from === null ? (
        <p className="field-help">
          Every candle held for {symbol?.id ?? 'this symbol'}
          {symbol ? ` — ${symbol.bars.toLocaleString()} bars` : ''}.
        </p>
      ) : (
        <>
          <p className="field-help">
            {plan?.cached
              ? `Cached ${day(plan.cached.from)} → ${day(plan.cached.to)}.`
              : 'Nothing cached for this symbol yet.'}{' '}
            {plan && plan.credits === 0 && 'This range is fully cached — running costs no credits.'}
          </p>

          {plan && plan.credits > 0 && (
            <div className="field-actions">
              {plan.canDownload ? (
                <>
                  <button type="button" className="ghost" onClick={handleDownload} disabled={busy}>
                    {busy ? 'Downloading…' : `Download missing (~${plan.credits} credits)`}
                  </button>
                  <span className="dim small">
                    {plan.missing
                      .map((gap) => `${day(gap.from)} → ${day(gap.to)}`)
                      .join(', ')}
                  </span>
                </>
              ) : (
                <span className="warn small">
                  {symbol?.id} has no data provider, so this range cannot be downloaded. The
                  backtest will use whatever candles are cached.
                </span>
              )}
            </div>
          )}
        </>
      )}

      {note && <p className="ok small">{note}</p>}
      {error && <div className="panel-error">{error}</div>}
    </section>
  )
}
