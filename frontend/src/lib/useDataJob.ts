import { useCallback, useEffect, useState } from 'react'
import { dismissDataJob, fetchDataJob } from '../api'
import type { DataJob } from '../types'

/**
 * Watches the backend's one download slot.
 *
 * Downloads are paced to the provider's rate limit and take a minute or more,
 * so they run on the server and are polled here - quickly while one is in
 * flight, idly otherwise. `onFinished` fires once per completed job, which is
 * the moment anything showing candle counts needs to reload.
 */
export function useDataJob(active: boolean, onFinished?: () => void) {
  const [job, setJob] = useState<DataJob | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let timer = 0
    let wasRunning = false

    const tick = async () => {
      const next = await fetchDataJob().catch(() => null)
      if (cancelled) return
      if (next) {
        setJob(next.job)
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
    setJob(null)
    dismissDataJob().catch(() => undefined)
  }, [])

  return { job, setJob, dismiss }
}
