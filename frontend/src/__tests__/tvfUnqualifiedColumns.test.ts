// Con una FUNZIONE TABELLARE con alias, anche le colonne NON qualificate devono essere proposte:
// nella SELECT, dentro count(…) e nella WHERE.
//
// Segnalazione utente: "perché nella select o where devo usare l'alias della funzione e non mi torna i
// nomi colonna? Vedi quello dentro la count o la join che senza tt non torna x_ordine".
import { describe, expect, it } from 'vitest'
import { buildColumnContextSuggestions, buildSelectListSuggestions } from '../helpers'
import type { DatabaseSummary, FunctionInfo } from '../types'
import { mkCol } from './schema'

const fn: FunctionInfo = {
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

const ordini = {
  schema: 'dbo',
  name: 'DAT_ORDINI',
  columns: [mkCol('ORD_ORDINE', 'nvarchar'), mkCol('ORD_DES', 'nvarchar')],
}

const summary = {
  tables: [ordini],
  views: [],
  procedures: [],
  triggers: [],
  checkConstraints: [],
  functions: [fn],
  foreignKeys: [],
  databases: [],
  cooccurrences: [],
} as unknown as DatabaseSummary

describe('funzione tabellare: colonne anche senza alias', () => {
  it('nella SELECT propone i campi della funzione', () => {
    const sql = `select X_ORDINE, ORD_DES + '' + count(x_ready)
from dbo.fn_Custom_PK_ReadyLine('') tt
  inner join DAT_ORDINI on ORD_ORDINE = tt.X_ORDINE
group by X_ORDINE`
    const sel = buildSelectListSuggestions(sql, 'select x_', summary)
    const nomi = sel.columns.map(c => c.name.toLowerCase())
    expect(nomi).toContain('x_ordine')
    expect(nomi).toContain('x_ready')
  })

  it('nella WHERE propone i campi della funzione con il loro tipo', () => {
    const sql = `select count(X_READY)
from dbo.fn_Custom_PK_ReadyLine('') tt
  inner join DAT_ORDINI on ORD_ORDINE = tt.X_ORDINE
where x_`
    const out = buildColumnContextSuggestions(sql, sql, 'x_', summary)
    const nomi = out.map(o => o.name.toLowerCase())
    expect(nomi).toContain('x_ready')
    expect(nomi).toContain('x_ordine')
    // X_ORDINE esiste sia nella funzione sia (come ORD_ORDINE) in DAT_ORDINI: qui è solo la funzione
    expect(nomi).not.toContain('ord_ordine')
  })

  it('i campi della funzione sono condivisi solo se due sorgenti li hanno davvero', () => {
    const sql = `select *
from dbo.fn_Custom_PK_ReadyLine('') tt
where x_r`
    const out = buildColumnContextSuggestions(sql, sql, 'x_r', summary)
    const ready = out.find(o => o.name.toLowerCase() === 'x_ready')
    expect(ready).toBeDefined()
    // colonna presente SOLO nella funzione → nessun qualificatore "tt." nell'insert
    expect(ready!.insertText.toLowerCase()).toBe('x_ready')
  })

  it('con "tt." continua a funzionare (colonne qualificate)', () => {
    const sql = `select *
from dbo.fn_Custom_PK_ReadyLine('') tt
where tt.`
    const out = buildColumnContextSuggestions(sql, sql, 'tt.', summary)
    expect(out.map(o => o.name.toLowerCase())).toEqual([])
  })
})
