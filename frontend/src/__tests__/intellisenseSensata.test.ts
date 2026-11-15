// TEST DI SENSATEZZA dell'intellisense: nei contesti "chiusi" non deve proporre nulla e nei contesti
// di codice deve proporre le cose giuste.
//
// Segnalazione utente: "riesci a fare dei test sull'intellisense che dia risultati sensati e non
// proponga cose senza senso al momento sbagliato? tipo quando faccio un begin e scrivo la end mi
// propone invece una exec di una store procedure".
import { describe, expect, it } from 'vitest'
import { isTextOffsetInComment, isTextOffsetInString } from '../helpers'
import { classifyContext as ctx } from '../intellisenseContext'

describe('dentro una stringa o un commento non si propone nulla', () => {
  it('stringa aperta: offset dentro → true', () => {
    expect(isTextOffsetInString("select 'abc", 11)).toBe(true)
    expect(isTextOffsetInString("where x = 'a", 12)).toBe(true)
    expect(isTextOffsetInString('select "abc', 11)).toBe(true)
  })

  it('stringa chiusa: offset dopo → false', () => {
    expect(isTextOffsetInString("select 'abc'", 12)).toBe(false)
    expect(isTextOffsetInString("select 'abc' ", 13)).toBe(false)
  })

  it('apostrofo raddoppiato (escape) non chiude la stringa', () => {
    expect(isTextOffsetInString("select 'a''b", 13)).toBe(true)
    expect(isTextOffsetInString("select 'a''b'", 14)).toBe(false)
  })

  it('identificatore fra parentesi quadre con apostrofo non apre una stringa', () => {
    expect(isTextOffsetInString("[Quantita'] x", 13)).toBe(false)
  })

  it('commento dentro una stringa non conta come commento', () => {
    expect(isTextOffsetInComment("select '-- non è un commento", 28)).toBe(false)
    expect(isTextOffsetInString("select '-- non è un commento", 28)).toBe(true)
  })

  it('commento vero: niente suggerimenti', () => {
    expect(isTextOffsetInComment('-- prova END', 12)).toBe(true)
    expect(isTextOffsetInComment('/* prova */', 5)).toBe(true)
  })
})

describe('contesti di codice: le classi sono quelle giuste', () => {
  const casi: { nome: string; stmtBefore: string; attesa: Record<string, boolean> }[] = [
    {
      nome: 'dopo BEGIN non è una posizione di tabella',
      stmtBefore: 'BEGIN\n  ',
      attesa: { isTablePosition: false, isJoinPosition: false, inSelectList: false },
    },
    {
      nome: 'dopo FROM è posizione di tabella',
      stmtBefore: 'select * from ',
      attesa: { isTablePosition: true },
    },
    {
      nome: 'dopo JOIN è posizione di join',
      stmtBefore: 'select * from a inner join ',
      attesa: { isJoinPosition: true },
    },
    {
      nome: 'nella select-list',
      stmtBefore: 'select ',
      attesa: { inSelectList: true },
    },
    {
      nome: 'dopo WHERE è contesto di colonne',
      stmtBefore: 'select * from t where ',
      attesa: { isColumnContext: true },
    },
    {
      nome: 'dopo EXEC è posizione EXEC',
      stmtBefore: 'exec ',
      attesa: { isExecPosition: true },
    },
  ]
  for (const c of casi) {
    it(c.nome, () => {
      const r = ctx({ prefix: c.stmtBefore, stmtBefore: c.stmtBefore })
      for (const [chiave, valore] of Object.entries(c.attesa)) {
        expect((r as unknown as Record<string, boolean>)[chiave], `${c.nome} · ${chiave}`).toBe(valore)
      }
    })
  }
})

describe('parole chiave ammesse a inizio statement', () => {
  it('dopo BEGIN sono ammesse le keyword di statement e non le tabelle', () => {
    const r = ctx({ prefix: 'BEGIN\n  ', stmtBefore: 'BEGIN\n  ' })
    // dopo BEGIN si è a inizio di uno statement: keyword (END/EXEC/IF…), non tabelle/procedure sciolte
    expect(r.statementStart).toBe(true)
    expect(r.isTablePosition).toBe(false)
  })
})
