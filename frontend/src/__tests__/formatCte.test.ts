// CTE DENTRO UNA PROCEDURA: allineamento delle liste e del ";WITH".
// Segnalazione utente: "questa query non la identa bene, nella parte della cte".
// Il testo che aveva incollato era già l'output del formattatore: gli unici due difetti erano
//  1) la virgola di continuazione della ORDER BY una colonna più a destra del primo elemento
//     (era `' '.repeat(kw.length) + ' ,'`, cioè uno spazio di troppo in listRows);
//  2) "; WITH" con lo spazio dopo il punto e virgola (convenzione T-SQL: ";WITH").
import { describe, expect, it } from 'vitest'
import { formatRoutineWithProfile } from '../tsqlFormatter'
import { buildFormatProfile, loadFormatProfileXml } from '../formatProfile'

const profile = buildFormatProfile(loadFormatProfileXml())

const CTE = `; WITH tbl AS
(
  SELECT TOP 1 UDC_UDC X_UDC
     ,IIF (UDC_SSCC > '', UDC_SSCC, SCO_SSCC_SOURCE) X_SSCC --sorgente
     ,UDC_ARTICOLO X_SKU
  FROM DAT_UDC
    INNER JOIN DAT_SCOMPART ON SCO_UDC = UDC_UDC
  WHERE UDC_CAUSMISS = 'CCKIT'
        AND (UDC_USER_TASK = ''
          OR UDC_USER_TASK = @user)
  ORDER BY IIF (UDC_USER_TASK > '', 0, 1)
            ,MIS_DCREA
)
SELECT TOP 1 a.*
INTO #tmpMission
FROM tbl a
WHERE (@UDC > 0
        AND X_UDC = @UDC
        OR @UDC = 0)
ORDER BY IIF (a.UDC_USER_TASK = @user, 0, 1)`

const ROUTINE = `CREATE OR ALTER PROCEDURE [dbo].[p]
(
        @user  NVARCHAR(50)
)
AS
SET NOCOUNT ON
${CTE}
IF @@rowcount = 0
BEGIN
  PRINT 'No task find'
END
`

const out = formatRoutineWithProfile(ROUTINE, profile)
const righe = out.split('\n')
const indiceDi = (re: RegExp) => righe.findIndex(r => re.test(r))

describe('CTE in una routine: allineamento', () => {
  it('la virgola della ORDER BY cade esattamente sotto il primo elemento', () => {
    const i = indiceDi(/^\s*ORDER BY IIF \(UDC_USER_TASK/)
    expect(i).toBeGreaterThanOrEqual(0)
    const colonnaPrimo = righe[i].indexOf('IIF')
    const continuazione = righe[i + 1]
    console.log(`  "${righe[i]}"\n  "${continuazione}"`)
    expect(continuazione.indexOf(',')).toBe(colonnaPrimo)
    expect(continuazione.trim()).toBe(',MIS_DCREA')
  })

  it('niente spazio dopo il punto e virgola del CTE', () => {
    expect(out).toMatch(/^\s*;WITH tbl AS$/m)
    expect(out).not.toMatch(/; WITH/)
  })

  it('la CTE è indentata sotto il corpo della procedura: "(" e la SELECT interna dentro', () => {
    const iCte = indiceDi(/^\s*;WITH tbl AS$/)
    expect(righe[iCte].indexOf(';')).toBe(2) // corpo della procedura
    expect(righe[iCte + 1]).toBe('  (')
    expect(righe[iCte + 2]).toMatch(/^ {4}SELECT TOP 1 UDC_UDC X_UDC$/)
    // FROM allo stesso livello della SELECT, JOIN due spazi più dentro
    expect(indiceDi(/^ {4}FROM DAT_UDC$/)).toBeGreaterThan(iCte)
    expect(indiceDi(/^ {6}INNER JOIN DAT_SCOMPART/)).toBeGreaterThan(iCte)
    // la parentesi di chiusura torna al livello del "("
    const iChiusa = righe.findIndex((r, i) => i > iCte && r === '  )')
    expect(iChiusa).toBeGreaterThan(iCte)
  })

  it('la lista dei campi e la ORDER BY sono impilate con la virgola in testa', () => {
    expect(out).toMatch(/^ {7},IIF \(UDC_SSCC > '', UDC_SSCC, SCO_SSCC_SOURCE\) X_SSCC --sorgente$/m)
    expect(out).toMatch(/^ {7},UDC_ARTICOLO X_SKU$/m)
  })

  it('dopo la CTE lo statement resta indentato nel corpo', () => {
    expect(out).toMatch(/^ {2}SELECT TOP 1 a\.\*$/m)
    expect(out).toMatch(/^ {2}INTO #tmpMission$/m)
    expect(out).toMatch(/^ {2}FROM tbl a$/m)
  })

  it('formattare due volte non cambia niente (idempotente)', () => {
    expect(formatRoutineWithProfile(out, profile)).toBe(out)
  })
})
