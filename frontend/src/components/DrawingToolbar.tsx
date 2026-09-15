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
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

const dot = (cx: number, cy: number) => <circle cx={cx} cy={cy} r="1.8" fill="currentColor" stroke="none" />

export const TOOL_ICONS: Record<ToolId, ReactNode> = {
  cursor: svg(<path d="M6 3l12 9-5.5 1.2L15 20l-2.6 1-2.6-6.6L6 18z" />),
  trendline: svg(<>{dot(5, 19)}{dot(19, 5)}<path d="M6.3 17.7L17.7 6.3" /></>),
  ray: svg(<>{dot(5, 19)}{dot(13, 11)}<path d="M6.3 17.7L21 3" /></>),
  extended: svg(<>{dot(9, 15)}{dot(15, 9)}<path d="M3 21L21 3" /></>),
  hline: svg(<>{dot(12, 12)}<path d="M2 12h8M14 12h8" /></>),
  hray: svg(<>{dot(6, 12)}<path d="M8 12h14" /></>),
  vline: svg(<>{dot(12, 12)}<path d="M12 2v8M12 14v8" /></>),
  rect: svg(<><rect x="4" y="6" width="16" height="12" rx="1" />{dot(4, 6)}{dot(20, 18)}</>),
  fib: svg(<path d="M3 4h18M3 9h18M3 13h18M3 17h18M3 21h18M5 21L19 4" strokeDasharray="0" />),
  long: svg(<><rect x="4" y="4" width="16" height="9" fill="currentColor" fillOpacity="0.25" /><rect x="4" y="13" width="16" height="6" /><path d="M8 10l4-4 4 4" /></>),
  short: svg(<><rect x="4" y="5" width="16" height="6" /><rect x="4" y="11" width="16" height="9" fill="currentColor" fillOpacity="0.25" /><path d="M8 14l4 4 4-4" /></>),
  measure: svg(<><path d="M12 3v18M3 12h18" /><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></>),
  text: svg(<path d="M5 6V4h14v2M12 4v16M9 20h6" />),
  brush: svg(<path d="M3 17c3-1 4-5 7-5s2 5 5 5 4-6 6-9" />),
}

/** Tools grouped the way TradingView's left rail groups them. */
const GROUPS: { id: string; label: string; tools: ToolId[] }[] = [
  { id: 'cursor', label: 'Cursor', tools: ['cursor'] },
  { id: 'lines', label: 'Lines', tools: ['trendline', 'ray', 'extended', 'hline', 'hray', 'vline'] },
  { id: 'fib', label: 'Fibonacci', tools: ['fib'] },
  { id: 'shapes', label: 'Shapes', tools: ['rect', 'brush'] },
  { id: 'text', label: 'Text', tools: ['text'] },
  { id: 'forecast', label: 'Prediction and measurement', tools: ['long', 'short', 'measure'] },
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
