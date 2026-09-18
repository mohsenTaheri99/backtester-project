import { useCallback, useEffect, useRef, useState } from 'react'
import { dismissDataJob, fetchDataJob } from '../api'
import type { DataJob } from '../types'

/**
 * Watches the backend's one download slot.
 *
 * Downloads are paced to the provider's rate limit and take a minute or more,
 * so they run on the server and are polled here - quickly while one is in
 * flight, idly otherwise. `onFinished` fires once per completed job, which is
 * the moment anything showing candle counts needs to reload.
 *
 * A finished job stays in that slot until it is dismissed, so most polls answer
 * with something identical to the last one. Storing it again would be a fresh
 * object every few seconds and a re-render of everything below the watcher -
 * enough, from the App-level watcher, to make the chart redraw its trade zones
 * on a timer. So an unchanged payload is dropped here instead.
 */
export function useDataJob(active: boolean, onFinished?: () => void) {
  const [job, setJob] = useState<DataJob | null>(null)
  const seen = useRef<string | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let timer = 0
    let wasRunning = false

    const tick = async () => {
      const next = await fetchDataJob().catch(() => null)
      if (cancelled) return
      if (next) {
        const signature = JSON.stringify(next.job)
        if (signature !== seen.current) {
          seen.current = signature
          setJob(next.job)
        }
        const running = next.job?.state === 'running'
        if (wasRunning && !running) onFinished?.()
        wasRunning = running
      }
      timer = window.setTimeout(tick, wasRunning ? 700 : 3000)
    }

    tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [active, onFinished])

  const dismiss = useCallback(() => {
    seen.current = null // the next poll decides again, whatever the backend says
    setJob(null)
    dismissDataJob().catch(() => undefined)
  }, [])

  return { job, setJob, dismiss }
}
