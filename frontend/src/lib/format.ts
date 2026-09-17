/** Number and time formatting shared by the result panels. */

export const num = (value: number | null | undefined, digits = 2, suffix = '') =>
  value === null || value === undefined ? '—' : `${value.toFixed(digits)}${suffix}`

/** Bar and trade times are always shown in UTC, like the chart's axis. */
export const clock = (unix: number) =>
  new Date(unix * 1000).toLocaleString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

/** "4m ago", "just now" - for live status lines that tick on their own. */
export const since = (unix: number | null | undefined, now = Date.now() / 1000): string => {
  if (!unix) return 'never'
  const seconds = Math.max(0, Math.round(now - unix))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  return `${Math.round(seconds / 3600)}h ago`
}
