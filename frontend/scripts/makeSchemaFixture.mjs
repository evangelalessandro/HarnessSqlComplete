// Genera il fixture di test partendo dallo schema REALE letto dal backend.
//
// Perché serve: lo schema finto "a mano" (schema.ts) ha functions: [], mentre il DB
// reale ha centinaia di funzioni (scalari, tabellari e inline) e centinaia di trigger
// e vincoli CHECK. Testare solo contro lo schema finto significa non accorgersi mai se
// il codice si aspetta una forma diversa da quella che il backend spedisce davvero.
//
// Uso:
//   1) avvia il backend (dotnet run -c Release)
//   2) node scripts/makeSchemaFixture.mjs                     (usa id login salvato 3 + WSBRITVIC)
//      node scripts/makeSchemaFixture.mjs 3 WSBRITVIC out.ts (id login, database, file di uscita)
//
// Il risultato è un modulo TypeScript tipizzato, così i test importano dati veri
// senza dipendere da resolveJsonModule.

import { writeFileSync } from 'node:fs'

const API = process.env.SQLINTELLI_API ?? 'http://localhost:5213'
const loginId = process.argv[2] ?? '3'
const database = process.argv[3] ?? 'WSBRITVIC'
const outFile = process.argv[4] ?? 'src/__tests__/fixtures/wsbritvicReal.ts'

/** Tabelle di cui teniamo TUTTE le colonne (le altre restano con l'elenco vuoto). */
const TABLES_WITH_COLUMNS = [
  'RUN_MISSIONI',
  'DAT_UDC',
  'DAT_ARTICOLI',
  'DAT_CLIENTI',
  'CFG_BARCODE',
  'RUN_MISSIONI_RIGHE',
]
/** Procedure di cui teniamo i parametri (le altre solo nome). */
const PROCS_WITH_PARAMS = 20
/** Coppie di tabelle che compaiono insieme nei JOIN reali. */
const MAX_COOCCURRENCES = 80

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
const summary = await get(`/api/metadata/${session.connectionId}/summary`)

const keep = new Set(TABLES_WITH_COLUMNS.map(n => n.toUpperCase()))
const tables = summary.tables.map(t => ({
  schema: t.schema,
  name: t.name,
  columnCount: t.columnCount,
  createDate: null,
  columns: (t.columns ?? []).map(c => ({
    name: c.name,
    dataType: c.dataType,
    isNullable: c.isNullable,
    isIdentity: c.isIdentity,
    isComputed: c.isComputed,
    maxLength: c.maxLength,
    description: c.description ?? null,
    extendedProperties: c.extendedProperties ?? null,
  })).filter(() => keep.has(t.name.toUpperCase())),
  usage: null,
  extendedProperties: t.extendedProperties ?? null,
  indexes: null,
}))

const procedures = summary.procedures.map((p, i) => ({
  schema: p.schema,
  name: p.name,
  createDate: null,
  parameters: i < PROCS_WITH_PARAMS
    ? (p.parameters ?? []).map(q => ({
        name: q.name,
        dataType: q.dataType,
        mode: q.mode,
        defaultValue: q.defaultValue ?? null,
      }))
    : [],
}))

const fixture = {
  tables,
  views: summary.views.map(v => ({ schema: v.schema, name: v.name, createDate: null })),
  procedures,
  triggers: summary.triggers.map(t => ({ schema: t.schema, tableName: t.tableName, name: t.name })),
  checkConstraints: (summary.checkConstraints ?? []).map(c => ({
    schema: c.schema,
    tableName: c.tableName,
    name: c.name,
    definition: c.definition,
    isDisabled: c.isDisabled ?? false,
  })),
  functions: summary.functions.map(f => ({ schema: f.schema, name: f.name, type: f.type })),
  foreignKeys: summary.foreignKeys.map(f => ({
    name: f.name,
    schema: f.schema,
    table: f.table,
    column: f.column,
    refSchema: f.refSchema,
    refTable: f.refTable,
    refColumn: f.refColumn,
  })),
  databases: summary.databases.map(d => ({ name: d.name })),
  cooccurrences: (summary.cooccurrences ?? []).slice(0, MAX_COOCCURRENCES).map(c => ({
    tableA: c.tableA,
    tableB: c.tableB,
    count: c.count,
  })),
}

const banner = `// File GENERATO da scripts/makeSchemaFixture.mjs — non modificare a mano.
// Schema reale: login salvato ${loginId}, database ${database}.
// Rigenera con: node scripts/makeSchemaFixture.mjs ${loginId} ${database}
/* eslint-disable */
import type { DatabaseSummary } from '../../types'

export function realSummary(): DatabaseSummary {
  return ${JSON.stringify(fixture)}
}
`

writeFileSync(outFile, banner, 'utf8')

const byType = new Map()
for (const f of fixture.functions) byType.set(f.type, (byType.get(f.type) ?? 0) + 1)
console.log(`scritto ${outFile}`)
console.log(`tabelle=${fixture.tables.length} (con colonne: ${fixture.tables.filter(t => t.columns.length > 0).length})`)
console.log(`viste=${fixture.views.length} procedure=${fixture.procedures.length} trigger=${fixture.triggers.length}`)
console.log(`funzioni=${fixture.functions.length} ${JSON.stringify(Object.fromEntries(byType))}`)
console.log(`FK=${fixture.foreignKeys.length} check=${fixture.checkConstraints.length} cooccorrenze=${fixture.cooccurrences.length}`)
