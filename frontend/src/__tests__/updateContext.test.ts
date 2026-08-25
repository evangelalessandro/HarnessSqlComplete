import { describe, expect, it } from 'vitest'
import { buildColumnContextSuggestions } from '../helpers'
import { classifyContext } from '../intellisenseContext'
import { mkCol, mkTbl, wsbritvicLikeSummary } from './schema'

/**
 * UPDATE ... WHERE con una parola che sta IN MEZZO al nome colonna:
 * "where udc" deve suggerire per prima SCO_UDC (colonna della tabella target
 * dell'UPDATE), non colonne di altre tabelle anche se matchano meglio per prefisso.
 */
describe('intellisense: UPDATE ... WHERE con affinità di colonna', () => {
  const summary = wsbritvicLikeSummary()
  // DAT_SCOMPART reale (WSBRITVIC): molte colonne SCO_*, SCO_UDC è decimal
  summary.tables.push(
    mkTbl('dbo', 'DAT_SCOMPART', [
      mkCol('SCO_SCOMPARTO', 'int'),
      mkCol('SCO_UDC', 'decimal'),
      mkCol('SCO_FIX', 'bit'),
      mkCol('SCO_ARTICOLO', 'nvarchar'),
      mkCol('SCO_SUB1', 'nvarchar'),
      mkCol('SCO_QTA', 'decimal'),
      mkCol('SCO_PRE', 'decimal'),
      mkCol('SCO_GIAC', 'decimal'),
      mkCol('SCO_DMOD', 'datetime'),
      mkCol('SCO_HOSTRIF', 'nvarchar'),
    ]),
  )
  // DAT_UDC ha UDC_UDC (prefisso esatto "udc") ma NON è nello statement: non deve comparire
  summary.tables.push(mkTbl('dbo', 'DAT_UDC', [mkCol('UDC_UDC', 'nvarchar'), mkCol('UDC_CODICE', 'nvarchar')]))

  const stmt = `update DAT_SCOMPART\nset SCO_ARTICOLO='ART2'\nwhere udc`
  const before = `update DAT_SCOMPART\nset SCO_ARTICOLO='ART2'\nwhere `

  it('il contesto è columnContext', () => {
    const ctx = classifyContext({ prefix: before, stmtBefore: before })
    expect(ctx.kind).toBe('columnContext')
    expect(ctx.isColumnContext).toBe(true)
  })

  it('digitando "udc" suggerisce per prima SCO_UDC della tabella target', () => {
    const res = buildColumnContextSuggestions(stmt, before, 'udc', summary)
    expect(res.length).toBeGreaterThan(0)
    expect(res[0].name).toBe('SCO_UDC')
    expect(res[0].ownerLabel).toContain('DAT_SCOMPART')
  })

  it('non suggerisce colonne di tabelle fuori dallo statement (es. UDC_UDC di DAT_UDC)', () => {
    const res = buildColumnContextSuggestions(stmt, before, 'udc', summary)
    const names = res.map(r => r.name)
    expect(names).not.toContain('UDC_UDC')
    expect(names).not.toContain('UDC_CODICE')
  })

  it('anche con una sola lettera "u" SCO_UDC resta il primo', () => {
    const res = buildColumnContextSuggestions(stmt, before, 'u', summary)
    expect(res.length).toBeGreaterThan(0)
    expect(res[0].name).toBe('SCO_UDC')
  })

  it('senza tabella target riconosciuta non inventa colonne', () => {
    const res = buildColumnContextSuggestions(`update tabella_inesistente\nset x = 1\nwhere udc`, before, 'udc', summary)
    expect(res).toHaveLength(0)
  })
})
