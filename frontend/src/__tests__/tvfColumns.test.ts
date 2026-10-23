// Funzioni TABELLARI: "select * from dbo.fn_x() a where a.ca" → l'alias "a" è la funzione e
// l'intellisense deve proporre i campi che la funzione restituisce.
// Segnalazione utente: "nel caso sotto l'intellisense non sta tornando niente, quella è una
// funzione tabellare e deve tornare i nomi campi".
import { describe, expect, it } from 'vitest'
import { buildQualifiedColumnSuggestions, extractTableValuedFunctionRefs } from '../helpers'
import type { DatabaseSummary, FunctionInfo } from '../types'
import { mkCol } from './schema'

const fun: FunctionInfo = {
  schema: 'dbo',
  name: 'fn_calc_campi',
  type: 'SQL_INLINE_TABLE_VALUED_FUNCTION',
  columns: [mkCol('CALC_ORD_ORDINE', 'nvarchar'), mkCol('CALC_ORD_STATO', 'varchar'), mkCol('CALC_RIGHE_TOT', 'int')],
}

const summary = {
  tables: [],
  views: [],
  procedures: [],
  triggers: [],
  checkConstraints: [],
  functions: [fun],
  foreignKeys: [],
  databases: [],
  cooccurrences: [],
} as unknown as DatabaseSummary

describe('extractTableValuedFunctionRefs', () => {
  it('riconosce schema, nome e alias (con o senza AS)', () => {
    expect(extractTableValuedFunctionRefs('select * from dbo.fn_x() a')).toEqual([
      { schema: 'dbo', name: 'fn_x', alias: 'a' },
    ])
    expect(extractTableValuedFunctionRefs('select * from dbo.fn_x() AS a')).toEqual([
      { schema: 'dbo', name: 'fn_x', alias: 'a' },
    ])
    expect(extractTableValuedFunctionRefs('select * from fn_x()')).toEqual([
      { schema: null, name: 'fn_x', alias: null },
    ])
    expect(extractTableValuedFunctionRefs('select * from [dbo].[fn_x]() [a]')).toEqual([
      { schema: 'dbo', name: 'fn_x', alias: 'a' },
    ])
  })

  it('accetta parametri e JOIN, e non scambia le parole chiave per un alias', () => {
    expect(extractTableValuedFunctionRefs('select * from dbo.fn_y(@p, 2) a')).toEqual([
      { schema: 'dbo', name: 'fn_y', alias: 'a' },
    ])
    expect(extractTableValuedFunctionRefs('select * from dbo.fn_y() where x = 1')).toEqual([
      { schema: 'dbo', name: 'fn_y', alias: null },
    ])
    expect(extractTableValuedFunctionRefs('select * from t join dbo.fn_z() b on b.x = t.x')).toEqual([
      { schema: 'dbo', name: 'fn_z', alias: 'b' },
    ])
  })
})

describe('campi di una funzione tabellare', () => {
  const testo = 'select * from dbo.fn_calc_campi() a\nwhere a.ca'

  it('con l\'alias della funzione propone i campi restituiti', () => {
    const out = buildQualifiedColumnSuggestions(testo, 'select * from dbo.fn_calc_campi() a\nwhere a.', summary)
    expect(out.map(c => c.name)).toEqual(['CALC_ORD_ORDINE', 'CALC_ORD_STATO', 'CALC_RIGHE_TOT'])
    expect(out[0].documentation).toContain('fn_calc_campi')
  })

  it('funziona anche qualificando con il nome della funzione', () => {
    const out = buildQualifiedColumnSuggestions(testo, 'select * from dbo.fn_calc_campi() a\nwhere fn_calc_campi.', summary)
    expect(out).toHaveLength(3)
  })

  it('senza corrispondenza non propone nulla (nessun falso positivo)', () => {
    expect(buildQualifiedColumnSuggestions(testo, 'select * from dbo.fn_calc_campi() a\nwhere zz.', summary)).toEqual([])
  })

  it('una funzione senza colonne note non rompe nulla', () => {
    const senza = { ...summary, functions: [{ schema: 'dbo', name: 'fn_calc_campi', type: 'FN' }] } as DatabaseSummary
    expect(buildQualifiedColumnSuggestions(testo, 'select * from dbo.fn_calc_campi() a\nwhere a.', senza)).toEqual([])
  })
})
