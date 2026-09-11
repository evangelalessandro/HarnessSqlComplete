// GRAFO DELLE CHIAMATE fra routine: "chi chiama chi".
//
// Dai legami DIRETTI che arrivano dal backend (dipendenze reali di SQL Server) si ricava
// la catena dei chiamanti di una routine, fino al chiamante più lontano.
//
// ATTENZIONE AI CICLI: nel database reale esistono routine che chiamano SE STESSE
// (fn_tabCellaCella, fn_tabUdcBack, fn_tabUdcFront, ws_UTI_WhyEseNoMiss) e catene che si
// richiudono. L'esplorazione tiene l'insieme dei nodi già visti, quindi ogni routine viene
// espansa UNA VOLTA SOLA: il numero di passi è al massimo quello dei nodi coinvolti, non
// dipende dalla forma del grafo. I legami che tornano indietro vengono marcati "ciclo"
// e mostrati, invece di essere seguiti all'infinito.
//
// Tutto qui dentro è PURO (nessun accesso alla rete o a Monaco) per poter essere testato.

import type { RoutineCallEdge, RoutineCallGraph } from './types'

export type RoutineKind = 'procedure' | 'function' | 'trigger' | 'view' | 'other'

/** Direzione dell'esplorazione: chi la chiama oppure cosa chiama lei. */
export type WalkDirection = 'callers' | 'callees'

/** Etichette leggibili dei tipi di oggetto di SQL Server. */
export const ROUTINE_KIND_LABEL: Record<RoutineKind, string> = {
  procedure: 'stored procedure',
  function: 'funzione',
  trigger: 'trigger',
  view: 'vista',
  other: 'oggetto',
}

/** Nome breve del tipo (per le targhette nel diagramma). */
export const ROUTINE_KIND_BADGE: Record<RoutineKind, string> = {
  procedure: 'PROC',
  function: 'FUNC',
  trigger: 'TRG',
  view: 'VIEW',
  other: 'OBJ',
}

/** Tipo di oggetto di SQL Server → categoria usata dall'interfaccia. */
export function routineKind(type: string | null | undefined): RoutineKind {
  switch ((type ?? '').trim().toUpperCase()) {
    case 'P':
    case 'PC':
      return 'procedure'
    case 'FN':
    case 'IF':
    case 'TF':
    case 'FS':
    case 'FT':
      return 'function'
    case 'TR':
      return 'trigger'
    case 'V':
      return 'view'
    default:
      return 'other'
  }
}

/** Identificatore unico di una routine: "schema.nome" in minuscolo. */
export function routineId(schema: string, name: string): string {
  return `${(schema ?? '').toLowerCase()}.${(name ?? '').toLowerCase()}`
}

export function splitRoutineId(id: string): { schema: string; name: string } {
  const at = id.indexOf('.')
  return at === -1 ? { schema: '', name: id } : { schema: id.slice(0, at), name: id.slice(at + 1) }
}

/** Indice dei legami, pronto per l'esplorazione (chiavi = id "schema.nome"). */
export interface RoutineIndex {
  /** id chiamato → id dei suoi chiamanti */
  callersOf: Map<string, string[]>
  /** id chiamante → id delle routine che chiama */
  calleesOf: Map<string, string[]>
  /** id → tipo di oggetto (es. 'P', 'FN') */
  types: Map<string, string>
  /** id → schema e nome con la GRAFIA ORIGINALE del database (es. ws_CUSTOM_L2_X) */
  display: Map<string, { schema: string; name: string }>
  /** numero di legami diretti letti */
  edgeCount: number
}

/**
 * Costruisce l'indice dai legami diretti. Gli elenchi sono ordinati e senza duplicati,
 * così l'esplorazione e il disegno sono sempre identici a parità di dati.
 */
