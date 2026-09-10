import { describe, expect, it } from 'vitest'
import { identifierPartsAt, resolveCallableAt } from '../callables'
import type { DatabaseSummary } from '../types'
import { wsbritvicLikeSummary } from './schema'

function summaryWithFunction(): DatabaseSummary {
  const s = wsbritvicLikeSummary()
  s.functions.push({ schema: 'dbo', name: 'fn_td', type: 'FN' }, { schema: 'dbo', name: 'fn_GetMissioni', type: 'IF' })
  return s
}

const summary = summaryWithFunction()

describe('identifierPartsAt: identificatore (anche qualificato) sotto il cursore', () => {
  it('nome semplice e qualificato', () => {
    const sql = 'EXEC dbo.ws_X @a = 1'
    expect(identifierPartsAt(sql, sql.indexOf('ws_X') + 2)).toEqual(['dbo', 'ws_X'])
    expect(identifierPartsAt(sql, sql.indexOf('@a'))).toEqual(['@a'])
  })

  it('nome tra parentesi quadre', () => {
    const sql = 'EXEC [dbo].[ws_L2_Prova] @a = 1'
    expect(identifierPartsAt(sql, sql.indexOf('ws_L2_Prova'))).toEqual(['dbo', 'ws_L2_Prova'])
  })

  it('cursore subito DOPO il nome → lo prende comunque', () => {
    const sql = 'EXEC dbo.ws_X'
    expect(identifierPartsAt(sql, sql.length)).toEqual(['dbo', 'ws_X'])
  })

  it('fuori da un identificatore → nessuna parte', () => {
    expect(identifierPartsAt('EXEC   ', 6)).toEqual([])
    expect(identifierPartsAt('', 0)).toEqual([])
  })
})

describe('resolveCallableAt: procedure e funzioni richiamate', () => {
  it('chiamata EXEC a una stored procedure (nome semplice e qualificato)', () => {
    const sql = 'EXEC zzz_test_proc @id = 1, @nome = 2'
    expect(resolveCallableAt(sql, sql.indexOf('zzz_test_proc') + 3, summary)).toEqual({
      kind: 'procedure',
      schema: 'dbo',
      name: 'zzz_test_proc',
    })
    const sql2 = 'EXEC dbo.zzz_test_proc'
    expect(resolveCallableAt(sql2, sql2.indexOf('zzz_test_proc'), summary)?.name).toBe('zzz_test_proc')
  })

  it('chiamata a una funzione (anche dentro una espressione)', () => {
    const sql = "select dbo.fn_td('ciao'), 1"
    const r = resolveCallableAt(sql, sql.indexOf('fn_td') + 1, summary)
    expect(r).toEqual({ kind: 'function', schema: 'dbo', name: 'fn_td' })
  })

  it('una TABELLA non è "chiamabile" (→ null)', () => {
    const sql = 'SELECT * FROM dbo.RUN_MISSIONI'
    expect(resolveCallableAt(sql, sql.indexOf('RUN_MISSIONI') + 2, summary)).toBeNull()
  })

  it('nome sconosciuto → null', () => {
    const sql = 'EXEC dbo.non_esiste @a = 1'
    expect(resolveCallableAt(sql, sql.indexOf('non_esiste') + 1, summary)).toBeNull()
  })

  it('schema sbagliato → null (ma senza schema lo trova)', () => {
    const sql = 'EXEC altro.zzz_test_proc'
    expect(resolveCallableAt(sql, sql.indexOf('zzz_test_proc'), summary)).toBeNull()
    const sql2 = 'EXEC zzz_test_proc'
    expect(resolveCallableAt(sql2, sql2.indexOf('zzz_test_proc'), summary)?.schema).toBe('dbo')
  })

  it('senza sommario → null (nessun crash)', () => {
    expect(resolveCallableAt('EXEC dbo.ws_X', 8, null)).toBeNull()
    expect(resolveCallableAt('EXEC dbo.ws_X', 8, undefined)).toBeNull()
  })

  it('cursore sul nome di una variabile → null', () => {
    const sql = 'EXEC dbo.zzz_test_proc @id = 1'
    expect(resolveCallableAt(sql, sql.indexOf('@id') + 1, summary)).toBeNull()
  })
})
