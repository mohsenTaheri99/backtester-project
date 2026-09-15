/**
 * Mouse / touch interaction for the drawing layer: placing new drawings with
 * the armed tool, selecting, dragging bodies and handles, and keyboard
 * shortcuts that act on the selection.
 *
 * The chart pans on mousedown/touchstart. When a pointer press belongs to a
 * drawing we swallow those events in the capture phase so the chart never
 * sees them, while mousemove still flows through and the crosshair keeps
 * tracking the pointer.
 */
import type { DrawingLayer } from './DrawingLayer'
import { TOOLS, type Anchor, type Drawing, type DrawingType, type ToolId } from './types'

export interface DrawingCallbacks {
  /** A finished edit: new drawing, move, delete. */
  onCommit: (drawings: Drawing[]) => void
  onSelect: (id: string | null) => void
  /** The armed tool finished (or was cancelled); the toolbar goes back to cursor. */
  onToolDone: () => void
  onEditText: (id: string) => void
}

interface DragState {
  id: string
  handle: number
  original: Anchor[]
  startLogical: number | null
  startPrice: number | null
  moved: boolean
}

interface PlacingState {
  downX: number
  downY: number
}

const DRAG_THRESHOLD = 4

export const newDrawingId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export class DrawingController {
  private tool: ToolId = 'cursor'
  magnet = false

  private drag: DragState | null = null
  private placing: PlacingState | null = null
  private brushing = false
  /** Set while a press belongs to us, so the chart's own handlers are skipped. */
  private claimed = false

  constructor(
    private readonly layer: DrawingLayer,
    private readonly container: HTMLElement,
    private readonly callbacks: DrawingCallbacks,
  ) {
    container.addEventListener('pointerdown', this.handlePointerDown, true)
    container.addEventListener('mousedown', this.swallow, true)
    container.addEventListener('touchstart', this.swallow, true)
    container.addEventListener('dblclick', this.handleDoubleClick, true)
    container.addEventListener('pointerleave', this.handleLeave)
    window.addEventListener('pointermove', this.handlePointerMove)
    window.addEventListener('pointerup', this.handlePointerUp)
    window.addEventListener('keydown', this.handleKeyDown)
  }

  destroy(): void {
    const { container } = this
    container.removeEventListener('pointerdown', this.handlePointerDown, true)
    container.removeEventListener('mousedown', this.swallow, true)
    container.removeEventListener('touchstart', this.swallow, true)
    container.removeEventListener('dblclick', this.handleDoubleClick, true)
    container.removeEventListener('pointerleave', this.handleLeave)
    window.removeEventListener('pointermove', this.handlePointerMove)
    window.removeEventListener('pointerup', this.handlePointerUp)
    window.removeEventListener('keydown', this.handleKeyDown)
  }

  // --- external state -------------------------------------------------------
  setDrawings(drawings: Drawing[]): void {
    if (this.drag) return // mid-drag the working copy wins; it commits on release
    this.layer.drawings = drawings
    if (this.layer.selectedId && !drawings.some((d) => d.id === this.layer.selectedId)) this.select(null)
    this.layer.update()
  }

  setTool(tool: ToolId): void {
    this.tool = tool
    this.layer.draft = null
    this.placing = null
    this.brushing = false
    this.layer.armed = tool !== 'cursor'
    if (tool !== 'cursor') this.select(null)
    this.layer.update()
  }

  setVisible(visible: boolean): void {
    this.layer.visible = visible
    if (!visible) this.select(null)
    this.layer.update()
  }

  select(id: string | null): void {
    if (this.layer.selectedId === id) return
    this.layer.selectedId = id
    this.layer.update()
    this.callbacks.onSelect(id)
  }

  // --- helpers --------------------------------------------------------------
  private local(e: { clientX: number; clientY: number }) {
    const rect = this.container.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  private inPane(x: number, y: number): boolean {
    // Presses on the price or time axis belong to the chart (axis scaling).
    return x >= 0 && y >= 0 && x < this.layer.paneWidth() && y < this.layer.paneHeight()
  }

  private commit(drawings: Drawing[]): void {
    this.layer.drawings = drawings
    this.layer.update()
    this.callbacks.onCommit(drawings)
  }

  private finishDraft(): void {
    const draft = this.layer.draft
    this.layer.draft = null
    this.placing = null
    this.brushing = false
    if (!draft) return
    this.commit([...this.layer.drawings, draft])
    this.callbacks.onToolDone()
    this.select(draft.id)
  }

  private makeDrawing(type: DrawingType, points: Anchor[]): Drawing {
    return { id: newDrawingId(), type, points, color: TOOLS[type].defaultColor ?? '#2962ff' }
  }

  /** A long/short tool dropped with one click gets a 2R box sized to the view. */
  private positionPoints(type: 'long' | 'short', entry: Anchor): Anchor[] | null {
    const px = this.layer.toPixel(entry)
    const logical = this.layer.timeToLogical(entry.time)
    if (!px || logical === null) return null
    const sign = type === 'long' ? 1 : -1
    const target = this.layer.priceAtY(px.y - sign * 70)
    const stop = this.layer.priceAtY(px.y + sign * 35)
    if (target === null || stop === null) return null
    const end = this.layer.logicalToTime(logical + 25)
    return [entry, { time: end, price: target }, { time: end, price: stop }]
  }

  // --- events ---------------------------------------------------------------
  private swallow = (e: Event) => {
    if (this.claimed) e.stopPropagation()
  }

  private handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    const { x, y } = this.local(e)
    if (!this.inPane(x, y)) return

    if (this.tool !== 'cursor') {
      this.claimed = true
      // Keep the press from moving focus away from the text box it is about to open.
      if (this.tool === 'text') e.preventDefault()
      this.placeAt(x, y)
      return
    }

    const hit = this.layer.hit(x, y)
    if (!hit) {
      this.select(null)
      return // let the chart pan
    }

    this.claimed = true
    this.select(hit.id)
    const drawing = this.layer.drawings.find((d) => d.id === hit.id)
    if (!drawing) return
    this.drag = {
      id: hit.id,
      handle: hit.handle,
      original: drawing.points.map((p) => ({ ...p })),
      startLogical: this.layer.logicalAtX(x),
      startPrice: this.layer.priceAtY(y),
      moved: false,
    }
  }

  private placeAt(x: number, y: number): void {
    const type = this.tool as DrawingType
    const spec = TOOLS[type]
    const anchor = this.layer.fromPixel(x, y, this.magnet)
    if (!anchor) return

    // Second click of a click-move-click placement.
    if (this.placing && this.layer.draft) {
      this.layer.draft.points[1] = anchor
      this.finishDraft()
      return
    }

    if (spec.placement === 'one-click') {
      const points = type === 'long' || type === 'short' ? this.positionPoints(type, anchor) : [anchor]
      if (!points) return
      const drawing = this.makeDrawing(type, points)
      this.commit([...this.layer.drawings, drawing])
      this.callbacks.onToolDone()
      this.select(drawing.id)
      if (type === 'text') this.callbacks.onEditText(drawing.id)
      return
    }

    if (spec.placement === 'freehand') {
      this.layer.draft = this.makeDrawing(type, [anchor])
      this.brushing = true
    } else {
      this.layer.draft = this.makeDrawing(type, [anchor, { ...anchor }])
      this.placing = { downX: x, downY: y }
    }
    this.layer.update()
  }

  private handlePointerMove = (e: PointerEvent) => {
    const { x, y } = this.local(e)
    const layer = this.layer

    if (this.drag) {
      this.dragTo(x, y)
      return
    }

    if (layer.draft) {
      const anchor = layer.fromPixel(x, y, this.magnet && !this.brushing)
      if (!anchor) return
      if (this.brushing) {
        const last = layer.toPixel(layer.draft.points[layer.draft.points.length - 1])
        if (!last || Math.hypot(last.x - x, last.y - y) >= 3) layer.draft.points.push(anchor)
      } else {
        layer.draft.points[1] = anchor
      }
      layer.update()
      return
    }

    if (this.tool === 'cursor' && e.target instanceof Node && this.container.contains(e.target)) {
      const hovered = this.inPane(x, y) ? (layer.hit(x, y)?.id ?? null) : null
      if (hovered !== layer.hoveredId) {
        layer.hoveredId = hovered
        layer.update()
      }
    }
  }

  private dragTo(x: number, y: number): void {
    const drag = this.drag
    const layer = this.layer
    if (!drag) return
    const drawing = layer.drawings.find((d) => d.id === drag.id)
    if (!drawing) return

    let points: Anchor[]
    if (drag.handle >= 0 && drawing.type !== 'hline' && drawing.type !== 'vline') {
      const anchor = layer.fromPixel(x, y, this.magnet)
      if (!anchor) return
      points = drag.original.map((p) => ({ ...p }))
      points[drag.handle] = anchor
      // Target and stop of a position tool share one right edge.
      if ((drawing.type === 'long' || drawing.type === 'short') && drag.handle > 0) {
        points[1].time = anchor.time
        points[2].time = anchor.time
      }
    } else {
      const logical = layer.logicalAtX(x)
      const price = layer.priceAtY(y)
      if (logical === null || price === null || drag.startLogical === null || drag.startPrice === null) return
      const dBars = Math.round(logical - drag.startLogical)
      const dPrice = price - drag.startPrice
      points = drag.original.map((p) => ({
        time: layer.logicalToTime((layer.timeToLogical(p.time) ?? 0) + dBars),
        price: p.price + dPrice,
      }))
    }

    drag.moved = true
    layer.drawings = layer.drawings.map((d) => (d.id === drag.id ? { ...d, points } : d))
    layer.update()
  }

  private handlePointerUp = (e: PointerEvent) => {
    this.claimed = false

    if (this.drag) {
      const { moved } = this.drag
      this.drag = null
      if (moved) this.commit(this.layer.drawings)
      return
    }

    if (this.brushing) {
      const draft = this.layer.draft
      if (draft && draft.points.length > 1) this.finishDraft()
      else this.setTool(this.tool)
      return
    }

    // Press-drag-release places a two-point drawing in one gesture; a plain
    // click leaves it following the mouse until the second click.
    if (this.placing) {
      const { x, y } = this.local(e)
      if (Math.hypot(x - this.placing.downX, y - this.placing.downY) > DRAG_THRESHOLD) this.finishDraft()
    }
  }

  private handleLeave = () => {
    if (this.layer.hoveredId) {
      this.layer.hoveredId = null
      this.layer.update()
    }
  }

  private handleDoubleClick = (e: MouseEvent) => {
    const { x, y } = this.local(e)
    const hit = this.layer.hit(x, y)
    const drawing = hit && this.layer.drawings.find((d) => d.id === hit.id)
    if (drawing?.type !== 'text') return
    e.stopPropagation()
    this.callbacks.onEditText(drawing.id)
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null
    if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return

    if (e.key === 'Escape') {
      if (this.layer.draft || this.tool !== 'cursor') {
        this.setTool('cursor')
        this.callbacks.onToolDone()
      } else {
        this.select(null)
      }
      return
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && this.layer.selectedId) {
      e.preventDefault()
      const id = this.layer.selectedId
      this.select(null)
      this.commit(this.layer.drawings.filter((d) => d.id !== id))
    }
  }
}
