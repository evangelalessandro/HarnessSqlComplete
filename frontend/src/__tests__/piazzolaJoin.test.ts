import { describe, expect, it } from 'vitest'
import {
  buildColumnContextSuggestions,
  buildJoinSuggestions,
  detectLeftColumnInOn,
  findJoinCounterparts,
  rankTablesForJoin,
} from '../helpers'
import { classifyContext } from '../intellisenseContext'
import { mkCol, mkTbl, demoStoreLikeSummary } from './schema'

/**
 * Scenario reale: "inner join MAG_BAIE_PIAZ ON (BCO_BAIA = BPZ_BAIA) inner join
 * GESTORI_MODULI ON (GM_PIAZZOLA = pia".
 * 1) digitando "pia" dopo "GM_PIAZZOLA = " l'intellisense deve proporre per primo
 *    BPZ_PIAZZOLA (colonna di MAG_BAIE_PIAZ che referenzia la STESSA chiave PZ_PIAZZOLA);
 * 2) il suggerimento di JOIN per GESTORI_MODULI deve includere la relazione con
 *    MAG_BAIE_PIAZ (GM_PIAZZOLA = BPZ_PIAZZOLA) anche senza FK diretta (via MAG_PIAZZOLE).
 */
describe('intellisense piazzola (GESTORI_MODULI ↔ MAG_BAIE_PIAZ)', () => {
  const summary = demoStoreLikeSummary()
  summary.tables.push(
    mkTbl('dbo', 'MAG_BAIE', [mkCol('BCO_BAIA', 'int')]),
    mkTbl('dbo', 'MAG_BAIE_PIAZ', [mkCol('BPZ_BAIA', 'int'), mkCol('BPZ_PIAZZOLA', 'int')]),
    mkTbl('dbo', 'MAG_PIAZZOLE', [mkCol('PZ_PIAZZOLA', 'int')]),
    mkTbl('dbo', 'GESTORI_MODULI', [mkCol('GM_PIAZZOLA', 'int'), mkCol('GM_SG_EVAC_BAIA', 'int')]),
  )
  summary.foreignKeys.push(
    { name: 'FK_MAG_BAIE_PIAZ_MAG_BAIE', schema: 'dbo', table: 'MAG_BAIE_PIAZ', column: 'BPZ_BAIA', refSchema: 'dbo', refTable: 'MAG_BAIE', refColumn: 'BCO_BAIA' },
    { name: 'FK_MAG_BAIE_PIAZ_MAG_PIAZZOLE', schema: 'dbo', table: 'MAG_BAIE_PIAZ', column: 'BPZ_PIAZZOLA', refSchema: 'dbo', refTable: 'MAG_PIAZZOLE', refColumn: 'PZ_PIAZZOLA' },
    { name: 'FK_GESTORI_MODULI_MAG_PIAZZOLE', schema: 'dbo', table: 'GESTORI_MODULI', column: 'GM_PIAZZOLA', refSchema: 'dbo', refTable: 'MAG_PIAZZOLE', refColumn: 'PZ_PIAZZOLA' },
    { name: 'FK_GESTORI_MODULI_MAG_BAIE', schema: 'dbo', table: 'GESTORI_MODULI', column: 'GM_SG_EVAC_BAIA', refSchema: 'dbo', refTable: 'MAG_BAIE', refColumn: 'BCO_BAIA' },
  )

  const stmt = `select * FROM dat_udc inner join MAG_BAIE on bco_usobaia like '%,INKIT,%' inner join MAG_BAIE_PIAZ ON (BCO_BAIA = BPZ_BAIA) inner join GESTORI_MODULI ON (GM_PIAZZOLA = pia`
  const before = `select * FROM dat_udc inner join MAG_BAIE on bco_usobaia like '%,INKIT,%' inner join MAG_BAIE_PIAZ ON (BCO_BAIA = BPZ_BAIA) inner join GESTORI_MODULI ON (GM_PIAZZOLA = `

  it('detectLeftColumnInOn riconosce la colonna anche dentro la parentesi "ON ("', () => {
    expect(detectLeftColumnInOn(before)).toEqual({ name: 'GM_PIAZZOLA', qualifier: null })
  })

  it('digitando "pia" propone per primo BPZ_PIAZZOLA (stessa chiave PZ_PIAZZOLA)', () => {
    const ctx = classifyContext({ prefix: before, stmtBefore: before })
    expect(ctx.isColumnContext).toBe(true)
    const cols = buildColumnContextSuggestions(stmt, before, 'pia', summary)
    expect(cols.length).toBeGreaterThan(0)
    expect(cols[0].name).toBe('BPZ_PIAZZOLA')
    expect(cols[0].ownerLabel).toContain('MAG_BAIE_PIAZ')
  })

  it('la colonna sinistra già scritta (GM_PIAZZOLA) non viene riproposta', () => {
    const cols = buildColumnContextSuggestions(stmt, before, 'pia', summary)
    expect(cols.some(c => c.name === 'GM_PIAZZOLA')).toBe(false)
  })

  it('findJoinCounterparts: partner con target FK condiviso al primo posto', () => {
    const gm = summary.tables.find(t => t.name === 'GESTORI_MODULI')!
    const tables = summary.tables.filter(t => ['DAT_UDC', 'MAG_BAIE', 'MAG_BAIE_PIAZ', 'GESTORI_MODULI'].includes(t.name))
    const cps = findJoinCounterparts('GM_PIAZZOLA', gm, tables, summary.foreignKeys)
    expect(cps[0].column.name).toBe('BPZ_PIAZZOLA')
    expect(cps[0].viaFk).toBe(true)
  })

  it('il JOIN di GESTORI_MODULI include la relazione via piazzola con MAG_BAIE_PIAZ', () => {
    const ctxNames = ['dat_udc', 'mag_baie', 'mag_baie_piaz']
    const ctxInfos = summary.tables.filter(t => ctxNames.includes(t.name.toLowerCase()))
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ctxNames)
    const gm = ranked.find(r => r.table.name === 'GESTORI_MODULI')!
    expect(gm.viaPaths?.some(p => p.midTable === 'MAG_PIAZZOLE' && p.ctxTable === 'MAG_BAIE_PIAZ')).toBe(true)
    const items = buildJoinSuggestions(gm, ctxInfos, true, false, new Set())
    expect(items.some(i => i.insertText === 'GESTORI_MODULI ON (GM_PIAZZOLA = BPZ_PIAZZOLA)')).toBe(true)
  })
})
