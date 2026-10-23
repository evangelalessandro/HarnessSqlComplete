// MOSTRA SPAZI E TAB (richiesta utente: "mi aggiungi un tasto per vedere anche i caratteri
// speciali, come gli spazi e i tab?"): la scelta si ricorda fra un avvio e l'altro e si traduce
// nelle opzioni di Monaco (renderWhitespace). Qui si prova la parte pura e il collegamento
// nell'editor (se sparisce un pezzo, il tasto non fa più nulla).
import { describe, expect, it } from 'vitest'
import source from '../components/SqlEditor.tsx?raw'
import { SPAZI_KEY, opzioniSpazi, parseSpazi, serializzaSpazi } from '../whitespaceMode'

describe('preferenza "mostra spazi e tab"', () => {
  it('accesa solo se salvata esplicitamente', () => {
    expect(parseSpazi('on')).toBe(true)
    expect(parseSpazi('true')).toBe(true)
    expect(parseSpazi('1')).toBe(true)
    expect(parseSpazi('off')).toBe(false)
    expect(parseSpazi(null)).toBe(false)
    expect(parseSpazi('')).toBe(false)
    expect(parseSpazi('qualcosa')).toBe(false)
  })

  it('si salva in modo rileggibile', () => {
    expect(parseSpazi(serializzaSpazi(true))).toBe(true)
    expect(parseSpazi(serializzaSpazi(false))).toBe(false)
    expect(SPAZI_KEY).toContain('spazi')
  })
})

describe('opzioni di Monaco', () => {
  it('accesa: disegna TUTTI gli spazi e i caratteri di controllo', () => {
    expect(opzioniSpazi(true)).toEqual({ renderWhitespace: 'all', renderControlCharacters: true })
  })

  it('spenta: nessun carattere invisibile disegnato', () => {
    expect(opzioniSpazi(false)).toEqual({ renderWhitespace: 'none', renderControlCharacters: false })
  })
})

describe('collegamento nell\'editor', () => {
  it('la toolbar ha il tasto e Monaco riceve le opzioni degli spazi', () => {
    expect(source).toContain('<Pilcrow')
    expect(source).toContain('Spazi e tab')
    expect(source).toContain('data-spazi={mostraSpazi ? \'on\' : \'off\'}')
    expect(source).toContain('onClick={toggleSpazi}')
    // le opzioni arrivano sia al mount (nell'oggetto options) sia al cambio (updateOptions)
    expect(source).toContain('...opzioniSpazi(mostraSpazi)')
    expect(source).toContain('editorRef.current?.updateOptions(opzioniSpazi(mostraSpazi))')
    // la preferenza si salva/rilegge
    expect(source).toContain('localStorage.getItem(SPAZI_KEY)')
    expect(source).toContain('localStorage.setItem(SPAZI_KEY, serializzaSpazi(nuovo))')
  })
})
