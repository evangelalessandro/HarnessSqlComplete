// Diagramma delle chiamate fra routine: esplorazione del grafo e disposizione a livelli.
//
// Il punto critico è la PROTEZIONE DAI CICLI: nel database reale ci sono routine che
// chiamano se stesse e catene che si richiudono. Questi test usano sia grafi costruiti a
// mano (casi limite) sia il grafo VERO di WSBRITVIC (1696 legami, 4 routine ricorsive),
// e verificano che l'esplorazione termini sempre e non perda né duplichi nodi.
import { describe, expect, it } from 'vitest'
import {
  buildRoutineIndex,
  describeWalk,
  layoutCallGraph,
  routineId,
  routineKind,
  splitRoutineId,
  walkCallGraph,
} from '../callGraph'
import type { RoutineCallEdge } from '../types'
import { realCallEdges } from './fixtures/routineCallGraph'

/** Legame: A chiama B (tipi di default: procedure). */
function edge(a: string, b: string, typeA = 'P', typeB = 'P'): RoutineCallEdge {
  const [as, an] = a.split('.')
  const [bs, bn] = b.split('.')
  return {
    callerSchema: as,
    callerName: an,
    callerType: typeA,
    calleeSchema: bs,
    calleeName: bn,
    calleeType: typeB,
  }
}

const graphOf = (...edges: RoutineCallEdge[]) => buildRoutineIndex(edges)

/** Id dei nodi per livello, comodo per le asserzioni. */
function levelsOf(view: ReturnType<typeof walkCallGraph>): Record<number, string[]> {
  const out: Record<number, string[]> = {}
  for (const n of view.nodes) {
    out[n.level] = [...(out[n.level] ?? []), n.name]
  }
  for (const k of Object.keys(out)) out[Number(k)].sort()
  return out
}

/** Ordine di visita simulato: se ci fosse un ciclo infinito, questo non terminerebbe. */
function expandsWithin(index: ReturnType<typeof buildRoutineIndex>, target: string) {
  return walkCallGraph(index, { schema: target.split('.')[0], name: target.split('.')[1] }, 'callers', {
    maxDepth: 100,
    maxNodes: 100000,
  })
}

describe('routineKind / routineId', () => {
  it('riconosce i tipi di SQL Server (con spazio finale)', () => {
    expect(routineKind('P')).toBe('procedure')
    expect(routineKind('P ')).toBe('procedure')
    expect(routineKind('FN')).toBe('function')
    expect(routineKind('IF')).toBe('function')
    expect(routineKind('TF')).toBe('function')
    expect(routineKind('TR')).toBe('trigger')
    expect(routineKind('V')).toBe('view')
    expect(routineKind('X')).toBe('other')
    expect(routineKind(undefined)).toBe('other')
  })

  it('id e divisione dello schema', () => {
    expect(routineId('dbo', 'ws_X')).toBe('dbo.ws_x')
    expect(splitRoutineId('dbo.ws_x')).toEqual({ schema: 'dbo', name: 'ws_x' })
    expect(splitRoutineId('ws_x')).toEqual({ schema: '', name: 'ws_x' })
  })
})

describe('buildRoutineIndex', () => {
  it('costruisce chiamanti e chiamati, senza duplicati', () => {
    const idx = buildRoutineIndex([edge('dbo.A', 'dbo.B'), edge('dbo.A', 'dbo.B'), edge('dbo.C', 'dbo.B')])
    expect(idx.edgeCount).toBe(2)
    expect(idx.callersOf.get('dbo.b')).toEqual(['dbo.a', 'dbo.c'])
    expect(idx.calleesOf.get('dbo.a')).toEqual(['dbo.b'])
    expect(idx.types.get('dbo.b')).toBe('P')
  })

  it('accetta sia il grafo completo sia l elenco di legami, e regge i valori mancanti', () => {
    expect(buildRoutineIndex({ edges: [edge('dbo.A', 'dbo.B')], truncated: false }).edgeCount).toBe(1)
    expect(buildRoutineIndex(null).edgeCount).toBe(0)
    expect(buildRoutineIndex(undefined).edgeCount).toBe(0)
    expect(buildRoutineIndex([]).edgeCount).toBe(0)
  })

  it('conserva il tipo corretto di funzioni e trigger', () => {
    const idx = buildRoutineIndex([edge('dbo.TR_X', 'dbo.P_Y', 'TR', 'P'), edge('dbo.P_Y', 'dbo.F_Z', 'P', 'FN')])
    expect(idx.types.get('dbo.tr_x')).toBe('TR')
    expect(idx.types.get('dbo.f_z')).toBe('FN')
  })
})

