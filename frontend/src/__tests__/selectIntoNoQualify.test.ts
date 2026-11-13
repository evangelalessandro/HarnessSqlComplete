// "SELECT … INTO #tmp" NON deve qualificare le colonne con la tabella di destinazione.
//
// Segnalazione utente: dopo "select * into #tmpEsequi from RUN_ESEGUI …", digitando "ese_udc" la
// completamento inseriva "[#tmpEsequi].ESE_UDC" — la temp è il BERSAGLIO della SELECT INTO, non una
// sorgente di colonne (e nello statement la tabella da cui leggere è RUN_ESEGUI).
import { describe, expect, it } from 'vitest'
import {
  extractStatementTableRefs,
  buildColumnContextSuggestions,
  buildSelectListSuggestions,
  buildQualifiedColumnSuggestions,
} from '../helpers'
import type { DatabaseSummary } from '../types'
import { mkCol } from './schema'

const RUN_ESEGUI = {
  schema: 'dbo',
  name: 'RUN_ESEGUI',
  columns: [mkCol('ESE_UDC', 'int'), mkCol('ESE_RIGA', 'int'), mkCol('ESE_CAUSMISS', 'varchar')],
}
const TMP = {
  schema: 'dbo',
  name: '#tmpEsequi',
  columns: [mkCol('ESE_UDC', 'int'), mkCol('ESE_RIGA', 'int'), mkCol('ESE_CAUSMISS', 'varchar')],
}
const DAT_ORDINI = {
  schema: 'dbo',
  name: 'DAT_ORDINI',
  columns: [mkCol('ORD_ORDINE', 'nvarchar'), mkCol('ESE_UDC', 'int')],
}

const summary = {
  tables: [RUN_ESEGUI, DAT_ORDINI, TMP],
  views: [],
  procedures: [],
  triggers: [],
  checkConstraints: [],
  functions: [],
  foreignKeys: [],
  databases: [],
  cooccurrences: [],
} as unknown as DatabaseSummary

const INTO = `select * 
into #tmpEsequi
from RUN_ESEGUI where ese_`

describe('SELECT … INTO: il bersaglio non qualifica le colonne', () => {
  it('i riferimenti distinguono INTO dalle sorgenti', () => {
    const refs = extractStatementTableRefs(INTO)
    expect(refs).toEqual([
      { tableName: '#tmpEsequi', alias: null, kind: 'into' },
      { tableName: 'RUN_ESEGUI', alias: null, kind: 'from' },
    ])
  })

  it('nella WHERE non propone "[#tmpEsequi].COLONNA"', () => {
    const out = buildColumnContextSuggestions(INTO, INTO, 'ese_', summary)
    const insert = out.map(o => o.insertText)
    expect(insert).toContain('ESE_UDC')
    expect(insert.some(x => /#tmpEsequi/i.test(x))).toBe(false)
  })

  it('nella select-list non propone "[#tmpEsequi].COLONNA"', () => {
    const sel = buildSelectListSuggestions(INTO, INTO, summary)
    const insert = sel.columns.map(c => c.insertText)
    expect(insert).toContain('ESE_UDC')
    expect(insert.some(x => /#tmpEsequi/i.test(x))).toBe(false)
  })

  it('con un JOIN verso la temp (sorgente vera) la qualifica invece è legittima', () => {
    const sql = `select *
into #tmpEsequi
from RUN_ESEGUI r
  inner join #tmpEsequi t on t.ESE_UDC = r.ESE_UDC
where ese_`
    const out = buildColumnContextSuggestions(sql, sql, 'ese_', summary)
    // quando la temp è davvero una SORGENTE (JOIN) la colonna è ambigua e viene qualificata
    // (con l'alias del primo proprietario: "r."): è corretto, serve a non ambigui
    expect(out.map(o => o.insertText).some(x => /\./.test(x))).toBe(true)
  })

  it('un alias di tabella nell INTO non diventa un alias di colonna', () => {
    const sql = `select * into #tmpEsequi from RUN_ESEGUI where ese_`
    const q = buildQualifiedColumnSuggestions(sql, sql, summary)
    expect(q).toEqual([])
  })
})
