import { useEffect, useState } from 'react'

/**
 * Re-renders on an interval while `active`, so relative times like "12s ago"
 * stay true between the polls that actually fetch data.
 */
export function useTicker(active: boolean, everyMs = 1000): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setTick((n) => n + 1), everyMs)
    return () => window.clearInterval(id)
  }, [active, everyMs])
}
