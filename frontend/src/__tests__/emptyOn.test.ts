import { describe, expect, it } from 'vitest'
import { buildJoinConditionSuggestions } from '../helpers'
import { mkCol, mkTbl, demoStoreLikeSummary } from './schema'

/**
 * "in questa l'intellisense ... mi fa 'AND ' nomi campi, ma non ci può mettere l'and":
 * con l'ON VUOTO (subito dopo "inner join MAG_CELLE ON ") le prime condizioni NON
 * devono iniziare con "AND" e devono riguardare la tabella appena unita (MAG_CELLE),
 * non coppie di altri JOIN.
 */
describe('ON vuoto: prima condizione senza "AND" e solo la tabella appena unita', () => {
  const summary = demoStoreLikeSummary()
  summary.tables.push(
    mkTbl('dbo', 'DAT_UDC_PRED', [mkCol('UPR_UDCPRED', 'nvarchar')]),
    mkTbl('dbo', 'MAG_CELLE', [mkCol('CEL_CORRIDOIO', 'int'), mkCol('CEL_CELLA', 'nvarchar')]),
  )
  summary.tables[1].columns!.push(mkCol('MIS_D_CELLA', 'nvarchar'), mkCol('MIS_D_CORRIDOIO', 'nvarchar')) // RUN_MISSIONI
  summary.foreignKeys.push(
    { name: 'FK_DAT_UDC_PRED', schema: 'dbo', table: 'DAT_UDC', column: 'UDC_UDCPRED', refSchema: 'dbo', refTable: 'DAT_UDC_PRED', refColumn: 'UPR_UDCPRED' },
    { name: 'FK_RUN_MISSIONI_DAT_UDC', schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_UDC', refSchema: 'dbo', refTable: 'DAT_UDC', refColumn: 'UDC_UDC' },
    { name: 'FK_RUN_MISSIONI_MAG_CELLE', schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_D_CELLA', refSchema: 'dbo', refTable: 'MAG_CELLE', refColumn: 'CEL_CELLA' },
    { name: 'FK_RUN_MISSIONI_MAG_CELLE_CORR', schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_D_CORRIDOIO', refSchema: 'dbo', refTable: 'MAG_CELLE', refColumn: 'CEL_CORRIDOIO' },
  )

  const head = `SELECT * FROM dbo.DAT_UDC inner join DAT_UDC_PRED ON (UDC_UDCPRED = UPR_UDCPRED)\ninner join RUN_MISSIONI ON (UDC_UDC = MIS_UDC)\ninner join MAG_CELLE ON `

  it('ON vuoto: niente "AND" iniziale e solo coppie di MAG_CELLE', () => {
    const res = buildJoinConditionSuggestions(head, head, summary)
    expect(res.length).toBeGreaterThan(0)
    expect(res.every(r => !r.text.startsWith('AND '))).toBe(true)
    // solo relazioni che coinvolgono MAG_CELLE (mai UDC_UDC = MIS_UDC di un altro JOIN)
    expect(res.every(r => r.text.includes('CEL_'))).toBe(true)
    expect(res.some(r => r.text === 'MIS_D_CELLA = CEL_CELLA')).toBe(true)
    expect(res.some(r => r.text === 'MIS_D_CORRIDOIO = CEL_CORRIDOIO')).toBe(true)
  })

  it('ON con una condizione già scritta: le aggiunte iniziano con "AND"', () => {
    const before = head + '(CEL_CELLA = MIS_D_CELLA)'
    const res = buildJoinConditionSuggestions(before, before, summary)
    expect(res.length).toBeGreaterThan(0)
    expect(res.every(r => r.text.startsWith('AND '))).toBe(true)
    // la coppia già scritta non viene riproposta
    expect(res.some(r => r.text.includes('MIS_D_CELLA'))).toBe(false)
  })
})
