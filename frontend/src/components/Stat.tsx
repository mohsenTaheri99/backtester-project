import { colors } from '../lib/theme'

export default function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'up' | 'down'
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={tone ? { color: tone === 'up' ? colors.up : colors.down } : undefined}>
        {value}
      </span>
    </div>
  )
}
