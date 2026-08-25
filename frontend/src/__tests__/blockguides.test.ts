import { describe, expect, it } from 'vitest'
import { computeBlockGuides } from '../sqlBlockGuides'

describe('computeBlockGuides: righe verticali tra BEGIN/END', () => {
  it('BEGIN/END semplice produce una guida', () => {
    const text = `BEGIN\n  SELECT 1\nEND`
    const guides = computeBlockGuides(text)
    expect(guides.length).toBe(1)
    expect(guides[0].kind).toBe('begin')
    expect(guides[0].openLine).toBe(1)
    expect(guides[0].closeLine).toBe(3)
    expect(guides[0].column).toBe(1)
    expect(guides[0].depth).toBe(0)
  })

  it('blocchi annidati hanno profondità crescenti', () => {
    const text = `BEGIN\n  IF x = 1\n  BEGIN\n    SELECT 1\n  END\nEND`
    const guides = computeBlockGuides(text)
    const begins = guides.filter(g => g.kind === 'begin')
    const ifs = guides.filter(g => g.kind === 'if')
    expect(begins.length).toBe(2)
    // il blocco più interno ha depth maggiore
    const depths = begins.map(g => g.depth).sort()
    expect(depths).toEqual([0, 1])
    expect(ifs.length).toBe(1)
    // la guida IF parte dall'IF e arriva all'END del suo blocco BEGIN (riga 5)
    expect(ifs[0].openLine).toBe(2)
    expect(ifs[0].closeLine).toBe(5)
  })

  it('IF seguito da BEGIN si aggancia al blocco senza guide fantasma', () => {
    const text = `IF @a = 1\nBEGIN\n  SELECT 1\nEND\nIF @b = 2\nBEGIN\n  SELECT 2\nEND`
    const guides = computeBlockGuides(text)
    const begins = guides.filter(g => g.kind === 'begin')
    const ifs = guides.filter(g => g.kind === 'if')
    expect(begins.length).toBe(2)
    expect(ifs.length).toBe(2)
    // ogni IF si chiude all'END del proprio blocco, non all'ultima riga
    expect(ifs.map(g => g.closeLine)).toEqual([4, 8])
  })

  it('IF senza BEGIN non genera guide e non confonde gli END', () => {
    const text = `BEGIN\n  IF @a = 1\n    SET @b = 2\n  SELECT 3\nEND`
    const guides = computeBlockGuides(text)
    expect(guides.length).toBe(1)
    expect(guides[0].kind).toBe('begin')
    expect(guides[0].openLine).toBe(1)
    expect(guides[0].closeLine).toBe(5)
  })

  it('CASE/END produce una guida', () => {
    const text = `SELECT CASE WHEN a = 1 THEN 1 ELSE 0 END FROM T`
    const guides = computeBlockGuides(text)
    expect(guides.some(g => g.kind === 'case')).toBe(true)
  })

  it('keyword dentro stringhe e commenti ignorate', () => {
    const text = `SELECT 'BEGIN END' AS x -- BEGIN commento\nBEGIN\nEND`
    const guides = computeBlockGuides(text)
    expect(guides.length).toBe(1)
    // la BEGIN vera è alla riga 2: quelle dentro la stringa e il commento (riga 1) sono ignorate
    expect(guides[0].openLine).toBe(2)
    expect(guides[0].closeLine).toBe(3)
  })

  it('END senza apertura non produce guida', () => {
    const guides = computeBlockGuides(`SELECT 1\nEND`)
    expect(guides.length).toBe(0)
  })

  it('blocco non chiuso arriva fino all\'ultima riga', () => {
    const text = `BEGIN\n  SELECT 1\nGO`
    const guides = computeBlockGuides(text)
    expect(guides.length).toBe(1)
    expect(guides[0].closeLine).toBe(3)
  })

  it('keyword dentro parentesi (funzioni) ignorate', () => {
    const text = `SELECT dbo.fn(BEGIN, END) FROM T`
    const guides = computeBlockGuides(text)
    expect(guides.length).toBe(0)
  })

  it('BEGIN TRAN non apre un blocco', () => {
    const text = `BEGIN TRAN\nSELECT 1\nCOMMIT`
    expect(computeBlockGuides(text)).toHaveLength(0)
  })

  it('BEGIN DISTRIBUTED TRANSACTION non apre un blocco', () => {
    const text = `BEGIN DISTRIBUTED TRANSACTION\nSELECT 1\nCOMMIT`
    expect(computeBlockGuides(text)).toHaveLength(0)
  })

  it('BEGIN TRAN dentro un blocco non genera guide fantasma', () => {
    const text = `IF @a = 1\nBEGIN\n  BEGIN TRAN\n  SELECT 1\n  COMMIT\nEND`
    const guides = computeBlockGuides(text)
    expect(guides.filter(g => g.kind === 'begin')).toHaveLength(1)
    expect(guides.filter(g => g.kind === 'if')).toHaveLength(1)
    const begin = guides.find(g => g.kind === 'begin')!
    expect(begin.openLine).toBe(2)
    expect(begin.closeLine).toBe(6)
  })
})
