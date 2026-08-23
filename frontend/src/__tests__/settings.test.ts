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

describe('settings: font e tema', () => {
  it('default senza dati salvati', () => {
    expect(loadSettings()).toEqual({ fontSize: 13, theme: 'vs-dark' })
  })

  it('roundtrip save/load', () => {
    saveSettings({ fontSize: 18, theme: 'vs' })
    expect(loadSettings()).toEqual({ fontSize: 18, theme: 'vs' })
  })

  it('valori fuori range o non validi → default', () => {
    store.set('sqlIntelli.settings.v1', JSON.stringify({ fontSize: 999, theme: 'weird' }))
    expect(loadSettings()).toEqual({ fontSize: 13, theme: 'vs-dark' })
    store.set('sqlIntelli.settings.v1', JSON.stringify({ fontSize: 3, theme: 'vs' }))
    expect(loadSettings()).toEqual({ fontSize: 13, theme: 'vs' })
  })

  it('JSON corrotto → default', () => {
    store.set('sqlIntelli.settings.v1', '{broken')
    expect(loadSettings()).toEqual({ fontSize: 13, theme: 'vs-dark' })
  })
})
