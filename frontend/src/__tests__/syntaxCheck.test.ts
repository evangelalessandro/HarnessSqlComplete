import { describe, expect, it } from 'vitest'
import { syntaxIssuesFromCheck } from '../syntaxCheck'

describe('syntaxIssuesFromCheck: messaggi "Riga N:" → marker', () => {
  it('estrae la riga assoluta e il messaggio', () => {
    const issues = syntaxIssuesFromCheck(null, ["Riga 1: Sintassi non corretta in prossimità di 'FORM'."])
    expect(issues).toEqual([
      { line: 1, message: "Sintassi non corretta in prossimità di 'FORM'.", severity: 'error' },
    ])
  })

  it('gestisce più errori e righe dopo GO (riga assoluta)', () => {
    const issues = syntaxIssuesFromCheck(null, [
      'Riga 4: Sintassi non corretta in prossimità di \'3\'.',
      'Riga 7: Il nome di oggetto \'dbo.X\' non è valido.',
    ])
    expect(issues.map(i => i.line)).toEqual([4, 7])
  })

  it('errore generico senza riga → segnalato sulla riga 1', () => {
    const issues = syntaxIssuesFromCheck('Query annullata (timeout).', [])
    expect(issues).toEqual([{ line: 1, message: 'Query annullata (timeout).', severity: 'error' }])
  })

  it('testo valido (nessun errore) → lista vuota', () => {
    expect(syntaxIssuesFromCheck(null, [])).toEqual([])
    // i messaggi informativi (PRINT, righe interessate) non sono errori
    expect(syntaxIssuesFromCheck(null, ['(1 riga interessata)', 'PRINT ok'])).toEqual([])
  })
})
