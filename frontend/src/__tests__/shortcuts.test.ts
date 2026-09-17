import { describe, expect, it } from 'vitest'
import { isRefreshSchemaShortcut, isToggleResultsShortcut, type KeyLike } from '../shortcuts'

const tasto = (key: string, mods: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
})

describe('scorciatoie di applicazione', () => {
  it('Ctrl+Shift+R aggiorna lo schema (come SSMS)', () => {
    expect(isRefreshSchemaShortcut(tasto('r', { ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(isRefreshSchemaShortcut(tasto('R', { ctrlKey: true, shiftKey: true }))).toBe(true)
    // su Mac il tasto è Cmd
    expect(isRefreshSchemaShortcut(tasto('r', { metaKey: true, shiftKey: true }))).toBe(true)
  })

  it('Ctrl+Shift+R non scatta con altre combinazioni', () => {
    expect(isRefreshSchemaShortcut(tasto('r', { ctrlKey: true }))).toBe(false) // Ctrl+R = pannello risultati
    expect(isRefreshSchemaShortcut(tasto('r', { shiftKey: true }))).toBe(false)
    expect(isRefreshSchemaShortcut(tasto('r', { ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false)
    expect(isRefreshSchemaShortcut(tasto('s', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isRefreshSchemaShortcut(tasto('f', { ctrlKey: true, shiftKey: true }))).toBe(false)
  })

  it('Ctrl+R resta il mostra/nascondi dei risultati (senza Shift)', () => {
    expect(isToggleResultsShortcut(tasto('r', { ctrlKey: true }))).toBe(true)
    expect(isToggleResultsShortcut(tasto('r', { metaKey: true }))).toBe(true)
    expect(isToggleResultsShortcut(tasto('r', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isToggleResultsShortcut(tasto('r', { ctrlKey: true, altKey: true }))).toBe(false)
  })
})
