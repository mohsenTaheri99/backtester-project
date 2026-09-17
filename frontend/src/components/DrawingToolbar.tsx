import { useEffect, useRef, useState, type ReactNode } from 'react'
import { TOOLS, type ToolId } from '../lib/drawings/types'

interface Props {
  tool: ToolId
  magnet: boolean
  visible: boolean
  hasDrawings: boolean
  canUndo: boolean
  onToolChange: (tool: ToolId) => void
  onToggleMagnet: () => void
  onToggleVisible: () => void
  onUndo: () => void
  onClear: () => void
}

const svg = (children: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
)

/**
 * A drawing's draggable end, as a small hollow ring. TradingView marks anchors
 * this way, and hollow reads as "grab me" where a filled dot reads as ink.
 *
 * Genuinely unfilled rather than filled with the panel colour: the button has
 * its own background when hovered and when active, and a fill would show as a
 * mismatched disc in both.
 */
const ring = (cx: number, cy: number) => <circle cx={cx} cy={cy} r="2.1" strokeWidth="1.4" />

export const TOOL_ICONS: Record<ToolId, ReactNode> = {
  cursor: svg(
    <path
      d="M5.5 2.8v15.6l4-3.8 2.6 6 2.7-1.2-2.6-5.8 5.4-.9z"
      fill="currentColor"
      fillOpacity="0.18"
    />,
  ),
  trendline: svg(
    <>
      <path d="M7.4 16.6L16.6 7.4" />
      {ring(5.5, 18.5)}
      {ring(18.5, 5.5)}
    </>,
  ),
  ray: svg(
    <>
      <path d="M7.4 16.6L21.5 2.5" />
      <path d="M17.5 2.5h4v4" />
      {ring(5.5, 18.5)}
    </>,
  ),
  extended: svg(
    <>
      <path d="M2.5 21.5L21.5 2.5" />
      {ring(9, 15)}
      {ring(15, 9)}
    </>,
  ),
  hline: svg(
    <>
      <path d="M2.5 12h7M14.5 12h7" />
      {ring(12, 12)}
    </>,
  ),
  hray: svg(
    <>
      <path d="M8.1 12h13.4" />
      <path d="M18.5 9l3 3-3 3" />
      {ring(6, 12)}
    </>,
  ),
  vline: svg(
    <>
      <path d="M12 2.5v7M12 14.5v7" />
      {ring(12, 12)}
    </>,
  ),
  rect: svg(
    <>
      <rect x="4.5" y="6.5" width="15" height="11" rx="1" />
      {ring(4.5, 6.5)}
      {ring(19.5, 17.5)}
    </>,
  ),
  fib: svg(
    <>
      <path d="M3 5h18M3 9.5h18M3 14.5h18M3 19h18" strokeOpacity="0.85" />
      <path d="M5.5 19L18.5 5" strokeOpacity="0.5" />
    </>,
  ),
  long: svg(
    <>
      <rect x="4.5" y="4.5" width="15" height="7.5" fill="currentColor" fillOpacity="0.22" />
      <rect x="4.5" y="12" width="15" height="7.5" fill="currentColor" fillOpacity="0.07" />
      <path d="M12 16.5v-8M9.2 11.3L12 8.5l2.8 2.8" />
    </>,
  ),
  short: svg(
    <>
      <rect x="4.5" y="4.5" width="15" height="7.5" fill="currentColor" fillOpacity="0.07" />
      <rect x="4.5" y="12" width="15" height="7.5" fill="currentColor" fillOpacity="0.22" />
      <path d="M12 7.5v8M9.2 12.7L12 15.5l2.8-2.8" />
    </>,
  ),
  measure: svg(
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="1" strokeDasharray="2.6 2.2" strokeOpacity="0.6" />
      <path d="M8 12h8" />
      <path d="M10 9.7L7.6 12l2.4 2.3M14 9.7l2.4 2.3-2.4 2.3" />
    </>,
  ),
  text: svg(<path d="M4.5 7V4.5h15V7M12 4.5v15M8.5 19.5h7" />),
  brush: svg(<path d="M3 16.5c2.4-.6 3.4-4.6 6.2-4.6s2.2 4.6 4.6 4.6 3.4-5.4 7.2-8.4" />),
}