describe('esplorazione verso i chiamanti (chi la chiama)', () => {
  it('catena lineare: livelli progressivi fino al chiamante più lontano', () => {
    // RADICE → MEDIA → FOGLIA (foglia = routine analizzata)
    const idx = graphOf(edge('dbo.RADICE', 'dbo.MEDIA'), edge('dbo.MEDIA', 'dbo.FOGLIA'))
    const view = walkCallGraph(idx, { schema: 'dbo', name: 'FOGLIA' }, 'callers')
    expect(levelsOf(view)).toEqual({ 0: ['FOGLIA'], 1: ['MEDIA'], 2: ['RADICE'] })
    expect(view.maxLevel).toBe(2)
    expect(view.depthLimited).toBe(false)
    expect(view.hasCycle).toBe(false)
    expect(view.nodes[0].isTarget).toBe(true)
  })

  it('due rami che convergono NON sono un ciclo', () => {
    // COMUNE → A → FOGLIA, COMUNE → B → FOGLIA (A e B sono entrambi chiamanti diretti)
    const idx = graphOf(edge('dbo.COMUNE', 'dbo.A'), edge('dbo.COMUNE', 'dbo.B'), edge('dbo.A', 'dbo.FOGLIA'), edge('dbo.B', 'dbo.FOGLIA'))
    const view = walkCallGraph(idx, { schema: 'dbo', name: 'FOGLIA' }, 'callers')
    expect(levelsOf(view)).toEqual({ 0: ['FOGLIA'], 1: ['A', 'B'], 2: ['COMUNE'] })
    expect(view.hasCycle).toBe(false)
    expect(view.nodes.every(n => !n.inCycle)).toBe(true)
  })

  it('senza chiamanti resta solo la routine analizzata', () => {
    const idx = graphOf(edge('dbo.A', 'dbo.B'))
    const view = walkCallGraph(idx, { schema: 'dbo', name: 'A' }, 'callers')
    expect(view.nodes.map(n => n.name)).toEqual(['A'])
    expect(view.links).toEqual([])
    expect(describeWalk(view)).toContain('0 chiamanti')
  })

  it('routine inesistente nel grafo: nessun crash', () => {
    const view = walkCallGraph(graphOf(edge('dbo.A', 'dbo.B')), { schema: 'dbo', name: 'MAI_VISTA' }, 'callers')
    expect(view.nodes).toHaveLength(1)
    expect(view.nodes[0].kind).toBe('other')
    expect(view.nodes[0].callerCount).toBe(0)
  })
})

