// MULTI-CURSORE A COLONNA: riempimento con spazi delle righe corte.
// Richiesta utente: con il multi cursore su più righe (una vuota in mezzo), digitando SSMS riempie
// la riga vuota di spazi per restare allineato alle altre; Monaco no.
import { describe, expect, it } from 'vitest'
import { riempimentiPerColonna } from '../multiCursorColonna'

const QUERY = ['SELECT 1', '', 'BEGIN', '  print', '', '  print', '', 'end']

describe('riempimentiPerColonna', () => {
  it('con i cursori sulle due print riempie la riga vuota in mezzo', () => {
    // cursori a fine riga delle due print (colonna 8) e sulla riga vuota (Monaco la mette a colonna 1)
    const r = riempimentiPerColonna(QUERY, [
      { lineNumber: 4, column: 8 },
      { lineNumber: 5, column: 1 },
      { lineNumber: 6, column: 8 },
    ])
    console.log(`  riempimenti: ${JSON.stringify(r)}`)
    expect(r).toHaveLength(1)
    expect(r[0].lineNumber).toBe(5)
    expect(r[0].spazi).toHaveLength(7) // la riga vuota arriva a 7 caratteri: "  print" è lunga 7
    expect(r[0].colonna).toBe(8)
  })

  it('le righe che arrivano già alla colonna non vengono toccate', () => {
    const r = riempimentiPerColonna(QUERY, [
      { lineNumber: 4, column: 8 },
      { lineNumber: 6, column: 8 },
    ])
    expect(r).toHaveLength(0)
  })

  it('un solo cursore o tutti sulla stessa riga → niente da fare', () => {
    expect(riempimentiPerColonna(QUERY, [{ lineNumber: 4, column: 8 }])).toEqual([])
    expect(
      riempimentiPerColonna(QUERY, [
        { lineNumber: 4, column: 8 },
        { lineNumber: 4, column: 3 },
      ]),
    ).toEqual([])
  })

  it('due righe corte diverse: ognuna si riempie fino alla colonna più avanzata', () => {
    const righe = ['abc', '', '  x', 'abcdef']
    const r = riempimentiPerColonna(righe, [
      { lineNumber: 1, column: 4 },
      { lineNumber: 2, column: 1 },
      { lineNumber: 3, column: 4 },
      { lineNumber: 4, column: 7 },
    ])
    console.log(`  ${JSON.stringify(r)}`)
    expect(r.map(x => x.lineNumber)).toEqual([1, 2, 3])
    expect(r[0].spazi).toHaveLength(3) // "abc" → 6 caratteri
    expect(r[1].spazi).toHaveLength(6) // "" → 6 caratteri
    expect(r[2].spazi).toHaveLength(3) // "  x" → 6 caratteri
  })

  it('un cursore in colonna 1 con un altro in colonna 1 → niente da fare', () => {
    expect(
      riempimentiPerColonna(['', ''], [
        { lineNumber: 1, column: 1 },
        { lineNumber: 2, column: 1 },
      ]),
    ).toEqual([])
  })

  it('non tocca una riga con il cursore in mezzo al testo', () => {
    // riga 1: cursore a colonna 3 (in mezzo a "abcdef") → NON si sposta in fondo.
    // La riga vuota invece si riempie fino alla colonna del cursore più avanzato (3 → 2 spazi).
    const r = riempimentiPerColonna(['abcdef', ''], [
      { lineNumber: 1, column: 3 },
      { lineNumber: 2, column: 1 },
    ])
    console.log(`  ${JSON.stringify(r)}`)
    expect(r.map(x => x.lineNumber)).toEqual([2])
    expect(r[0].spazi).toHaveLength(2)
  })

  it('ignora più cursori sulla stessa riga (conta una volta)', () => {
    const r = riempimentiPerColonna(['', 'xy'], [
      { lineNumber: 1, column: 1 },
      { lineNumber: 1, column: 1 },
      { lineNumber: 2, column: 3 },
    ])
    expect(r).toHaveLength(1)
    expect(r[0].lineNumber).toBe(1)
    expect(r[0].spazi).toHaveLength(2)
  })
})
