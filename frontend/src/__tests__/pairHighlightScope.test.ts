// EVIDENZIAZIONE DELLA COPPIA (colonna ↔ valore): vale SOLO per l'INSERT, e solo fra lista colonne e
// VALUES / select-list. Niente evidenziazione nelle SELECT (comprese le assegnazioni "SELECT @x = col") né
// nella FROM/WHERE di un INSERT…SELECT.
//
// SEGNALAZIONE UTENTE: "se seleziono la parte dopo l'uguale a riga 199 fa un highlight sbagliato… l'highlight
// deve funzionare per insert e non ha senso nelle select".
import { describe, expect, it } from 'vitest'
import { pairHighlightTarget } from '../helpers'

const INSERT_VALUES = `INSERT INTO dbo.T (A, B, C) VALUES (1, 2, 3)`
const INSERT_SELECT = `INSERT INTO dbo.T (A, B)
SELECT X, Y
FROM dbo.S`
const STORE = `UPDATE dbo.T
  SET COL = 'x'
FROM dbo.T
SELECT @var = COL
FROM dbo.T
SELECT 1
EXEC dbo.p @a = @var`

describe('pairHighlightTarget: solo INSERT, niente SELECT', () => {
  it('VALUES: cursore su un valore → evidenzia la colonna corrispondente', () => {
    const off = INSERT_VALUES.indexOf('2')
    const t = pairHighlightTarget(INSERT_VALUES, off)
    expect(t).not.toBeNull()
    expect(INSERT_VALUES.slice(t!.start, t!.end)).toBe('B')
  })

  it('VALUES: cursore su una colonna → evidenzia il valore corrispondente', () => {
    const off = INSERT_VALUES.indexOf('C')
    const t = pairHighlightTarget(INSERT_VALUES, off)
    expect(t).not.toBeNull()
    expect(INSERT_VALUES.slice(t!.start, t!.end)).toBe('3')
  })

  it('INSERT … SELECT: cursore su un campo della select-list → evidenzia la colonna', () => {
    const off = INSERT_SELECT.indexOf('Y')
    const t = pairHighlightTarget(INSERT_SELECT, off)
    expect(t).not.toBeNull()
    expect(INSERT_SELECT.slice(t!.start, t!.end)).toBe('B')
  })

  it('INSERT … SELECT: nella FROM non evidenzia nulla', () => {
    const off = INSERT_SELECT.indexOf('dbo.S')
    expect(pairHighlightTarget(INSERT_SELECT, off)).toBeNull()
  })

  it('in una SELECT (anche con assegnazione) non evidenzia nulla', () => {
    const offSelect = STORE.indexOf('SELECT 1') + 'SELECT '.length
    expect(pairHighlightTarget(STORE, offSelect)).toBeNull()
    const offAssegnazione = STORE.indexOf('@var = COL') + '@var = '.length
    expect(pairHighlightTarget(STORE, offAssegnazione)).toBeNull()
  })

  it('nella UPDATE la SET evidenzia la coppia (colonna ↔ espressione)', () => {
    const off = STORE.indexOf("COL = 'x'") + 2
    const t = pairHighlightTarget(STORE, off)
    expect(t).not.toBeNull()
    expect(STORE.slice(t!.start, t!.end)).toBe("'x'")
  })

  it('nell EXEC con parametri non evidenzia nulla', () => {
    const off = STORE.indexOf('@a = @var') + 6
    expect(pairHighlightTarget(STORE, off)).toBeNull()
  })

  it('fuori da un INSERT non evidenzia nulla', () => {
    expect(pairHighlightTarget('SELECT 1', 3)).toBeNull()
    expect(pairHighlightTarget('', 0)).toBeNull()
  })
})
