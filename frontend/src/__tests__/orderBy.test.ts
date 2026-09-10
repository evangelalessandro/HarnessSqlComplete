// ORDER BY: l'intellisense deve proporre SOLO le colonne delle tabelle dello statement
// più ASC/DESC — mai tabelle, viste, procedure o funzioni (non utilizzabili lì).
import { describe, expect, it } from 'vitest'
import { buildColumnContextSuggestions, statementRangeAt } from '../helpers'
import { allows, classifyContext, ORDER_DIRECTIONS } from '../intellisenseContext'
import { extractLocalTables } from '../localTables'
import type { DatabaseSummary } from '../types'
import { wsbritvicLikeSummary } from './schema'

const summary = wsbritvicLikeSummary()

function ctxFor(prefix: string) {
  return classifyContext({ prefix, stmtBefore: prefix })
}

describe('ORDER BY: contesto e categorie ammesse', () => {
  it('dentro la ORDER BY: solo colonne + ASC/DESC', () => {
    const ctx = ctxFor('SELECT MIS_UDC FROM dbo.RUN_MISSIONI ORDER BY ')
    expect(ctx.kind).toBe('orderBy')
    expect(ctx.inOrderBy).toBe(true)
    expect(allows(ctx, 'columns')).toBe(true)
    expect(allows(ctx, 'orderDirections')).toBe(true)
    expect(allows(ctx, 'functions')).toBe(false)
    expect(allows(ctx, 'tables')).toBe(false)
    expect(allows(ctx, 'views')).toBe(false)
    expect(allows(ctx, 'procedures')).toBe(false)
    expect(allows(ctx, 'keywords')).toBe(false)
    expect(allows(ctx, 'snippets')).toBe(false)
  })

  it('ASC/DESC proposte anche dopo una colonna già scritta', () => {
    expect(ctxFor('SELECT MIS_UDC FROM dbo.RUN_MISSIONI ORDER BY MIS_UDC ').kind).toBe('orderBy')
    expect(ctxFor('SELECT MIS_UDC FROM dbo.RUN_MISSIONI ORDER BY MIS_UDC ASC, ').inOrderBy).toBe(true)
    expect(ctxFor('SELECT a FROM t ORDER BY a DESC ').inOrderBy).toBe(true)
  })

  it('fuori dalla ORDER BY il contesto NON è orderBy (WHERE/GROUP BY/SELECT)', () => {
    expect(ctxFor('SELECT a FROM t WHERE ').kind).toBe('columnContext')
    expect(ctxFor('SELECT a FROM t GROUP BY ').kind).toBe('columnContext')
    expect(ctxFor('SELECT a FROM t ORDER BY a WHERE ').inOrderBy).toBe(false)
    expect(ctxFor('SELECT ').inOrderBy).toBe(false)
  })

  it('ORDER_DIRECTIONS contiene ASC e DESC', () => {
    expect([...ORDER_DIRECTIONS]).toEqual(['ASC', 'DESC'])
  })
})

