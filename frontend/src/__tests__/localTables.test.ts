import { describe, expect, it } from 'vitest'
import { buildColumnContextSuggestions } from '../helpers'
import { extractLocalTables, parseColumnDefs, selectListInfo } from '../localTables'
import type { DatabaseSummary } from '../types'
import { demoStoreLikeSummary } from './schema'
import kittingReturn from './fixtures/routine_ws_CIDEDO_HUSOBUME_KIPEVUBEGUSEV_St1_GIVOSEB.sql?raw'

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

EXEC ws_CIDEDO_HUSOBUME_IIGISUMIVOSOVUBE_St1_GIVOSEB @user = @user, @udc = @pUDC
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
    const base: DatabaseSummary = demoStoreLikeSummary()
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
    const base: DatabaseSummary = demoStoreLikeSummary()
    const stmtText = sql.slice(sql.lastIndexOf('SELECT @txtError'))
    const res = buildColumnContextSuggestions(stmtText, stmtText, '', base)
    expect(res.map(r => r.name)).not.toContain('X_SSCC')
  })
})

// Casi segnalati dall'utente ("l'intellisense non mi aiuta con le tabelle temporanee,
// tipo la #tmpMission"): una "SELECT TOP 1 * … INTO #t FROM <CTE>" non dava le colonne.
describe('SELECT … INTO #t: alias, TOP, * e colonne delle CTE', () => {
  it('alias dopo una funzione (il CAST ha un suo "as" interno)', () => {
    const info = selectListInfo(`CAST('' as nvarchar(50)) as X_SSCC_DEST, CAST(0 as decimal(15,0)) X_UDC_DEST`)
    expect(info.names).toEqual(['X_SSCC_DEST', 'X_UDC_DEST'])
    expect(info.star).toBe(false)
  })

  it('"espressione alias" senza AS, e nessun alias inventato dalle espressioni', () => {
    expect(selectListInfo('SCO_GIAC + SCO_VER X_GIAC').names).toEqual(['X_GIAC'])
    expect(selectListInfo('0 X_CORRIDOIO').names).toEqual(['X_CORRIDOIO'])
    // espressioni senza alias: nessun nome (SQL Server non lo assegna)
    expect(selectListInfo('SCO_GIAC + SCO_VER').names).toEqual([])
    expect(selectListInfo('CAST(x as int)').names).toEqual([])
    expect(selectListInfo('ISNULL(a, 0)').names).toEqual([])
    expect(selectListInfo('CASE WHEN a = 1 THEN 1 ELSE 0 END').names).toEqual([])
  })

  it('TOP n e DISTINCT non fanno parte della lista; "*" viene riconosciuto', () => {
    expect(selectListInfo('top 1 *')).toEqual({ names: [], star: true })
    expect(selectListInfo('DISTINCT top 10 a, b')).toEqual({ names: ['a', 'b'], star: false })
    expect(selectListInfo('t.*')).toEqual({ names: [], star: true })
  })

  it('le colonne della CTE arrivano nella temporanea', () => {
    const sql = `;with tbl as (select top 1 SCO_SCOMPARTO X_SCO, UDC_SSCC X_SSCC from DAT_UDC)
select top 1 * , cast('' as nvarchar(50)) as X_SSCC_DEST into #tmpMission from tbl`
    const t = extractLocalTables(sql)[0]
    expect(t.name).toBe('#tmpMission')
    expect(t.columns!.map(c => c.name)).toEqual(['X_SSCC_DEST', 'X_SCO', 'X_SSCC'])
  })

  it('CTE annidate fra loro e "SELECT * FROM tabella nota"', () => {
    const known = demoStoreLikeSummary()
    const sql = `with a as (select * from ${known.tables[0].name}), b as (select * from a)
select * into #t from b`
    const t = extractLocalTables(sql, known.tables)[0]
    expect(t.columns!.map(c => c.name)).toEqual(known.tables[0].columns!.map(c => c.name))
  })

  it('"*" da un altra temporanea definita prima', () => {
    const sql = `select a, b into #prima from dbo.T
select * into #seconda from #prima`
    const t = extractLocalTables(sql).find(x => x.name === '#seconda')
    expect(t?.columns?.map(c => c.name)).toEqual(['a', 'b'])
  })
})

describe('store reale: #tmpMission nell intellisense', () => {
  const locali = extractLocalTables(kittingReturn)

  it('riconosce le temporanee della store', () => {
    expect(locali.map(t => t.name)).toEqual(['#tmpMission', '#tmpNewDest'])
  })

  it('#tmpMission ha le colonne della CTE oltre a quelle esplicite (niente tipi al posto dei nomi)', () => {
    const mission = locali[0]
    expect(mission.columns!.map(c => c.name)).toEqual([
      'X_SSCC_DEST',
      'X_CORRIDOIO',
      'X_CELLA',
      'X_UDC_DEST',
      'X_SCO',
      'X_UDC_SOURCE',
      'X_SSCC',
      'X_SKU',
      'X_SKU_DESC',
      'X_GIAC',
      'UDC_USER_TASK',
    ])
  })

  it('nel JOIN la sua colonna viene proposta (era il problema segnalato)', () => {
    const base: DatabaseSummary = demoStoreLikeSummary()
    const merged: DatabaseSummary = { ...base, tables: [...base.tables, ...locali] }
    const stmt = 'select * from DAT_UDC inner join #tmpMission on '
    const res = buildColumnContextSuggestions(stmt, stmt, '', merged)
    expect(res.map(r => r.name)).toContain('X_UDC_SOURCE')
    expect(res.map(r => r.name)).toContain('X_UDC_DEST')
  })
})
