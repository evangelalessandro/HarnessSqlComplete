// DECLARE @t TABLE ( … ) con molte colonne: va indentata una colonna per riga
// (segnalazione utente: "sistema questa, andrebbe tutta identata").
import { describe, expect, it } from 'vitest'
import { formatRoutineWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)
const fmt = (sql: string) => formatRoutineWithProfile(sql, profile).replace(/\r\n/g, '\n')

const SP = `CREATE OR ALTER PROCEDURE dbo.Prova
AS
IF @retVal <> 0
  GOTO lblExit
DECLARE @table TABLE (ORD_ORDINE NVARCHAR(50), ORD_SPEDIZIONE NVARCHAR(50), ESE_BPRIO INT, ESE_PRIO INT, ORD_USER_POCKET NVARCHAR(50), X_PK INT, X_UDS_TO_INFEED INT, X_SU_CODE DECIMAL(15, 0), X_TIME DATETIME, X_PKNUM INT)
SELECT 1 AS X`

describe('DECLARE … TABLE con molte colonne', () => {
  it('apre la parentesi e mette una colonna per riga, indentata', () => {
    const out = fmt(SP)
    console.log(out)
    const righe = out.split('\n')
    const iTesta = righe.findIndex(r => /DECLARE @table TABLE \($/.test(r.trim()))
    expect(iTesta).toBeGreaterThan(-1)
    // prima colonna indentata di un passo rispetto a DECLARE
    const rientro = righe[iTesta].search(/\S/)
    expect(righe[iTesta + 1].search(/\S/)).toBe(rientro + 2)
    expect(righe[iTesta + 1].trim()).toContain('ORD_ORDINE NVARCHAR(50)')
    // gli altri campi hanno la virgola in testa
    expect(righe[iTesta + 2].trim().startsWith(',ORD_SPEDIZIONE')).toBe(true)
    // la chiusura su riga propria
    expect(righe.some(r => r.trim() === ')')).toBe(true)
  })

  it('non lascia la lista su una riga sola', () => {
    const out = fmt(SP)
    expect(out).not.toMatch(/DECLARE @table TABLE \(.*ESE_BPRIO.*X_PKNUM.*\)/)
  })

  it('è idempotente e non perde token', () => {
    const firma = (s: string) =>
      tokenizeSqlText(s)
        .filter(t => t.type !== 'comment')
        .map(t => t.type + ':' + t.text.toUpperCase())
        .sort()
        .join('|')
    const una = fmt(SP)
    expect(fmt(una)).toBe(una)
    expect(firma(una)).toBe(firma(SP))
  })

  it('DECLARE di sole variabili resta col tipo allineato (non toccato)', () => {
    const out = fmt('CREATE OR ALTER PROCEDURE dbo.P AS\nDECLARE @a INT, @nome NVARCHAR(50)')
    expect(out).toContain('DECLARE @a')
    expect(out).toMatch(/@a\s+INT/)
  })
})