describe('ORDER BY: caso utente reale (batch con temporanea, CASE e alias)', () => {
  // Testo completo dell'utente: temp table + EXEC + IF/BEGIN + SELECT con CASE + JOIN + ORDER BY
  const FULL = `CREATE TABLE #tbl_InventoryKitting_St1 (
  X_SSCC NVARCHAR(50)
  ,X_SKU NVARCHAR(50)
  ,X_MODULO NVARCHAR(50)
)

EXEC ws_CUSTOM_Handheld_InventoryKitting_St1_GetList @user = @user
                                                    ,@udc  = @pUDC
IF @@rowcount = 0
BEGIN
  SET @txtError = 'No task find !'
  GOTO lblExit
END

SELECT @txtError =
  CASE
    WHEN ISNULL (@ssccLu, '') = ''
      THEN dbo.fn_td ('SSCC not set !')
    WHEN X_UDC IS NULL
      THEN dbo.fn_td ('Lu not found !')
    WHEN X_SSCC <> @ssccLu
      THEN dbo.fn_td ('SSCC not match !')
    WHEN @Qty <= 0
      THEN dbo.fn_td ('Qta is invalid !')
    ELSE ''
  END
  ,@modulo = X_MODULO
FROM (SELECT 1 TT) a
  LEFT JOIN #tbl_InventoryKitting_St1 b ON 1 = 1
 ORDER BY X_SSCC`

  /** Riproduce esattamente quello che fa il provider (statementRangeAt + classifyContext). */
  function providerContext(word: string) {
    const cursorOffset = FULL.length
    const prefix = FULL.slice(0, Math.max(0, FULL.length - word.length))
    const stmtRange = statementRangeAt(FULL, cursorOffset)
    const stmtText = FULL.slice(stmtRange.start, stmtRange.end)
    const stmtBefore = stmtText.slice(0, cursorOffset - stmtRange.start)
    return { ctx: classifyContext({ prefix, stmtBefore }), stmtText, stmtBefore }
  }

  it('dopo "ORDER BY X_SSCC" (parola in corso e dopo lo spazio) NON propone tabelle', () => {
    for (const word of ['X_SSCC', '']) {
      const { ctx } = providerContext(word)
      expect(ctx.kind).toBe('orderBy')
      expect(ctx.inOrderBy).toBe(true)
      expect(allows(ctx, 'orderDirections')).toBe(true)
      expect(allows(ctx, 'columns')).toBe(true)
      expect(allows(ctx, 'tables')).toBe(false)
      expect(allows(ctx, 'views')).toBe(false)
      expect(allows(ctx, 'procedures')).toBe(false)
      expect(allows(ctx, 'functions')).toBe(false)
    }
  })

  it('la temporanea #tbl_… è nello scope: le sue colonne sono proponibili', () => {
    const { stmtText, stmtBefore } = providerContext('')
    const local = extractLocalTables(FULL)
    const merged: DatabaseSummary = { ...summary, tables: [...summary.tables, ...local] }
    const cols = buildColumnContextSuggestions(stmtText, stmtBefore, '', merged)
    const names = cols.map(c => c.name)
    expect(names).toContain('X_SSCC')
    expect(names).toContain('X_MODULO')
    expect(names).toContain('X_SKU')
  })
})

describe('ORDER BY: le colonne proposte sono quelle dello statement', () => {
  const stmt = 'SELECT MIS_UDC, UDC_UDC FROM dbo.RUN_MISSIONI inner join dbo.DAT_UDC ON MIS_UDC = UDC_UDC ORDER BY '
  const before = stmt

  it('propone le colonne delle tabelle presenti nello statement', () => {
    const cols = buildColumnContextSuggestions(stmt, before, '', summary)
    const names = cols.map(c => c.name)
    expect(names).toContain('MIS_UDC')
    expect(names).toContain('MIS_MISSIONE')
    expect(names).toContain('UDC_UDC')
    expect(names).toContain('UDC_CORRIDOIO')
  })

  it('NON propone colonne di tabelle estranee allo statement', () => {
    const cols = buildColumnContextSuggestions(stmt, before, '', summary)
    const names = cols.map(c => c.name)
    // colonne di tabelle non citate (es. MAG_BAIE / MAG_CELLE / DAT_SCOMPART)
    expect(names).not.toContain('BAI_BAIA')
    expect(names).not.toContain('CEL_CELLA')
    expect(names).not.toContain('SCO_SCOMPARTO')
  })

  it('con colonne omonime qualifica con alias/tabella (ORDER BY non ambiguo)', () => {
    const sql = 'SELECT * FROM dbo.Ordini o JOIN dbo.Clienti c ON o.customer_id = c.id ORDER BY id'
    const cols = buildColumnContextSuggestions(sql, sql, 'id', summary)
    const id = cols.find(c => c.name === 'id')
    expect(id).toBeDefined()
    // 'id' esiste in entrambe le tabelle → inserimento qualificato (o, c)
    expect(id!.insertText).toMatch(/^(o|c)\.id$/)
    expect(id!.shared).toBe(true)
  })

  it('con una parola digitata propone solo le colonne con affinità', () => {
    const cols = buildColumnContextSuggestions(stmt, before, 'mis_', summary)
    const names = cols.map(c => c.name)
    expect(names.length).toBeGreaterThan(0)
    expect(names.every(n => n.toLowerCase().includes('mis'))).toBe(true)
  })

  it('anche le colonne delle TEMPORANEE dello statement sono proposte', () => {
    const sql = `CREATE TABLE #t (X_SSCC NVARCHAR(50), X_SKU NVARCHAR(50))
SELECT X_SSCC FROM #t ORDER BY `
    const local = extractLocalTables(sql)
    const merged: DatabaseSummary = { ...summary, tables: [...summary.tables, ...local] }
    const stmtText = sql.slice(sql.indexOf('SELECT X_SSCC'))
    const cols = buildColumnContextSuggestions(stmtText, stmtText, '', merged)
    expect(cols.map(c => c.name)).toContain('X_SSCC')
  })
})
