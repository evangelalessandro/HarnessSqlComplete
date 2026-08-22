import { beforeEach, describe, expect, it } from 'vitest'
import { loadPersistedTabs, persistTabs } from '../tabStorage'

// mock minimale di localStorage (ambiente node)
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

describe('tabStorage: persistenza delle query', () => {
  it('persist + load restituisce le stesse tab e la tab attiva', () => {
    persistTabs(
      [
        { id: 'tab-1', title: 'Query 1', sql: 'SELECT 1' },
        { id: 'tab-2', title: 'ALTER dbo.X', sql: 'ALTER PROCEDURE dbo.X AS SELECT 1' },
      ],
      'tab-2',
    )
    const loaded = loadPersistedTabs()
    expect(loaded).not.toBeNull()
    expect(loaded!.tabs).toEqual([
      { id: 'tab-1', title: 'Query 1', sql: 'SELECT 1' },
      { id: 'tab-2', title: 'ALTER dbo.X', sql: 'ALTER PROCEDURE dbo.X AS SELECT 1' },
    ])
    expect(loaded!.active).toBe('tab-2')
  })

  it('nessun dato salvato → null', () => {
    expect(loadPersistedTabs()).toBeNull()
  })

  it('JSON corrotto → null (non lancia)', () => {
    store.set('sqlIntelli.tabs.v1', '{not-json')
    expect(loadPersistedTabs()).toBeNull()
  })

  it('tab vuote → null', () => {
    persistTabs([], 'tab-1')
    expect(loadPersistedTabs()).toBeNull()
  })

  it('active non presente → ripiega sulla prima tab', () => {
    persistTabs([{ id: 'tab-1', title: 'Q', sql: 'SELECT 1' }], 'tab-999')
    expect(loadPersistedTabs()!.active).toBe('tab-1')
  })
})
