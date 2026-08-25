import { describe, expect, it } from 'vitest'
import { buildJoinSuggestions, rankTablesForJoin } from '../helpers'
import { mkCol, mkTbl, wsbritvicLikeSummary } from './schema'

/**
 * "non voglio l'alias dei nomi tabelle se non necessario": i suggerimenti di JOIN
 * non devono aggiungere alias (AS mbp / mb.) quando non servono. L'alias della
 * tabella candidata serve solo nei self-join; il lato contesto usa l'alias solo
 * se nell'editor è già stato scritto (altrimenti l'ON sarebbe SQL invalido).
 */
describe('JOIN senza alias se non necessari', () => {
  const summary = wsbritvicLikeSummary()
  summary.tables.push(
    mkTbl('dbo', 'MAG_BAIE', [mkCol('BCO_BAIA', 'int'), mkCol('BCO_MASTER', 'int')]),
    mkTbl('dbo', 'MAG_BAIE_PIAZ', [mkCol('BPZ_BAIA', 'int'), mkCol('BPZ_PIAZZOLA', 'int')]),
  )
  summary.foreignKeys.push(
    {
      name: 'FK_MAG_BAIE_PIAZ_MAG_BAIE',
      schema: 'dbo',
      table: 'MAG_BAIE_PIAZ',
      column: 'BPZ_BAIA',
      refSchema: 'dbo',
      refTable: 'MAG_BAIE',
      refColumn: 'BCO_BAIA',
    },
    {
      name: 'FK_MAG_BAIE_MASTER',
      schema: 'dbo',
      table: 'MAG_BAIE',
      column: 'BCO_MASTER',
      refSchema: 'dbo',
      refTable: 'MAG_BAIE',
      refColumn: 'BCO_BAIA',
    },
  )

  const ctx = (names: string[]) => summary.tables.filter(t => names.includes(t.name.toLowerCase()))

  it('il suggerimento per MAG_BAIE_PIAZ NON usa alias', () => {
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ['dat_udc', 'mag_baie'])
    const piaz = ranked.find(r => r.table.name === 'MAG_BAIE_PIAZ')!
    const items = buildJoinSuggestions(piaz, ctx(['dat_udc', 'mag_baie']), true, false, new Set())
    expect(items.some(i => i.insertText === 'MAG_BAIE_PIAZ ON (BCO_BAIA = BPZ_BAIA)')).toBe(true)
    expect(items.some(i => i.insertText.includes(' AS '))).toBe(false)
  })

  it('con un alias già scritto per MAG_BAIE, l\'ON usa quell\'alias (mb)', () => {
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ['dat_udc', 'mag_baie'])
    const piaz = ranked.find(r => r.table.name === 'MAG_BAIE_PIAZ')!
    const items = buildJoinSuggestions(piaz, ctx(['dat_udc', 'mag_baie']), true, false, new Set(['mag_baie']))
    expect(items.some(i => i.insertText === 'MAG_BAIE_PIAZ ON (mb.BCO_BAIA = BPZ_BAIA)')).toBe(true)
  })

  it('colonne uniche nello scope: ON senza qualifica (nessun nome tabella inutile)', () => {
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ['run_missioni'])
    const udc = ranked.find(r => r.table.name === 'DAT_UDC')!
    const missioni = summary.tables.find(t => t.name === 'RUN_MISSIONI')!
    const items = buildJoinSuggestions(udc, [missioni], true, false, new Set())
    expect(items[0].insertText).toBe('DAT_UDC ON (MIS_UDC = UDC_UDC)')
  })

  it('useAliases=true continua a generare alias su entrambi i lati (richiesta esplicita/self-join)', () => {
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ['run_missioni'])
    const udc = ranked.find(r => r.table.name === 'DAT_UDC')!
    const missioni = summary.tables.find(t => t.name === 'RUN_MISSIONI')!
    const items = buildJoinSuggestions(udc, [missioni], true, true, new Set())
    expect(items[0].insertText).toBe('DAT_UDC AS du ON (rm.MIS_UDC = du.UDC_UDC)')
  })
})
