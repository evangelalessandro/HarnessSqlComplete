import { describe, expect, it } from 'vitest'
import { buildFormatProfile } from '../formatProfile'
import { formatRoutineWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)

/**
 * Sequenza dei token con i commenti esclusi: serve a dimostrare che il formatter
 * non perde (né riordina) niente per strada. Le keyword cambiano solo di case.
 */
function tokeniUtili(sql: string): string[] {
  return tokenizeSqlText(sql)
    .filter(t => t.type !== 'comment')
    .map(t => (t.type === 'word' ? t.text.toUpperCase() : t.text))
}

// Caso segnalato: funzione scalare SENZA parametri, "RETURNs" scritto in minuscolo.
// La clausola fra ")" e "AS" spariva del tutto dall'output.
const fnScalareSenzaParam = `/* Ritorna baia ingresso dal vna
     
*/
/* Function that return the  bay of infeed
   
*/
CREATE OR ALTER FUNCTION [dbo].[fn_Prova_BaiaIngresso]
(
)
RETURNs INT
AS
BEGIN
  DECLARE @baia INT
  SELECT @baia = BCO_BAIA
  FROM TEST_ELEVATORI
    INNER JOIN TEST_BAIE ON (BCO_USOBAIA LIKE '%,VNKIT,%' AND ELE_ABI = 1 OR BCO_USOBAIA LIKE '%,VNABS,%' AND ELE_ABI = 0)
  WHERE ELE_ELEVATORE = 'EL5'

  RETURN @baia
END
GO`

const fnScalareConParam = `create or alter function dbo.fn_Prova_Importo(@pId int, @pNome nvarchar(20))
returns decimal(18,2)
as
begin
  declare @r decimal(18,2)
  select @r = sum(IMPORTO) from dbo.TEST_RIGHE where ID = @pId
  return @r
end`

const fnTabellaMulti = `CREATE FUNCTION dbo.fn_Prova_Tabella(@pAnno int)
RETURNS @esito TABLE (ID int, NOME varchar(20), DATA datetime)
AS
BEGIN
  INSERT INTO @esito (ID, NOME) SELECT ID, NOME FROM dbo.TEST_TAB WHERE ANNO = @pAnno
  RETURN
END`

const fnTabellaInline = `create function dbo.fn_Prova_Inline(@pAnno int)
returns table
as
return (select ID, NOME from dbo.TEST_TAB where ANNO = @pAnno)`

describe('formatter routine: la clausola RETURNS non viene piu cancellata', () => {
  it('funzione scalare senza parametri: RETURNS sta fra ")" e AS (caso segnalato)', () => {
    const out = formatRoutineWithProfile(fnScalareSenzaParam, profile)
    const righe = out.split('\n').map(l => l.trim())
    // "RETURNs" minuscolo diventa "RETURNS" (keyword) e resta una riga propria
    expect(out).toMatch(/^RETURNS INT$/m)
    const iChiusa = righe.indexOf(')')
    const iReturns = righe.indexOf('RETURNS INT')
    const iAs = righe.indexOf('AS')
    expect(iChiusa).toBeGreaterThan(-1)
    expect(iReturns).toBe(iChiusa + 1)
    expect(iAs).toBe(iReturns + 1)
  })

  it('funzione scalare senza parametri: il corpo e il RETURN interno restano intatti', () => {
    const out = formatRoutineWithProfile(fnScalareSenzaParam, profile)
    expect(out).toMatch(/^  DECLARE @baia INT$/m)
    expect(out).toMatch(/^  RETURN @baia$/m)
    // i due commenti di documentazione restano prima della CREATE, su righe proprie
    expect(out.startsWith('/* Ritorna baia ingresso dal vna')).toBe(true)
    expect(out).toContain('/* Function that return the  bay of infeed')
    expect(out).toMatch(/^GO$/m)
  })

  it('funzione scalare con parametri: firma incolonnata e RETURNS con il suo tipo', () => {
    const out = formatRoutineWithProfile(fnScalareConParam, profile)
    expect(out).toMatch(/^RETURNS DECIMAL\(18, 2\)$/m)
    expect(out).toMatch(/^\s+@pId\s+INT$/m)
    expect(out).toMatch(/^\s+,@pNome\s+NVARCHAR\(20\)$/m)
  })

  it('table-valued multi-statement: RETURNS @t TABLE (...) resta intero', () => {
    const out = formatRoutineWithProfile(fnTabellaMulti, profile)
    expect(out).toMatch(/^RETURNS @esito TABLE \(ID INT, NOME VARCHAR\(20\), DATA DATETIME\)$/m)
    expect(out).toMatch(/^\s+RETURN$/m)
  })

  it('table-valued inline: RETURNS TABLE e il RETURN (SELECT ...) restano', () => {
    const out = formatRoutineWithProfile(fnTabellaInline, profile)
    expect(out).toMatch(/^RETURNS TABLE$/m)
    expect(out).toContain('RETURN (SELECT')
  })

  it('nessun token perso in nessuno dei casi di funzione', () => {
    for (const sql of [fnScalareSenzaParam, fnScalareConParam, fnTabellaMulti, fnTabellaInline]) {
      expect(tokeniUtili(formatRoutineWithProfile(sql, profile))).toEqual(tokeniUtili(sql))
    }
  })
})

describe('formatter routine: firma con parametri sciolti (senza parentesi)', () => {
  const procSenzaParen = `create procedure dbo.sp_Prova
  @pA int
, @pB nvarchar(10) = 'x'
as
begin
  set nocount on
  select @pA = @pA + 1
  return @pA
end`

  it('la parentesi di un tipo non viene scambiata per l elenco parametri', () => {
    const out = formatRoutineWithProfile(procSenzaParen, profile)
    expect(out).toContain('@pA INT')
    // il tipo con parentesi resta intero e non finisce su righe finte da parametro
    expect(out).toContain("@pB NVARCHAR(10) = 'x'")
    expect(out).not.toMatch(/^\($/m)
    expect(out).toMatch(/^AS$/m)
    expect(out).toMatch(/^\s+RETURN @pA$/m)
  })

  it('nessun token perso nella firma senza parentesi', () => {
    const out = formatRoutineWithProfile(procSenzaParen, profile)
    expect(tokeniUtili(out)).toEqual(tokeniUtili(procSenzaParen))
  })
})