export function buildRoutineIndex(
  graph: RoutineCallGraph | RoutineCallEdge[] | null | undefined,
): RoutineIndex {
  const edges = Array.isArray(graph) ? graph : (graph?.edges ?? [])
  const callersOf = new Map<string, string[]>()
  const calleesOf = new Map<string, string[]>()
  const types = new Map<string, string>()
  const display = new Map<string, { schema: string; name: string }>()
  const seen = new Set<string>()
  let edgeCount = 0

  for (const e of edges) {
    const caller = routineId(e.callerSchema, e.callerName)
    const callee = routineId(e.calleeSchema, e.calleeName)
    // l'id è in minuscolo per confrontare, ma per mostrare si tiene la grafia del database
    if (!display.has(caller)) display.set(caller, { schema: e.callerSchema, name: e.callerName })
    if (!display.has(callee)) display.set(callee, { schema: e.calleeSchema, name: e.calleeName })
    const key = `${caller}>${callee}`
    if (seen.has(key)) continue
    seen.add(key)
    edgeCount++
    types.set(caller, e.callerType ?? '')
    types.set(callee, e.calleeType ?? '')
    const callers = callersOf.get(callee) ?? []
    callers.push(caller)
    callersOf.set(callee, callers)
    const callees = calleesOf.get(caller) ?? []
    callees.push(callee)
    calleesOf.set(caller, callees)
  }

  for (const list of callersOf.values()) list.sort()
  for (const list of calleesOf.values()) list.sort()
  return { callersOf, calleesOf, types, display, edgeCount }
}

export interface RoutineNode {
  id: string
  schema: string
  name: string
  kind: RoutineKind
  /** tipo originale di SQL Server ('P', 'FN', 'IF', 'TF', 'TR', 'V') */
  type: string
  /** distanza dall'oggetto analizzato: 0 = l'oggetto stesso */
  level: number
  isTarget: boolean
  /** quanti chiamanti diretti ha nel database */
  callerCount: number
  /** quante routine chiama direttamente */
  calleeCount: number
  /** toccata da un legame che si richiude (ciclo o ricorsione) */
  inCycle: boolean
}

export interface RoutineLink {
  from: string
  to: string
  /** legame che si richiude su una routine già esplorata (ciclo o chiamata ricorsiva) */
  isCycle: boolean
}

export interface CallGraphView {
  rootId: string
  direction: WalkDirection
  nodes: RoutineNode[]
  links: RoutineLink[]
  /** esplorazione fermata dal limite di profondità (ci sono altri chiamanti più lontani) */
  depthLimited: boolean
  /** esplorazione fermata dal limite di nodi */
  nodeLimited: boolean
  /** true se nell'esplorazione è stato incontrato almeno un ciclo */
  hasCycle: boolean
  /** profondità massima raggiunta (0 = solo l'oggetto analizzato) */
  maxLevel: number
}

export interface WalkOptions {
  /** livelli da esplorare oltre all'oggetto analizzato (default 6) */
  maxDepth?: number
  /** numero massimo di routine disegnate (default 140) */
  maxNodes?: number
}

const DEFAULT_MAX_DEPTH = 6
const DEFAULT_MAX_NODES = 140

/**
 * Esplora il grafo partendo da una routine.
 * - `callers`: sale verso chi la chiama, fino al chiamante più lontano;
 * - `callees`: scende verso quello che chiama.
 * I nodi sono al massimo `maxNodes` e i livelli al massimo `maxDepth`: i limiti servono a
 * tenere leggibile il diagramma, e vengono segnalati con `depthLimited`/`nodeLimited`.
 */
