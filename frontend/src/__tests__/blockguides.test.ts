// GUIDE DEI BLOCCHI (BEGIN/END) — ora servono all'EVIDENZIAZIONE delle keyword: le linee verticali
// sono quelle native di Monaco.
//
// Segnalazione utente: "aprendo questa SP gestisce malissimo la visualizzazione delle righe verticali".
// Cause trovate su ws_L2_Engine_Automatismi e regole nuove:
//  - la linea partiva dalla colonna della KEYWORD "begin" (a metà riga in "if … begin") → ora c'è
//    `indentColumn`, l'indentazione della riga di apertura;
//  - gli IF (anche senza BEGIN) producevano guide accoppiate a un END qualsiasi (blocchi inesistenti)
//    → niente più guide per gli IF;
//  - i CASE facevano guide anche su una riga sola → i CASE si contano solo per bilanciare gli END.
import { describe, expect, it } from 'vitest'
import { computeBlockGuides } from '../sqlBlockGuides'

describe('computeBlockGuides: blocchi BEGIN/END', () => {
  it('BEGIN/END semplice produce una guida', () => {
    const text = `BEGIN\n  SELECT 1\nEND`
    const guides = computeBlockGuides(text)
    expect(guides.length).toBe(1)
    expect(guides[0].kind).toBe('begin')
    expect(guides[0].openLine).toBe(1)
    expect(guides[0].closeLine).toBe(3)
    expect(guides[0].column).toBe(1)
    expect(guides[0].indentColumn).toBe(1)
    expect(guides[0].depth).toBe(0)
  })

  it('blocchi annidati hanno profondità crescenti', () => {
    const text = `BEGIN\n  IF x = 1\n  BEGIN\n    SELECT 1\n  END\nEND`
    const guides = computeBlockGuides(text)
    expect(guides).toHaveLength(2)
    expect(guides.map(g => g.depth).sort()).toEqual([0, 1])
  })

  it('l IF con BEGIN non produce una seconda guida (prima erano linee doppie)', () => {
    const text = `IF @a = 1\nBEGIN\n  SELECT 1\nEND\nIF @b = 2\nBEGIN\n  SELECT 2\nEND`
    const guides = computeBlockGuides(text)
    expect(guides).toHaveLength(2)
    expect(guides.map(g => g.closeLine)).toEqual([4, 8])
  })

  it('IF senza BEGIN non produce guide e non confonde gli END', () => {
    const text = `BEGIN\n  IF @a = 1\n    SET @b = 2\n  SELECT 3\nEND`
    const guides = computeBlockGuides(text)
    expect(guides.length).toBe(1)
    expect(guides[0].openLine).toBe(1)
    expect(guides[0].closeLine).toBe(5)
  })

  it('la colonna della LINEA è l indentazione della riga di apertura, non quella di "begin"', () => {
    // "if @fn = 1 begin": il BEGIN sta alla colonna 17, ma il blocco comincia alla colonna 5
    const testoSenzaIndentazione = `if @fn = 1 begin\n  select 1\nend`
    const g1 = computeBlockGuides(testoSenzaIndentazione)
    expect(g1).toHaveLength(1)
    expect(g1[0].column).toBe(12) // posizione della keyword BEGIN (per l'evidenziazione)
    expect(g1[0].indentColumn).toBe(1) // la linea si disegna dove comincia il blocco
    const testoIndentato = `    if @fn = 1 begin\n      select 1\n    end`
    const g2 = computeBlockGuides(testoIndentato)
    expect(g2[0].indentColumn).toBe(5)
  })

  it('CASE/END non produce più guide (prima anche su una riga sola)', () => {
    expect(computeBlockGuides(`SELECT CASE WHEN a = 1 THEN 1 ELSE 0 END FROM T`)).toHaveLength(0)
  })

  it('un CASE non sbilancia la guida del BEGIN che lo contiene', () => {
    const text = `BEGIN\n  SELECT CASE WHEN a = 1 THEN 1 ELSE 0 END\nEND`
    const guides = computeBlockGuides(text)
    expect(guides).toHaveLength(1)
    expect(guides[0].closeLine).toBe(3)
  })

  it('blocco su una riga sola non produce guida', () => {
    expect(computeBlockGuides(`BEGIN SELECT 1 END`)).toHaveLength(0)
  })

  it('keyword dentro stringhe e commenti ignorate', () => {
    const text = `SELECT 'BEGIN END' AS x -- BEGIN commento\nBEGIN\nEND`
    const guides = computeBlockGuides(text)
    expect(guides.length).toBe(1)
    expect(guides[0].openLine).toBe(2)
    expect(guides[0].closeLine).toBe(3)
  })

  it('END senza apertura non produce guida', () => {
    expect(computeBlockGuides(`SELECT 1\nEND`)).toHaveLength(0)
  })

  it('blocco non chiuso arriva fino all ultima riga', () => {
    const text = `BEGIN\n  SELECT 1\nGO`
    const guides = computeBlockGuides(text)
    expect(guides.length).toBe(1)
    expect(guides[0].closeLine).toBe(3)
  })

  it('keyword dentro parentesi (funzioni) ignorate', () => {
    expect(computeBlockGuides(`SELECT dbo.fn(BEGIN, END) FROM T`)).toHaveLength(0)
  })

  it('BEGIN TRAN e BEGIN DISTRIBUTED TRANSACTION non aprono un blocco', () => {
    expect(computeBlockGuides(`BEGIN TRAN\nSELECT 1\nCOMMIT`)).toHaveLength(0)
    expect(computeBlockGuides(`BEGIN DISTRIBUTED TRANSACTION\nSELECT 1\nCOMMIT`)).toHaveLength(0)
  })

  it('BEGIN TRAN dentro un blocco non genera guide fantasma', () => {
    const text = `IF @a = 1\nBEGIN\n  BEGIN TRAN\n  SELECT 1\n  COMMIT\nEND`
    const guides = computeBlockGuides(text)
    expect(guides).toHaveLength(1)
    expect(guides[0].openLine).toBe(2)
    expect(guides[0].closeLine).toBe(6)
  })
})
