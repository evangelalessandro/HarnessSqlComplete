import { beforeEach, describe, expect, it } from 'vitest'
import { instanceKey, loadPersistedTabs, persistTabs } from '../tabStorage'

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

const INST = 'localhost\\SQL2022'

describe('tabStorage: persistenza delle query per istanza SQL', () => {
  it('persist + load restituisce le stesse tab e la tab attiva', () => {
    persistTabs(
      INST,
      [
        { id: 'tab-1', title: 'Query 1', sql: 'SELECT 1' },
        { id: 'tab-2', title: 'ALTER dbo.X', sql: 'ALTER PROCEDURE dbo.X AS SELECT 1' },
      ],
      'tab-2',
    )
    const loaded = loadPersistedTabs(INST)
    expect(loaded).not.toBeNull()
    expect(loaded!.tabs).toEqual([
      { id: 'tab-1', title: 'Query 1', sql: 'SELECT 1' },
      { id: 'tab-2', title: 'ALTER dbo.X', sql: 'ALTER PROCEDURE dbo.X AS SELECT 1' },
    ])
    expect(loaded!.active).toBe('tab-2')
  })

  it('istanze diverse NON condividono le tab (isolamento per istanza)', () => {
    persistTabs('localhost\\SQL2022', [{ id: 'tab-1', title: 'Q', sql: 'SELECT 1' }], 'tab-1')
    persistTabs('.\\sql2019dev', [{ id: 'tab-1', title: 'ALTRA', sql: 'SELECT 2' }], 'tab-1')
    expect(loadPersistedTabs('localhost\\SQL2022')!.tabs[0].sql).toBe('SELECT 1')
    expect(loadPersistedTabs('.\\sql2019dev')!.tabs[0].sql).toBe('SELECT 2')
  })

  it('istanza senza dati salvati → null', () => {
    expect(loadPersistedTabs('server-mai-visto')).toBeNull()
  })

  it('JSON corrotto → null (non lancia)', () => {
    store.set('sqlIntelli.tabs.v1.' + instanceKey(INST), '{not-json')
    expect(loadPersistedTabs(INST)).toBeNull()
  })

  it('tab vuote → null', () => {
    persistTabs(INST, [], 'tab-1')
    expect(loadPersistedTabs(INST)).toBeNull()
  })

  it('active non presente → ripiega sulla prima tab', () => {
    persistTabs(INST, [{ id: 'tab-1', title: 'Q', sql: 'SELECT 1' }], 'tab-999')
    expect(loadPersistedTabs(INST)!.active).toBe('tab-1')
  })

  it('instanceKey normalizza maiuscole e caratteri speciali', () => {
    expect(instanceKey('LOCALHOST\\SQL2022')).toBe('localhost_sql2022')
    expect(instanceKey('192.168.1.10,1433')).toBe('192.168.1.10_1433')
  })
})
