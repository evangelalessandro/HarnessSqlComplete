import { describe, expect, it } from 'vitest'
import { shouldSuggestSystemObjects, systemObjectsFor, SYSTEM_CATALOG_OBJECTS } from '../systemObjects'

describe('oggetti di catalogo di sistema (sys.* e DMV)', () => {
  it('la lista contiene i principali oggetti di catalogo e DMV', () => {
    for (const o of ['sys.tables', 'sys.columns', 'sys.views', 'sys.procedures', 'sys.foreign_keys', 'sys.dm_exec_requests', 'sys.dm_exec_query_stats', 'sys.dm_os_wait_stats']) {
      expect(SYSTEM_CATALOG_OBJECTS).toContain(o)
    }
  })

  it('shouldSuggestSystemObjects: si attiva digitando sys/dm o dopo "sys."', () => {
    expect(shouldSuggestSystemObjects('SELECT * FROM ', 'sys')).toBe(true)
    expect(shouldSuggestSystemObjects('SELECT * FROM ', 'sys_ta')).toBe(true)
    expect(shouldSuggestSystemObjects('SELECT * FROM ', 'dm_exec')).toBe(true)
    expect(shouldSuggestSystemObjects('SELECT * FROM sys.', '')).toBe(true)
    expect(shouldSuggestSystemObjects('SELECT * FROM ', 'tables')).toBe(false)
    expect(shouldSuggestSystemObjects('SELECT * FROM ', '')).toBe(false)
  })

  it('systemObjectsFor filtra per la parola digitata', () => {
    const all = systemObjectsFor('SELECT * FROM ', '')
    expect(all.length).toBe(SYSTEM_CATALOG_OBJECTS.length)
    const dm = systemObjectsFor('SELECT * FROM ', 'dm_')
    expect(dm.every(o => o.startsWith('sys.dm_'))).toBe(true)
    const tables = systemObjectsFor('SELECT * FROM ', 'tables')
    expect(tables).toContain('sys.tables')
  })
})