/** Tools grouped the way TradingView's left rail groups them. */
const GROUPS: { id: string; label: string; tools: ToolId[] }[] = [
  { id: 'cursor', label: 'Cursor', tools: ['cursor'] },
  { id: 'lines', label: 'Lines', tools: ['trendline', 'ray', 'extended', 'hline', 'hray', 'vline'] },
  { id: 'fib', label: 'Fibonacci', tools: ['fib'] },
  { id: 'shapes', label: 'Shapes', tools: ['rect', 'brush'] },
  { id: 'text', label: 'Text', tools: ['text'] },
  // Measure earns its own slot: it is the tool reached for most often, and a
  // flyout it shared with the position tools kept it hidden behind them.
  { id: 'measure', label: 'Measure', tools: ['measure'] },
  { id: 'forecast', label: 'Prediction', tools: ['long', 'short'] },
]

const tooltip = (tool: ToolId) => {
  const spec = TOOLS[tool]
  return spec.shortcut ? `${spec.label} (${spec.shortcut})` : spec.label
}

export default function DrawingToolbar({
  tool,
  magnet,
  visible,
  hasDrawings,
  canUndo,
  onToolChange,
  onToggleMagnet,
  onToggleVisible,
  onUndo,
  onClear,
}: Props) {
  // Each group remembers the tool last picked from its flyout.
  const [groupTool, setGroupTool] = useState<Record<string, ToolId>>(() =>
    Object.fromEntries(GROUPS.map((g) => [g.id, g.tools[0]])),
  )
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const railRef = useRef<HTMLDivElement>(null)

  // A tool armed by keyboard shortcut becomes its group's face.
  useEffect(() => {
    const group = GROUPS.find((g) => g.tools.includes(tool))
    if (group) setGroupTool((current) => (current[group.id] === tool ? current : { ...current, [group.id]: tool }))
  }, [tool])

  useEffect(() => {
    if (!openGroup) return
    const close = (e: PointerEvent) => {
      if (!railRef.current?.contains(e.target as Node)) setOpenGroup(null)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [openGroup])

  return (
    <div className="draw-rail" ref={railRef} role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
      {GROUPS.map((group) => {
        const face = groupTool[group.id]
        const active = group.tools.includes(tool)
        const multi = group.tools.length > 1
        return (
          <div key={group.id} className="draw-group">
            <button
              type="button"
              className={active ? 'draw-btn active' : 'draw-btn'}
              title={tooltip(face)}
              aria-label={TOOLS[face].label}
              aria-pressed={active}
              onClick={() => {
                setOpenGroup(null)
                onToolChange(active && face !== 'cursor' ? 'cursor' : face)
              }}
            >
              {TOOL_ICONS[face]}
            </button>
            {multi && (
              <button
                type="button"
                className={openGroup === group.id ? 'draw-caret open' : 'draw-caret'}
                title={group.label}
                aria-label={`More ${group.label.toLowerCase()} tools`}
                aria-expanded={openGroup === group.id}
                onClick={() => setOpenGroup((g) => (g === group.id ? null : group.id))}
              >
                <svg viewBox="0 0 6 10" width="5" height="8">
                  <path d="M1 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
            )}
            {openGroup === group.id && (
              <div className="draw-flyout" role="menu">
                <div className="draw-flyout-title">{group.label}</div>
                {group.tools.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="menuitem"
                    className={id === tool ? 'draw-flyout-item active' : 'draw-flyout-item'}
                    onClick={() => {
                      setGroupTool((current) => ({ ...current, [group.id]: id }))
                      setOpenGroup(null)
                      onToolChange(id)
                    }}
                  >
                    {TOOL_ICONS[id]}
                    <span>{TOOLS[id].label}</span>
                    {TOOLS[id].shortcut && <kbd>{TOOLS[id].shortcut}</kbd>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <div className="draw-sep" />

      <button
        type="button"
        className={magnet ? 'draw-btn active' : 'draw-btn'}
        title="Magnet: snap to open / high / low / close"
        aria-pressed={magnet}
        onClick={onToggleMagnet}
      >
        {svg(<path d="M6 4v7a6 6 0 0012 0V4h-4v7a2 2 0 01-4 0V4zM6 8h4M14 8h4" />)}
      </button>

      <button
        type="button"
        className={visible ? 'draw-btn' : 'draw-btn active'}
        title={visible ? 'Hide all drawings' : 'Show all drawings'}
        aria-pressed={!visible}
        onClick={onToggleVisible}
      >
        {visible
          ? svg(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>)
          : svg(<><path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3 3.9M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 005.4-1.6" /><path d="M9.9 9.9a3 3 0 004.2 4.2" /></>)}
      </button>

      <button type="button" className="draw-btn" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>
        {svg(<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />)}
      </button>

      <button type="button" className="draw-btn danger" title="Remove all drawings" disabled={!hasDrawings} onClick={onClear}>
        {svg(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />)}
      </button>
    </div>
  )
}
