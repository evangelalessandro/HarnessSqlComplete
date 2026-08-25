import { describe, expect, it } from 'vitest'
import { computeFoldingRanges } from '../sqlFolding'

describe('computeFoldingRanges: chiudi porzioni di codice', () => {
  it('blocco BEGIN/END produce un range', () => {
    const text = `BEGIN\n  SELECT 1\nEND`
    const ranges = computeFoldingRanges(text)
    expect(ranges).toHaveLength(1)
    expect(ranges[0]).toEqual({ start: 1, end: 3, kind: 'block' })
  })

  it('blocchi annidati producono range annidati', () => {
    const text = `BEGIN\n  BEGIN\n    SELECT 1\n  END\nEND`
    const ranges = computeFoldingRanges(text)
    expect(ranges).toHaveLength(2)
    const starts = ranges.map(r => r.start).sort()
    expect(starts).toEqual([1, 2])
    // il range interno è contenuto in quello esterno
    const outer = ranges.find(r => r.start === 1)!
    const inner = ranges.find(r => r.start === 2)!
    expect(inner.end).toBeLessThanOrEqual(outer.end)
  })

  it('IF...BEGIN genera un solo range (sul BEGIN)', () => {
    const text = `IF @a = 1\nBEGIN\n  SELECT 1\nEND`
    const ranges = computeFoldingRanges(text)
    expect(ranges).toHaveLength(1)
    expect(ranges[0]).toEqual({ start: 2, end: 4, kind: 'block' })
  })

  it('BEGIN TRAN non genera un blocco', () => {
    const text = `BEGIN TRAN\nSELECT 1\nCOMMIT`
    expect(computeFoldingRanges(text)).toHaveLength(0)
  })

  it('BEGIN DISTRIBUTED TRANSACTION non genera un blocco', () => {
    const text = `BEGIN DISTRIBUTED TRANSACTION\nSELECT 1\nCOMMIT`
    expect(computeFoldingRanges(text)).toHaveLength(0)
  })

  it('BEGIN TRAN dentro un blocco non lo rompe', () => {
    const text = `IF @a = 1\nBEGIN\n  BEGIN TRAN\n  SELECT 1\n  COMMIT\nEND`
    const ranges = computeFoldingRanges(text)
    expect(ranges).toHaveLength(1)
    expect(ranges[0]).toEqual({ start: 2, end: 6, kind: 'block' })
  })

  it('CASE/END multilinea produce un range', () => {
    const text = `SELECT CASE\n  WHEN a = 1 THEN 1\n  ELSE 0\nEND`
    const ranges = computeFoldingRanges(text)
    expect(ranges.some(r => r.kind === 'block' && r.start === 1 && r.end === 4)).toBe(true)
  })

  it('regioni SSMS --#region/--#endregion', () => {
    const text = `--#region Setup\nSELECT 1\n--#endregion`
    const ranges = computeFoldingRanges(text)
    expect(ranges.some(r => r.kind === 'region' && r.start === 1 && r.end === 3)).toBe(true)
  })

  it('regioni annidate', () => {
    const text = `--#region A\nSELECT 1\n--#region B\nSELECT 2\n--#endregion\nSELECT 3\n--#endregion`
    const regions = computeFoldingRanges(text).filter(r => r.kind === 'region')
    expect(regions).toHaveLength(2)
    const sorted = [...regions].sort((a, b) => a.start - b.start)
    expect(sorted[0]).toEqual({ start: 1, end: 7, kind: 'region' })
    expect(sorted[1]).toEqual({ start: 3, end: 5, kind: 'region' })
  })

  it('regione non chiusa non viene emessa', () => {
    const text = `--#region A\nSELECT 1`
    expect(computeFoldingRanges(text)).toHaveLength(0)
  })

  it('#endregion senza apertura non viene emesso', () => {
    const text = `SELECT 1\n--#endregion`
    expect(computeFoldingRanges(text)).toHaveLength(0)
  })

  it('commento /* */ su più righe produce un range comment', () => {
    const text = `/*\n  commento\n*/\nSELECT 1`
    const ranges = computeFoldingRanges(text)
    expect(ranges.some(r => r.kind === 'comment' && r.start === 1 && r.end === 3)).toBe(true)
  })

  it('commento su una sola riga non produce un range', () => {
    const text = `/* breve */\nSELECT 1`
    expect(computeFoldingRanges(text).filter(r => r.kind === 'comment')).toHaveLength(0)
  })

  it('stringhe e commenti di riga non creano falsi marker', () => {
    const text = `SELECT '--#region' AS x -- BEGIN\nBEGIN\nEND`
    const ranges = computeFoldingRanges(text)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].kind).toBe('block')
    expect(ranges[0].start).toBe(2)
    expect(ranges[0].end).toBe(3)
  })

  it('keyword in stringhe e commenti non generano blocchi', () => {
    const text = `SELECT 'BEGIN END' AS x /* BEGIN\nEND */\nGO`
    const ranges = computeFoldingRanges(text)
    // solo il commento multilinea è un range
    expect(ranges).toHaveLength(1)
    expect(ranges[0].kind).toBe('comment')
    expect(ranges[0].start).toBe(1)
    expect(ranges[0].end).toBe(2)
  })

  it('range sovrapposti parzialmente vengono scartati', () => {
    // blocco [1,6] e regione che inizia dentro e finisce fuori [3,8]: scartata
    const text = `BEGIN\n  SELECT 1\n--#region A\n  SELECT 2\n  SELECT 3\nEND\n--#endregion`
    const ranges = computeFoldingRanges(text)
    expect(ranges).toHaveLength(1)
    expect(ranges[0]).toEqual({ start: 1, end: 6, kind: 'block' })
  })
})
