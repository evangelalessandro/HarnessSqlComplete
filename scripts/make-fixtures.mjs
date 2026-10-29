// GENERA I FIXTURE DEI TEST DA UN DATABASE PUBBLICO (AdventureWorks2019 / WideWorldImporters).
//
// Prima questi fixture erano estratti dal database di produzione dell'autore (nomi reali di clienti e
// procedure finivano su git). Ora si rigenerano da un database di esempio Microsoft: stesso realismo
// (definizioni vere, con commenti di testata, JOIN, CTE) e zero nomi riservati.
//
// Uso (backend attivo):
//   node scripts/make-fixtures.mjs                     # WideWorldImporters, 8 routine
//   node scripts/make-fixtures.mjs AdventureWorks2019 10
//   node scripts/make-fixtures.mjs WideWorldImporters 8 routine-call-graph
'use strict'

import { writeFileSync } from 'node:fs'

const api = process.env.SHOT_API ?? 'http://localhost:5213'
const database = process.argv[2] ?? 'WideWorldImporters'
const quante = Number(process.argv[3] ?? 8)
const cosa = process.argv[4] ?? 'definizioni'

const leggi = async (url, opzioni) => {
  const r = await fetch(url, opzioni)
  const testo = await r.text()
  if (!r.ok) throw new Error(`${url} → ${r.status} ${testo.slice(0, 200)}`)
  return testo ? JSON.parse(testo) : null
}

const logins = await leggi(`${api}/api/connections`)
const login = logins.find(l => (l.name || '').toLowerCase().includes('sql2019'))
if (!login) throw new Error('login salvata non trovata')
const conn = await leggi(`${api}/api/connections/saved/${login.id}/connect`, { method: 'POST' })
const attiva =
  conn.database === database
    ? conn.connectionId
    : (
        await leggi(`${api}/api/connections/${conn.connectionId}/switch-database`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ database }),
        })
      ).connectionId

const interroga = async sql => {
  const r = await leggi(`${api}/api/query/${attiva}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, timeoutSeconds: 120 }),
  })
  if (r.error) throw new Error(r.error)
  return r.resultSets?.[0]?.rows ?? []
}

if (cosa === 'summary') {
  // Sommario COMPLETO del database (tabelle, viste, procedure, funzioni, trigger, FK, co-occorrenze):
  // sostituisce il vecchio dump del database di produzione usato dai test sul "real schema".
  const s = await leggi(`${api}/api/metadata/${attiva}/summary?refresh=true`)
  const corpo = `// File GENERATO da scripts/make-fixtures.mjs — non modificare a mano.
// Schema di ${database} (database di esempio Microsoft): nomi pubblici, nessun riferimento al database
// di produzione dell'autore. Rigenera con:
//   node scripts/make-fixtures.mjs ${database} 0 summary
/* eslint-disable */
import type { DatabaseSummary } from '../../types'

export function realSummary(): DatabaseSummary {
  // il JSON arriva dal backend così com'è (campi opzionali compresi): il cast evita rumore di tipi
  return ${JSON.stringify(s)} as unknown as DatabaseSummary
}
`
  writeFileSync('frontend/src/__tests__/fixtures/demoStoreReal.ts', corpo)
  const kb = (Buffer.byteLength(corpo) / 1024).toFixed(0)
  console.log(`scritto demoStoreReal.ts: ${kb} KB · tabelle ${s.tables?.length} · viste ${s.views?.length} · proc ${s.procedures?.length} · FK ${s.foreignKeys?.length} da ${database}`)
  process.exit(0)
}
if (cosa === 'routine-call-graph') {
  const grafo = await leggi(`${api}/api/metadata/${attiva}/routine-call-graph`)
  const edges = grafo.edges ?? grafo.Edges ?? []
  const corpo = `// File GENERATO da scripts/make-fixtures.mjs — non modificare a mano.
// Legami di chiamata REALI presi da ${database} (database di esempio Microsoft): nomi pubblici.
/* eslint-disable */

/** Chi chiama chi, letto dalle dipendenze del database. */
export const realCallEdges = ${JSON.stringify(edges)} as {
  callerSchema: string
  callerName: string
  callerType: string
  calleeSchema: string
  calleeName: string
  calleeType: string
}[]
`
  writeFileSync('frontend/src/__tests__/fixtures/routineCallGraph.ts', corpo)
  console.log(`scritto routineCallGraph.ts con ${edges.length} legami da ${database}`)
  process.exit(0)
}

// definizioni: si prendono le procedure/viste/funzioni con intestazione di commento o corpo lungo
const righe = await interroga(`
  SELECT TOP (${quante}) s.name + '.' + o.name AS nome, m.definition
  FROM sys.sql_modules m
  INNER JOIN sys.objects o ON o.object_id = m.object_id
  INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
  WHERE o.is_ms_shipped = 0
    AND o.type IN ('P', 'V', 'FN', 'IF', 'TF', 'TR')
    AND LEN(m.definition) BETWEEN 400 AND 15000

  ORDER BY LEN(m.definition) DESC;`)

/**
 * Il test su queste definizioni controlla il caso "commento di testata + CREATE": i database di esempio
 * Microsoft NON hanno commenti sopra la CREATE, quindi il generatore ne aggiunge uno (dichiarato qui:
 * il CORPO è codice reale pubblico, l'intestazione è aggiunta da questo script). Se una definizione ha
 * già un commento in testa, si lascia il suo.
 */
const voci = righe.map(([nome, definizione]) => {
  const testo = String(definizione).replace(/^\s+/, '')
  const haCommento = /^(\/\/|--|\/\*)/.test(testo)
  const header = haCommento ? '' : `/* ${nome} — definizione di esempio da ${database} */\n`
  return { nome, definizione: header + testo }
})
const corpo = `// File GENERATO da scripts/make-fixtures.mjs — non modificare a mano.
// Definizioni REALI dal database ${database} (esempio Microsoft): nomi pubblici, nessun riferimento
// al database di produzione. Rigenera con:
//   node scripts/make-fixtures.mjs ${database} ${quante}
/* eslint-disable */

/** Estratti reali di definizioni: header + intestazione dell'istruzione. */
export const realDefinitions: { name: string; definition: string }[] = [
${voci
  .map(
    v => `  {
    name: ${JSON.stringify(v.nome)},
    definition: ${JSON.stringify(v.definizione)},
  },`,
  )
  .join('\n')}
]
`
writeFileSync('frontend/src/__tests__/fixtures/realDefinitions.ts', corpo)
const kb = (Buffer.byteLength(corpo) / 1024).toFixed(0)
console.log(`scritto realDefinitions.ts con ${voci.length} definizioni da ${database} (${kb} KB)`)
voci.forEach(v => console.log(`  ${v.nome} (${v.definizione.length} caratteri)`))
