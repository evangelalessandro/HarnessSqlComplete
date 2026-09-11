// Rilevamento dei commenti: un singolo costrutto "sballato" in un file lungo non deve
// far credere all'intellisense di essere dentro un commento (in quel caso il provider
// restituisce lista vuota → Monaco mostra "No suggestions.").
import { describe, expect, it } from 'vitest'
import { isTextOffsetInComment } from '../helpers'

describe('isTextOffsetInComment', () => {
  it('commento di riga: dentro fino a fine riga, fuori dalla riga dopo', () => {
    const sql = 'select 1 -- nota\nfrom t'
    expect(isTextOffsetInComment(sql, sql.indexOf('nota'))).toBe(true)
    expect(isTextOffsetInComment(sql, sql.length)).toBe(false)
  })

  it('commento a blocco: dentro tra /* e */, fuori dopo', () => {
    const sql = 'select /* nota */ 1 from t'
    expect(isTextOffsetInComment(sql, sql.indexOf('nota'))).toBe(true)
    expect(isTextOffsetInComment(sql, sql.indexOf('1'))).toBe(false)
  })

  it('un apostrofo dentro un commento a blocco non apre una stringa', () => {
    const sql = "select /* Quantita' da prelevare */ 1\nfrom t"
    expect(isTextOffsetInComment(sql, sql.indexOf('Quantita'))).toBe(true)
    expect(isTextOffsetInComment(sql, sql.length)).toBe(false)
  })

  it('un apostrofo dentro [identificatore] non apre una stringa', () => {
    const sql = "select [Quantita'] = 1\nfrom t"
    expect(isTextOffsetInComment(sql, sql.length)).toBe(false)
  })

  it('apostrofo in [identificatore] + "/*" dentro una stringa: NON siamo in un commento (era il bug)', () => {
    const sql = "select [a'b] , '/*' + 1\nfrom t"
    expect(isTextOffsetInComment(sql, sql.length)).toBe(false)
  })

  it('stringa con "/*" dentro: il codice successivo resta codice', () => {
    const sql = "select '/*' as x, 2 as y\nfrom t"
    expect(isTextOffsetInComment(sql, sql.indexOf('from'))).toBe(false)
  })

  it('stringhe con apostrofo raddoppiato e apici vuoti', () => {
    const sql = "select 'un''UDS', N'', '' -- ciao\nfrom t"
    expect(isTextOffsetInComment(sql, sql.indexOf('ciao'))).toBe(true)
    expect(isTextOffsetInComment(sql, sql.length)).toBe(false)
  })

  it('doppi apici ("…") non fanno perdere il conto', () => {
    const sql = 'select "n--ome" as c1, 2\nfrom t'
    expect(isTextOffsetInComment(sql, sql.indexOf('from'))).toBe(false)
  })

  it('commento a blocco non chiuso: siamo dentro (comportamento voluto)', () => {
    const sql = 'select 1 /* aperto\nfrom t'
    expect(isTextOffsetInComment(sql, sql.length)).toBe(true)
  })

  it('nel codice normale non è mai un commento', () => {
    const sql = 'SELECT *\nFROM run\nWHERE MIS_UDC > 0'
    for (let i = 0; i <= sql.length; i++) expect(isTextOffsetInComment(sql, i)).toBe(false)
  })
})
