// Genera il fixture con il grafo REALE delle chiamate fra routine (WSBRITVIC).
//
// Serve ai test che devono garantire che l'esplorazione del grafo (chi chiama chi, fino al
// chiamante più lontano) NON vada in loop infinito: nel database reale esistono routine
// che chiamano SE STESSE (procedure/funzioni ricorsive), quindi il caso non è teorico.
//
// Uso: node scripts/makeCallGraphFixture.mjs [idLogin] [database] [fileUscita]

import { writeFileSync } from 'node:fs'

const API = process.env.SQLINTELLI_API ?? 'http://localhost:5213'
const loginId = process.argv[2] ?? '3'
const database = process.argv[3] ?? 'WSBRITVIC'
const outFile = process.argv[4] ?? 'src/__tests__/fixtures/routineCallGraph.ts'

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

async function get(path) {
  const res = await fetch(`${API}${path}`)
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

const connected = await post(`/api/connections/saved/${loginId}/connect`)
const session = await post(`/api/connections/${connected.connectionId}/switch-database`, { database })
const graph = await get(`/api/metadata/${session.connectionId}/routine-call-graph`)

const edges = graph.edges.map(e => ({
  callerSchema: e.callerSchema,
  callerName: e.callerName,
  callerType: e.callerType.trim(),
  calleeSchema: e.calleeSchema,
  calleeName: e.calleeName,
  calleeType: e.calleeType.trim(),
}))

writeFileSync(
  outFile,
  `// File GENERATO da scripts/makeCallGraphFixture.mjs — non modificare a mano.
// Grafo reale delle chiamate fra routine dal database ${database}.
// Rigenera con: node scripts/makeCallGraphFixture.mjs ${loginId} ${database}
/* eslint-disable */
import type { RoutineCallEdge } from '../../types'

/** Legami diretti "chi chiama chi" letti dalle dipendenze reali di SQL Server. */
export const realCallEdges: RoutineCallEdge[] = ${JSON.stringify(edges)}

/** true se il backend ha troncato l'elenco (database molto grandi). */
export const realCallTruncated = ${graph.truncated ? 'true' : 'false'}
`,
  'utf8',
)

const selfLoops = edges.filter(e => e.callerName === e.calleeName && e.callerSchema === e.calleeSchema)
const hubs = new Map()
for (const e of edges) hubs.set(e.calleeName, (hubs.get(e.calleeName) ?? 0) + 1)
const top = [...hubs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)

console.log(`scritto ${outFile}`)
console.log(`legami=${edges.length} troncato=${graph.truncated}`)
console.log(`routine ricorsive (chiamano se stesse)=${selfLoops.length}: ${selfLoops.map(e => e.callerName).join(', ')}`)
console.log(`più chiamate: ${top.map(([n, c]) => `${n}(${c})`).join(', ')}`)
