// DIAGRAMMA DELLE CHIAMATE: data una stored procedure o una funzione, mostra i legami con
// le altre routine, salendo fino al chiamante più lontano (o scendendo verso quello che
// chiama). I cicli — nel database reale esistono routine che chiamano se stesse — sono
// segnalati invece di far esplodere il disegno.
import { useMemo, useState } from 'react'
import { ArrowLeft, Crosshair, ExternalLink, RefreshCw, Share2, X, ZoomIn, ZoomOut } from 'lucide-react'
import {
  buildRoutineIndex,
  describeWalk,
  layoutCallGraph,
  ROUTINE_KIND_BADGE,
  ROUTINE_KIND_LABEL,
  walkCallGraph,
  type RoutineKind,
  type WalkDirection,
} from '../callGraph'
import type { RoutineCallGraph } from '../types'
import { Spinner } from './ui'

export interface CallGraphTarget {
  schema: string
  name: string
  kind?: RoutineKind
}

interface Props {
  target: CallGraphTarget
  /** legami diretti di tutto il database (null finché non sono caricati) */
  graph: RoutineCallGraph | null
  loading: boolean
  error: string | null
  /** Chiude il diagramma (la tab si chiude con la sua "×"): se assente non c'è il pulsante. */
  onClose?: () => void
  /** apre la routine nel diagramma in una nuova tab (CREATE OR ALTER) */
  onOpenObject?: (kind: 'procedure' | 'function' | 'view' | 'trigger', schema: string, name: string) => void
  /** riprova a caricare il grafo (es. dopo una sessione scaduta) */
  onReload?: () => void
}

/** Colori per tipo di oggetto (bordo, sfondo, testo). */
const KIND_COLORS: Record<RoutineKind, { stroke: string; fill: string; text: string }> = {
  procedure: { stroke: '#38bdf8', fill: '#0c4a6e55', text: '#e0f2fe' },
  function: { stroke: '#c084fc', fill: '#581c8755', text: '#f3e8ff' },
  trigger: { stroke: '#34d399', fill: '#064e3b55', text: '#d1fae5' },
  view: { stroke: '#94a3b8', fill: '#33415555', text: '#e2e8f0' },
  other: { stroke: '#a1a1aa', fill: '#3f3f4655', text: '#e4e4e7' },
}

const CYCLE_COLOR = '#f59e0b'
const TARGET_COLOR = '#fbbf24'

/** Accorcia i nomi lunghi: nel diagramma serve leggibilità, il nome intero è nel tooltip. */
function shortName(name: string, max = 24): string {
  return name.length <= max ? name : `${name.slice(0, max - 1)}…`
}

