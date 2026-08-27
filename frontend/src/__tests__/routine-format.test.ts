import { describe, expect, it } from 'vitest'
import { buildFormatProfile } from '../formatProfile'
import { formatRoutineWithProfile, formatSqlWithProfile, isRoutineText } from '../tsqlFormatter'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)

describe('formatSqlWithProfile: keyword ufficiali maiuscole (riferimento Microsoft)', () => {
  it('BACKUP/RESTORE/GRANT/DENY/DBCC vengono maiuscolizzate', () => {
    expect(formatSqlWithProfile("backup database wsdb to disk = 'c:\\x.bak'", profile)).toContain(
      'BACKUP DATABASE wsdb TO DISK',
    )
    expect(formatSqlWithProfile("restore database wsdb from disk = 'c:\\x.bak'", profile)).toContain(
      'RESTORE DATABASE wsdb FROM DISK',
    )
    expect(formatSqlWithProfile('grant select on dbo.t to u', profile)).toContain('GRANT SELECT ON dbo.t TO u')
    expect(formatSqlWithProfile('deny delete on dbo.t to u', profile)).toContain('DENY DELETE ON dbo.t TO u')
    // DBCC è maiuscolo; il sottocomando (checkdb) non è una keyword e resta com'è
    expect(formatSqlWithProfile('dbcc checkdb (wsdb)', profile)).toContain('DBCC checkdb (wsdb)')
  })

  it('costrutti APPLY con a-capo coerente (CROSS APPLY resta unito)', () => {
    const out = formatSqlWithProfile('select * from t cross apply dbo.fn(1) x', profile)
    expect(out).toContain('CROSS APPLY dbo.fn')
  })
})

describe('formatRoutineWithProfile: stored procedure con blocchi (stile Redgate)', () => {
  const proc = `alter procedure [dbo].[ws_L2_Engine_Automatismi]
(
 @pComponente nvarchar(max) /* Componente */
,@pGestore nvarchar(max) /* Gestore */
,@pOperatore nvarchar(max) = 'SYSTEM' /* Operatore (Opzionale) */
,@pTimeOut int = 0 /* 0 = Timeout infinito (Opzionale) */
)
as
 set nocount on
 set xact_abort on
 declare @retval int = 0
        ,@txtlog nvarchar(max) = ''
 if @pOperatore = ''
   select @pOperatore = 'SYSTEM'
 select @retval = case
                     when @pTimeOut > 20
                       then @pTimeOut - 20
                     else @pTimeOut
                  end
 if @@rowcount < 1
   return 0
 begin
   select @retval = 1
 end
 exec @retval = dbo.ws_Uti_TabChanges_Done @pGestore, @fn_name, 10
 return @retval
 end_err:
 raiserror ('x', 16, 1)
 return -1
GO`

  it('isRoutineText riconosce le procedure e ignora le query semplici', () => {
    expect(isRoutineText(proc)).toBe(true)
    expect(isRoutineText('select * from t where a = 1')).toBe(false)
  })

  it('firma: intestazione, parentesi e parametri su righe proprie con virgola iniziale', () => {
    const out = formatRoutineWithProfile(proc, profile)
    const lines = out.split('\n')
    expect(lines[0].trim()).toContain('ALTER PROCEDURE [dbo].[ws_L2_Engine_Automatismi]')
    expect(lines[1].trim()).toBe('(')
    expect(out).toContain('@pComponente')
    expect(out).toContain(',@pGestore')
    expect(out).toContain(",@pOperatore NVARCHAR(max) = 'SYSTEM'")
    expect(lines.some(l => l.trim() === 'AS')).toBe(true)
  })

  it('corpo: set/declare/select/if/begin/end indentati a 2 spazi per livello', () => {
    const out = formatRoutineWithProfile(proc, profile)
    expect(out).toMatch(/^  SET NOCOUNT ON$/m)
    expect(out).toMatch(/^  SET XACT_ABORT ON$/m)
    expect(out).toMatch(/^  DECLARE @retval INT = 0$/m)
    expect(out).toMatch(/^  IF @pOperatore = ''$/m)
    expect(out).toMatch(/^  BEGIN$/m)
    expect(out).toMatch(/^  END$/m)
    expect(out).toMatch(/^  RETURN @retval$/m)
    // il contenuto di un blocco è indentato di +2
    expect(out).toMatch(/^    SELECT @retval = 1$/m)
  })

  it('CASE multilinea: WHEN/THEN/ELSE su righe proprie con indentazione crescente', () => {
    const out = formatRoutineWithProfile(proc, profile)
    expect(out).toMatch(/^    CASE$/m)
    expect(out).toMatch(/^      WHEN @pTimeOut > 20$/m)
    expect(out).toMatch(/^        THEN @pTimeOut - 20$/m)
    expect(out).toMatch(/^      ELSE @pTimeOut$/m)
    expect(out).toMatch(/^    END$/m)
  })

  it('IF senza BEGIN: il corpo condizionale è indentato', () => {
    const out = formatRoutineWithProfile(proc, profile)
    expect(out).toMatch(/^  IF @@rowcount < 1$/m)
    expect(out).toMatch(/^    RETURN 0$/m)
  })

  it('label a margine (end_err:) e GO a margine', () => {
    const out = formatRoutineWithProfile(proc, profile)
    expect(out).toMatch(/^end_err:$/m)
    expect(out).toMatch(/^GO$/m)
  })

  it('output stabile e terminato da newline', () => {
    const out = formatRoutineWithProfile(proc, profile)
    expect(out.endsWith('\n')).toBe(true)
    expect(formatRoutineWithProfile(proc, profile)).toBe(out)
  })
})

