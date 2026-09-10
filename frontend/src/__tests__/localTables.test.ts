import { describe, expect, it } from 'vitest'
import { buildColumnContextSuggestions } from '../helpers'
import { extractLocalTables, parseColumnDefs } from '../localTables'
import type { DatabaseSummary } from '../types'
import { wsbritvicLikeSummary } from './schema'

describe('extractLocalTables: tabelle temporanee definite nel testo', () => {
  it('legge nome tabella e colonne con il tipo (parentesi comprese)', () => {
    const sql = `CREATE TABLE #tbl_InventoryKitting_St1 (
  X_SSCC NVARCHAR(50)
  ,X_SKU NVARCHAR(50)
  ,X_GIAC NVARCHAR(50)
  ,QTA INT NOT NULL
)`
    const tables = extractLocalTables(sql)
    expect(tables.length).toBe(1)
    expect(tables[0].name).toBe('#tbl_InventoryKitting_St1')
    expect(tables[0].columns!.map(c => c.name)).toEqual(['X_SSCC', 'X_SKU', 'X_GIAC', 'QTA'])
    expect(tables[0].columns!.map(c => c.dataType)).toEqual([
      'NVARCHAR(50)',
      'NVARCHAR(50)',
      'NVARCHAR(50)',
      'INT',
    ])
    expect(tables[0].columnCount).toBe(4)
  })

  it('temporanea globale ##nome e più definizioni', () => {
    const sql = 'CREATE TABLE ##globale (a int, b decimal(10,2))\nCREATE TABLE #locale (x int)'
    const names = extractLocalTables(sql).map(t => t.name)
    expect(names).toEqual(['##globale', '#locale'])
  })

  it('definizioni dentro commenti o stringhe NON contano', () => {
    const sql = `-- CREATE TABLE #finta (a int)
/* CREATE TABLE #altra (b int) */
SELECT 'CREATE TABLE #stringa (c int)'
CREATE TABLE #vera (d int)`
    const tables = extractLocalTables(sql)
    expect(tables.map(t => t.name)).toEqual(['#vera'])
  })

  it('senza parentesi (AS SELECT) non inventa colonne', () => {
    expect(extractLocalTables('SELECT * INTO #t FROM dbo.T')).toEqual([])
  })

  it('parseColumnDefs: salta i vincoli di tabella e taglia i vincoli di colonna', () => {
    const cols = parseColumnDefs('a int PRIMARY KEY, b nvarchar(10) NOT NULL, CONSTRAINT pk PRIMARY KEY (a)')
    expect(cols.map(c => [c.name, c.dataType])).toEqual([
      ['a', 'int'],
      ['b', 'nvarchar(10)'],
    ])
  })
})

describe('intellisense: colonne della TEMPORANEA nel WHERE (caso utente)', () => {
  const sql = `CREATE TABLE #tbl_InventoryKitting_St1 (
  X_SSCC NVARCHAR(50)
  ,X_SKU NVARCHAR(50)
  ,X_MODULO NVARCHAR(50)
  ,X_UDC NVARCHAR(50)
)

EXEC ws_CUSTOM_Handheld_InventoryKitting_St1_GetList @user = @user, @udc = @pUDC
IF @@rowcount = 0
BEGIN
  SET @txtError = 'No task find !'
  GOTO lblExit
END

SELECT @txtError = CASE WHEN ISNULL(@ssccLu, '') = '' THEN 'x' ELSE '' END, @modulo = X_MODULO
FROM (SELECT 1 TT) a
  LEFT JOIN #tbl_InventoryKitting_St1 ON 1 = 1
WHERE `

  it('con la temporanea nel sommario propone le sue colonne', () => {
    const base: DatabaseSummary = wsbritvicLikeSummary()
    const local = extractLocalTables(sql)
    expect(local.map(t => t.name)).toEqual(['#tbl_InventoryKitting_St1'])
    const merged: DatabaseSummary = { ...base, tables: [...base.tables, ...local] }

    // stesso ritaglio che fa il provider (statement corrente)
    const stmtText = sql.slice(sql.lastIndexOf('SELECT @txtError'))
    const res = buildColumnContextSuggestions(stmtText, stmtText, '', merged)
    const names = res.map(r => r.name)
    expect(names).toContain('X_SSCC')
    expect(names).toContain('X_MODULO')
    expect(names).toContain('X_UDC')
  })

  it('senza la temporanea nel sommario non c\'era nulla da proporre (motivo del bug)', () => {
    const base: DatabaseSummary = wsbritvicLikeSummary()
    const stmtText = sql.slice(sql.lastIndexOf('SELECT @txtError'))
    const res = buildColumnContextSuggestions(stmtText, stmtText, '', base)
    expect(res.map(r => r.name)).not.toContain('X_SSCC')
  })
})
