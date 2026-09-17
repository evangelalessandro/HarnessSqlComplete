import { describe, expect, it } from 'vitest'
import { buildColumnContextSuggestions, buildSelectListSuggestions, rankSelectListForTyped } from '../helpers'
import { classifyContext } from '../intellisenseContext'
import { mkCol, mkTbl, demoStoreLikeSummary } from './schema'

/**
 * "select uso ... from MAG_BAIE": digitando "uso" l'intellisense deve proporre SOLO
 * le colonne della tabella che contengono "uso" nel nome (es. BCO_USOBAIA) — non
 * tutte le chiavi esterne della tabella (bug: il boost FK +150 era applicato prima
 * del filtro di affinità e faceva comparire colonne senza "uso" nel nome).
 */
describe('intellisense: colonne con "uso" nel nome su MAG_BAIE', () => {
  const summary = demoStoreLikeSummary()
  summary.tables.push(
    mkTbl('dbo', 'MAG_BAIE', [
      mkCol('BCO_USOBAIA', 'nvarchar'),
      mkCol('BCO_BAIA', 'int'), // FK ma SENZA "uso" nel nome: non deve comparire
      mkCol('BCO_AREA', 'nvarchar'), // FK ma SENZA "uso": non deve comparire
      mkCol('BCO_USC', 'int'), // senza "uso": non deve comparire
      mkCol('BCO_USOFK', 'nvarchar'), // FK E con "uso": deve stare in cima
      mkCol('BCO_BAY_RESET', 'bit'),
    ]),
  )
  summary.foreignKeys.push(
    { name: 'FK_BCO_BAIA', schema: 'dbo', table: 'MAG_BAIE', column: 'BCO_BAIA', refSchema: 'dbo', refTable: 'DAT_X', refColumn: 'id' },
    { name: 'FK_BCO_AREA', schema: 'dbo', table: 'MAG_BAIE', column: 'BCO_AREA', refSchema: 'dbo', refTable: 'DAT_Y', refColumn: 'id' },
    { name: 'FK_BCO_USOFK', schema: 'dbo', table: 'MAG_BAIE', column: 'BCO_USOFK', refSchema: 'dbo', refTable: 'DAT_Z', refColumn: 'id' },
  )

  it('select list: digitando "uso" compaiono solo le colonne con "uso" (FK prima tra quelle che matchano)', () => {
    const sel = buildSelectListSuggestions('select uso from MAG_BAIE', 'select uso ', summary)
    const ranked = rankSelectListForTyped(sel.columns, 'uso')
    expect(ranked.map(r => r.col.name)).toEqual(['BCO_USOFK', 'BCO_USOBAIA'])
  })

  it('select list: le colonne FK senza "uso" NON compaiono', () => {
    const sel = buildSelectListSuggestions('select uso from MAG_BAIE', 'select uso ', summary)
    const names = rankSelectListForTyped(sel.columns, 'uso').map(r => r.col.name)
    expect(names).not.toContain('BCO_BAIA')
    expect(names).not.toContain('BCO_AREA')
    expect(names).not.toContain('BCO_USC')
    expect(names).not.toContain('BCO_BAY_RESET')
  })

  it('where: digitando "uso" solo le colonne con "uso" (BCO_USOFK prima per il boost FK)', () => {
    const before = 'select * from MAG_BAIE where '
    const ctx = classifyContext({ prefix: before, stmtBefore: before })
    expect(ctx.isColumnContext).toBe(true)
    const cols = buildColumnContextSuggestions('select * from MAG_BAIE where uso', before, 'uso', summary)
    expect(cols.map(c => c.name)).toEqual(['BCO_USOFK', 'BCO_USOBAIA'])
    expect(cols.some(c => c.name === 'BCO_BAIA')).toBe(false)
    expect(cols.some(c => c.name === 'BCO_AREA')).toBe(false)
  })

  it('senza parola digitata compaiono tutte le colonne (come prima)', () => {
    const sel = buildSelectListSuggestions('select  from MAG_BAIE', 'select  ', summary)
    const names = sel.columns.map(c => c.name)
    expect(names).toContain('BCO_USOBAIA')
    expect(names).toContain('BCO_BAIA')
    expect(names).toContain('BCO_BAY_RESET')
  })
})