describe('PROTEZIONE DAI CICLI (loop infiniti)', () => {
  it('routine che chiama SE STESSA: termina e segnala il ciclo', () => {
    // caso reale: dbo.fn_tabUdcFront chiama se stessa
    const idx = graphOf(edge('dbo.RICORSIVA', 'dbo.RICORSIVA', 'FN', 'FN'))
    const view = expandsWithin(idx, 'dbo.RICORSIVA')
    expect(view.nodes).toHaveLength(1)
    expect(view.links).toHaveLength(1)
    expect(view.links[0]).toMatchObject({ isCycle: true })
    expect(view.links[0].from).toBe(view.links[0].to)
    expect(view.hasCycle).toBe(true)
    expect(view.nodes[0].inCycle).toBe(true)
    expect(describeWalk(view)).toContain('cicli segnalati')
  })

  it('ciclo a due (A chiama B, B chiama A): termina', () => {
    const idx = graphOf(edge('dbo.A', 'dbo.B'), edge('dbo.B', 'dbo.A'))
    const view = expandsWithin(idx, 'dbo.A')
    expect(levelsOf(view)).toEqual({ 0: ['A'], 1: ['B'] })
    // le frecce seguono la chiamata: A→B chiude il ciclo, B→A è il legame normale
    expect(view.links.find(l => l.from === 'dbo.a' && l.to === 'dbo.b')?.isCycle).toBe(true)
    expect(view.links.find(l => l.from === 'dbo.b' && l.to === 'dbo.a')?.isCycle).toBe(false)
  })

  it('ciclo lungo (A→B→C→A): termina e segnala', () => {
    const idx = graphOf(edge('dbo.A', 'dbo.B'), edge('dbo.B', 'dbo.C'), edge('dbo.C', 'dbo.A'))
    const view = expandsWithin(idx, 'dbo.A')
    expect(view.nodes.map(n => n.name).sort()).toEqual(['A', 'B', 'C'])
    expect(view.links.filter(l => l.isCycle)).toHaveLength(1)
    // il legame che si richiude è A→B (A è chiamata da C, che è chiamata da B)
    expect(view.links.find(l => l.isCycle)).toMatchObject({ from: 'dbo.a', to: 'dbo.b' })
  })

  it('doppia ricorsione incrociata: nessun nodo duplicato, nessuna espansione ripetuta', () => {
    const idx = graphOf(
      edge('dbo.A', 'dbo.B'),
      edge('dbo.B', 'dbo.A'),
      edge('dbo.A', 'dbo.A'),
      edge('dbo.B', 'dbo.B'),
    )
    const view = expandsWithin(idx, 'dbo.A')
    expect(view.nodes).toHaveLength(2)
    expect(new Set(view.nodes.map(n => n.id)).size).toBe(2)
    // A>B, B>A, A>A, B>B: tutti presenti una volta sola
    expect(view.links).toHaveLength(4)
    expect(view.links.filter(l => l.isCycle)).toHaveLength(3)
  })

  it('grafo completamente ciclico (anello di 6): termina in pochi passi', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F']
    const edges = names.map((n, i) => edge(`dbo.${n}`, `dbo.${names[(i + 1) % names.length]}`))
    const idx = graphOf(...edges)
    const view = expandsWithin(idx, 'dbo.A')
    expect(view.nodes).toHaveLength(6)
    expect(view.links.filter(l => l.isCycle)).toHaveLength(1)
    expect(Math.max(...view.nodes.map(n => n.level))).toBe(5)
  })

  it('molti legami ripetuti sullo stesso nodo non gonfiano il grafo', () => {
    const many = Array.from({ length: 50 }, () => edge('dbo.A', 'dbo.B'))
    const view = walkCallGraph(graphOf(...many), { schema: 'dbo', name: 'B' }, 'callers')
    expect(view.nodes).toHaveLength(2)
    expect(view.links).toHaveLength(1)
  })
})

describe('limiti di esplorazione', () => {
  const chain = (n: number) => Array.from({ length: n }, (_, i) => edge(`dbo.L${i}`, `dbo.L${i + 1}`))

  it('il limite di profondità ferma l esplorazione e lo segnala', () => {
    const idx = graphOf(...chain(10))
    const view = walkCallGraph(idx, { schema: 'dbo', name: 'L10' }, 'callers', { maxDepth: 3 })
    expect(view.maxLevel).toBe(3)
    expect(view.nodes).toHaveLength(4)
    expect(view.depthLimited).toBe(true)
    expect(describeWalk(view)).toContain('limite di profondità')
  })

  it('profondità 0 = solo la routine analizzata', () => {
    const view = walkCallGraph(graphOf(...chain(3)), { schema: 'dbo', name: 'L3' }, 'callers', { maxDepth: 0 })
    expect(view.nodes.map(n => n.name)).toEqual(['L3'])
    expect(view.depthLimited).toBe(true)
  })

  it('il limite di nodi tronca l elenco e lo segnala', () => {
    const fan = Array.from({ length: 30 }, (_, i) => edge(`dbo.C${i}`, 'dbo.TARGET'))
    const view = walkCallGraph(graphOf(...fan), { schema: 'dbo', name: 'TARGET' }, 'callers', { maxNodes: 5 })
    expect(view.nodes).toHaveLength(5)
    expect(view.nodeLimited).toBe(true)
    expect(describeWalk(view)).toContain('troncato')
  })
})

