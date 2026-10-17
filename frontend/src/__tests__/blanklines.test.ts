import { describe, expect, it } from 'vitest'
import { formatRoutineWithProfile, formatSqlWithProfile } from '../tsqlFormatter'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)
const fmt = (sql: string) => formatRoutineWithProfile(sql, profile)
const fmtQ = (sql: string) => formatSqlWithProfile(sql, profile)

describe('righe vuote tra le istruzioni', () => {
  it('una riga vuota tra le istruzioni viene preservata', () => {
    const sql = `alter procedure [dbo].[x]\nas\nbegin\n    set nocount on\n\n    select @x = 1\nend`
    const out = fmt(sql)
    expect(out).toContain('SET NOCOUNT ON\n\n    SELECT @x = 1')
  })

  it('due righe vuote tra le istruzioni vengono preservate', () => {
    const sql = `alter procedure [dbo].[x]\nas\nbegin\n    set nocount on\n\n\n    select @x = 1\nend`
    const out = fmt(sql)
    expect(out).toContain('SET NOCOUNT ON\n\n\n    SELECT @x = 1')
  })

  it('righe vuote dentro un UPDATE (routine) vengono tolte', () => {
    const sql = `alter procedure [dbo].[x]\nas\nbegin\n    update t\n        set a = 1\n\n        , b = 2\n    where id = 1\nend`
    const out = fmt(sql)
    expect(out).not.toContain('\n\n')
    expect(out).toContain('UPDATE t\n      SET a  = 1\n          ,b = 2\n    WHERE id = 1')
  })

  it('righe vuote dentro un UPDATE standalone (query) vengono tolte', () => {
    const sql = `update t\n    set a = 1\n\n        , b = 2\nwhere id = 1`
    const out = fmtQ(sql)
    expect(out).not.toContain('\n\n')
    expect(out).toContain('UPDATE t\n  SET a  = 1\n      ,b = 2\nWHERE id = 1')
  })

  it('righe vuote iniziali del documento non vengono riprodotte', () => {
    const sql = `\n\nalter procedure [dbo].[x]\nas\nbegin\n    set nocount on\nend`
    const out = fmt(sql)
    expect(out.startsWith('\n')).toBe(false)
  })

  it('righe vuote attorno ai commenti preservate e commenti al loro posto', () => {
    const sql = `alter procedure [dbo].[x]\nas\nbegin\n    set nocount on\n\n    -- sezione 2\n\n    select @x = 1\nend`
    const out = fmt(sql)
    expect(out).toContain('SET NOCOUNT ON\n\n    -- sezione 2\n\n    SELECT @x = 1')
  })

  it('riga vuota tra END e la prossima istruzione preservata', () => {
    const sql = `alter procedure [dbo].[x]\nas\nbegin\n    if @a = 1\n    begin\n        select 1\n    end\n\n    select 2\nend`
    const out = fmt(sql)
    expect(out).toContain('END\n\n    SELECT 2')
  })

  it('riga vuota tra GO e la prossima istruzione preservata', () => {
    const sql = `alter procedure [dbo].[x]\nas\nbegin\n    set nocount on\nend\ngo\n\nselect 1`
    const out = fmt(sql)
    expect(out).toContain('GO\n\n  SELECT 1')
  })

  it('senza righe vuote l\'output non ne aggiunge', () => {
    const sql = `alter procedure [dbo].[x]\nas\nbegin\n    set nocount on\n    select @x = 1\nend`
    const out = fmt(sql)
    expect(out).not.toContain('\n\n')
  })
})
