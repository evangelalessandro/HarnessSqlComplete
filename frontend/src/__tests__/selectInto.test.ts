import { describe, expect, it } from 'vitest'
import { formatSqlWithProfile, isRoutineText } from '../tsqlFormatter'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)

describe('formattazione SELECT INTO con IIF e condizioni', () => {
  const sql = `SELECT TOP 1 UDC_UDC X_SU_CODE, UDC_SSCC X_SSCC_SU, IIF (UDC_CNT_STA = 'C', 'Close', 'Refilling') X_CNT_STA, IIF (UDC_ETICH = '1', 'Printed', 'To Print') X_ETICH INTO # tmpLu FROM dat_udc WHERE UDC_ORDINE = @pOrder AND UDC_STAPRENUDC = 'PR_PK' AND UDC_UDC = @pSU_CODE`

  it('non è una routine: "Print" è dentro la stringa \'To Print\'', () => {
    expect(isRoutineText(sql)).toBe(false)
  })

  it('INTO, FROM, WHERE e AND vanno su righe proprie', () => {
    const out = formatSqlWithProfile(sql, profile)
    expect(out.split('\n').map(l => l.trim())[0]).toMatch(/^SELECT TOP 1 UDC_UDC X_SU_CODE/)
    expect(out).toContain('\nINTO # tmpLu')
    expect(out).toContain('\nFROM dat_udc')
    expect(out).toContain('\nWHERE UDC_ORDINE = @pOrder')
    expect(out).toContain('\nAND UDC_STAPRENUDC = \'PR_PK\'')
    expect(out).toContain('\nAND UDC_UDC = @pSU_CODE')
  })

  it('lo spazio di "IIF (" viene preservato', () => {
    const out = formatSqlWithProfile(sql, profile)
    expect(out).toContain("IIF (UDC_CNT_STA = 'C', 'Close', 'Refilling')")
    expect(out).toContain("IIF (UDC_ETICH = '1', 'Printed', 'To Print')")
  })

  it('INSERT INTO resta attaccato (niente a capo prima di INTO)', () => {
    const out = formatSqlWithProfile(
      "insert into ordini (id, cliente_id, codice, descrizione, data) values (1, 2, 'ABC', 'una descrizione molto lunga per superare la soglia', getdate())",
      profile,
    )
    expect(out).toMatch(/INSERT INTO ordini \(id, cliente_id, codice, descrizione, data\)\nVALUES \(1, 2/)
  })

  it('AND/OR dentro le parentesi non vanno a capo, quelli a livello top sì', () => {
    const out = formatSqlWithProfile(
      'select a, b, c, d, e, f, g, h from tabella_lunga where a = 1 and (b = 2 or c = 3) and d = 4',
      profile,
    )
    expect(out).toContain('AND (b = 2 OR c = 3)')
    expect(out).toContain('\nAND d = 4')
  })

  it('BEGIN TRAN è codice procedurale (motore routine)', () => {
    expect(isRoutineText('BEGIN TRAN\nSELECT 1\nCOMMIT')).toBe(true)
  })
})
