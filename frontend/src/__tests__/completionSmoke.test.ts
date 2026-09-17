// @vitest-environment jsdom
// SMOKE TEST dell'intellisense: esegue DAVVERO il provider di completamento (lo stesso
// codice che gira nell'app) su un modello Monaco reale, in molti contesti e in OGNI
// posizione di alcune query. Fallisce se il provider lancia un'eccezione (era il caso
// del ReferenceError che spegneva l'intellisense) o se non propone nulla nel codice.
import { describe, expect, it } from 'vitest'
import * as monaco from 'monaco-editor'
import { provideSqlCompletions } from '../sqlCompletions'
import type { DatabaseSummary } from '../types'
import { mkCol, mkTbl, demoStoreLikeSummary } from './schema'
import { inCommentOrString } from './sqlText'

function summaryWith(): DatabaseSummary {
  const s = demoStoreLikeSummary()
  s.tables.push(
    mkTbl('dbo', 'MAG_CORRIDOI', [
      mkCol('COR_CORRIDOIO', 'int'),
      mkCol('COR_AREA', 'nvarchar'),
      mkCol('COR_ABIPREN', 'bit'),
    ]),
    mkTbl('dbo', 'RUN_ESEGUI', [mkCol('ESE_UDC', 'int'), mkCol('ESE_QTAR', 'decimal'), mkCol('ESE_RIGA', 'int')]),
  )
  // funzioni come le manda il BACKEND (type_desc): una tabellare e una scalare
  s.functions.push(
    { schema: 'dbo', name: 'fn_GIPAVUDUBES', type: 'SQL_INLINE_TABLE_VALUED_FUNCTION' },
    { schema: 'dbo', name: 'fn_CUVAD', type: 'SQL_TABLE_VALUED_FUNCTION' },
    { schema: 'dbo', name: 'fn_tu', type: 'SQL_SCALAR_FUNCTION' },
  )
  return s
}

const summary = summaryWith()

/** Esegue il provider alla posizione indicata (come fa Monaco nell'editor). */
function suggest(sql: string, offset: number, sum: DatabaseSummary | null = summary) {
  const model = monaco.editor.createModel(sql, 'sql')
  try {
    const position = model.getPositionAt(offset)
    return provideSqlCompletions({
      model,
      position,
      state: { connectionId: 'test', summary: sum, aiEnabled: true, onExecute: () => {} },
    })
  } finally {
    model.dispose()
  }
}

const QUERIES = [
  'SELECT * FROM dbo.RUN_MISSIONI',
  'SELECT MIS_UDC, UDC_UDC FROM dbo.RUN_MISSIONI JOIN dbo.DAT_UDC ON MIS_UDC = UDC_UDC WHERE ',
  'UPDATE dbo.RUN_MISSIONI SET MIS_MISSIONE = 1 WHERE MIS_UDC = ',
  'INSERT INTO dbo.RUN_MISSIONI (MIS_UDC, MIS_MISSIONE) VALUES (',
  'SELECT MIS_UDC FROM dbo.RUN_MISSIONI ORDER BY MIS_UDC ',
  'EXEC dbo.',
  '-- commento\nSELECT * FROM dbo.RUN_MISSIONI',
  'CREATE TABLE #t (X_SSCC NVARCHAR(50), X_SKU NVARCHAR(50))\nSELECT X_SSCC FROM #t WHERE ',
  'select MFC_BLOCK, COR_CORRIDOIO into #TBL from MAG_CORRIDOI\nselect * from #TBL a inner join mag_corridoi b on a.COR_CORRIDOIO = b.COR_CORRIDOIO where ',
]

