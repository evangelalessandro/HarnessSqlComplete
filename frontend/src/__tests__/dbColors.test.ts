import { beforeEach, describe, expect, it } from 'vitest'
import { loadDbColors, saveDbColors } from '../dbColors'

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

describe('dbColors: persistenza colori personalizzati', () => {
  it('roundtrip save/load', () => {
    saveDbColors({ DEMOSTORE: '#123456', master: '#abcdef' })
    expect(loadDbColors()).toEqual({ DEMOSTORE: '#123456', master: '#abcdef' })
  })

  it('nessun dato → oggetto vuoto', () => {
    expect(loadDbColors()).toEqual({})
  })

  it('JSON corrotto → oggetto vuoto (non lancia)', () => {
    store.set('sqlIntelli.dbColors.v1', '{broken')
    expect(loadDbColors()).toEqual({})
  })
})
