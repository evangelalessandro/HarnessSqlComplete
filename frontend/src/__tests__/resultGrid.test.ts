// Griglia risultati: riordino delle colonne (trascinamento) e righe alternate a 3 colori.
import { describe, expect, it } from 'vitest'
import { identityOrder, reorderColumns, rowBackgroundClass, SELECTED_ROW_CLASS, ZEBRA_CLASSES } from '../resultGrid'

describe('ordine iniziale delle colonne', () => {
  it('è l identità (0,1,2,…)', () => {
    expect(identityOrder(4)).toEqual([0, 1, 2, 3])
    expect(identityOrder(0)).toEqual([])
    expect(identityOrder(-3)).toEqual([])
  })
})

describe('spostamento delle colonne con il trascinamento', () => {
  const order = [0, 1, 2, 3, 4]

  it('trascinando verso DESTRA la colonna finisce dopo quella puntata', () => {
    // colonna 0 rilasciata sulla colonna 2 → 1, 2, 0, 3, 4
    expect(reorderColumns(order, 0, 2)).toEqual([1, 2, 0, 3, 4])
  })

  it('trascinando verso SINISTRA la colonna finisce prima di quella puntata', () => {
    // colonna 4 rilasciata sulla colonna 1 → 0, 4, 1, 2, 3
    expect(reorderColumns(order, 4, 1)).toEqual([0, 4, 1, 2, 3])
  })

  it('spostamenti adiacenti', () => {
    expect(reorderColumns(order, 0, 1)).toEqual([1, 0, 2, 3, 4])
    expect(reorderColumns(order, 1, 0)).toEqual([1, 0, 2, 3, 4])
  })

  it('rilasciare su se stessa o su un indice inesistente non cambia nulla', () => {
    expect(reorderColumns(order, 2, 2)).toEqual(order)
    expect(reorderColumns(order, 9, 1)).toEqual(order)
    expect(reorderColumns(order, 1, 9)).toEqual(order)
  })

  it('non modifica l elenco di partenza (nessun effetto collaterale)', () => {
    const original = [0, 1, 2, 3]
    const copy = [...original]
    reorderColumns(original, 0, 3)
    expect(original).toEqual(copy)
  })

  it('conserva sempre tutte le colonne, una sola volta ciascuna', () => {
    let current = identityOrder(8)
    const moves: [number, number][] = [
      [0, 7],
      [5, 2],
      [3, 3],
      [1, 6],
      [7, 0],
    ]
    for (const [from, to] of moves) current = reorderColumns(current, from, to)
    expect([...current].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('spostare avanti e poi indietro riporta all ordine di partenza', () => {
    // 0,1,2,3,4 → trascino 0 sulla 3 → 1,2,3,0,4 → ritrascino 0 sulla 1 → 0,1,2,3,4
    const avanti = reorderColumns(order, 0, 3)
    expect(avanti).toEqual([1, 2, 3, 0, 4])
    expect(reorderColumns(avanti, 0, 1)).toEqual(order)
  })

  it('funziona anche partendo da un ordine già mescolato', () => {
    // ordine mostrato: 3,1,0,2 → trascino la colonna 0 (terza) sulla colonna 3 (prima)
    expect(reorderColumns([3, 1, 0, 2], 0, 3)).toEqual([0, 3, 1, 2])
  })
})

describe('righe alternate a TRE colori', () => {
  it('i tre colori si ripetono ogni tre righe', () => {
    expect(rowBackgroundClass(0, false)).toBe(ZEBRA_CLASSES[0])
    expect(rowBackgroundClass(1, false)).toBe(ZEBRA_CLASSES[1])
    expect(rowBackgroundClass(2, false)).toBe(ZEBRA_CLASSES[2])
    expect(rowBackgroundClass(3, false)).toBe(ZEBRA_CLASSES[0])
    expect(rowBackgroundClass(4, false)).toBe(ZEBRA_CLASSES[1])
    expect(rowBackgroundClass(5, false)).toBe(ZEBRA_CLASSES[2])
  })

  it('sono tre colori DISTINTI', () => {
    expect(new Set(ZEBRA_CLASSES).size).toBe(3)
  })

  it('sono OPACHI: le celle fisse del numero di riga devono coprire ciò che scorre sotto', () => {
    for (const c of ZEBRA_CLASSES) expect(c, `colore trasparente: ${c}`).not.toContain('/')
    expect(SELECTED_ROW_CLASS).not.toContain('/')
  })

  it('la riga selezionata ha la precedenza sulla fascia', () => {
    expect(rowBackgroundClass(0, true)).toBe(SELECTED_ROW_CLASS)
    expect(rowBackgroundClass(4, true)).toBe(SELECTED_ROW_CLASS)
  })

  it('indici negativi o fuori scala non escono dall elenco', () => {
    expect(ZEBRA_CLASSES).toContain(rowBackgroundClass(-1, false))
    expect(ZEBRA_CLASSES).toContain(rowBackgroundClass(1000, false))
  })
})
