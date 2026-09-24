import { describe, expect, it } from 'vitest'
import { compareTableReport, scriptDeleteTablesContent, sortTableReport, topTablesBySize } from '../helpers'
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

// ISTOGRAMMA: le 20 tabelle più pesanti (richiesta utente: "anche un istogramma con quelle 20 più
// pesanti") e SVUOTAMENTO del contenuto delle tabelle selezionate, in una nuova tab.
describe('Report tabelle: istogramma delle più pesanti', () => {
  it('ordina per spazio RISERVATO, dalla più grande, e taglia a 20', () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      mkRow(`T${String(i).padStart(2, '0')}`, { reservedKb: (i + 1) * 100, dataKb: (i + 1) * 10 }),
    )
    const top = topTablesBySize(rows)
    expect(top).toHaveLength(20)
    expect(top[0].name).toBe('T24')
    expect(top[19].name).toBe('T05')
    for (let i = 1; i < top.length; i++) expect(top[i - 1].reservedKb).toBeGreaterThanOrEqual(top[i].reservedKb)
  })

  it('lascia fuori le tabelle vuote e usa il nome come spareggio', () => {
    const rows = [
      mkRow('Vuota'),
      mkRow('Pari_B', { reservedKb: 500 }),
      mkRow('Pari_A', { reservedKb: 500 }),
      mkRow('Grande', { reservedKb: 900 }),
    ]
    expect(topTablesBySize(rows).map(r => r.name)).toEqual(['Grande', 'Pari_A', 'Pari_B'])
  })

  it('il numero di barre si può chiedere diverso da 20', () => {
    const rows = [mkRow('A', { reservedKb: 3 }), mkRow('B', { reservedKb: 2 })]
    expect(topTablesBySize(rows, 1).map(r => r.name)).toEqual(['A'])
    expect(topTablesBySize(rows, 0)).toEqual([])
  })
})

describe('Report tabelle: script DELETE del contenuto delle selezionate', () => {
  const scelte = [
    { schema: 'dbo', name: 'STA_STORICO', rowCount: 1234567, dataKb: 2 * 1024 * 1024, reservedKb: 3 * 1024 * 1024 },
    { schema: 'dbo', name: 'DAT_UDC', rowCount: 42, dataKb: 512, reservedKb: 1024 },
    { schema: 'usr', name: 'T', rowCount: 0 },
  ]

  it('un DELETE FROM per ogni tabella, fra parentesi quadre e chiuso da ;', () => {
    const sql = scriptDeleteTablesContent(scelte)
    expect(sql).toContain('DELETE FROM [dbo].[STA_STORICO];')
    expect(sql).toContain('DELETE FROM [dbo].[DAT_UDC];')
    expect(sql).toContain('DELETE FROM [usr].[T];')
    expect(sql.match(/DELETE FROM/g)).toHaveLength(3)
  })

  it('dice cosa si sta cancellando (righe e spazio) e avvisa che è irreversibile', () => {
    const sql = scriptDeleteTablesContent(scelte)
    expect(sql).toContain('Svuota il contenuto di 3 tabelle')
    expect(sql).toContain('1.234.567 righe') // separatori italiani
    expect(sql).toContain('2.0 GB di dati')
    expect(sql).toContain('3.0 GB su disco')
    expect(sql).toContain('non si possono recuperare')
    expect(sql).toContain('chiavi esterne entranti')
  })

  it('con una sola tabella il testo è al singolare e senza selezione non genera nulla', () => {
    expect(scriptDeleteTablesContent([scelte[0]])).toContain('Svuota il contenuto di 1 tabella:')
    expect(scriptDeleteTablesContent([])).toBe('')
  })
})
