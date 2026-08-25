import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { GripVertical, PanelLeft, PanelRight, PanelTopClose, Pin, X } from 'lucide-react'
import { clampPanelSize } from '../panelLayout'
import type { PanelSize } from '../panelLayout'

export interface PanelPosition {
  x: number
  y: number
}

interface DockPanelProps {
  title: string
  icon: ReactNode
  /** True se il pannello è flottante (fixed, trascinabile e ridimensionabile). */
  floating: boolean
  position: PanelPosition
  /** Dimensioni del pannello flottante (larghezza/altezza). */
  size?: PanelSize
  onMove: (pos: PanelPosition) => void
  /** Chiamato al RILASCIO del trascinamento con le coordinate del mouse (per l'aggancio). */
  onDragEnd?: (point: { x: number; y: number }) => void
  /** Ridimensionamento del pannello flottante (maniglie su bordo destro/in basso/angolo). */
  onResize?: (size: PanelSize) => void
  onClose: () => void
  /** Stacca/riancora il pannello (usato dai pannelli ancorati). */
  onToggleFloat?: () => void
  /** Aggancia a sinistra (sidebar) — usato dai pulsanti del pannello flottante. */
  onDockLeft?: () => void
  /** Aggancia a destra (colonna laterale destra). */
  onDockRight?: () => void
  /** Classi per il layout quando è ancorato (es. "flex-1 min-h-0"). */
  dockClassName?: string
  /** Altezza fissa in px quando ancorato (per il pannello Database ridimensionabile). */
  dbHeight?: number
  accent?: string
  /** Chiamato allo scroll del contenuto (per chiudere le hover card). */
  onScroll?: () => void
  children: ReactNode
}

/** Trascina un elemento: richiama onMove con le coordinate del mouse e onDragEnd al rilascio. */
export function useDrag(onMove: (pos: PanelPosition) => void, onDragEnd?: (point: { x: number; y: number }) => void) {
  const dragging = useRef(false)
  const offset = useRef({ dx: 0, dy: 0 })

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      dragging.current = true
      const el = e.currentTarget as HTMLElement
      const rect = el.getBoundingClientRect()
      offset.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
      const onMoveHandler = (ev: MouseEvent) => {
        if (!dragging.current) return
        onMove({ x: ev.clientX - offset.current.dx, y: ev.clientY - offset.current.dy })
      }
      const onUp = (ev: MouseEvent) => {
        dragging.current = false
        window.removeEventListener('mousemove', onMoveHandler)
        window.removeEventListener('mouseup', onUp)
        onDragEnd?.({ x: ev.clientX, y: ev.clientY })
      }
      window.addEventListener('mousemove', onMoveHandler)
      window.addEventListener('mouseup', onUp)
    },
    [onMove, onDragEnd],
  )

  useEffect(() => () => {
    dragging.current = false
  }, [])

  return onMouseDown
}

/**
 * Ridimensiona un pannello trascinando una maniglia:
 * 'e' = bordo destro (larghezza), 's' = bordo inferiore (altezza), 'se' = angolo (entrambi).
 */
export function useResize(
  ref: React.RefObject<HTMLDivElement | null>,
  onResize: (size: PanelSize) => void,
  mode: 'e' | 's' | 'se',
) {
  const dragging = useRef(false)
  const start = useRef({ x: 0, y: 0, w: 0, h: 0 })

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return
      dragging.current = true
      start.current = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height }
      const onMoveHandler = (ev: MouseEvent) => {
        if (!dragging.current) return
        let w = start.current.w
        let h = start.current.h
        if (mode === 'e' || mode === 'se') w = start.current.w + (ev.clientX - start.current.x)
        if (mode === 's' || mode === 'se') h = start.current.h + (ev.clientY - start.current.y)
        onResize(clampPanelSize(w, h))
      }
      const onUp = () => {
        dragging.current = false
        window.removeEventListener('mousemove', onMoveHandler)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMoveHandler)
      window.addEventListener('mouseup', onUp)
    },
    [ref, onResize, mode],
  )

  useEffect(() => () => {
    dragging.current = false
  }, [])

  return onMouseDown
}

/** Pannello dock stile Visual Studio: chiudibile, staccabile (floating) e ridimensionabile. */
export default function DockPanel({
  title,
  icon,
  floating,
  position,
  size,
  onMove,
  onDragEnd,
  onResize,
  onClose,
  onToggleFloat,
  onDockLeft,
  onDockRight,
  dockClassName = '',
  dbHeight,
  accent = 'text-sky-300',
  onScroll,
  children,
}: DockPanelProps) {
  const startDrag = useDrag(onMove, onDragEnd)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const resizeE = useResize(panelRef, onResize ?? (() => {}), 'e')
  const resizeS = useResize(panelRef, onResize ?? (() => {}), 's')
  const resizeSE = useResize(panelRef, onResize ?? (() => {}), 'se')

  if (floating) {
    return (
      <div
        ref={panelRef}
        className="fixed z-[90] flex min-w-64 flex-col overflow-hidden rounded-lg border border-zinc-600 bg-zinc-900 shadow-2xl"
        style={{ left: position.x, top: position.y, width: size?.width ?? 320, height: size?.height ?? 320 }}
      >
        <div
          onMouseDown={startDrag}
          className="flex cursor-move items-center gap-2 border-b border-zinc-700 bg-zinc-800/80 px-2 py-1.5 select-none"
          title="Trascina per spostare il pannello — rilascia sopra la sidebar (sinistra) o sul bordo destro per agganciarlo"
        >
          <GripVertical className="h-3.5 w-3.5 text-zinc-500" />
          {icon}
          <span className={`truncate text-xs font-semibold ${accent}`}>{title}</span>
          <span className="ml-auto flex items-center gap-0.5">
            <button
              onClick={onDockLeft ?? onToggleFloat}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              title="Aggancia a sinistra (sidebar)"
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onDockRight}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              title="Aggancia a destra (colonna laterale)"
            >
              <PanelRight className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onClose}
              className="rounded p-1 text-zinc-400 hover:bg-rose-950 hover:text-rose-300"
              title="Chiudi il pannello"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" onScroll={onScroll}>{children}</div>
        {/* Maniglie di ridimensionamento */}
        <div
          onMouseDown={resizeE}
          className="absolute inset-y-0 -right-0.5 w-1.5 cursor-ew-resize"
          title="Trascina per allargare/stringere"
        />
        <div
          onMouseDown={resizeS}
          className="absolute inset-x-0 -bottom-0.5 h-1.5 cursor-ns-resize"
          title="Trascina per allungare/accorciare"
        />
        <div
          onMouseDown={resizeSE}
          className="absolute -bottom-1 -right-1 h-4 w-4 cursor-nwse-resize"
          title="Trascina per ridimensionare"
        />
      </div>
    )
  }

  return (
    <div className={`flex min-h-0 flex-col ${dockClassName}`} style={dbHeight !== undefined ? { height: dbHeight } : undefined}>
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-900/80 px-2 py-1">
        {icon}
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${accent}`}>{title}</span>
        <span className="ml-auto flex items-center gap-0.5">
          {onToggleFloat && (
            <button
              onClick={onToggleFloat}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              title="Stacca il pannello (floating)"
            >
              <Pin className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-rose-950 hover:text-rose-300"
            title="Chiudi il pannello"
          >
            <PanelTopClose className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" onScroll={onScroll}>{children}</div>
    </div>
  )
}
