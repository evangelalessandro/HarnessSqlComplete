// La SELECT "semplice" con una tabella derivata deve passare dal motore "statement" (quello che sa
// impaginare il contenuto della parentesi) e non restare su una riga.
import { describe, expect, it } from 'vitest'
import { formatSqlWithProfile } from '../tsqlFormatter'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)
const fmt = (sql: string) => formatSqlWithProfile(sql, profile).replace(/\r\n/g, '\n')

const QUERY = `SELECT X_SSCC, X_SKU FROM (SELECT DISTINCT ESE_UDC, ESE_CAUSMISS FROM RUN_ESEGUI UNION SELECT DISTINCT MIS_UDC, MIS_CAUSMISS FROM RUN_MISSIONI WHERE MIS_GES_GESTORE LIKE 'UOMO%' UNION SELECT UDC_UDC, 'ABSRP' FROM dat_udc INNER JOIN MAG_CORRIDOI ON (UDC_CORRIDOIO = COR_CORRIDOIO) WHERE UDC_ORDINE > '' AND COR_AREA = 'AM') ESE_TBL INNER JOIN DAT_UDC ON ESE_UDC = UDC_UDC`

describe('query con tabella derivata (percorso "query", non store)', () => {
  it('impagina il contenuto della parentesi e mette i UNION a capo', () => {
    const out = fmt(QUERY)
    console.log(out)
    const righe = out.split('\n')
    expect(righe.some(r => r.trim() === 'FROM (')).toBe(true)
    expect(righe.filter(r => r.trim() === 'UNION').length).toBe(2)
    // nessuna RIGA con "UNION SELECT" attaccati (si guarda riga per riga: il testo intero contiene
    // comunque "UNION\nSELECT")
    expect(righe.some(r => /UNION[ \t]+SELECT/i.test(r))).toBe(false)
    expect(righe.some(r => /^\)\s+ESE_TBL$/.test(r.trim()))).toBe(true)
    // il JOIN esterno resta dopo la chiusura
    expect(righe.some(r => /INNER JOIN DAT_UDC/i.test(r))).toBe(true)
  })

  it('è idempotente', () => {
    const una = fmt(QUERY)
    expect(fmt(una)).toBe(una)
  })

  it('una query senza tabelle derivate segue il percorso normale', () => {
    const out = fmt('select a, b from t1 where a > 0')
    expect(out).toMatch(/SELECT a/i)
    expect(out).toMatch(/FROM t1/i)
    expect(out).toMatch(/WHERE a > 0/i)
  })
})
