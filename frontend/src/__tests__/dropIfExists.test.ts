// "DROP TABLE IF EXISTS #tmp" deve restare su UNA riga (segnalazione utente: "sistema questa
// formattazione, deve stare tutto su di una riga — DROP TABLE / IF EXISTS #tmpUdc").
import { describe, expect, it } from 'vitest'
import { formatRoutineWithProfile } from '../tsqlFormatter'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)
const fmt = (sql: string) => formatRoutineWithProfile(sql, profile).replace(/\r\n/g, '\n')

const SP = `CREATE OR ALTER PROCEDURE dbo.Prova
AS
DROP TABLE
IF EXISTS #tmpUdc
SELECT 1 AS X`

describe('DROP … IF EXISTS su una riga', () => {
  it('DROP TABLE IF EXISTS resta su una riga sola', () => {
    const out = fmt(SP)
    console.log(out)
    expect(out).toContain('DROP TABLE IF EXISTS #tmpUdc')
    expect(out).not.toMatch(/DROP TABLE\s*\n\s*IF EXISTS/)
  })

  it('vale anche per DROP INDEX, DROP VIEW e ALTER TABLE … DROP COLUMN', () => {
    const casi = [
      'CREATE OR ALTER PROCEDURE dbo.P1\nAS\nDROP INDEX IF EXISTS IX_Prova ON dbo.T1\nSELECT 1 AS X',
      'CREATE OR ALTER PROCEDURE dbo.P2\nAS\nDROP VIEW IF EXISTS dbo.V1\nSELECT 1 AS X',
      'CREATE OR ALTER PROCEDURE dbo.P3\nAS\nALTER TABLE dbo.T1 DROP COLUMN IF EXISTS Col\nSELECT 1 AS X',
    ]
    for (const sql of casi) {
      const out = fmt(sql)
      console.log('---\n' + out)
      expect(out).not.toMatch(/DROP (TABLE|INDEX|VIEW|COLUMN)\s*\n\s*IF EXISTS/)
      expect(out).toMatch(/IF EXISTS/)
    }
  })

  it('un IF vero dopo un altro statement resta un IF suo', () => {
    const out = fmt("CREATE OR ALTER PROCEDURE dbo.P4\nAS\nSELECT 1 AS X\nIF @a > 0\n  PRINT 'ok'")
    expect(out).toMatch(/\n\s*IF @a > 0/)
  })
})
