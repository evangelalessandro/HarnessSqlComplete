// UNION / EXCEPT / INTERSECT: ogni ramo su righe proprie.
// SEGNALAZIONE UTENTE: "le union non le formatta bene".
// Causa trovata: `splitStatementClauses` attivava il layout a clausole solo con FROM/JOIN/APPLY, quindi
// una SELECT SENZA FROM ma con UNION restava su una riga. Il caso più visibile era il corpo di una CTE
// (";with F as (select 'a' union select 'b')") che finiva tutto su una riga dentro le parentesi.
import { describe, expect, it } from 'vitest'
import { formatSqlWithProfile, formatRoutineWithProfile } from '../tsqlFormatter'
import { buildFormatProfile, loadFormatProfileXml } from '../formatProfile'

const profile = buildFormatProfile(loadFormatProfileXml())

describe('UNION: rami su righe proprie', () => {
  it('SELECT senza FROM con UNION: un ramo per blocco', () => {
    const out = formatSqlWithProfile(`select 'a' as X union select 'b' as Y`, profile)
    out.split('\n').forEach(r => console.log(`  |${r}`))
    const righe = out.trimEnd().split('\n')
    expect(righe[0]).toBe("SELECT 'a' AS X")
    expect(righe[1]).toBe('UNION')
    expect(righe[2]).toBe("SELECT 'b' AS Y")
  })

  it('UNION ALL resta attaccato e i rami vanno a capo', () => {
    const out = formatSqlWithProfile(`select a from t1 union all select b from t2`, profile)
    expect(out.trimEnd().split('\n')).toEqual([
      'SELECT a',
      'FROM t1',
      'UNION ALL',
      'SELECT b',
      'FROM t2',
    ])
  })

  it('EXCEPT e INTERSECT come UNION', () => {
    const out = formatSqlWithProfile(`select 'a' except select 'b' intersect select 'c'`, profile)
    const righe = out.trimEnd().split('\n')
    expect(righe).toContain('EXCEPT')
    expect(righe).toContain('INTERSECT')
    expect(righe.filter(r => r.startsWith('SELECT'))).toHaveLength(3)
  })

  it('corpo di una CTE con UNION: le colonne si impilano e ogni ramo va a capo', () => {
    const sql = `;with FUNCTIONS as (
   select 'ws_A' as FN_NAME
    union select 'ws_CUSTOM_B' as FN_NAME
    union select 'BAYKITT' as FN_NAME
)
select FN_NAME from FUNCTIONS`
    const out = formatSqlWithProfile(sql, profile)
    out.split('\n').forEach(r => console.log(`  |${r}`))
    const righe = out.trimEnd().split('\n')
    // la CTE resta una struttura con parentesi su righe proprie
    expect(righe[1]).toBe('(')
    // i tre rami della CTE sono indentati di 2 e ognuno inizia con SELECT
    const rami = righe.filter(r => /^ {2}SELECT/.test(r))
    expect(rami).toHaveLength(3)
    expect(righe.filter(r => r.trim() === 'UNION')).toHaveLength(2)
    // nessuna riga contiene due SELECT (era il difetto: tutto su una riga)
    expect(righe.some(r => (r.match(/SELECT/g) ?? []).length > 1)).toBe(false)
  })

  it('nella routine (dentro BEGIN/END) i rami UNION sono indentati come il resto', () => {
    const sql = `create procedure p as
begin
  select a from t1
  union all
  select b from t2
end`
    const out = formatRoutineWithProfile(sql, profile)
    const righe = out.trimEnd().split('\n')
    expect(righe).toContain('    UNION ALL')
    expect(righe.filter(r => /^\s+SELECT /.test(r))).toHaveLength(2)
  })

  it('formattare due volte dà lo stesso risultato', () => {
    const sql = `;with F as (select 'a' as X union all select 'b' as X) select X from F`
    const una = formatSqlWithProfile(sql, profile)
    expect(formatSqlWithProfile(una, profile)).toBe(una)
  })
})
