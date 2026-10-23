// COPIA NEGLI APPUNTI dalla griglia dei risultati.
// Richiesta utente: una cella con tanto testo è tagliata a video e non si riesce a copiarla;
// serve un modo (tasto destro sulla cella → copia).
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { copiaTesto, rigaPerCopia, testoPerCopia } from '../clipboard'

describe('testoPerCopia', () => {
  it('testo normale, numeri, booleani', () => {
    expect(testoPerCopia('abc')).toBe('abc')
    expect(testoPerCopia(42)).toBe('42')
    expect(testoPerCopia(1.5)).toBe('1.5')
    expect(testoPerCopia(true)).toBe('1')
    expect(testoPerCopia(false)).toBe('0')
  })

  it('NULL e undefined → stringa vuota (come in SSMS)', () => {
    expect(testoPerCopia(null)).toBe('')
    expect(testoPerCopia(undefined)).toBe('')
  })

  it('oggetti → JSON', () => {
    expect(testoPerCopia({ a: 1 })).toBe('{"a":1}')
  })
})

describe('rigaPerCopia', () => {
  it('separa i valori con TAB (incolla in Excel) e mette vuoto al posto di NULL', () => {
    expect(rigaPerCopia(['a', 1, null, true])).toBe('a\t1\t\t1')
  })
})

describe('copiaTesto', () => {
  it('usa navigator.clipboard quando c\'è', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await expect(copiaTesto('ciao')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('ciao')
    vi.unstubAllGlobals()
  })

  it('se l\'API moderna fallisce usa il ripiego con textarea + execCommand', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('permesso negato')),
      },
    })
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    await expect(copiaTesto('lungo testo')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
    // la textarea temporanea viene rimossa
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
    vi.unstubAllGlobals()
  })

  it('senza API e con ripiego fallito restituisce false (non lancia)', async () => {
    vi.stubGlobal('navigator', {})
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockImplementation(() => {
        throw new Error('non supportato')
      }),
      configurable: true,
    })
    await expect(copiaTesto('x')).resolves.toBe(false)
    vi.unstubAllGlobals()
  })
})
