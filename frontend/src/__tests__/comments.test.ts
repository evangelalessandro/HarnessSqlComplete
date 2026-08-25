import { describe, expect, it } from 'vitest'
import { formatRoutineWithProfile, formatSqlWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)
const fmt = (sql: string) => formatRoutineWithProfile(sql, profile)
const fmtQ = (sql: string) => formatSqlWithProfile(sql, profile)

describe('formattazione dei commenti', () => {
  it('commenti su riga propria dopo BEGIN restano sulla loro riga', () => {
    const sql = `alter procedure [dbo].[x]\nas\nbegin\n    -- commento 1\n    -- commento 2\n    set nocount on\nend`
    const out = fmt(sql)
    expect(out).toContain('    -- commento 1\n    -- commento 2\n    SET NOCOUNT ON')
    expect(out).not.toContain('-- commento 1 -- commento 2')
  })

  it('commenti consecutivi non vengono fusi', () => {
    const sql = `alter procedure [dbo].[x]\nas\nbegin\n    -- intestazione\n    -- sezione 1\n    select @x = 1\nend`
    const out = fmt(sql)
    expect(out).toContain('    -- intestazione\n    -- sezione 1\n    SELECT @x = 1')
  })

  it('commento tra statement resta su riga propria', () => {
    const sql = `alter procedure [dbo].[x]\nas\nbegin\n    set nocount on\n    -- commento medio\n    select @x = 1\nend`
    const out = fmt(sql)
    expect(out).toContain('SET NOCOUNT ON\n    -- commento medio\n    SELECT @x = 1')
  })

  it('commento inline resta sulla riga dello statement', () => {
    const sql = `alter procedure [dbo].[x]\nas\nbegin\n    set nocount on -- attiva no-count\n    select @x = 1\nend`
    const out = fmt(sql)
    expect(out).toContain('SET NOCOUNT ON -- attiva no-count')
  })

  it('commento a blocco multilinea preservato su più righe', () => {
    const sql = `alter procedure [dbo].[x]\nas\nbegin\n    /* commento\n       su piu righe */\n    set nocount on\nend`
    const out = fmt(sql)
    expect(out).toContain('/* commento\n       su piu righe */')
    expect(out).toContain('SET NOCOUNT ON')
  })

  it('commento indentato dentro blocco IF resta al suo livello', () => {
    const sql = `alter procedure [dbo].[x]\nas\nbegin\n    if @a = 1\n    begin\n        -- commento interno\n        select 1\n    end\nend`
    const out = fmt(sql)
    expect(out).toContain('      -- commento interno\n      SELECT 1')
  })

  it('commento dopo END e GO finale a margine', () => {
    const sql = `alter procedure [dbo].[x]\nas\nbegin\n    set nocount on\nend\n-- commento finale\ngo`
    const out = fmt(sql)
    expect(out).toContain('END\n  -- commento finale\nGO')
  })

  it('commento prima di BEGIN non viene scartato', () => {
    const sql = `alter procedure [dbo].[x]\nas\nbegin\n    -- avvio blocco\n    begin\n        select 1\n    end\nend`
    const out = fmt(sql)
    expect(out).toContain('    -- avvio blocco\n    BEGIN')
  })

  it('commento su riga propria in una query resta su riga propria', () => {
    const sql = `SELECT a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r, s, t, u, v, w, x, y, z,\n       aa, bb, cc\n-- commento separato\nFROM t\nWHERE x = 1`
    const out = fmtQ(sql)
    const lines = out.split('\n')
    expect(lines.some(l => l.trim() === '-- commento separato')).toBe(true)
    // il commento non è fuso con la riga FROM
    expect(lines.some(l => l.includes('-- commento separato FROM'))).toBe(false)
  })

  it('stringhe con -- e /* non vengono trattate come commenti', () => {
    const tokens = tokenizeSqlText(`SELECT '--#region' AS a, '/* x */' AS b`)
    expect(tokens.filter(t => t.type === 'comment')).toHaveLength(0)
    expect(tokens.filter(t => t.type === 'string')).toHaveLength(2)
  })
})
