import { describe, expect, it } from 'vitest'
import { compareTableReport, sortTableReport } from '../helpers'
import type { TableReportRow } from '../types'

function mkRow(name: string, partial: Partial<TableReportRow> = {}): TableReportRow {
  return {
    schema: 'dbo',
    name,
    createDate: null,
    rowCount: 0,
    reservedKb: 0,
    usedKb: 0,
    dataKb: 0,
    indexKb: 0,
    unusedKb: 0,
    indexCount: 0,
    reads: 0,
    writes: 0,
    lastRead: null,
    lastWrite: null,
    ...partial,
  }
}

describe('Report tabelle: ordinamento per colonna selezionata', () => {
  it('ordina per spazio riservato (numerico) discendente', () => {
    const rows = [
      mkRow('A', { reservedKb: 100 }),
      mkRow('B', { reservedKb: 300 }),
      mkRow('C', { reservedKb: 200 }),
    ]
    expect(sortTableReport(rows, 'reservedKb', 'desc').map(r => r.name)).toEqual(['B', 'C', 'A'])
    expect(sortTableReport(rows, 'reservedKb', 'asc').map(r => r.name)).toEqual(['A', 'C', 'B'])
  })

  it('ordina per nome (stringa) crescente, senza mutare l\'originale', () => {
    const rows = [mkRow('zeta'), mkRow('alfa'), mkRow('beta')]
    const sorted = sortTableReport(rows, 'name', 'asc')
    expect(sorted.map(r => r.name)).toEqual(['alfa', 'beta', 'zeta'])
    expect(rows.map(r => r.name)).toEqual(['zeta', 'alfa', 'beta']) // originale intatto
  })

  it('i valori null (date mai lette) vanno in fondo in senso crescente', () => {
    const rows = [
      mkRow('A', { lastRead: null }),
      mkRow('B', { lastRead: '2026-08-28T10:00:00.000' }),
      mkRow('C', { lastRead: '2026-08-28T09:00:00.000' }),
    ]
    expect(sortTableReport(rows, 'lastRead', 'asc').map(r => r.name)).toEqual(['C', 'B', 'A'])
  })

  it('compare numerici: differenza diretta', () => {
    expect(compareTableReport(mkRow('A', { reads: 5 }), mkRow('B', { reads: 9 }), 'reads')).toBe(-4)
  })
})
