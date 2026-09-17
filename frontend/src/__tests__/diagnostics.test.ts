import { describe, expect, it } from 'vitest'
import { positionAt, runSqlDiagnostics } from '../sqlDiagnostics'
import { demoStoreLikeSummary } from './schema'

const summary = demoStoreLikeSummary()

describe('runSqlDiagnostics: diagnostica in tempo reale', () => {
  it('parentesi non bilanciate', () => {
    const d = runSqlDiagnostics('SELECT * FROM T WHERE (a = 1', { summary })
    expect(d.some(x => x.message.includes('Parentesi non chiusa'))).toBe(true)
    expect(d.some(x => x.severity === 'error')).toBe(true)
  })

  it('parentesi chiusa senza apertura', () => {
    const d = runSqlDiagnostics('SELECT * FROM T) WHERE a = 1', { summary })
    expect(d.some(x => x.message.includes('senza apertura'))).toBe(true)
  })

  it('apice non chiuso', () => {
    const d = runSqlDiagnostics("SELECT * FROM T WHERE a = 'abc", { summary })
    expect(d.some(x => x.message.includes('Stringa non chiusa'))).toBe(true)
  })

  it('apostrofo con escape non è un errore', () => {
    const d = runSqlDiagnostics("SELECT * FROM T WHERE a = 'it''s ok'", { summary })
    expect(d.some(x => x.message.includes('Stringa non chiusa'))).toBe(false)
  })

  it('colonna qualificata inesistente segnalata', () => {
    const d = runSqlDiagnostics('SELECT * FROM DAT_UDC WHERE DAT_UDC.COLONNA_INESISTENTE = 1', { summary })
    expect(d.some(x => x.message.includes('COLONNA_INESISTENTE'))).toBe(true)
  })

  it('colonna qualificata esistente non segnalata', () => {
    const d = runSqlDiagnostics('SELECT * FROM DAT_UDC WHERE DAT_UDC.UDC_UDC = 1', { summary })
    expect(d.some(x => x.message.includes('UDC_UDC'))).toBe(false)
  })

  it('SELECT senza FROM segnalato come warning', () => {
    const d = runSqlDiagnostics('SELECT * WHERE a = 1', { summary })
    expect(d.some(x => x.message.includes('senza FROM'))).toBe(true)
  })

  it('INSERT INTO non è segnalato come SELECT senza FROM', () => {
    const d = runSqlDiagnostics('INSERT INTO T (a) VALUES (1)', { summary })
    expect(d.some(x => x.message.includes('senza FROM'))).toBe(false)
  })

  it('query valida non produce errori', () => {
    const d = runSqlDiagnostics("SELECT * FROM DAT_UDC WHERE UDC_UDC = 'x' AND (a = 1)", { summary })
    expect(d.filter(x => x.severity === 'error')).toEqual([])
  })
})

describe('positionAt: offset → riga/colonna', () => {
  it('posizioni in testo multilinea', () => {
    const text = 'abc\ndef\nghi'
    expect(positionAt(text, 0)).toEqual({ lineNumber: 1, column: 1 })
    expect(positionAt(text, 4)).toEqual({ lineNumber: 2, column: 1 })
    expect(positionAt(text, 8)).toEqual({ lineNumber: 3, column: 1 })
  })
})