describe('esplorazione verso il basso (cosa chiama)', () => {
  it('elenca le routine chiamate, sempre senza cicli infiniti', () => {
    const idx = graphOf(edge('dbo.A', 'dbo.B'), edge('dbo.B', 'dbo.C'), edge('dbo.C', 'dbo.A'))
    const view = walkCallGraph(idx, { schema: 'dbo', name: 'A' }, 'callees')
    expect(levelsOf(view)).toEqual({ 0: ['A'], 1: ['B'], 2: ['C'] })
    expect(view.direction).toBe('callees')
    expect(view.hasCycle).toBe(true)
    expect(describeWalk(view)).toContain('routine chiamate')
  })
})

describe('disposizione a livelli', () => {
  it('una riga per livello, senza sovrapposizioni nella stessa riga', () => {
    const idx = graphOf(
      edge('dbo.R1', 'dbo.M'),
      edge('dbo.R2', 'dbo.M'),
      edge('dbo.M', 'dbo.F'),
      edge('dbo.R3', 'dbo.F'),
    )
    const view = walkCallGraph(idx, { schema: 'dbo', name: 'F' }, 'callers')
    const layout = layoutCallGraph(view)
    expect(layout.rows).toBe(view.maxLevel + 1)
    const byRow = new Map<number, { x: number; width: number }[]>()
    for (const n of layout.nodes) byRow.set(n.y, [...(byRow.get(n.y) ?? []), n])
    for (const [y, row] of byRow) {
      const sorted = [...row].sort((a, b) => a.x - b.x)
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].x, `sovrapposizione alla riga ${y}`).toBeGreaterThanOrEqual(
          sorted[i - 1].x + sorted[i - 1].width,
        )
      }
    }
  })

  it('con i chiamanti l oggetto analizzato sta in BASSO, con i chiamati in ALTO', () => {
    const idx = graphOf(edge('dbo.RADICE', 'dbo.FOGLIA'))
    const su = layoutCallGraph(walkCallGraph(idx, { schema: 'dbo', name: 'FOGLIA' }, 'callers'))
    const target = su.nodes.find(n => n.name === 'FOGLIA')!
    const root = su.nodes.find(n => n.name === 'RADICE')!
    expect(target.y).toBeGreaterThan(root.y)
    const giu = layoutCallGraph(walkCallGraph(idx, { schema: 'dbo', name: 'RADICE' }, 'callees'))
    expect(giu.nodes.find(n => n.name === 'RADICE')!.y).toBeLessThan(giu.nodes.find(n => n.name === 'FOGLIA')!.y)
  })

  it('i nodi collegati vengono accostati (meno incroci)', () => {
    // i due chiamanti di M devono finire vicini tra loro nella loro riga
    const idx = graphOf(
      edge('dbo.Z1', 'dbo.M'),
      edge('dbo.Z2', 'dbo.M'),
      edge('dbo.A1', 'dbo.ALTRO'),
      edge('dbo.A2', 'dbo.ALTRO'),
      edge('dbo.ALTRO', 'dbo.F'),
      edge('dbo.M', 'dbo.F'),
    )
    const layout = layoutCallGraph(walkCallGraph(idx, { schema: 'dbo', name: 'F' }, 'callers'))
    const row = layout.nodes.filter(n => n.y === layout.nodes.find(x => x.name === 'Z1')!.y).map(n => n.name)
    const i1 = row.indexOf('Z1')
    const i2 = row.indexOf('Z2')
    expect(Math.abs(i1 - i2)).toBe(row.length - 1 === 0 ? 0 : 1) // adiacenti nella stessa riga
  })

  it('dimensioni coerenti e disposizione deterministica', () => {
    const idx = buildRoutineIndex(realCallEdges.slice(0, 200))
    const view = walkCallGraph(idx, { schema: 'dbo', name: 'RUN_MISSIONI' }, 'callers', { maxDepth: 3 })
    const a = layoutCallGraph(view)
    const b = layoutCallGraph(view)
    expect(a.width).toBeGreaterThan(0)
    expect(a.height).toBeGreaterThan(0)
    expect(a.nodes.map(n => `${n.id}@${n.x},${n.y}`)).toEqual(b.nodes.map(n => `${n.id}@${n.x},${n.y}`))
    for (const n of a.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.y).toBeGreaterThanOrEqual(0)
      expect(n.x + n.width).toBeLessThanOrEqual(a.width)
      expect(n.y + n.height).toBeLessThanOrEqual(a.height)
    }
  })
})

