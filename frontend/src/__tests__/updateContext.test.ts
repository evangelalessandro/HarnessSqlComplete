import { describe, expect, it } from 'vitest'
import { buildColumnContextSuggestions, statementRangeAt } from '../helpers'
import { classifyContext } from '../intellisenseContext'
import { mkCol, mkTbl, demoStoreLikeSummary } from './schema'

/**
 * UPDATE ... WHERE con una parola che sta IN MEZZO al nome colonna:
 * "where udc" deve suggerire per prima SCO_UDC (colonna della tabella target
 * dell'UPDATE), non colonne di altre tabelle anche se matchano meglio per prefisso.
 */
describe('intellisense: UPDATE ... WHERE con affinità di colonna', () => {
  const summary = demoStoreLikeSummary()
  // DAT_SCOMPART reale (DEMOSTORE): molte colonne SCO_*, SCO_UDC è decimal
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

describe('UPDATE: i campi NON si qualificano col nome tabella se inutile (statement separati senza ";")', () => {
  const summary = demoStoreLikeSummary()
  // DAT_SCOMPART è la tabella dell'UPDATE; ALTRO è referenziato da una SELECT
  // PRECEDENTE (stesso batch senza ';') e ha una colonna con lo STESSO nome.
  summary.tables.push(
    mkTbl('dbo', 'DAT_SCOMPART', [
      mkCol('SCO_SCOMPARTO', 'int'),
      mkCol('SCO_UDC', 'nvarchar'),
      mkCol('SCO_ARTICOLO', 'nvarchar'),
    ]),
  )
  summary.tables.push(mkTbl('dbo', 'ALTRO', [mkCol('SCO_UDC', 'nvarchar'), mkCol('ALTRO_X', 'int')]))

  const sql = `select * from dbo.ALTRO\nupdate dbo.DAT_SCOMPART\nset SCO_`

  it('statementRangeAt: l\'UPDATE è uno statement a sé (parte da "update", non da "select")', () => {
    const cursor = sql.length
    const r = statementRangeAt(sql, cursor)
    expect(sql.slice(r.start, r.start + 6).toLowerCase()).toBe('update')
    expect(sql.slice(r.start, r.end)).not.toMatch(/ALTRO/)
  })

  it('in SET propone il campo SENZA prefisso (univoco nello statement dell\'UPDATE)', () => {
    const cursor = sql.length
    const r = statementRangeAt(sql, cursor)
    const stmtText = sql.slice(r.start, r.end)
    const stmtBefore = stmtText.slice(0, cursor - r.start)
    const res = buildColumnContextSuggestions(stmtText, stmtBefore, 'SCO_', summary)
    const sc = res.find(s => s.name === 'SCO_UDC')
    expect(sc).toBeDefined()
    expect(sc!.insertText).toBe('SCO_UDC') // niente "DAT_SCOMPART.SCO_UDC"
    expect(sc!.insertText).not.toContain('.')
    expect(sc!.shared).toBe(false)
  })
})
