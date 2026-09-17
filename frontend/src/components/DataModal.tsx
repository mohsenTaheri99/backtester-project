import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteSymbol,
  downloadRange,
  fetchSymbols,
  importSymbol,
  refreshSymbol,
  searchProvider,
} from '../api'
import { useDataJob } from '../lib/useDataJob'
import { useTicker } from '../lib/useTicker'
import type { DataJob, ProviderSymbol, SymbolInfo } from '../types'

interface Props {
  open: boolean
  symbols: SymbolInfo[]
  activeSymbol: string
  onClose: () => void
  onSymbolsChanged: (symbols: SymbolInfo[], select?: string) => void
  onOpenSettings: () => void
}

const DAY = 86400
/** How much history the Add button offers, in days. */
const IMPORT_PRESETS = [7, 30, 90, 180]

const bytes = (n: number) => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const date = (unix: number | null) =>
  unix === null
    ? '—'
    : new Date(unix * 1000).toLocaleDateString('en-GB', {
        timeZone: 'UTC',
        day: '2-digit',
        month: 'short',
        year: '2-digit',
      })

const stale = (to: number | null) => {
  if (to === null) return ''
  const hours = (Date.now() / 1000 - to) / 3600
  if (hours < 2) return ''
  if (hours < 48) return `${Math.round(hours)}h behind`
  return `${Math.round(hours / 24)}d behind`
}

/** The running download, as a bar with a number on it rather than a spinner. */
function JobBanner({ job, onDismiss }: { job: DataJob; onDismiss: () => void }) {
  useTicker(job.state === 'running')
  const pct =
    job.pagesTotal > 0 ? Math.min(100, Math.round((job.pagesDone / job.pagesTotal) * 100)) : 0

  if (job.state === 'running') {
    return (
      <div className="job running">
        <div className="job-head">
          <b>{job.label}</b>
          <span className="dim small">
            {job.pagesTotal ? `request ${job.pagesDone} of ~${job.pagesTotal}` : 'starting…'} ·{' '}
            {job.elapsedSeconds}s
          </span>
        </div>
        <div className="job-bar">
          <span style={{ width: `${Math.max(pct, 3)}%` }} />
        </div>
        <p className="dim small">
          {job.message || 'Contacting the provider…'}
          {job.credits > 0 && ` · ${job.credits} credit${job.credits === 1 ? '' : 's'} spent`}
        </p>
        {job.waitingSeconds > 0 ? (
          <p className="warn small">
            Paused — your plan's rate limit is reached. Resuming in {job.waitingSeconds}s.
          </p>
        ) : (
          <p className="dim small">Paced to your plan's rate limit, so requests are spread out.</p>
        )}
      </div>
    )
  }

  return (
    <div className={job.state === 'error' ? 'job error' : 'job done'}>
      <div className="job-head">
        <b>{job.state === 'error' ? 'Download failed' : job.label}</b>
        <button type="button" className="icon-button" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      </div>
      <p className="small">
        {job.error ?? job.message}
        {job.state === 'done' && job.credits > 0 && (
          <span className="dim">
            {' '}
            · {job.credits} credit{job.credits === 1 ? '' : 's'} · {job.elapsedSeconds}s
          </span>
        )}
      </p>
    </div>
  )
}

