import { useState } from 'react'
import { deleteSymbol, fetchSymbols, importSymbol, refreshSymbol, searchProvider } from '../api'
import type { ProviderSymbol, SymbolInfo } from '../types'

interface Props {
  symbols: SymbolInfo[]
  /** `select` names a symbol the chart should switch to, e.g. a fresh import. */
  onSymbolsChanged: (symbols: SymbolInfo[], select?: string) => void
}

const when = (unix: number | null) =>
  unix === null
    ? '—'
    : new Date(unix * 1000).toLocaleString('en-GB', {
        timeZone: 'UTC',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })

export default function MarketDataSection({ symbols, onSymbolsChanged }: Props) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<ProviderSymbol[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const reload = (select?: string) => fetchSymbols().then((list) => onSymbolsChanged(list, select))

  const run = (
    label: string,
    work: () => Promise<unknown>,
    done?: (result: never) => string,
    select?: (result: never) => string,
  ) => {
    setBusy(label)
    setError(null)
    setNote(null)
    work()
      .then(async (result) => {
        await reload(select ? select(result as never) : undefined)
        if (done) setNote(done(result as never))
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(null))
  }

  const handleSearch = () => {
    if (!query.trim()) return
    setBusy('search')
    setError(null)
    setMatches(null)
    searchProvider(query.trim())
      .then(setMatches)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(null))
  }

  const handleImport = (match: ProviderSymbol) =>
    run(
      `import:${match.symbol}`,
      () => importSymbol(match.symbol, match.name, match.exchange),
      (added: SymbolInfo) =>
        `Imported ${added.id} — ${added.bars.toLocaleString()} 1m bars. The chart is now showing it.`,
      (added: SymbolInfo) => added.id, // jump the chart to what was just imported
    )

  return (
    <div className="market-data">
      <p className="field-help">
        Import a symbol to download its 1-minute history from Twelve Data. Imported symbols can
        stream live prices and be forward tested; the bundled sample cannot.
      </p>

      <div className="field">
        <label htmlFor="symbol-search">Find a symbol</label>
        <div className="row">
          <input
            id="symbol-search"
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
          <button type="button" className="ghost" onClick={handleSearch} disabled={busy === 'search'}>
            {busy === 'search' ? 'Searching…' : 'Search'}
          </button>
        </div>
      </div>

      {error && <div className="panel-error">{error}</div>}
      {note && <p className="ok small">{note}</p>}

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
                  <span className="dim"> {match.name}</span>
                </td>
                <td className="dim">{match.exchange || match.type}</td>
                <td className="right">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => handleImport(match)}
                    disabled={busy !== null}
                  >
                    {busy === `import:${match.symbol}` ? 'Downloading…' : 'Import'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4>Loaded symbols</h4>
      <table className="mini-table">
        <tbody>
          {symbols.map((symbol) => (
            <tr key={symbol.id}>
              <td>
                <b>{symbol.id}</b>
                {symbol.live && <span className="pill">live</span>}
                <span className="dim block">
                  {symbol.bars.toLocaleString()} bars · to {when(symbol.to)} UTC
                </span>
              </td>
              <td className="right">
                {symbol.imported ? (
                  <>
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy !== null}
                      onClick={() =>
                        run(
                          `refresh:${symbol.id}`,
                          () => refreshSymbol(symbol.id),
                          (result: SymbolInfo & { added: number }) =>
                            `${symbol.id}: ${result.added.toLocaleString()} new bars.`,
                        )
                      }
                    >
                      {busy === `refresh:${symbol.id}` ? 'Updating…' : 'Update'}
                    </button>
                    <button
                      type="button"
                      className="ghost danger"
                      disabled={busy !== null}
                      onClick={() => run(`delete:${symbol.id}`, () => deleteSymbol(symbol.id))}
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <span className="dim small">bundled</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
