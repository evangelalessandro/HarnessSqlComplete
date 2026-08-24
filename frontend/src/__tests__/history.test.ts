import { beforeEach, describe, expect, it } from 'vitest'
import { clearHistory, columnUseCount, historyTableBoost, recordColumnUse, recordTableUse, recordTablesFromSql, tableUseCount } from '../history'

describe('history: cronologia utente (localStorage)', () => {
  beforeEach(() => clearHistory())

  it('recordTableUse incrementa il conteggio', () => {
    recordTableUse('RUN_MISSIONI')
    recordTableUse('run_missioni')
    expect(tableUseCount('RUN_MISSIONI')).toBe(2)
  })

  it('recordColumnUse incrementa il conteggio', () => {
    recordColumnUse('MIS_UDC')
    recordColumnUse('mis_udc')
    expect(columnUseCount('MIS_UDC')).toBe(2)
  })

  it('tabella mai usata → conteggio 0 e boost 0', () => {
    expect(tableUseCount('INESISTENTE')).toBe(0)
    expect(historyTableBoost('INESISTENTE')).toBe(0)
  })

  it('boost cresce con l\'uso ma è limitato a 1', () => {
    for (let i = 0; i < 100; i++) recordTableUse('DAT_UDC')
    expect(historyTableBoost('DAT_UDC')).toBeGreaterThan(0)
    expect(historyTableBoost('DAT_UDC')).toBeLessThanOrEqual(1)
  })

  it('recordTablesFromSql estrae e registra le tabelle', () => {
    const found = recordTablesFromSql('SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON x = y')
    expect(found).toContain('run_missioni')
    expect(found).toContain('mag_celle')
    expect(tableUseCount('RUN_MISSIONI')).toBe(1)
  })

  it('recordTablesFromSql ignora keyword e deduplica', () => {
    const found = recordTablesFromSql('SELECT * FROM T JOIN T ON a = b')
    expect(found).toEqual(['t'])
    expect(tableUseCount('T')).toBe(1)
  })

  it('clearHistory azzera tutto', () => {
    recordTableUse('A')
    recordColumnUse('B')
    clearHistory()
    expect(tableUseCount('A')).toBe(0)
    expect(columnUseCount('B')).toBe(0)
  })
})
