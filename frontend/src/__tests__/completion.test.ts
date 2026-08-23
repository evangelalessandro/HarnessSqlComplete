import { describe, expect, it } from 'vitest'
import {
  buildColumnContextSuggestions,
  columnMatchScore,
  detectLeftColumnInOn,
  findJoinCounterparts,
} from '../helpers'
import { mkCol, mkTbl } from './schema'

describe('columnMatchScore: affinità colonne digitate', () => {
  it('prefisso esatto ha il punteggio più alto', () => {
    expect(columnMatchScore('mis_corr', 'mis_corridoio')).toBeGreaterThan(
      columnMatchScore('mis_corr', 'mis_d_corridoio'),
    )
    expect(columnMatchScore('mis_corr', 'mis_corridoio')).toBeGreaterThan(0)
  })

  it('token in ordine: mis_corr → mis_d_corridoio / mis_s_corridoio', () => {
    const d = columnMatchScore('mis_corr', 'mis_d_corridoio')
    const s = columnMatchScore('mis_corr', 'mis_s_corridoio')
    expect(d).toBeGreaterThan(0)
    expect(s).toBeGreaterThan(0)
    // più vicini del token condiviso parziale
    expect(d).toBeGreaterThan(columnMatchScore('mis_corr', 'mis_udc'))
  })

  it('case-insensitive', () => {
    expect(columnMatchScore('MIS_CORR', 'mis_d_corridoio')).toBe(columnMatchScore('mis_corr', 'mis_d_corridoio'))
  })

  it('nessuna affinità → 0', () => {
    expect(columnMatchScore('mis_corr', 'cel_cella')).toBe(0)
    expect(columnMatchScore('xyz', 'mis_udc')).toBe(0)
  })

  it('sottostringa nel mezzo: corr dentro corridoio', () => {
    expect(columnMatchScore('corr', 'cel_corridoio')).toBeGreaterThan(0)
  })

  it('query vuota → 0', () => {
    expect(columnMatchScore('', 'mis_udc')).toBe(0)
  })
})

describe('detectLeftColumnInOn: colonna sinistra di "col = "', () => {
  it('ON mis_corr = ', () => {
    expect(detectLeftColumnInOn('SELECT * FROM t INNER JOIN m ON mis_corr = ')).toEqual({
      name: 'mis_corr',
      qualifier: null,
    })
  })

  it('con qualificatore alias', () => {
    expect(detectLeftColumnInOn('FROM a JOIN b ON a.mis_corr = ')).toEqual({
      name: 'mis_corr',
      qualifier: 'a',
    })
  })

  it('WHERE x = ', () => {
    expect(detectLeftColumnInOn('WHERE x = ')).toEqual({ name: 'x', qualifier: null })
  })

  it('senza "=" → null', () => {
    expect(detectLeftColumnInOn('ON mis_corr')).toBeNull()
  })

  it('con parentesi quadre', () => {
    expect(detectLeftColumnInOn('ON [mis_corr] = ')).toEqual({ name: 'mis_corr', qualifier: null })
  })
})

describe('findJoinCounterparts: controparti di JOIN', () => {
  const mis = mkTbl('dbo', 'RUN_MISSIONI', [
    mkCol('mis_udc', 'nvarchar'),
    mkCol('mis_corr', 'nvarchar'),
    mkCol('mis_d_cella', 'nvarchar'),
  ])
  const udc = mkTbl('dbo', 'DAT_UDC', [mkCol('udc_udc', 'nvarchar'), mkCol('udc_descr', 'nvarchar')])
  const celle = mkTbl('dbo', 'MAG_CELLE', [mkCol('cel_cella', 'nvarchar'), mkCol('cel_corridoio', 'nvarchar')])
  const fks = [
    { schema: 'dbo', table: 'RUN_MISSIONI', column: 'mis_udc', refSchema: 'dbo', refTable: 'DAT_UDC', refColumn: 'udc_udc' },
  ]

  it('FK esatta → colonna referenziata al primo posto', () => {
    const res = findJoinCounterparts('mis_udc', mis, [mis, udc, celle], fks)
    expect(res.length).toBeGreaterThan(0)
    expect(res[0].viaFk).toBe(true)
    expect(res[0].column.name).toBe('udc_udc')
    expect(res[0].table.name).toBe('DAT_UDC')
  })

  it('token condivisi: mis_corr → cel_corridoio (MAG_CELLE)', () => {
    const res = findJoinCounterparts('mis_corr', mis, [mis, udc, celle], fks)
    const byName = (n: string) => res.find(r => r.column.name === n)
    expect(byName('cel_corridoio')).toBeDefined()
  })

  it('mis_d_cella → cel_cella', () => {
    const res = findJoinCounterparts('mis_d_cella', mis, [mis, udc, celle], fks)
    expect(res.some(r => r.column.name === 'cel_cella')).toBe(true)
  })

  it('senza tabella sinistra: cerca token su tutte le tabelle', () => {
    const res = findJoinCounterparts('mis_corr', null, [mis, udc, celle], fks)
    expect(res.some(r => r.column.name === 'cel_corridoio')).toBe(true)
  })

  it('esclude la stessa colonna', () => {
    const res = findJoinCounterparts('mis_corr', mis, [mis, udc, celle], fks)
    expect(res.some(r => r.column.name === 'mis_corr')).toBe(false)
  })
})