export function walkCallGraph(
  index: RoutineIndex,
  target: { schema: string; name: string },
  direction: WalkDirection = 'callers',
  options: WalkOptions = {},
): CallGraphView {
  const maxDepth = Math.max(0, options.maxDepth ?? DEFAULT_MAX_DEPTH)
  const maxNodes = Math.max(1, options.maxNodes ?? DEFAULT_MAX_NODES)
  const rootId = routineId(target.schema, target.name)
  const neighbours = direction === 'callers' ? index.callersOf : index.calleesOf

  const nodes = new Map<string, RoutineNode>()
  const makeNode = (id: string, level: number): RoutineNode => {
    const shown = index.display.get(id) ?? splitRoutineId(id)
    const type = index.types.get(id) ?? ''
    return {
      id,
      schema: shown.schema,
      name: shown.name,
      type,
      kind: routineKind(type),
      level,
      isTarget: id === rootId,
      callerCount: index.callersOf.get(id)?.length ?? 0,
      calleeCount: index.calleesOf.get(id)?.length ?? 0,
      inCycle: false,
    }
  }
  // anche l'oggetto analizzato può non comparire nel grafo: si mostra la grafia richiesta
  if (!index.display.has(rootId)) index.display.set(rootId, { schema: target.schema, name: target.name })
  nodes.set(rootId, makeNode(rootId, 0))

  const links: RoutineLink[] = []
  const seenLinks = new Set<string>()
  let depthLimited = false
  let nodeLimited = false

  // Visita in ampiezza: il livello di ogni nodo è la distanza minima dall'oggetto analizzato.
  const queue: string[] = [rootId]
  while (queue.length > 0) {
    const currentId = queue.shift()!
    const current = nodes.get(currentId)!
    const nextIds = neighbours.get(currentId) ?? []
    if (nextIds.length === 0) continue
    if (current.level >= maxDepth) {
      depthLimited = true // ci sarebbero altri chiamanti, ma il diagramma si ferma qui
      continue
    }
    for (const nextId of nextIds) {
      const existing = nodes.get(nextId)
      const selfLoop = nextId === currentId
      // Un legame è "ciclo" se torna su una routine già esplorata allo stesso livello o più
      // vicina all'oggetto: è la definizione che distingue una ricorsione da un semplice
      // incrocio (due rami che convergono sullo stesso nodo non sono un ciclo).
      const isCycle = selfLoop || (existing !== undefined && existing.level <= current.level)
      if (existing === undefined) {
        if (nodes.size >= maxNodes) {
          nodeLimited = true
          continue
        }
        nodes.set(nextId, makeNode(nextId, current.level + 1))
        queue.push(nextId)
      }
      if (isCycle) {
        current.inCycle = true
        nodes.get(nextId)!.inCycle = true
      }
      const key = `${currentId}>${nextId}`
      if (!seenLinks.has(key)) {
        seenLinks.add(key)
        // I legami sono SEMPRE nel verso della chiamata (chi chiama → chi è chiamato),
        // così le frecce si leggono allo stesso modo nelle due direzioni:
        // salendo verso i chiamanti puntano verso il basso (verso l'oggetto analizzato),
        // scendendo verso i chiamati puntano verso il basso (verso chi è chiamato).
        links.push(
          direction === 'callers'
            ? { from: nextId, to: currentId, isCycle }
            : { from: currentId, to: nextId, isCycle },
        )
      }
    }
  }

  const orderedNodes = [...nodes.values()].sort(
    (a, b) => a.level - b.level || a.name.localeCompare(b.name) || a.schema.localeCompare(b.schema),
  )
  links.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
  const maxLevel = orderedNodes.reduce((m, n) => Math.max(m, n.level), 0)

  return {
    rootId,
    direction,
    nodes: orderedNodes,
    links,
    depthLimited,
    nodeLimited,
    hasCycle: links.some(l => l.isCycle),
    maxLevel,
  }
}

export interface PositionedNode extends RoutineNode {
  x: number
  y: number
  width: number
  height: number
}

export interface CallGraphLayout {
  width: number
  height: number
  nodes: PositionedNode[]
  /** numero di righe disegnate (una per livello) */
  rows: number
  nodeWidth: number
  nodeHeight: number
}

export interface LayoutOptions {
  nodeWidth?: number
  nodeHeight?: number
  gapX?: number
  gapY?: number
  padding?: number
}

/**
 * Dispone le routine a livelli orizzontali: una riga per livello, l'oggetto analizzato
 * nella riga più vicina al bordo (in basso quando si guardano i chiamanti, in alto quando
 * si guarda cosa chiama). Dentro la riga le routine "vicine" a quelle della riga
 * precedente vengono accostate, per ridurre gli incroci; l'ordine resta deterministico.
 */