export default function CallGraphPanel({
  target,
  graph,
  loading,
  error,
  onClose,
  onOpenObject,
  onReload,
}: Props) {
  const [direction, setDirection] = useState<WalkDirection>('callers')
  const [depth, setDepth] = useState(4)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  // cronologia dei ri-centramenti, per poter tornare indietro
  const [history, setHistory] = useState<CallGraphTarget[]>([])
  const [center, setCenter] = useState<CallGraphTarget>(target)

  const index = useMemo(() => buildRoutineIndex(graph), [graph])
  const view = useMemo(
    () => walkCallGraph(index, { schema: center.schema, name: center.name }, direction, { maxDepth: depth }),
    [index, center, direction, depth],
  )
  const layout = useMemo(() => layoutCallGraph(view), [view])
  const nodeById = useMemo(() => new Map(layout.nodes.map(n => [n.id, n])), [layout])
  const selected = selectedId ? nodeById.get(selectedId) : undefined

  const recenter = (schema: string, name: string) => {
    setHistory(h => [...h, center])
    setCenter({ schema, name })
    setSelectedId(null)
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }
  const goBack = () => {
    setHistory(h => {
      if (h.length === 0) return h
      setCenter(h[h.length - 1])
      return h.slice(0, -1)
    })
    setSelectedId(null)
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }

  const openDefinition = (schema: string, name: string, kind: RoutineKind) => {
    const k = kind === 'function' ? 'function' : kind === 'trigger' ? 'trigger' : kind === 'view' ? 'view' : 'procedure'
    onOpenObject?.(k, schema, name)
  }

  /** Percorso di un legame: la freccia va sempre da chi chiama verso chi è chiamato. */
  const linkPath = (fromId: string, toId: string) => {
    const a = nodeById.get(fromId)
    const b = nodeById.get(toId)
    if (!a || !b) return ''
    if (a.id === b.id) {
      // auto-chiamata: piccolo anello sul lato destro, non si può disegnare dritto
      const x = a.x + a.width
      const y = a.y + a.height / 2
      return `M ${x} ${y - 8} C ${x + 46} ${y - 26}, ${x + 46} ${y + 26}, ${x} ${y + 8}`
    }
    const down = a.y < b.y
    const x1 = a.x + a.width / 2
    const y1 = down ? a.y + a.height : a.y
    const x2 = b.x + b.width / 2
    const y2 = down ? b.y : b.y + b.height
    const mid = (y2 - y1) / 2
    return `M ${x1} ${y1} C ${x1} ${y1 + mid}, ${x2} ${y2 - mid}, ${x2} ${y2}`
  }

  const emptyMessage =
    view.nodes.length <= 1
      ? direction === 'callers'
        ? 'Nessuna routine la chiama: è un punto di ingresso (il chiamante più lontano è lei stessa).'
        : 'Non chiama nessuna routine.'
      : null

  return (
    <div
      data-diagramma="pannello"
      className="flex h-full min-h-0 flex-col overflow-hidden border border-zinc-800 bg-zinc-900"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Intestazione */}
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-700 bg-zinc-800/80 px-4 py-2.5">
          <Share2 className="h-4 w-4 text-sky-400" />
          <h2 className="text-sm font-semibold text-zinc-100">
            Diagramma chiamate — {center.schema}.{center.name}
          </h2>
          {(loading || error) && <Spinner />}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded border border-zinc-600">
              <button
                onClick={() => setDirection('callers')}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  direction === 'callers' ? 'bg-sky-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
                title="Sale verso chi la chiama, fino al chiamante più lontano"
              >
                Chi la chiama
              </button>
              <button
                onClick={() => setDirection('callees')}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  direction === 'callees' ? 'bg-sky-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
                title="Scende verso le routine che chiama"
              >
                Cosa chiama
              </button>
            </div>
            <label className="flex items-center gap-1 text-xs text-zinc-400">
              livelli
              <select
                value={depth}
                onChange={e => setDepth(Number(e.target.value))}
                className="rounded border border-zinc-600 bg-zinc-800 px-1.5 py-1 text-xs text-zinc-200"
              >
                {[1, 2, 3, 4, 5, 6, 8, 10].map(d => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            {history.length > 0 && (
              <button
                onClick={goBack}
                className="flex items-center gap-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
                title="Torna alla routine precedente"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Indietro
              </button>
            )}
            <button
              onClick={() => {
                setScale(s => Math.min(2.5, s + 0.15))
              }}
              className="rounded border border-zinc-600 bg-zinc-800 p-1 text-zinc-300 transition-colors hover:bg-zinc-700"
              title="Ingrandisci"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                setScale(s => Math.max(0.35, s - 0.15))
              }}
              className="rounded border border-zinc-600 bg-zinc-800 p-1 text-zinc-300 transition-colors hover:bg-zinc-700"
              title="Riduci"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                setScale(1)
                setOffset({ x: 0, y: 0 })
              }}
              className="rounded border border-zinc-600 bg-zinc-800 p-1 text-zinc-300 transition-colors hover:bg-zinc-700"
              title="Adatta alla finestra"
            >
              <Crosshair className="h-3.5 w-3.5" />
            </button>
            {onReload && (
              <button
                onClick={onReload}
                className="rounded border border-zinc-600 bg-zinc-800 p-1 text-zinc-300 transition-colors hover:bg-zinc-700"
                title="Ricarica i legami dal database"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
                title="Chiudi"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Riepilogo */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-800 bg-zinc-900/60 px-4 py-1.5 text-xs text-zinc-400">
          <span>{describeWalk(view)}</span>
          {view.hasCycle && <span className="text-amber-400">↻ i legami tratteggiati chiudono un ciclo (chiamata ricorsiva)</span>}
          {graph?.truncated && <span className="text-amber-400">elenco dei legami troncato dal backend</span>}
        </div>

        {error && <div className="border-b border-red-900/60 bg-red-950/40 px-4 py-2 text-xs text-red-300">{error}</div>}

        <div className="flex min-h-0 flex-1">
          {/* Diagramma */}
          <div
            className="relative min-h-0 flex-1 overflow-hidden bg-zinc-950"
            onMouseDown={e => setDrag({ x: e.clientX - offset.x, y: e.clientY - offset.y })}
            onMouseMove={e => {
              if (drag) setOffset({ x: e.clientX - drag.x, y: e.clientY - drag.y })
            }}
            onMouseUp={() => setDrag(null)}
            onMouseLeave={() => setDrag(null)}
            onWheel={e => {
              e.preventDefault()
              setScale(s => Math.min(2.5, Math.max(0.35, s - e.deltaY * 0.001)))
            }}
          >
            {loading && !graph ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500">
                <Spinner /> Lettura dei legami dal database…
              </div>
            ) : view.nodes.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">Nessun dato.</div>
            ) : (
              <svg width="100%" height="100%" className={drag ? 'cursor-grabbing' : 'cursor-grab'}>
                <defs>
                  <marker id="cg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#71717a" />
                  </marker>
                  <marker
                    id="cg-arrow-cycle"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill={CYCLE_COLOR} />
                  </marker>
                </defs>
                <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>
                  {/* Legami */}
                  {view.links.map(l => {
                    const d = linkPath(l.from, l.to)
                    if (!d) return null
                    return (
                      <path
                        key={`${l.from}->${l.to}`}
                        d={d}
                        fill="none"
                        stroke={l.isCycle ? CYCLE_COLOR : '#52525b'}
                        strokeWidth={l.isCycle ? 1.8 : 1.4}
                        strokeDasharray={l.isCycle ? '6 4' : undefined}
                        markerEnd={l.isCycle ? 'url(#cg-arrow-cycle)' : 'url(#cg-arrow)'}
                      />
                    )
                  })}
                  {/* Routine */}
                  {layout.nodes.map(n => {
                    const colors = KIND_COLORS[n.kind]
                    const isSelected = n.id === selectedId
                    const stroke = n.isTarget ? TARGET_COLOR : n.inCycle ? CYCLE_COLOR : colors.stroke
                    return (
                      <g
                        key={n.id}
                        transform={`translate(${n.x} ${n.y})`}
                        onClick={e => {
                          e.stopPropagation()
                          setSelectedId(n.id)
                        }}
                        onDoubleClick={e => {
                          e.stopPropagation()
                          recenter(n.schema, n.name)
                        }}
                        className="cursor-pointer"
                      >
                        <title>
                          {`${n.schema}.${n.name} (${ROUTINE_KIND_LABEL[n.kind]})\nchiamanti: ${n.callerCount} · chiamate: ${n.calleeCount}${
                            n.inCycle ? '\n↻ coinvolta in un ciclo' : ''
                          }\nclic: dettagli · doppio clic: ricentra qui`}
                        </title>
                        <rect
                          x={0}
                          y={0}
                          width={n.width}
                          height={n.height}
                          rx={7}
                          fill={colors.fill}
                          stroke={stroke}
                          strokeWidth={n.isTarget || isSelected ? 2.4 : 1.4}
                          strokeDasharray={n.inCycle && !n.isTarget ? '5 3' : undefined}
                        />
                        {/* targhetta del tipo */}
                        <rect x={8} y={(n.height - 16) / 2} width={40} height={16} rx={4} fill={colors.stroke} opacity={0.9} />
                        <text x={28} y={n.height / 2 + 3.5} fontSize={9} fontWeight={700} textAnchor="middle" fill="#0b0b0f">
                          {ROUTINE_KIND_BADGE[n.kind]}
                        </text>
                        <text x={54} y={n.height / 2 - 1} fontSize={11.5} fill={colors.text} fontFamily="Cascadia Code, Consolas, monospace">
                          {shortName(n.name)}
                        </text>
                        <text x={54} y={n.height / 2 + 11} fontSize={9} fill={n.inCycle ? CYCLE_COLOR : '#a1a1aa'}>
                          {n.schema}
                          {n.isTarget ? ' · analizzata' : n.level > 0 ? ` · livello ${n.level}` : ''}
                          {n.inCycle ? ' · ↻' : ''}
                        </text>
                      </g>
                    )
                  })}
                </g>
              </svg>
            )}
            {emptyMessage && (
              <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                <div className="rounded bg-zinc-800/90 px-3 py-1.5 text-xs text-zinc-300">{emptyMessage}</div>
              </div>
            )}
          </div>

          {/* Dettaglio della routine selezionata */}
          <div className="w-[320px] shrink-0 overflow-y-auto border-l border-zinc-800 bg-zinc-900 p-3 text-xs">
            {selected ? (
              <div className="space-y-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-zinc-500">{ROUTINE_KIND_LABEL[selected.kind]}</div>
                  <div className="break-all font-mono text-sm text-zinc-100">
                    {selected.schema}.{selected.name}
                  </div>
                </div>
                <dl className="space-y-1 text-zinc-300">
                  <div className="flex justify-between">
                    <dt className="text-zinc-500">Livello</dt>
                    <dd>{selected.level === 0 ? 'oggetto analizzato' : `${selected.level} (distanza)`}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-zinc-500">Chiamanti diretti</dt>
                    <dd>{selected.callerCount}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-zinc-500">Routine chiamate</dt>
                    <dd>{selected.calleeCount}</dd>
                  </div>
                  {selected.inCycle && (
                    <div className="flex justify-between text-amber-400">
                      <dt>Ciclo</dt>
                      <dd>sì (↻)</dd>
                    </div>
                  )}
                </dl>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => recenter(selected.schema, selected.name)}
                    className="flex items-center justify-center gap-1.5 rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-200 transition-colors hover:bg-zinc-700"
                  >
                    <Crosshair className="h-3.5 w-3.5" /> Ricentra il diagramma qui
                  </button>
                  {onOpenObject && (
                    <button
                      onClick={() => openDefinition(selected.schema, selected.name, selected.kind)}
                      className="flex items-center justify-center gap-1.5 rounded border border-sky-700 bg-sky-900/40 px-2 py-1.5 text-sky-200 transition-colors hover:bg-sky-800/50"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Apri definizione (CREATE OR ALTER)
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-zinc-400">
                <p className="text-zinc-300">Clic su una routine per i dettagli, doppio clic per ricentrare il diagramma.</p>
                <p>Le frecce vanno sempre da chi chiama verso chi è chiamato. Con «Chi la chiama» l'oggetto analizzato è in basso e i chiamanti salgono fino al più lontano.</p>
                <p className="text-amber-400">↻ tratteggiato = legame che chiude un ciclo (chiamata ricorsiva o catena che si richiude).</p>
                <p>Tabelle e campi non compaiono: il diagramma segue solo i legami fra routine.</p>
                <p className="text-zinc-500">
                  I legami arrivano dalle dipendenze registrate da SQL Server. Le chiamate scritte senza schema
                  («EXEC nomeproc») vengono risolte per nome sullo schema del chiamante, come fa il server; il codice
                  costruito con SQL dinamico (EXEC di una stringa) non è invece tracciabile.
                </p>
              </div>
            )}
            <div className="mt-4 space-y-1 border-t border-zinc-800 pt-3">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">Legenda</div>
              {(['procedure', 'function', 'trigger', 'view'] as RoutineKind[]).map(k => (
                <div key={k} className="flex items-center gap-2">
                  <span className="inline-block h-3 w-5 rounded border" style={{ borderColor: KIND_COLORS[k].stroke, background: KIND_COLORS[k].fill }} />
                  <span className="text-zinc-400">{ROUTINE_KIND_LABEL[k]}</span>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-5 rounded border-2" style={{ borderColor: TARGET_COLOR }} />
                <span className="text-zinc-400">routine analizzata</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
