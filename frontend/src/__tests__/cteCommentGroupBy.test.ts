// Store con CTE il cui corpo comincia con un COMMENTO, WHERE con commento in mezzo e GROUP BY dopo un
// AND: (segnalazione utente) il corpo della CTE restava su una riga e la GROUP BY finiva incollata
// alla WHERE.
import { describe, expect, it } from 'vitest'
import { formatRoutineWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)
const fmt = (sql: string) => formatRoutineWithProfile(sql, profile).replace(/\r\n/g, '\n')

const SP = `CREATE OR ALTER PROCEDURE dbo.Export
AS
DECLARE @time NVARCHAR(50)
SET @time = GETDATE()

;WITH UDC AS
(
  /* Tutte le UDC a magazzino */
  SELECT UDC_UDC, UDC_CORRIDOIO FROM DAT_UDC INNER JOIN TIPI_CAUSALI_MISSIONI ON CAUM_CAUSMISS = UDC_CAUSMISS INNER JOIN MAG_CORRIDOI AS U ON U.COR_CORRIDOIO = UDC_CORRIDOIO WHERE UDC_FAMIUDC <> 'V' AND (
  (U.COR_TIPOCORR IN ('A', 'M') AND UDC_UBIUDC IN ('M', 'EH')) OR
  (UDC_UBIUDC = 'I' AND CAUM_RIENTRO = 1))
)
SELECT @time AS STO_DATETIME, SCO_ARTICOLO AS STO_SKU, sum (SCO_GIAC + SCO_VER) AS STO_QTY
FROM UDC
  INNER JOIN DAT_SCOMPART ON SCO_UDC = UDC_UDC
WHERE SCO_ARTICOLO <> ''
      AND ART_HOST = 1
/* nota in mezzo alla WHERE */
AND (EXISTS (SELECT 1 FROM UTI_WORK WHERE WOR_COD = 'EXP_STOCK' AND WOR_NUM = 1) OR @checkFlag = 0) GROUP BY SCO_ARTICOLO, SCO_SUB1, udc_cella`

describe('CTE con commento iniziale + GROUP BY dopo un AND', () => {
  it('il corpo della CTE viene impaginato (non resta su una riga)', () => {
    const out = fmt(SP)
    console.log(out)
    const righe = out.split('\n')
    const iCte = righe.findIndex(r => r.trim() === 'WITH UDC AS' || r.trim() === ';WITH UDC AS')
    expect(iCte).toBeGreaterThan(-1)
    // dentro la CTE: FROM e JOIN su righe proprie
    const dentro = righe.slice(iCte, iCte + 40).map(r => r.trim())
    expect(dentro.some(r => r.startsWith('FROM'))).toBe(true)
    expect(dentro.some(r => r.startsWith('INNER JOIN'))).toBe(true)
    // la select-list della CTE è impilata
    expect(dentro.filter(r => r.startsWith(',')).length).toBeGreaterThan(0)
  })

  it('la GROUP BY va su riga propria, mai attaccata alla WHERE', () => {
    const out = fmt(SP)
    expect(out).toMatch(/\n\s*GROUP BY /)
    // nessuna RIGA con la GROUP BY attaccata alla condizione (sul testo intero il confronto non vale
    // perché "0)" e "GROUP BY" sono su righe diverse)
    expect(out.split('\n').some(r => /OR @checkFlag = 0\)[ \t]+GROUP BY/i.test(r))).toBe(false)
    // e le colonne della GROUP BY sono impilate
    const righe = out.split('\n')
    const iGroup = righe.findIndex(r => r.trim().startsWith('GROUP BY '))
    expect(righe[iGroup + 1].trim().startsWith(',SCO_SUB1')).toBe(true)
  })

  it('il commento dentro la WHERE resta dentro e indentato', () => {
    const out = fmt(SP)
    expect(out).toContain('/* nota in mezzo alla WHERE */')
    const righe = out.split('\n')
    const iCommento = righe.findIndex(r => r.includes('/* nota in mezzo alla WHERE */'))
    expect(righe[iCommento].search(/\S/)).toBeGreaterThan(0)
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
})
