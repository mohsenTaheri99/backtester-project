import { useCallback, useRef, useState } from 'react'
import type { Drawing } from './types'

const MAX_HISTORY = 100
const storageKey = (symbol: string) => `backtester:drawings:${symbol}`

function load(symbol: string): Drawing[] {
  try {
    const raw = localStorage.getItem(storageKey(symbol))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as Drawing[]) : []
  } catch {
    return []
  }
}

function save(symbol: string, drawings: Drawing[]): void {
  try {
    localStorage.setItem(storageKey(symbol), JSON.stringify(drawings))
  } catch {
    // Storage full or blocked: drawings still work for this session.
  }
}

/** Drawings for one symbol, persisted in localStorage, with undo. Shared across timeframes. */
export function useDrawings(symbol: string) {
  const [state, setState] = useState(() => ({ symbol, drawings: load(symbol) }))
  const historyRef = useRef<Drawing[][]>([])

  // Switching symbol swaps in that symbol's drawings during render.
  let current = state
  if (state.symbol !== symbol) {
    current = { symbol, drawings: load(symbol) }
    historyRef.current = []
    setState(current)
  }

  // Latest state for the callbacks, which stay stable across renders.
  const currentRef = useRef(current)
  currentRef.current = current

  const replace = useCallback((drawings: Drawing[]) => {
    const next = { symbol: currentRef.current.symbol, drawings }
    currentRef.current = next
    save(next.symbol, drawings)
    setState(next)
  }, [])

  const commit = useCallback(
    (next: Drawing[]) => {
      historyRef.current = [...historyRef.current.slice(-MAX_HISTORY + 1), currentRef.current.drawings]
      replace(next)
    },
    [replace],
  )

  const undo = useCallback(() => {
    const previous = historyRef.current.pop()
    if (previous) replace(previous)
  }, [replace])

  const clear = useCallback(() => commit([]), [commit])

  // Every history change goes through setState, so this is current on each render.
  return { drawings: current.drawings, canUndo: historyRef.current.length > 0, commit, undo, clear }
}
