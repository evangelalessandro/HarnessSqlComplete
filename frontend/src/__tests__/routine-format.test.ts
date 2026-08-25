import { describe, expect, it } from 'vitest'
import { buildFormatProfile } from '../formatProfile'
import { formatRoutineWithProfile, isRoutineText } from '../tsqlFormatter'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)

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
