import { describe, expect, it } from 'vitest'
import { formatRoutineWithProfile, isRoutineText } from '../tsqlFormatter'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)
const fmt = (sql: string) => formatRoutineWithProfile(sql, profile)

describe('formattazione IF/ELSE annidati (frammento senza firma)', () => {
  it('IF/BEGIN con IF/ELSE interni senza BEGIN: allineati correttamente', () => {
    const sql = `IF @trancount = 0 AND @@trancount > 0
    BEGIN
      IF @txtError > '' OR XACT_STATE () = - 1 OR @retVal < 0
        ROLLBACK TRANSACTION
    ELSE
    COMMIT TRANSACTION
  END
END`
    const out = fmt(sql)
    expect(out).toBe(
      `IF @trancount = 0 AND @@trancount > 0\nBEGIN\n  IF @txtError > '' OR XACT_STATE () = - 1 OR @retVal < 0\n    ROLLBACK TRANSACTION\n  ELSE\n    COMMIT TRANSACTION\nEND\nEND\n`,
    )
  })

  it('un frammento senza firma parte da indent 0 (IF a margine)', () => {
    const sql = `IF x = 1\nBEGIN\n  IF y = 2\n    SELECT 1\n  ELSE\n    SELECT 2\nEND`
    const out = fmt(sql)
    expect(out).toBe(`IF x = 1\nBEGIN\n  IF y = 2\n    SELECT 1\n  ELSE\n    SELECT 2\nEND\n`)
  })

  it('ELSE si allinea al suo IF e il corpo dell\'ELSE è indentato', () => {
    const sql = `IF a = 1\n    SELECT 1\nELSE\nSELECT 2`
    const out = fmt(sql)
    expect(out).toBe(`IF a = 1\n  SELECT 1\nELSE\n  SELECT 2\n`)
  })

  it('una procedura con firma parte ancora da indent 1 (dopo AS)', () => {
    const sql = `alter procedure [dbo].[x]\nas\nbegin\n    set nocount on\n    if @a = 1\n        select 1\nend`
    const out = fmt(sql)
    expect(out).toBe(
      `  ALTER PROCEDURE [dbo].[x] AS\n  BEGIN\n    SET NOCOUNT ON\n    IF @a = 1\n      SELECT 1\n  END\n`,
    )
  })

  it('il frammento IF/ELSE è riconosciuto come codice procedurale', () => {
    expect(isRoutineText(`IF @a = 1\nBEGIN\n  SELECT 1\nEND`)).toBe(true)
  })
})
