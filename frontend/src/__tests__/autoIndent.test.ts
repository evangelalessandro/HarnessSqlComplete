// VIRGOLA A CAPO AUTOMATICA (motore puro).
// Richiesta utente: "che altro si può fare per velocizzare la scrittura?" → "Enter e virgola
// intelligenti": premendo Invio dopo la virgola, la virgola va in testa alla riga nuova, già
// incolonnata sotto il primo campo della riga precedente.
import { describe, expect, it } from 'vitest'
import { rientroContinuazione, spezzaDopoVirgola, testoSpezzato } from '../autoIndent'
import { loadSettings, saveSettings } from '../settings'
import { normalizzaOpzioniSqlFluff } from '../formatEngine'

describe('spezzaDopoVirgola', () => {
  it('dopo "SELECT a," la virgola va in testa, incolonnata sotto "a"', () => {
    const riga = 'SELECT UDC_UDC,'
    const s = spezzaDopoVirgola(riga, riga.length + 1)
    expect(s).not.toBeNull()
    expect(s!.colonnaVirgola).toBe(riga.length) // la virgola è l'ultimo carattere (1-based)
    expect(s!.rientro).toBe('SELECT '.length) // 7: sotto il primo campo
    expect(testoSpezzato(s!)).toBe('\n       ,')
  })

  it('funziona con spazi dopo la virgola e con righe rientrate', () => {
    const riga = '    SET X_CORRIDOIO = UDC_CORRIDOIO,   '
    const s = spezzaDopoVirgola(riga, riga.length + 1)
    expect(s!.rientro).toBe(4 + 'SET '.length) // 8: sotto X_CORRIDOIO
    // la modifica toglie "virgola + spazi" e mette la riga nuova
    expect(testoSpezzato(s!)).toBe('\n        ,')
  })

  it('riga senza clausola nota: si rientra di due spazi', () => {
    const riga = '   ,b = 2,'
    const s = spezzaDopoVirgola(riga, riga.length + 1)
    expect(s!.rientro).toBe(3 + 2)
  })

  it('non fa niente se la virgola non è in fondo alla riga', () => {
    expect(spezzaDopoVirgola('SELECT a, b', 11)).toBeNull()
    // cursore in mezzo: c'è codice dopo
    expect(spezzaDopoVirgola('SELECT a, b', 9)).toBeNull()
  })

  it('non fa niente se la riga non finisce con la virgola', () => {
    expect(spezzaDopoVirgola('SELECT a', 9)).toBeNull()
    expect(spezzaDopoVirgola('', 1)).toBeNull()
    expect(spezzaDopoVirgola('SELECT a.', 10)).toBeNull()
  })

  it('rientroContinuazione: clausole note e non', () => {
    expect(rientroContinuazione('SELECT x')).toBe(7)
    expect(rientroContinuazione('  FROM x')).toBe(7)
    expect(rientroContinuazione('WHERE x')).toBe(6)
    expect(rientroContinuazione('')).toBe(2)
    expect(rientroContinuazione('  xyz')).toBe(4)
  })
})

describe('impostazione "virgola a capo"', () => {
  it('è accesa di default e si salva/rilegge', () => {
    const base = { fontSize: 13, theme: 'vs-dark' as const, newTabPosition: 'end' as const, formatter: 'nostro' as const, sqlFluff: normalizzaOpzioniSqlFluff(undefined) }
    localStorage.removeItem('sqlIntelli.settings.v1')
    expect(loadSettings().virgolaACapo).toBe(true)
    saveSettings({ ...base, virgolaACapo: false })
    expect(loadSettings().virgolaACapo).toBe(false)
    // valori non booleani tornano al default
    localStorage.setItem('sqlIntelli.settings.v1', JSON.stringify({ ...base, virgolaACapo: 'boh' }))
    expect(loadSettings().virgolaACapo).toBe(true)
  })
})