export function layoutCallGraph(view: CallGraphView, options: LayoutOptions = {}): CallGraphLayout {
  const nodeWidth = options.nodeWidth ?? 210
  const nodeHeight = options.nodeHeight ?? 44
  const gapX = options.gapX ?? 24
  const gapY = options.gapY ?? 78
  const padding = options.padding ?? 24

  const byLevel = new Map<number, RoutineNode[]>()
  for (const n of view.nodes) {
    const list = byLevel.get(n.level) ?? []
    list.push(n)
    byLevel.set(n.level, list)
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b)
  const levelOf = new Map(view.nodes.map(n => [n.id, n.level]))

  // indici progressivi per il calcolo del "baricentro"
  const positionInRow = new Map<string, number>()
  const order: number[][] = []
  for (const level of levels) {
    const row = (byLevel.get(level) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name) || a.schema.localeCompare(b.schema))
    const ids: number[] = []
    row.forEach((n, i) => {
      positionInRow.set(n.id, i)
      ids.push(i)
    })
    order.push(ids)
    byLevel.set(level, row)
  }
  // seconda passata: ogni riga si ordina in base alla posizione dei vicini nella riga precedente
  // (adiacenza calcolata una volta sola, non a ogni confronto)
  const adjacency = new Map<string, string[]>()
  for (const l of view.links) {
    if (l.from === l.to) continue // le auto-chiamate non aiutano a ordinare
    adjacency.set(l.from, [...(adjacency.get(l.from) ?? []), l.to])
    adjacency.set(l.to, [...(adjacency.get(l.to) ?? []), l.from])
  }
  for (let li = 1; li < levels.length; li++) {
    const level = levels[li]
    const prevLevel = levels[li - 1]
    const row = byLevel.get(level)!
    const barycenter = (n: RoutineNode): number => {
      const neighbours: number[] = []
      for (const other of adjacency.get(n.id) ?? []) {
        if (levelOf.get(other) !== prevLevel) continue
        const p = positionInRow.get(other)
        if (p !== undefined) neighbours.push(p)
      }
      if (neighbours.length === 0) return Number.POSITIVE_INFINITY // senza legami: in fondo
      return neighbours.reduce((s, v) => s + v, 0) / neighbours.length
    }
    row.sort((a, b) => barycenter(a) - barycenter(b) || a.name.localeCompare(b.name))
    row.forEach((n, i) => positionInRow.set(n.id, i))
  }

  const rows = levels.length
  const widest = Math.max(1, ...levels.map(l => (byLevel.get(l)?.length ?? 1)))
  const width = padding * 2 + widest * nodeWidth + Math.max(0, widest - 1) * gapX
  const height = padding * 2 + rows * nodeHeight + Math.max(0, rows - 1) * gapY

  const positioned: PositionedNode[] = []
  for (const level of levels) {
    const row = byLevel.get(level)!
    const rowWidth = row.length * nodeWidth + Math.max(0, row.length - 1) * gapX
    const offsetX = padding + (width - padding * 2 - rowWidth) / 2
    // con i chiamanti la riga 0 (l'oggetto analizzato) sta in basso, con i chiamati in alto
    const rowFromTop = view.direction === 'callers' ? view.maxLevel - level : level
    const y = padding + rowFromTop * (nodeHeight + gapY)
    row.forEach((n, i) => {
      positioned.push({ ...n, x: offsetX + i * (nodeWidth + gapX), y, width: nodeWidth, height: nodeHeight })
    })
  }
  positioned.sort((a, b) => a.y - b.y || a.x - b.x)
  return { width, height, nodes: positioned, rows, nodeWidth, nodeHeight }
}

/** Riga di riepilogo del diagramma (usata sotto il titolo). */
export function describeWalk(view: CallGraphView): string {
  const others = view.nodes.length - 1
  const what = view.direction === 'callers' ? 'chiamanti' : 'routine chiamate'
  const parts = [`${others} ${what}`, `${view.maxLevel} livelli`]
  if (view.hasCycle) parts.push('cicli segnalati')
  if (view.depthLimited) parts.push('esplorazione fermata al limite di profondità')
  if (view.nodeLimited) parts.push('elenco troncato')
  return parts.join(' · ')
}