describe('intellisense: il provider NON si spacca (smoke test)', () => {
  it('non lancia eccezioni e propone almeno una voce in ogni posizione di codice', () => {
    for (const sql of QUERIES) {
      for (let offset = 0; offset <= sql.length; offset++) {
        if (inCommentOrString(sql, offset)) continue
        const where = `\n--- "${sql.slice(0, 40)}…" offset ${offset} ---`
        let res: monaco.languages.CompletionList
        expect(() => {
          res = suggest(sql, offset)
        }, `il provider ha lanciato un'eccezione${where}`).not.toThrow()
        expect(res!.suggestions.length, `nessun suggerimento nel codice${where}`).toBeGreaterThan(0)
      }
    }
  })

  it('dopo "FROM run" propone RUN_MISSIONI', () => {
    const sql = 'SELECT *\nFROM run'
    const res = suggest(sql, sql.length)
    expect(res.suggestions.some(s => String(s.filterText ?? s.label).toLowerCase().startsWith('run'))).toBe(true)
  })

  it('nella WHERE propone le colonne delle tabelle dello statement', () => {
    const sql = 'SELECT * FROM dbo.RUN_MISSIONI WHERE '
    const res = suggest(sql, sql.length)
    expect(res.suggestions.some(s => s.label === 'MIS_UDC')).toBe(true)
  })

  it('nella ORDER BY propone ASC e DESC e nessuna tabella/procedura', () => {
    const sql = 'SELECT MIS_UDC FROM dbo.RUN_MISSIONI ORDER BY MIS_UDC '
    const res = suggest(sql, sql.length)
    const labels = res.suggestions.map(s => String(s.label))
    expect(labels).toContain('ASC')
    expect(labels).toContain('DESC')
    // nessuna procedura/tabella fra i suggerimenti della ORDER BY
    for (const s of res.suggestions) {
      expect(s.kind).not.toBe(monaco.languages.CompletionItemKind.Function)
      expect(s.kind).not.toBe(monaco.languages.CompletionItemKind.Struct)
    }
  })

  it('subito dopo "ORDER BY " NON propone ASC/DESC (prima si sceglie il campo)', () => {
    const sql = 'SELECT MIS_UDC FROM dbo.RUN_MISSIONI ORDER BY '
    const res = suggest(sql, sql.length)
    const labels = res.suggestions.map(s => String(s.label))
    expect(labels).not.toContain('ASC')
    expect(labels).not.toContain('DESC')
    // le colonne invece ci sono
    expect(labels).toContain('MIS_UDC')
  })

  it('dopo la virgola nella ORDER BY le direzioni tornano solo con un altro campo', () => {
    const sql = 'SELECT MIS_UDC FROM dbo.RUN_MISSIONI ORDER BY MIS_UDC, '
    const res = suggest(sql, sql.length)
    const labels = res.suggestions.map(s => String(s.label))
    expect(labels).not.toContain('ASC')
    expect(labels).not.toContain('DESC')
  })

  it('dopo EXEC propone le stored procedure', () => {
    const sql = 'EXEC dbo.'
    const res = suggest(sql, sql.length)
    expect(res.suggestions.length).toBeGreaterThan(0)
  })

  it('dopo "inner join " propone anche le FUNZIONI TABELLARI (e non quelle scalari)', () => {
    // caso utente: SELECT … FROM dbo.RUN_MISSIONI inner join ▮
    const sql = 'SELECT MIS_UDC, MIS_OPERATORE FROM dbo.RUN_MISSIONI inner join '
    const res = suggest(sql, sql.length)
    const labels = res.suggestions.map(s => String(s.label))
    expect(labels).toContain('dbo.fn_GIPAVUDUBES')
    expect(labels).toContain('dbo.fn_CUVAD')
    // la funzione SCALARE non è una sorgente → non va proposta dopo JOIN
    expect(labels).not.toContain('dbo.fn_tu')
    // e restano proposte le tabelle
    expect(labels.some(l => l.includes('RUN_MISSIONI'))).toBe(true)
  })

  it('dopo "FROM " propone le funzioni tabellari come sorgenti', () => {
    const sql = 'SELECT * FROM '
    const labels = suggest(sql, sql.length).suggestions.map(s => String(s.label))
    expect(labels).toContain('dbo.fn_GIPAVUDUBES')
    expect(labels).not.toContain('dbo.fn_tu')
  })

  it('con il testo della procedura utente (CASE + temporanee + JOIN) propone le colonne', () => {
    const sql = `CREATE TABLE #tbl_InventoryKitting_St1 (X_SSCC NVARCHAR(50), X_SKU NVARCHAR(50), X_MODULO NVARCHAR(50))
INSERT INTO #tbl_InventoryKitting_St1 (X_SSCC) VALUES (1)
SELECT @txtError = CASE WHEN ISNULL(@ssccLu, '') = '' THEN 'x' ELSE '' END, @modulo = X_MODULO
FROM (SELECT 1 TT) a
  LEFT JOIN #tbl_InventoryKitting_St1 b ON 1 = 1
WHERE `
    const res = suggest(sql, sql.length)
    const labels = res.suggestions.map(s => String(s.label))
    expect(labels).toContain('X_SSCC')
    expect(labels.length).toBeGreaterThan(0)
  })

  it('senza schema (sessione scaduta) propone comunque qualcosa, mai il vuoto', () => {
    const sql = 'SELECT * FROM '
    const res = suggest(sql, sql.length, null)
    expect(res.suggestions.length).toBeGreaterThan(0)
  })

  it('dentro un commento non propone nulla (e non lancia)', () => {
    const sql = 'SELECT 1 -- commento qui'
    const res = suggest(sql, sql.length)
    expect(res.suggestions.length).toBe(0)
  })
})