describe('GRAFO REALE di WSBRITVIC (1696 legami)', () => {
  const index = buildRoutineIndex(realCallEdges)

  it('il fixture è completo e contiene le routine ricorsive reali', () => {
    expect(realCallEdges.length).toBeGreaterThan(1500)
    expect(index.edgeCount).toBe(realCallEdges.length)
    const selfLoops = realCallEdges.filter(e => e.callerName === e.calleeName && e.callerSchema === e.calleeSchema)
    expect(selfLoops.length).toBeGreaterThan(0)
    expect(selfLoops.map(e => e.callerName)).toContain('fn_tabUdcFront')
  })

  it('salendo dai chiamanti di una funzione molto usata si termina in fretta', () => {
    const started = Date.now()
    const view = walkCallGraph(index, { schema: 'dbo', name: 'fn_InsFromString' }, 'callers', {
      maxDepth: 6,
      maxNodes: 140,
    })
    expect(Date.now() - started).toBeLessThan(2000)
    expect(view.nodes.length).toBeGreaterThan(1)
    // nessun nodo duplicato e livelli coerenti
    expect(new Set(view.nodes.map(n => n.id)).size).toBe(view.nodes.length)
    for (const l of view.links) {
      expect(view.nodes.some(n => n.id === l.from)).toBe(true)
      expect(view.nodes.some(n => n.id === l.to)).toBe(true)
    }
  })

  it('ogni routine del DB, come punto di partenza, termina (nessun loop infinito)', () => {
    // prova esaustiva: si parte da OGNI chiamante reale e si sale senza limiti di profondità
    const starts = [...new Set(realCallEdges.map(e => routineId(e.calleeSchema, e.calleeName)))]
    expect(starts.length).toBeGreaterThan(200)
    for (const id of starts) {
      const { schema, name } = splitRoutineId(id)
      const view = walkCallGraph(index, { schema, name }, 'callers', { maxDepth: 50, maxNodes: 100000 })
      expect(view.nodes.length, `esplosione su ${id}`).toBeLessThan(900)
      expect(new Set(view.nodes.map(n => n.id)).size).toBe(view.nodes.length)
    }
  })

  it('anche scendendo (cosa chiama) si termina su tutte le routine', () => {
    const starts = [...new Set(realCallEdges.map(e => routineId(e.callerSchema, e.callerName)))]
    for (const id of starts) {
      const { schema, name } = splitRoutineId(id)
      const view = walkCallGraph(index, { schema, name }, 'callees', { maxDepth: 50, maxNodes: 100000 })
      expect(new Set(view.nodes.map(n => n.id)).size, `duplicati su ${id}`).toBe(view.nodes.length)
    }
  })

  it('la routine ricorsiva reale fn_tabUdcFront si esplora senza blocchi', () => {
    const view = walkCallGraph(index, { schema: 'dbo', name: 'fn_tabUdcFront' }, 'callers', {
      maxDepth: 6,
      maxNodes: 140,
    })
    expect(view.nodes.length).toBeGreaterThan(0)
    expect(view.nodes.map(n => n.name)).toContain('fn_tabUdcFront')
  })
})