export default function DataModal({
  open,
  symbols,
  activeSymbol,
  onClose,
  onSymbolsChanged,
  onOpenSettings,
}: Props) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<ProviderSymbol[] | null>(null)
  const [days, setDays] = useState(30)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set when an import starts, read when it finishes: the chart follows it.
  const jobSelection = useRef<string | undefined>(undefined)
  const [confirming, setConfirming] = useState<string | null>(null)

  const reload = useCallback(
    (select?: string) => fetchSymbols().then((list) => onSymbolsChanged(list, select)),
    [onSymbolsChanged],
  )

  // A finished download changes candle counts and sizes, so the table reloads.
  // A finished *import* is also what the chart should switch to.
  const onFinished = useCallback(() => {
    void reload(jobSelection.current)
    jobSelection.current = undefined
  }, [reload])

  const { job, setJob, dismiss } = useDataJob(open, onFinished)
  const busy = job?.state === 'running'

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const handleSearch = () => {
    if (!query.trim()) return
    setSearching(true)
    setError(null)
    setMatches(null)
    searchProvider(query.trim())
      .then(setMatches)
      .catch((err: Error) => setError(err.message))
      .finally(() => setSearching(false))
  }

  const run = (work: Promise<DataJob>, select?: string) => {
    setError(null)
    jobSelection.current = select
    work
      .then((started) => {
        setJob(started)
        // An "already cached" answer never runs, so nothing would poll it.
        if (started.state !== 'running') onFinished()
      })
      .catch((err: Error) => {
        jobSelection.current = undefined
        setError(err.message)
      })
  }

  const handleRemove = (id: string) => {
    setError(null)
    deleteSymbol(id)
      .then(() => reload())
      .catch((err: Error) => setError(err.message))
      .finally(() => setConfirming(null))
  }

  const totalBars = symbols.reduce((sum, s) => sum + s.bars, 0)
  const totalBytes = symbols.reduce((sum, s) => sum + s.bytes, 0)

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="Chart data"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>Chart data</h2>
          <span className="dim small">
            {symbols.length} symbol{symbols.length === 1 ? '' : 's'} ·{' '}
            {totalBars.toLocaleString()} candles · {bytes(totalBytes)} on disk
          </span>
          <div className="spacer" />
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="modal-pane">
          {error && <div className="panel-error">{error}</div>}
          {job && <JobBanner job={job} onDismiss={dismiss} />}

          <h4>Add a symbol</h4>
          <div className="row">
            <input
              type="text"
              value={query}
              placeholder="XAU/USD, EUR/USD, AAPL…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSearch()
                }
              }}
            />
            <div className="tf-group" role="group" aria-label="History to download">
              {IMPORT_PRESETS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={d === days ? 'tf active' : 'tf'}
                  onClick={() => setDays(d)}
                  title={`Download ${d} days of 1-minute candles`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <button type="button" className="ghost" onClick={handleSearch} disabled={searching}>
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
          <p className="field-help">
            One request covers about 3.5 days, so {days} days costs roughly{' '}
            {Math.max(1, Math.ceil((days * DAY) / (5000 * 60)))} credits.
          </p>

          {matches && (
            <table className="mini-table">
              <tbody>
                {matches.length === 0 && (
                  <tr>
                    <td className="dim">Nothing matched “{query}”.</td>
                  </tr>
                )}
                {matches.map((match) => (
                  <tr key={`${match.symbol}-${match.exchange}`}>
                    <td>
                      <b>{match.symbol}</b>
                      <span className="dim block">{match.name}</span>
                    </td>
                    <td className="dim">{match.exchange || match.type}</td>
                    <td className="right">
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={() =>
                          run(
                            importSymbol(match.symbol, match.name, match.exchange, match.type, days),
                            match.symbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
                          )
                        }
                      >
                        Add {days}d
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h4>Downloaded</h4>
          {symbols.length === 0 ? (
            <p className="field-help">
              Nothing downloaded yet. Search above to add an instrument — you'll need a Twelve Data
              API key in{' '}
              <button type="button" className="link-button inline" onClick={onOpenSettings}>
                Settings
              </button>
              .
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="right">Candles</th>
                  <th className="right">Days</th>
                  <th>Coverage (UTC)</th>
                  <th className="right">Size</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {symbols.map((symbol) => {
                  const behind = stale(symbol.to)
                  return (
                    <tr key={symbol.id} className={symbol.id === activeSymbol ? 'selected' : undefined}>
                      <td>
                        <b>{symbol.id}</b>
                        {symbol.id === activeSymbol && <span className="pill muted">on chart</span>}
                        {symbol.market === 'fx' && (
                          <span className="pill muted" title="Closed-market padding is removed">
                            fx hours
                          </span>
                        )}
                        <span className="dim block">{symbol.name}</span>
                      </td>
                      <td className="right num">{symbol.bars.toLocaleString()}</td>
                      <td className="right num">{symbol.days}</td>
                      <td className="dim">
                        {date(symbol.from)} → {date(symbol.to)}
                        {behind && <span className="warn block">{behind}</span>}
                      </td>
                      <td className="right num">{bytes(symbol.bytes)}</td>
                      <td className="right">
                        {confirming === symbol.id ? (
                          <>
                            <span className="dim small">Delete {symbol.bars.toLocaleString()} candles?</span>
                            <button
                              type="button"
                              className="ghost danger"
                              onClick={() => handleRemove(symbol.id)}
                            >
                              Delete
                            </button>
                            <button type="button" className="ghost" onClick={() => setConfirming(null)}>
                              Keep
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="ghost"
                              disabled={busy || !symbol.live}
                              title={
                                symbol.live
                                  ? 'Download everything since the last candle'
                                  : 'No data provider for this symbol'
                              }
                              onClick={() => run(refreshSymbol(symbol.id))}
                            >
                              Update
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              disabled={busy || !symbol.live}
                              title="Extend history further back"
                              onClick={() => {
                                const now = Math.floor(Date.now() / 1000)
                                run(downloadRange(symbol.id, now - 180 * DAY, now))
                              }}
                            >
                              +180d
                            </button>
                            <button
                              type="button"
                              className="ghost danger"
                              disabled={busy}
                              onClick={() => setConfirming(symbol.id)}
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          <p className="field-help">
            Candles are cached on this PC and re-used, so a range you already hold costs no credits.
            For FX and metals the candles the provider invents while the market is shut are detected
            and dropped, which is why a 90-day download keeps about 65 days of them.
          </p>
        </div>
      </div>
    </div>
  )
}