describe('formatRoutineWithProfile: BEGIN ... non deve mai perdere il resto del segmento', () => {
  it('BEGIN TRANSACTION ... ROLLBACK: "TRANSACTION" non scompare (bug utente)', () => {
    const sql = `BEGIN TRANSACTION

  SELECT * FROM dbo.MAG_BAIE_INTERNE ORDER BY 1 DESC

  IF 12 = 0
  BEGIN

  END
ROLLBACK`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toContain('BEGIN TRANSACTION')
    expect(out).toContain('SELECT * FROM dbo.MAG_BAIE_INTERNE ORDER BY 1 DESC')
    expect(out).toContain('IF 12 = 0')
    expect(out).toContain('ROLLBACK')
    // il blocco dopo BEGIN TRANSACTION è indentato
    expect(out).toMatch(/^BEGIN TRANSACTION$/m)
    expect(out).toMatch(/^  SELECT \* FROM dbo\.MAG_BAIE_INTERNE ORDER BY 1 DESC$/m)
  })

  it('BEGIN TRAN e BEGIN TRY/CATCH con il resto sulla stessa riga: testo preservato', () => {
    const sql = `BEGIN TRAN
  UPDATE dbo.T SET x = 1
COMMIT

BEGIN TRY
  SELECT 1
END TRY
BEGIN CATCH
  PRINT ERROR_MESSAGE()
END CATCH`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toContain('BEGIN TRAN')
    expect(out).toContain('COMMIT')
    expect(out).toContain('BEGIN TRY')
    expect(out).toContain('END TRY')
    expect(out).toContain('BEGIN CATCH')
    expect(out).toContain('END CATCH')
    expect(out).toContain('PRINT ERROR_MESSAGE')
  })

  it('statement di batch (USE/GRANT/BACKUP) su segmenti propri (riferimento Microsoft)', () => {
    const sql = `BEGIN
  USE WSDB
  GRANT SELECT ON dbo.T TO utente
  BACKUP DATABASE WSDB TO DISK = 'C:\\ws.bak'
END`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toMatch(/^BEGIN$/m)
    expect(out).toMatch(/^  USE WSDB$/m)
    expect(out).toMatch(/^  GRANT SELECT ON dbo\.T TO utente$/m)
    expect(out).toMatch(/^  BACKUP DATABASE WSDB TO DISK = 'C:\\ws\.bak'$/m)
    expect(out).toMatch(/^END$/m)
  })

  it('GRANT ... TO: dopo il TO uno statement successivo si spezza di nuovo', () => {
    const sql = `BEGIN
  GRANT SELECT ON dbo.T TO utente
  SELECT 1
END`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toContain('GRANT SELECT ON dbo.T TO utente')
    expect(out).toContain('SELECT 1')
    // GRANT e SELECT su righe diverse (il SELECT non viene inghiottito dal GRANT)
    const grantIdx = out.indexOf('GRANT SELECT')
    const selectIdx = out.indexOf('SELECT 1')
    expect(grantIdx).toBeGreaterThanOrEqual(0)
    expect(selectIdx).toBeGreaterThan(grantIdx)
  })
})
