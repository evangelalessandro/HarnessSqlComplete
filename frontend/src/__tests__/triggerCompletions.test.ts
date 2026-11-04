// @vitest-environment jsdom
// TRIGGER: il provider vero (lo stesso che gira nell'app) dopo "inserted." e "deleted." deve proporre
// i CAMPI della tabella del trigger (segnalazione utente).
import { describe, expect, it } from 'vitest'
import * as monaco from 'monaco-editor'
import { provideSqlCompletions } from '../sqlCompletions'
import type { DatabaseSummary, TableInfo } from '../types'

function tabella(): TableInfo {
  const nomi: [string, string][] = [
    ['SalesOrderID', 'int'],
    ['OrderDate', 'datetime'],
    ['TotalDue', 'money'],
    ['CustomerID', 'int'],
  ]
  return {
    schema: 'Sales',
    name: 'SalesOrderHeader',
    columnCount: nomi.length,
    columns: nomi.map(([name, dataType]) => ({
      name,
      dataType,
      isNullable: false,
      isIdentity: name === 'SalesOrderID',
      isComputed: false,
      maxLength: 4,
    })),
    usage: null,
    extendedProperties: null,
    createDate: null,
  } as unknown as TableInfo
}

const summary = {
  tables: [tabella()],
  views: [],
  procedures: [],
  functions: [],
  triggers: [
    { schema: 'Sales', name: 'uSalesOrderHeader', tableName: 'SalesOrderHeader', definition: null },
  ],
  foreignKeys: [],
  databases: [],
  checkConstraints: [],
  cooccurrences: [],
} as unknown as DatabaseSummary

function suggest(sql: string, offset: number) {
  const model = monaco.editor.createModel(sql, 'sql')
  try {
    return provideSqlCompletions({
      model,
      position: model.getPositionAt(offset),
      state: { connectionId: 'test', summary, aiEnabled: false, onExecute: () => {} },
    })
  } finally {
    model.dispose()
  }
}

const TRIGGER = `CREATE OR ALTER TRIGGER Sales.uSalesOrderHeader
ON Sales.SalesOrderHeader
AFTER UPDATE
AS
BEGIN
  UPDATE h
  SET ModifiedDate = GETDATE()
  FROM Sales.SalesOrderHeader AS h
  INNER JOIN inserted AS i ON i.SalesOrderID = h.SalesOrderID
  WHERE `

describe('provider: campi di inserted/deleted dentro un trigger', () => {
  it('dopo "inserted." arrivano le colonne della tabella del trigger', () => {
    const testo = TRIGGER.replace('i.SalesOrderID = h.SalesOrderID', 'inserted.')
    const offset = testo.indexOf('inserted.') + 'inserted.'.length
    const esito = suggest(testo, offset)
    const etichette = esito.suggestions.map(s => String(s.label))
    console.log(`  inserted. -> ${JSON.stringify(etichette.slice(0, 8))}`)
    expect(etichette).toContain('SalesOrderID')
    expect(etichette).toContain('OrderDate')
    expect(esito.suggestions.some(s => String(s.detail ?? '').includes('inserted'))).toBe(true)
  })

  it('dopo "deleted." idem', () => {
    const testo = TRIGGER.replace('i.SalesOrderID = h.SalesOrderID', 'deleted.')
    const offset = testo.indexOf('deleted.') + 'deleted.'.length
    const etichette = suggest(testo, offset).suggestions.map(s => String(s.label))
    console.log(`  deleted. -> ${JSON.stringify(etichette.slice(0, 8))}`)
    expect(etichette).toContain('SalesOrderID')
  })

  it('dentro un trigger propone anche i nomi "inserted" e "deleted"', () => {
    const testo = TRIGGER.replace('INNER JOIN inserted AS i', 'INNER JOIN ')
    const offset = testo.indexOf('INNER JOIN ') + 'INNER JOIN '.length
    const etichette = suggest(testo, offset).suggestions.map(s => String(s.label))
    console.log(`  INNER JOIN -> ${JSON.stringify(etichette.slice(0, 10))}`)
    expect(etichette).toContain('inserted')
    expect(etichette).toContain('deleted')
  })

  it('fuori da un trigger "inserted." non propone la tabella logica', () => {
    const sql = 'SELECT * FROM Sales.SalesOrderHeader WHERE inserted.'
    const ris = suggest(sql, sql.length)
    // nessuna voce deve presentarsi come "tabella logica del trigger"
    expect(ris.suggestions.some(s => String(s.detail ?? '').startsWith('inserted ·'))).toBe(false)
  })
})