describe('buildColumnContextSuggestions: suggerimenti per WHERE/ON', () => {
  const summary = {
    tables: [
      mkTbl('dbo', 'RUN_MISSIONI', [
        mkCol('mis_udc', 'nvarchar'),
        mkCol('mis_corr', 'nvarchar'),
        mkCol('mis_d_corridoio', 'nvarchar'),
        mkCol('mis_s_corridoio', 'nvarchar'),
        mkCol('mis_d_cella', 'nvarchar'),
      ]),
      mkTbl('dbo', 'DAT_UDC', [mkCol('udc_udc', 'nvarchar'), mkCol('udc_descr', 'nvarchar')]),
      mkTbl('dbo', 'MAG_CELLE', [mkCol('cel_cella', 'nvarchar'), mkCol('cel_corridoio', 'nvarchar')]),
    ],
    views: [],
    procedures: [],
    triggers: [],
    functions: [],
    foreignKeys: [
      { schema: 'dbo', table: 'RUN_MISSIONI', column: 'mis_udc', refSchema: 'dbo', refTable: 'DAT_UDC', refColumn: 'udc_udc' },
    ],
    databases: [],
  }

  it('digitando mis_corr → mis_corr esatto in testa, poi i corridoio affini', () => {
    const stmt = 'SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON mis_corr'
    const before = 'SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON '
    const res = buildColumnContextSuggestions(stmt, before, 'mis_corr', summary as never)
    const top = res.slice(0, 5).map(s => s.name)
    expect(top[0]).toBe('mis_corr') // corrispondenza esatta prima
    expect(top).toContain('mis_d_corridoio')
    expect(top).toContain('mis_s_corridoio')
    expect(res.every(s => s.score > 0)).toBe(true)
  })

  it('dopo "mis_corr = " propone la controparte cel_corridoio', () => {
    const stmt = 'SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON mis_corr = '
    const before = 'SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON mis_corr = '
    const res = buildColumnContextSuggestions(stmt, before, '', summary as never)
    const counterpart = res.find(s => s.counterpart && s.name === 'cel_corridoio')
    expect(counterpart).toBeDefined()
    expect(counterpart?.insertText).toBe('cel_corridoio')
  })

  it('dopo "mis_d_cella = " propone cel_cella', () => {
    const stmt = 'SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON mis_d_cella = '
    const before = 'SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON mis_d_cella = '
    const res = buildColumnContextSuggestions(stmt, before, '', summary as never)
    expect(res.some(s => s.counterpart && s.name === 'cel_cella')).toBe(true)
  })

  it('scenario utente: digitando cella/cel dopo "MIS_D_CELLA=" propone cel_cella in testa', () => {
    // l'utente scrive "...and MIS_D_CELLA=cella" (stmtBefore include la parola digitata)
    const stmt =
      'SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON MIS_D_CORRIDOIO = CEL_CORRIDOIO and MIS_D_CELLA=cella'
    const before =
      'SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON MIS_D_CORRIDOIO = CEL_CORRIDOIO and MIS_D_CELLA=cella'
    const res = buildColumnContextSuggestions(stmt, before, 'cella', summary as never)
    expect(res[0].name).toBe('cel_cella')
    expect(res[0].counterpart).toBe(true)
    // con "cel" la controparte resta in testa
    const beforeCel =
      'SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON MIS_D_CORRIDOIO = CEL_CORRIDOIO and MIS_D_CELLA=cel'
    const res2 = buildColumnContextSuggestions(stmt, beforeCel, 'cel', summary as never)
    expect(res2.some(s => s.name === 'cel_cella')).toBe(true)
  })

  it('dopo "mis_udc = " la FK esatta udc_udc viene prima delle altre', () => {
    const stmt = 'SELECT * FROM RUN_MISSIONI JOIN DAT_UDC ON mis_udc = '
    const before = 'SELECT * FROM RUN_MISSIONI JOIN DAT_UDC ON mis_udc = '
    const res = buildColumnContextSuggestions(stmt, before, '', summary as never)
    const first = res[0]
    expect(first.name).toBe('udc_udc')
    expect(first.counterpart).toBe(true)
  })

  it('senza parola né "=" → tutte le colonne dello statement', () => {
    const stmt = 'SELECT * FROM RUN_MISSIONI WHERE '
    const before = 'SELECT * FROM RUN_MISSIONI WHERE '
    const res = buildColumnContextSuggestions(stmt, before, '', summary as never)
    expect(res.some(s => s.name === 'mis_udc')).toBe(true)
    expect(res.some(s => s.name === 'mis_d_corridoio')).toBe(true)
  })

  it('boost FK: le colonne chiave (mis_udc) precedono le altre a parità di affinità', () => {
    const stmt = 'SELECT * FROM RUN_MISSIONI WHERE mis_'
    const before = 'SELECT * FROM RUN_MISSIONI WHERE '
    const res = buildColumnContextSuggestions(stmt, before, 'mis_', summary as never)
    // mis_udc è una FK (→ DAT_UDC): deve stare prima di mis_d_corridoio (non FK)
    const idxUdc = res.findIndex(s => s.name === 'mis_udc')
    const idxCorr = res.findIndex(s => s.name === 'mis_d_corridoio')
    expect(idxUdc).toBeGreaterThanOrEqual(0)
    expect(idxCorr).toBeGreaterThanOrEqual(0)
    expect(idxUdc).toBeLessThan(idxCorr)
  })

  it('con parola senza affinità → nessuna colonna', () => {
    const stmt = 'SELECT * FROM RUN_MISSIONI WHERE zzz'
    const before = 'SELECT * FROM RUN_MISSIONI WHERE '
    const res = buildColumnContextSuggestions(stmt, before, 'zzz', summary as never)
    expect(res.length).toBe(0)
  })
})
