import { describe, expect, it } from 'vitest'
import { buildColumnContextSuggestions } from '../helpers'
import { shouldSuggestJoinConditions } from '../intellisenseContext'
import { mkCol, mkTbl, wsbritvicLikeSummary } from './schema'

/**
 * "i campi delle tabelle in join ci devo comunque essere sempre": digitando mis_/cel_
 * dopo "=" in un ON multi-join, le colonne delle tabelle unite devono comparire
 * (e gli snippet "AND ..." delle condizioni ON NON devono coprirle).
 */
describe('campi delle tabelle in join: sempre presenti digitando mis_/cel_', () => {
  const summary = wsbritvicLikeSummary()
  summary.tables[0].columns!.push(mkCol('UDC_S_CORRIDOIO', 'nvarchar'), mkCol('UDC_S_CELLA', 'nvarchar')) // DAT_UDC
  summary.tables[1].columns!.push(mkCol('MIS_D_CELLA', 'nvarchar'), mkCol('MIS_S_CELLA', 'nvarchar')) // RUN_MISSIONI
  summary.tables.push(
    mkTbl('dbo', 'DAT_UDC_PRED', [mkCol('UPR_UDCPRED', 'nvarchar')]),
    mkTbl('dbo', 'MAG_CELLE', [mkCol('CEL_CORRIDOIO', 'int'), mkCol('CEL_CELLA', 'nvarchar'), mkCol('CEL_DES', 'nvarchar')]),
  )
  summary.foreignKeys.push(
    { name: 'FK_DAT_UDC_PRED', schema: 'dbo', table: 'DAT_UDC', column: 'UDC_UDCPRED', refSchema: 'dbo', refTable: 'DAT_UDC_PRED', refColumn: 'UPR_UDCPRED' },
    { name: 'FK_RUN_MISSIONI_DAT_UDC', schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_UDC', refSchema: 'dbo', refTable: 'DAT_UDC', refColumn: 'UDC_UDC' },
    { name: 'FK_RUN_MISSIONI_MAG_CELLE', schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_D_CELLA', refSchema: 'dbo', refTable: 'MAG_CELLE', refColumn: 'CEL_CELLA' },
    { name: 'FK_DAT_UDC_MAG_CELLE', schema: 'dbo', table: 'DAT_UDC', column: 'UDC_S_CELLA', refSchema: 'dbo', refTable: 'MAG_CELLE', refColumn: 'CEL_CELLA' },
  )

  const multiHead = `SELECT * FROM dbo.DAT_UDC inner join DAT_UDC_PRED ON (UDC_UDCPRED = UPR_UDCPRED)\ninner join RUN_MISSIONI ON (UDC_UDC = MIS_UDC)\ninner join MAG_CELLE ON `

  it('digitando "mis_" dopo "CEL_CELLA=" compaiono le colonne MIS_* di RUN_MISSIONI', () => {
    const before = multiHead + 'CEL_CELLA='
    const res = buildColumnContextSuggestions(before + 'mis_', before + 'mis_', 'mis_', summary)
    const names = res.map(c => c.name)
    expect(names).toContain('MIS_UDC')
    expect(names).toContain('MIS_MISSIONE')
    expect(names).toContain('MIS_D_CELLA')
    expect(names).toContain('MIS_S_CELLA')
  })

  it('digitando "cel_" dopo "UDC_S_CORRIDOIO = " compaiono le colonne CEL_* di MAG_CELLE', () => {
    const before = multiHead + '(UDC_S_CORRIDOIO = '
    const res = buildColumnContextSuggestions(before + 'cel_', before + 'cel_', 'cel_', summary)
    const names = res.map(c => c.name)
    expect(names).toContain('CEL_CORRIDOIO')
    expect(names).toContain('CEL_CELLA')
    expect(names).toContain('CEL_DES')
  })
})

describe('shouldSuggestJoinConditions: niente "AND ..." dopo "="', () => {
  it('con parola in corso → false (le colonne devono dominare)', () => {
    expect(shouldSuggestJoinConditions('mis_', '... ON (BCO_BAIA = ')).toBe(false)
    expect(shouldSuggestJoinConditions('cel_', '... ON (BCO_BAIA = ')).toBe(false)
  })

  it('subito dopo "col = " (lato destro vuoto) → false: servono le colonne', () => {
    expect(shouldSuggestJoinConditions('', '... ON (BCO_BAIA = ')).toBe(false)
    expect(shouldSuggestJoinConditions('', '... AND MIS_S_CELLA =')).toBe(false)
  })

  it('dopo una condizione COMPLETA nell\'ON → true (gli "AND ..." aggiuntivi)', () => {
    expect(shouldSuggestJoinConditions('', '... ON (BCO_BAIA = BPZ_BAIA)')).toBe(true)
    expect(shouldSuggestJoinConditions('', '... ON MIS_S_CORRIDOIO = CEL_CORRIDOIO')).toBe(true)
  })

  it('dopo l\'ON con ORDER BY/GROUP BY/HAVING/WHERE → false (il cursore non è più nell\'ON)', () => {
    // bug utente: in ORDER BY comparivano gli "AND a = b" del JOIN prima dei campi
    expect(shouldSuggestJoinConditions('', '... ON MIS_S_CORRIDOIO = CEL_CORRIDOIO\norder by ')).toBe(false)
    expect(shouldSuggestJoinConditions('', '... ON MIS_S_CORRIDOIO = CEL_CORRIDOIO\norder by 1 desc;')).toBe(false)
    expect(shouldSuggestJoinConditions('', '... ON (MIS_S_CORRIDOIO = CEL_CORRIDOIO)\ngroup by ')).toBe(false)
    expect(shouldSuggestJoinConditions('', '... ON (MIS_S_CORRIDOIO = CEL_CORRIDOIO)\nwhere ')).toBe(false)
    // dentro l'ON le condizioni aggiuntive continuano a funzionare anche dopo AND/OR
    expect(shouldSuggestJoinConditions('', '... ON (BCO_BAIA = BPZ_BAIA AND MIS_D_CELLA = CEL_CELLA) ')).toBe(true)
  })

  it('senza ON → false', () => {
    expect(shouldSuggestJoinConditions('', '... WHERE ')).toBe(false)
  })
})
