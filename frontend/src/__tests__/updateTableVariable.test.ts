// Variabili tabella: "update @tab set " deve proporre le colonne.
//
// Segnalazione utente: "quando provo a fare l'update non mi suggerisce il nome delle colonne, vedi
// questa funzione" — la tabella di ritorno di una funzione multi-istruzione
// (RETURNS @tab TABLE (…)) non era fra le tabelle note.
import { describe, expect, it } from 'vitest'
import { extractLocalTables } from '../localTables'
import { extractStatementTableRefs, buildColumnContextSuggestions } from '../helpers'
import type { DatabaseSummary } from '../types'
import { mkCol } from './schema'

const summaryVuoto = {
  tables: [],
  views: [],
  procedures: [],
  triggers: [],
  checkConstraints: [],
  functions: [],
  foreignKeys: [],
  databases: [],
  cooccurrences: [],
} as unknown as DatabaseSummary

const FUNZIONE = `CREATE OR ALTER FUNCTION [dbo].[fn_Custom_PK_ReadyLine]
(
        @ordine NVARCHAR(50) = ''
)
RETURNS @tab TABLE (X_ESE_ID INT, X_RIGA INT, X_READY INT, X_NOTE_STATUS NVARCHAR(50), X_ORDINE NVARCHAR(50), X_TO_SWAP INT)
AS
BEGIN
  INSERT INTO @tab
  SELECT ESE_ID, RIG_RIGA, 0, 'nota', ORD_ORDINE, 0 FROM DAT_ORDINI

  update @tab
  set X_`

describe('RETURNS @tab TABLE (…): le colonne sono note', () => {
  it('la tabella di ritorno viene riconosciuta con le sue colonne', () => {
    const t = extractLocalTables(FUNZIONE, [])
    const tab = t.find(x => x.name === '@tab')
    expect(tab).toBeDefined()
    expect((tab!.columns ?? []).map(c => c.name)).toEqual([
      'X_ESE_ID',
      'X_RIGA',
      'X_READY',
      'X_NOTE_STATUS',
      'X_ORDINE',
      'X_TO_SWAP',
    ])
  })

  it('"update @tab set X_" propone le colonne della variabile tabella', () => {
    const tabelle = extractLocalTables(FUNZIONE, [])
    const s = { ...summaryVuoto, tables: tabelle } as DatabaseSummary
    const stmt = `update @tab\nset X_`
    expect(extractStatementTableRefs(stmt).map(r => r.tableName)).toEqual(['@tab'])
    const out = buildColumnContextSuggestions(stmt, stmt, 'X_', s)
    const nomi = out.map(o => o.name)
    expect(nomi).toContain('X_TO_SWAP')
    expect(nomi).toContain('X_NOTE_STATUS')
    // solo colonne che iniziano per X_ (il frammento digitato)
    expect(nomi.every(n => n.toLowerCase().startsWith('x_'))).toBe(true)
  })

  it('vale anche per DECLARE @t TABLE (…)', () => {
    const sql = `DECLARE @t TABLE (A INT, B NVARCHAR(10))\nupdate @t set `
    const tabelle = extractLocalTables(sql, [])
    const s = { ...summaryVuoto, tables: tabelle } as DatabaseSummary
    const out = buildColumnContextSuggestions(sql, sql, '', s)
    expect(out.map(o => o.name)).toEqual(['A', 'B'])
  })

  it('la colonna della variabile tabella ha il tipo dichiarato', () => {
    const t = extractLocalTables(FUNZIONE, [])
    const tab = t.find(x => x.name === '@tab')!
    const nota = (tab.columns ?? []).find(c => c.name === 'X_NOTE_STATUS')
    expect(nota).toBeDefined()
    expect((nota as unknown as { dataType: string }).dataType.toLowerCase()).toContain('nvarchar')
    expect(mkCol('X', 'int').dataType).toBe('int')
  })
})
