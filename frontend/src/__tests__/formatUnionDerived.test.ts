// TABELLA DERIVATA con UNION/EXCEPT/INTERSECT dentro il FROM.
//
// SEGNALAZIONE UTENTE: "non viene formattata bene questa nella parte della union" — con
// `FROM (SELECT DISTINCT … FROM A UNION SELECT … FROM B WHERE …) ESE_TBL` tutto il contenuto della
// parentesi restava su UNA riga lunghissima, con il WHERE incollato all'alias di chiusura, e il ramo
// dopo UNION restava attaccato ("UNION SELECT …").
import { describe, expect, it } from 'vitest'
import { formatRoutineWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)
const fmt = (sql: string) => formatRoutineWithProfile(sql, profile).replace(/\r\n/g, '\n')
const righe = (sql: string) => fmt(sql).split('\n')

/** Firma dei token "parola": serve a dimostrare che il formattatore non perde né inventa nulla. */
function firma(sql: string): string {
  return tokenizeSqlText(sql)
    .filter(t => t.type === 'word' || t.type === 'string')
    .map(t => t.text.toUpperCase())
    .sort()
    .join('|')
}

const CON_UNION = `CREATE OR ALTER PROCEDURE dbo.Prova
AS
SELECT X_SSCC, X_SKU
FROM (SELECT DISTINCT ESE_UDC, ESE_CAUSMISS
     FROM RUN_ESEGUI
     UNION
     SELECT DISTINCT MIS_UDC, MIS_CAUSMISS
     FROM RUN_MISSIONI WHERE MIS_GES_GESTORE LIKE 'UOMO%'
     UNION SELECT UDC_UDC, 'ABSRP'
     FROM dat_udc INNER JOIN MAG_CORRIDOI ON (UDC_CORRIDOIO = COR_CORRIDOIO)
     WHERE UDC_ORDINE > '' AND COR_AREA = 'AM') ESE_TBL
    INNER JOIN DAT_UDC ON ESE_UDC = UDC_UDC`

describe('tabella derivata con UNION dentro il FROM', () => {
  it('apre la parentesi e indentа il contenuto', () => {
    const r = righe(CON_UNION)
    const iFrom = r.findIndex(x => x.trim() === 'FROM (')
    expect(iFrom).toBeGreaterThan(-1)
    // il primo ramo è indentato di un passo rispetto a FROM
    const indentFrom = r[iFrom].search(/\S/)
    expect(r[iFrom + 1].search(/\S/)).toBe(indentFrom + 2)
    expect(r[iFrom + 1].trim().startsWith('SELECT')).toBe(true)
  })

  it('UNION su una riga propria e il ramo successivo a capo', () => {
    const r = righe(CON_UNION)
    const union = r.filter(x => x.trim() === 'UNION')
    expect(union.length).toBe(2)
    // nessuna riga con "UNION SELECT" attaccati
    expect(r.some(x => /UNION\s+SELECT/i.test(x))).toBe(false)
    // dopo ogni UNION c'è una riga che comincia con SELECT
    for (let i = 0; i < r.length; i++) {
      if (r[i].trim() === 'UNION') expect(r[i + 1].trim().startsWith('SELECT')).toBe(true)
    }
  })

  it('chiude la parentesi con l alias, e i JOIN esterni restano fuori', () => {
    const r = righe(CON_UNION)
    const chiusa = r.findIndex(x => /^\)\s+ESE_TBL$/.test(x.trim()))
    expect(chiusa).toBeGreaterThan(-1)
    // la chiusura sta alla colonna del FROM
    const iFrom = r.findIndex(x => x.trim() === 'FROM (')
    expect(r[chiusa].search(/\S/)).toBe(r[iFrom].search(/\S/))
    // il JOIN esterno viene dopo la chiusura
    expect(r.slice(chiusa + 1).some(x => /INNER JOIN DAT_UDC/i.test(x))).toBe(true)
  })

  it('il WHERE del ramo derivato è spezzato su righe proprie', () => {
    const r = righe(CON_UNION)
    expect(r.some(x => /^\s*WHERE UDC_ORDINE > ''/.test(x))).toBe(true)
    expect(r.some(x => /^\s*AND COR_AREA = 'AM'/.test(x))).toBe(true)
    // nessuna riga con WHERE e AND insieme
    expect(r.some(x => /WHERE .*\bAND\b/.test(x))).toBe(false)
  })

  it('è IDEMPOTENTE e non perde token', () => {
    const una = fmt(CON_UNION)
    expect(fmt(una)).toBe(una)
    expect(firma(una)).toBe(firma(CON_UNION))
  })
})

describe('tabella derivata senza UNION (caso normale)', () => {
  const SQL = `SELECT * FROM (SELECT A, B FROM T1 WHERE A > 0) X INNER JOIN T2 ON T2.A = X.A`

  it('indenta il contenuto e chiude con l alias', () => {
    const r = righe(SQL)
    expect(r.some(x => x.trim() === 'FROM (')).toBe(true)
    expect(r.some(x => /^\)\s+X$/.test(x.trim()))).toBe(true)
    expect(fmt(fmt(SQL))).toBe(fmt(SQL))
  })
})

describe('derivate annidate', () => {
  const SQL = `SELECT * FROM (SELECT * FROM (SELECT A FROM T1) Y) X`

  it('non si perde e resta idempotente', () => {
    const una = fmt(SQL)
    expect(una).toContain('FROM (')
    expect(firma(una)).toBe(firma(SQL))
    expect(fmt(una)).toBe(una)
  })
})
