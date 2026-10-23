// RICHIESTA UTENTE: "i join con l'icona del drago devono essere ordinati per frequenza di uso trovato
// nel database".
// La frequenza è quella REALE del database: quante volte la tabella compare in un JOIN del codice
// (procedure/viste/funzioni) insieme alle tabelle già nella query — backend: TableCooccurrence —
// con ripiego sulle dipendenze quando il contesto è vuoto.
import { describe, expect, it } from 'vitest'
import { buildJoinSuggestions, rankTablesForJoin } from '../helpers'
import type { ForeignKeyInfo, TableCooccurrence, TableInfo } from '../types'

const tabella = (name: string, dep = 0, fkOut = 0): TableInfo =>
  ({
    schema: 'dbo',
    name,
    columnCount: 3,
    columns: [],
    usage: { fkIncoming: 0, fkOutgoing: fkOut, dependencyCount: dep, rowCount: 0 },
  }) as unknown as TableInfo

const fk = (table: string, refTable: string): ForeignKeyInfo =>
  ({
    name: `FK_${table}_${refTable}`,
    schema: 'dbo',
    table,
    column: 'X_ID',
    refSchema: 'dbo',
    refTable,
    refColumn: 'ID',
  }) as unknown as ForeignKeyInfo

const co = (a: string, b: string, count: number): TableCooccurrence => ({ tableA: a, tableB: b, count })

describe('frequenza dei JOIN nel database', () => {
  it('conta i JOIN della tabella nel codice del database', () => {
    const tables = [tabella('DAT_UDC'), tabella('MAG_CELLE'), tabella('RUN_MISSIONI')]
    const cooccurrences = [co('DAT_UDC', 'MAG_CELLE', 40), co('MAG_CELLE', 'RUN_MISSIONI', 5)]
    const ranked = rankTablesForJoin(tables, [], ['DAT_UDC'], cooccurrences)
    const per = new Map(ranked.map(r => [r.table.name, r.frequenzaJoin]))
    console.log(`  frequenze: ${JSON.stringify([...per])}`)
    expect(per.get('MAG_CELLE')).toBe(45) // 40 join con DAT_UDC + 5 con RUN_MISSIONI
    expect(per.get('RUN_MISSIONI')).toBe(5)
  })

  it('senza contesto vale il totale dei JOIN della tabella', () => {
    const tables = [tabella('DAT_UDC'), tabella('MAG_CELLE')]
    const cooccurrences = [co('DAT_UDC', 'MAG_CELLE', 40), co('MAG_CELLE', 'ALTRA', 10)]
    const ranked = rankTablesForJoin(tables, [], [], cooccurrences)
    const per = new Map(ranked.map(r => [r.table.name, r.frequenzaJoin]))
    expect(per.get('MAG_CELLE')).toBe(50)
  })

  it('senza co-occorrenze ripiega sulle dipendenze del database', () => {
    const tables = [tabella('A_TAB', 7, 2)]
    const ranked = rankTablesForJoin(tables, [], ['CTX'], [])
    expect(ranked[0].frequenzaJoin).toBe(9)
  })

  it('le voci di JOIN portano la frequenza', () => {
    const tables = [tabella('DAT_ARTICOLI')]
    const fks = [fk('DAT_UDC', 'DAT_ARTICOLI')]
    const cooccurrences = [co('DAT_UDC', 'DAT_ARTICOLI', 12)]
    const ranked = rankTablesForJoin(tables, fks, ['DAT_UDC'], cooccurrences)
    const items = buildJoinSuggestions(ranked[0], [tabella('DAT_UDC')], true)
    items.forEach(i => console.log(`  ${i.label} → ${i.insertText} (freq ${i.frequenza})`))
    expect(items.length).toBeGreaterThan(0)
    expect(items.every(i => i.frequenza === 12)).toBe(true)
  })
})
