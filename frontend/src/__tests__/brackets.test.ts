import { describe, expect, it } from 'vitest'
import { qualified, sqlIdent } from '../helpers'

describe('parentesi quadre intelligenti', () => {
  it('nomi semplici senza parentesi', () => {
    expect(sqlIdent('MIS_UDC')).toBe('MIS_UDC')
    expect(sqlIdent('UDC_UDCPRED')).toBe('UDC_UDCPRED')
    expect(sqlIdent('_tmp')).toBe('_tmp')
    expect(sqlIdent('A1')).toBe('A1')
  })

  it('parole riservate con parentesi', () => {
    expect(sqlIdent('order')).toBe('[order]')
    expect(sqlIdent('user')).toBe('[user]')
    expect(sqlIdent('select')).toBe('[select]')
  })

  it('nomi pericolosi con parentesi', () => {
    expect(sqlIdent('Order Details')).toBe('[Order Details]')
    expect(sqlIdent('2col')).toBe('[2col]')
    expect(sqlIdent('col-x')).toBe('[col-x]')
  })

  it('qualified: dbo senza prefisso, schema con punto, senza parentesi se sicuri', () => {
    expect(qualified('dbo', 'RUN_MISSIONI')).toBe('RUN_MISSIONI')
    expect(qualified('sales', 'Ordini')).toBe('sales.Ordini')
    expect(qualified('dbo', 'Order Details')).toBe('[Order Details]')
    expect(qualified('my schema', 'Tabella')).toBe('[my schema].Tabella')
  })
})
