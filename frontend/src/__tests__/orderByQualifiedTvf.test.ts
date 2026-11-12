// Alias di FUNZIONE TABELLARE nell'ORDER BY: "… ,t." deve proporre i campi restituiti dalla funzione.
//
// Segnalazione utente: "perché l'intellisense con questa funzione non torna niente? al punto ,t." —
// il ramo ORDER BY ritornava prima di considerare le colonne qualificate, quindi "t." restava vuoto.
import { describe, expect, it } from 'vitest'
import { buildQualifiedColumnSuggestions } from '../helpers'
import type { DatabaseSummary, FunctionInfo } from '../types'
import { mkCol } from './schema'

const fun: FunctionInfo = {
  schema: 'dbo',
  name: 'fn_Custom_PK_ReadyLine',
  type: 'SQL_TABLE_VALUED_FUNCTION',
  columns: [
    mkCol('X_ESE_ID', 'int'),
    mkCol('X_RIGA', 'int'),
    mkCol('X_READY', 'int'),
    mkCol('X_NOTE_STATUS', 'nvarchar'),
    mkCol('X_ORDINE', 'nvarchar'),
  ],
}

const tabella = {
  schema: 'dbo',
  name: 'DAT_ORDINI',
  columns: [mkCol('ORD_ORDINE', 'nvarchar'), mkCol('ORD_TIPOOP', 'varchar')],
}

const summary = {
  tables: [tabella],
  views: [],
  procedures: [],
  triggers: [],
  checkConstraints: [],
  functions: [fun],
  foreignKeys: [],
  databases: [],
  cooccurrences: [],
} as unknown as DatabaseSummary

const UTENTE = `SELECT TOP 1 *
INTO #tmpOrd
FROM @table
  left JOIN dbo.fn_Custom_PK_ReadyLine('') t on  t.X_ORDINE=ORD_ORDINE
ORDER BY iif (ORD_USER_POCKET = @USER, 0, 1)
         ,t.`

describe('ORDER BY con alias di funzione tabellare', () => {
  it('proporre i campi della funzione dopo ",t."', () => {
    const out = buildQualifiedColumnSuggestions(UTENTE, UTENTE, summary)
    expect(out.map(o => o.name)).toEqual([
      'X_ESE_ID',
      'X_RIGA',
      'X_READY',
      'X_NOTE_STATUS',
      'X_ORDINE',
    ])
  })

  it('vale anche per un alias di tabella nell ORDER BY', () => {
    const sql = 'SELECT TOP 1 * INTO #tmpOrd FROM DAT_ORDINI o ORDER BY o.'
    expect(buildQualifiedColumnSuggestions(sql, sql, summary).map(o => o.name)).toEqual([
      'ORD_ORDINE',
      'ORD_TIPOOP',
    ])
  })

  it('senza punto NON propone nulla (resta il ramo ORDER BY normale)', () => {
    const sql = 'SELECT TOP 1 * FROM DAT_ORDINI o ORDER BY '
    expect(buildQualifiedColumnSuggestions(sql, sql, summary)).toEqual([])
  })
})
