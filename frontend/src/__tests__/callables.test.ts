import { describe, expect, it } from 'vitest'
import { identifierPartsAt, isCallableAt, resolveCallableAt } from '../callables'
import type { DatabaseSummary } from '../types'
import { wsbritvicLikeSummary } from './schema'
import { realSummary } from './fixtures/wsbritvicReal'

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

describe('voce "Modifica" nel tasto destro: solo su procedure e funzioni', () => {
  it('testo qualunque: niente voce', () => {
    const sql = 'SELECT 1 WHERE 2 = 2'
    for (let i = 0; i <= sql.length; i++) expect(isCallableAt(sql, i, summary)).toBe(false)
    expect(isCallableAt('', 0, summary)).toBe(false)
    expect(isCallableAt('EXEC dbo.ws_X', 8, null)).toBe(false)
  })

  it('nomi di TABELLA: la voce non deve comparire', () => {
    for (const t of summary.tables) {
      const sql = `SELECT * FROM dbo.${t.name}`
      expect(isCallableAt(sql, sql.indexOf(t.name) + 1, summary), `tabella ${t.name}`).toBe(false)
    }
  })

  it('CAMPI (colonne): la voce non deve comparire', () => {
    const routineNames = new Set([
      ...summary.procedures.map(p => p.name.toLowerCase()),
      ...summary.functions.map(f => f.name.toLowerCase()),
    ])
    let checked = 0
    for (const t of summary.tables) {
      for (const c of t.columns ?? []) {
        // un campo che si chiama come una routine è per forza ambiguo: si salta
        if (routineNames.has(c.name.toLowerCase())) continue
        const sql = `SELECT ${c.name} FROM dbo.${t.name} WHERE ${c.name} = 1`
        expect(isCallableAt(sql, 7, summary), `campo ${c.name}`).toBe(false)
        expect(isCallableAt(sql, sql.lastIndexOf(c.name) + 1, summary), `campo ${c.name} in WHERE`).toBe(false)
        checked++
      }
    }
    // lo schema di comodo ha poche colonne; i numeri grossi sono nel test sullo schema reale
    expect(checked, 'nessun campo controllato').toBeGreaterThan(10)
  })
})

describe('voce "Modifica" con lo schema REALE (WSBRITVIC)', () => {
  const real = realSummary()

  it('tutte le stored procedure reali → voce attiva', () => {
    for (const p of real.procedures) {
      const sql = `EXEC [${p.schema}].[${p.name}] @p = 1`
      const at = sql.indexOf(p.name) + 1
      expect(isCallableAt(sql, at, real), `procedura ${p.schema}.${p.name}`).toBe(true)
    }
  })

  it('tutte le funzioni reali → voce attiva (anche usate in una SELECT)', () => {
    for (const f of real.functions) {
      const sql = `SELECT dbo.${f.name}`
      expect(isCallableAt(sql, sql.indexOf(f.name) + 1, real), `funzione ${f.name}`).toBe(true)
    }
  })

  it('tutte le tabelle reali → voce NON attiva', () => {
    const routineNames = new Set([
      ...real.procedures.map(p => p.name.toLowerCase()),
      ...real.functions.map(f => f.name.toLowerCase()),
    ])
    let checked = 0
    for (const t of real.tables) {
      if (routineNames.has(t.name.toLowerCase())) continue
      const sql = `SELECT * FROM dbo.${t.name}`
      expect(isCallableAt(sql, sql.indexOf(t.name) + 1, real), `tabella ${t.name}`).toBe(false)
      checked++
    }
    expect(checked).toBeGreaterThan(250)
  })

  it('i campi reali di RUN_MISSIONI → voce NON attiva', () => {
    const t = real.tables.find(x => x.name === 'RUN_MISSIONI')!
    expect((t.columns ?? []).length).toBeGreaterThan(50)
    for (const c of t.columns ?? []) {
      const sql = `SELECT ${c.name} FROM dbo.RUN_MISSIONI WHERE ${c.name} = 1`
      expect(isCallableAt(sql, 7, real), `campo ${c.name}`).toBe(false)
    }
  })
})
