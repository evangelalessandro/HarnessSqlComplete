import { beforeEach, describe, expect, it } from 'vitest'
import { loadSettings, saveSettings } from '../settings'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
  }
})

const DEFAULT = { fontSize: 13, theme: 'vs-dark', newTabPosition: 'afterActive' } as const

describe('settings: font e tema', () => {
  it('default senza dati salvati', () => {
    expect(loadSettings()).toEqual(DEFAULT)
  })

  it('roundtrip save/load', () => {
    saveSettings({ fontSize: 18, theme: 'vs', newTabPosition: 'start' })
    expect(loadSettings()).toEqual({ fontSize: 18, theme: 'vs', newTabPosition: 'start' })
  })

  it('valori fuori range o non validi → default', () => {
    store.set('sqlIntelli.settings.v1', JSON.stringify({ fontSize: 999, theme: 'weird' }))
    expect(loadSettings()).toEqual(DEFAULT)
    store.set('sqlIntelli.settings.v1', JSON.stringify({ fontSize: 3, theme: 'vs' }))
    expect(loadSettings()).toEqual({ ...DEFAULT, theme: 'vs' })
  })

  it('JSON corrotto → default', () => {
    store.set('sqlIntelli.settings.v1', '{broken')
    expect(loadSettings()).toEqual(DEFAULT)
  })
})

describe('settings: dove aprire le nuove tab', () => {
  it('di default si apre dopo la tab attiva', () => {
    expect(loadSettings().newTabPosition).toBe('afterActive')
  })

  it('le tre posizioni si salvano e si rileggono', () => {
    for (const pos of ['start', 'afterActive', 'end'] as const) {
      saveSettings({ ...DEFAULT, newTabPosition: pos })
      expect(loadSettings().newTabPosition, pos).toBe(pos)
    }
  })

  it('un valore inventato non rompe nulla: si torna al default', () => {
    store.set('sqlIntelli.settings.v1', JSON.stringify({ ...DEFAULT, newTabPosition: 'a caso' }))
    expect(loadSettings().newTabPosition).toBe('afterActive')
    store.set('sqlIntelli.settings.v1', JSON.stringify({ ...DEFAULT, newTabPosition: 42 }))
    expect(loadSettings().newTabPosition).toBe('afterActive')
  })

  it('le impostazioni salvate PRIMA di questa funzione restano valide', () => {
    // utenti che avevano solo font e tema: la nuova proprietà prende il default
    store.set('sqlIntelli.settings.v1', JSON.stringify({ fontSize: 16, theme: 'vs' }))
    expect(loadSettings()).toEqual({ fontSize: 16, theme: 'vs', newTabPosition: 'afterActive' })
  })
})
