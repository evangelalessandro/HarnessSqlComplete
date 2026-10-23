// Scrittura su più righe: la modalità "selezione a blocchi" (stile Alt+C di SSMS) si ricorda fra
// un avvio e l'altro e si traduce nelle opzioni di Monaco. Qui si prova la parte pura.
import { describe, expect, it } from 'vitest'
import source from '../components/SqlEditor.tsx?raw'
import { BLOCCHI_KEY, opzioniMonaco, parseBlocchi, serializzaBlocchi } from '../blockMode'

describe('preferenza della modalità a blocchi', () => {
  it('accesa solo se salvata esplicitamente', () => {
    expect(parseBlocchi('on')).toBe(true)
    expect(parseBlocchi('true')).toBe(true)
    expect(parseBlocchi('1')).toBe(true)
    expect(parseBlocchi('off')).toBe(false)
    expect(parseBlocchi(null)).toBe(false)
    expect(parseBlocchi('')).toBe(false)
    expect(parseBlocchi('qualcosa')).toBe(false)
  })

  it('si salva in modo rileggibile', () => {
    expect(parseBlocchi(serializzaBlocchi(true))).toBe(true)
    expect(parseBlocchi(serializzaBlocchi(false))).toBe(false)
    expect(BLOCCHI_KEY).toContain('blocchi')
  })
})

describe('opzioni di Monaco', () => {
  it('accendendo la modalità si attiva la selezione a colonne, con Alt per i cursori', () => {
    expect(opzioniMonaco(true)).toEqual({ columnSelection: true, multiCursorModifier: 'alt' })
    expect(opzioniMonaco(false)).toEqual({ columnSelection: false, multiCursorModifier: 'alt' })
  })
})

// Guardia sul collegamento nell'editor: l'interruttore in toolbar, la scorciatoia Alt+C e le
// opzioni di Monaco devono restare tutti presenti (se ne sparisce uno la modalità non funziona).
describe('collegamento nell\'editor', () => {
  it('la toolbar ha l\'interruttore e Monaco riceve le opzioni della modalità a blocchi', () => {
    expect(source).toContain('data-multiriga="blocchi"')
    expect(source).toContain('Scrittura su più righe')
    expect(source).toContain('editor.updateOptions(opzioniMonaco(')
    expect(source).toContain('monaco.KeyMod.Alt | monaco.KeyCode.KeyC')
    expect(source).toContain('columnSelection: blocchi')
    expect(source).toContain("multiCursorModifier: 'alt'")
    expect(source).toContain("multiCursorPaste: 'spread'")
  })
})
