import { describe, expect, it } from 'vitest'
import {
  buildJoinConditionSuggestions,
  buildJoinSuggestions,
  buildSelectListSuggestions,
  rankTablesForJoin,
} from '../helpers'
import { mkCol, mkTbl, wsbritvicLikeSummary } from './schema'

/**
 * Regressioni dell'intellisense con JOIN su più tabelle:
 * 1) le condizioni ON aggiuntive devono riguardare SOLO le tabelle dell'ON corrente
 *    (niente self-FK né coppie di altri JOIN);
 * 2) nei suggerimenti di JOIN le relazioni FK dirette vengono prima di quelle transitive (via);
 * 3) nella select list una colonna condivisa tra più tabelle viene inserita qualificata.
 */
describe('intellisense multi-join: niente rumore e ordine sensato', () => {
  const summary = wsbritvicLikeSummary()
  summary.tables[0].columns!.push(mkCol('UDC_CNT_BAIA', 'int')) // DAT_UDC
  summary.tables.push(
    mkTbl('dbo', 'MAG_BAIE', [mkCol('BCO_BAIA', 'int'), mkCol('BCO_BAIA2', 'int'), mkCol('BCO_MASTER', 'int')]),
    mkTbl('dbo', 'MAG_BAIE_PIAZ', [mkCol('BPZ_BAIA', 'int'), mkCol('BPZ_BAIA2', 'int'), mkCol('BPZ_PIAZZOLA', 'int')]),
    mkTbl('dbo', 'MAG_PIAZZOLE', [mkCol('PZ_PIAZZOLA', 'int')]),
    mkTbl('dbo', 'GESTORI_MODULI', [mkCol('GM_PIAZZOLA', 'int'), mkCol('GM_SG_EVAC_BAIA', 'int')]),
    mkTbl('dbo', 'DAT_ARTICOLI', [mkCol('ART_CODICE', 'nvarchar')]),
    mkTbl('dbo', 'BCKUP_ARTICOLI', [mkCol('ART_CODICE', 'nvarchar')]),
  )
  summary.foreignKeys.push(
    { name: 'FK_MAG_BAIE_PIAZ_MAG_BAIE', schema: 'dbo', table: 'MAG_BAIE_PIAZ', column: 'BPZ_BAIA', refSchema: 'dbo', refTable: 'MAG_BAIE', refColumn: 'BCO_BAIA' },
    { name: 'FK_MAG_BAIE_PIAZ_MAG_BAIE2', schema: 'dbo', table: 'MAG_BAIE_PIAZ', column: 'BPZ_BAIA2', refSchema: 'dbo', refTable: 'MAG_BAIE', refColumn: 'BCO_BAIA2' },
    { name: 'FK_MAG_BAIE_PIAZ_MAG_PIAZZOLE', schema: 'dbo', table: 'MAG_BAIE_PIAZ', column: 'BPZ_PIAZZOLA', refSchema: 'dbo', refTable: 'MAG_PIAZZOLE', refColumn: 'PZ_PIAZZOLA' },
    { name: 'FK_GESTORI_MODULI_MAG_PIAZZOLE', schema: 'dbo', table: 'GESTORI_MODULI', column: 'GM_PIAZZOLA', refSchema: 'dbo', refTable: 'MAG_PIAZZOLE', refColumn: 'PZ_PIAZZOLA' },
    { name: 'FK_GESTORI_MODULI_MAG_BAIE', schema: 'dbo', table: 'GESTORI_MODULI', column: 'GM_SG_EVAC_BAIA', refSchema: 'dbo', refTable: 'MAG_BAIE', refColumn: 'BCO_BAIA' },
    { name: 'FK_DAT_UDC_MAG_BAIE', schema: 'dbo', table: 'DAT_UDC', column: 'UDC_CNT_BAIA', refSchema: 'dbo', refTable: 'MAG_BAIE', refColumn: 'BCO_BAIA' },
    { name: 'FK_MAG_BAIE_MASTER', schema: 'dbo', table: 'MAG_BAIE', column: 'BCO_MASTER', refSchema: 'dbo', refTable: 'MAG_BAIE', refColumn: 'BCO_BAIA' },
  )

  const multiStmt = `select * from dat_udc inner join MAG_BAIE on bco_usobaia like '%,INKIT,%' inner join MAG_BAIE_PIAZ ON (BCO_BAIA = BPZ_BAIA)`

  it('condizioni ON aggiuntive: con la coppia già scritta non compaiono self-FK né terze tabelle', () => {
    const res = buildJoinConditionSuggestions(multiStmt, multiStmt, summary)
    // l'unica FK MAG_BAIE↔MAG_BAIE_PIAZ con la coppia scritta è BPZ_BAIA=BCO_BAIA (già usata):
    // resta solo l'altra relazione tra le stesse due tabelle (BPZ_BAIA2 = BCO_BAIA2)
    expect(res.some(r => r.text === 'AND BPZ_BAIA2 = BCO_BAIA2')).toBe(true)
    expect(res.some(r => r.text.includes('BCO_MASTER'))).toBe(false) // self-FK esclusa
    expect(res.some(r => r.text.includes('UDC_CNT_BAIA'))).toBe(false) // DAT_UDC (terza tabella) esclusa
  })

  it('condizioni ON aggiuntive: tutte le coppie già scritte → nessun suggerimento', () => {
    const stmt = `select * from dat_udc inner join MAG_BAIE on bco_usobaia like '%,INKIT,%' inner join MAG_BAIE_PIAZ ON (BCO_BAIA = BPZ_BAIA AND BPZ_BAIA2 = BCO_BAIA2)`
    const res = buildJoinConditionSuggestions(stmt, stmt, summary)
    expect(res).toEqual([])
  })

  it('JOIN: le relazioni FK dirette vengono prima delle transitive (via)', () => {
    const ctxNames = ['dat_udc', 'mag_baie', 'mag_baie_piaz']
    const ctxInfos = summary.tables.filter(t => ctxNames.includes(t.name.toLowerCase()))
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ctxNames)
    const gm = ranked.find(r => r.table.name === 'GESTORI_MODULI')!
    const items = buildJoinSuggestions(gm, ctxInfos, true, false, new Set())
    const fkIdx = items.findIndex(i => i.insertText.includes('GM_SG_EVAC_BAIA'))
    const viaIdx = items.findIndex(i => i.insertText.includes('GM_PIAZZOLA = BPZ_PIAZZOLA'))
    expect(fkIdx).toBeGreaterThanOrEqual(0)
    expect(viaIdx).toBeGreaterThan(fkIdx)
  })

  it('select list: colonna condivisa tra due tabelle → insert qualificato', () => {
    const sel = buildSelectListSuggestions(
      'select  from DAT_ARTICOLI inner join BCKUP_ARTICOLI on ART_CODICE = ART_CODICE',
      'select  ',
      summary,
    )
    const col = sel.columns.find(c => c.name === 'ART_CODICE')
    expect(col?.shared).toBe(true)
    expect(col?.insertText).toBe('DAT_ARTICOLI.ART_CODICE')
  })
})
