import { describe, expect, it } from 'vitest'
import { allows, classifyContext, filterKeywordsForContext, isAfterOrderKeyword, isOrderWordTyped } from '../intellisenseContext'
import { buildColumnContextSuggestions, buildSelectListSuggestions, buildStatementSnippets } from '../helpers'
import { demoStoreLikeSummary } from './schema'

const summary = demoStoreLikeSummary()

/**
 * Simula l'input del provider: dato il testo completo e la posizione del cursore
 * (come stringa con un marcatore virtuale), calcola prefix e stmtBefore come fa
 * il provider (senza word: cursore a fine testo).
 */
function ctxFor(fullSql: string) {
  const textBefore = fullSql
  const prefix = textBefore
  return classifyContext({ prefix, stmtBefore: textBefore })
}

describe('INTELLIGENZA INTELLISENSE — classificazione del contesto', () => {
  it('inizio vuoto → statementStart (snippet + oggetti + keyword)', () => {
    const ctx = ctxFor('')
    expect(ctx.kind).toBe('statementStart')
    expect(allows(ctx, 'snippets')).toBe(true)
    expect(allows(ctx, 'tables')).toBe(true)
    expect(allows(ctx, 'procedures')).toBe(true)
    expect(allows(ctx, 'keywords')).toBe(true)
    expect(allows(ctx, 'columns')).toBe(false) // nessuna tabella ancora
  })

  it('dopo "SELECT " senza FROM → selectList (colonne+funzioni/snippet)', () => {
    const ctx = ctxFor('SELECT ')
    expect(ctx.kind).toBe('selectList')
    expect(allows(ctx, 'columns')).toBe(true)
    expect(allows(ctx, 'functions')).toBe(true) // SUM/AVG/RANK/… si possono mettere nella select
    expect(allows(ctx, 'tables')).toBe(false)
    expect(allows(ctx, 'procedures')).toBe(false)
  })

  it('dopo "FROM " → tablePosition (solo tabelle/viste)', () => {
    const ctx = ctxFor('SELECT * FROM ')
    expect(ctx.kind).toBe('tablePosition')
    expect(allows(ctx, 'tables')).toBe(true)
    expect(allows(ctx, 'columns')).toBe(false)
    expect(allows(ctx, 'procedures')).toBe(false)
    expect(allows(ctx, 'keywords')).toBe(false)
  })

  it('dopo "JOIN " → joinPosition (tabelle con ON)', () => {
    const ctx = ctxFor('SELECT * FROM A INNER JOIN ')
    expect(ctx.kind).toBe('joinPosition')
    expect(allows(ctx, 'joinTables')).toBe(true)
    expect(allows(ctx, 'columns')).toBe(false)
  })

  it('batch senza ";" (BEGIN TRAN) con SELECT precedente: "INSERT INTO ti" resta tablePosition → tabelle', () => {
    // scenario utente: dentro un batch senza ';' la posizione INTO è preceduta da
    // "select @caus = …" senza FROM. Prima la flag "inSelectList" vedeva quel SELECT
    // e dirottava la posizione su colonne/funzioni: "insert into tipi" non mostrava
    // le tabelle (es. dbo.TIPI_EVENTI). Serve il contrario: TUTTE le tabelle.
    const prefix = 'BEGIN TRAN\nDECLARE @caus INT, @ret INT\nSELECT @caus = 1\nSET @caus = @caus + 1\nINSERT INTO '
    const ctx = classifyContext({ prefix, stmtBefore: prefix })
    expect(ctx.kind).toBe('tablePosition')
    expect(ctx.isTablePosition).toBe(true)
    expect(ctx.inSelectList).toBe(false)
    expect(allows(ctx, 'tables')).toBe(true)
    expect(allows(ctx, 'columns')).toBe(false)
    expect(allows(ctx, 'functions')).toBe(false)
  })

  it('batch senza ";" con SELECT precedente: anche "UPDATE " e "FROM " restano posizioni di tabelle', () => {
    const before = 'BEGIN TRAN\nSELECT @caus = 1\nUPDATE '
    const ctxU = classifyContext({ prefix: before, stmtBefore: before })
    expect(ctxU.kind).toBe('tablePosition')
    expect(ctxU.inSelectList).toBe(false)
    const beforeF = 'BEGIN TRAN\nSELECT @caus = 1\nSELECT * FROM '
    const ctxF = classifyContext({ prefix: beforeF, stmtBefore: beforeF })
    expect(ctxF.kind).toBe('tablePosition')
    expect(ctxF.inSelectList).toBe(false)
  })

  it('la select-list resta select-list: l\'ultimo SELECT non ha ancora né FROM né INTO', () => {
    // primo SELECT senza FROM ancora in corso (assegnazione @var o "select 1")
    expect(ctxFor('SELECT ').kind).toBe('selectList')
    const ctxMid = classifyContext({
      prefix: 'DECLARE @a INT\nSELECT @a = ',
      stmtBefore: 'DECLARE @a INT\nSELECT @a = ',
    })
    expect(ctxMid.kind).toBe('selectList')
    expect(ctxMid.inSelectList).toBe(true)
  })

  it('dopo "FROM t " (con spazio) → afterTableName (keyword di clausola + tabelle)', () => {
    const ctx = ctxFor('SELECT * FROM RUN_MISSIONI ')
    expect(ctx.kind).toBe('afterTableName')
    expect(allows(ctx, 'keywords')).toBe(true)
    expect(allows(ctx, 'tables')).toBe(true)
    expect(allows(ctx, 'columns')).toBe(false) // le colonne NON servono qui
    expect(allows(ctx, 'procedures')).toBe(false) // le proc NON servono qui
  })

  it('dopo "WHERE " → columnContext (colonne+funzioni)', () => {
    const ctx = ctxFor('SELECT * FROM RUN_MISSIONI WHERE ')
    expect(ctx.kind).toBe('columnContext')
    expect(allows(ctx, 'columns')).toBe(true)
    expect(allows(ctx, 'functions')).toBe(true)
    expect(allows(ctx, 'tables')).toBe(false)
    expect(allows(ctx, 'keywords')).toBe(false)
  })

  it('dopo "ON a = " → columnContext (colonne+controparti)', () => {
    const ctx = ctxFor('SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON mis_corr = ')
    expect(ctx.kind).toBe('columnContext')
    expect(allows(ctx, 'counterparts')).toBe(true)
    expect(allows(ctx, 'joinConditions')).toBe(true)
  })

  it('dopo "EXEC " → execPosition (solo procedure)', () => {
    const ctx = ctxFor('EXEC ')
    expect(ctx.kind).toBe('execPosition')
    expect(allows(ctx, 'procedures')).toBe(true)
    expect(allows(ctx, 'tables')).toBe(false)
    expect(allows(ctx, 'columns')).toBe(false)
  })

  it('dopo "GROUP BY " → groupBy (suggerimenti mirati: colonne non aggregate della select-list)', () => {
    const ctx = ctxFor('SELECT a FROM T GROUP BY ')
    expect(ctx.kind).toBe('groupBy')
    expect(ctx.inGroupBy).toBe(true)
    expect(allows(ctx, 'columns')).toBe(true)
    expect(allows(ctx, 'tables')).toBe(false)
  })

  it('dopo "ORDER BY " → orderBy (solo colonne: ASC/DESC solo dopo il campo)', () => {
    const ctx = ctxFor('SELECT a FROM T ORDER BY ')
    expect(ctx.kind).toBe('orderBy')
    expect(ctx.inOrderBy).toBe(true)
    expect(allows(ctx, 'columns')).toBe(true)
    // le direzioni compaiono solo quando la voce corrente ha già un campo
    expect(allows(ctx, 'orderDirections')).toBe(false)
    expect(allows(ctxFor('SELECT a FROM T ORDER BY a '), 'orderDirections')).toBe(true)
    expect(allows(ctx, 'functions')).toBe(false)
    expect(allows(ctx, 'tables')).toBe(false)
    expect(allows(ctx, 'procedures')).toBe(false)
  })
})

describe('INTELLIGENZA INTELLISENSE — voci coerenti col contesto', () => {
  it('select-list: buildSelectListSuggestions ritorna SOLO colonne (niente tabelle/proc)', () => {
    const sel = buildSelectListSuggestions('SELECT  FROM RUN_MISSIONI', 'SELECT ', summary)
    for (const col of sel.columns) {
      expect(col.name).toBeTruthy()
    }
    // tutte le colonne sono campi della tabella
    const allCols = new Set((summary.tables.find(t => t.name === 'RUN_MISSIONI')?.columns ?? []).map(c => c.name))
    expect(sel.columns.length).toBeGreaterThan(0)
    for (const col of sel.columns) expect(allCols.has(col.name)).toBe(true)
  })

  it('contesto colonna: buildColumnContextSuggestions ritorna colonne, non tabelle/proc', () => {
    const res = buildColumnContextSuggestions('SELECT * FROM RUN_MISSIONI WHERE ', 'SELECT * FROM RUN_MISSIONI WHERE ', '', summary)
    const allCols = new Set((summary.tables.find(t => t.name === 'RUN_MISSIONI')?.columns ?? []).map(c => c.name))
    for (const s of res) expect(allCols.has(s.name)).toBe(true)
  })

  it('keyword filtrate: dopo "FROM t " NON compaiono keyword di statement (SELECT/INSERT)', () => {
    const ctx = ctxFor('SELECT * FROM RUN_MISSIONI ')
    const filtered = filterKeywordsForContext(ctx, ['SELECT', 'WHERE', 'JOIN', 'ORDER', 'INSERT', 'DELETE', 'GROUP'])
    expect(filtered).toContain('WHERE')
    expect(filtered).toContain('JOIN')
    expect(filtered).toContain('ORDER')
    expect(filtered).toContain('GROUP')
    expect(filtered).not.toContain('SELECT')
    expect(filtered).not.toContain('INSERT')
    expect(filtered).not.toContain('DELETE')
  })

  it('keyword filtrate: all\'inizio dello statement solo keyword di statement', () => {
    const ctx = ctxFor('')
    const filtered = filterKeywordsForContext(ctx, ['SELECT', 'WHERE', 'JOIN', 'INSERT', 'DELETE', 'MERGE', 'BEGIN', 'ORDER'])
    expect(filtered).toContain('SELECT')
    expect(filtered).toContain('INSERT')
    expect(filtered).toContain('MERGE')
    expect(filtered).toContain('BEGIN')
    expect(filtered).not.toContain('WHERE')
    expect(filtered).not.toContain('JOIN')
    expect(filtered).not.toContain('ORDER')
  })

  it('keyword filtrate: statement ufficiali completi all\'inizio (BACKUP/GRANT/SET/PRINT/IF/WHILE)', () => {
    const ctx = ctxFor('')
    const filtered = filterKeywordsForContext(ctx, [
      'BACKUP', 'RESTORE', 'GRANT', 'REVOKE', 'DENY', 'SET', 'PRINT', 'IF', 'WHILE', 'COMMIT',
      'ROLLBACK', 'RAISERROR', 'THROW', 'RETURN', 'KILL', 'DBCC', 'CHECKPOINT', 'BULK', 'TRUNCATE',
      'TRANSACTION', 'WHERE', 'ORDER', 'FROM',
    ])
    for (const k of ['BACKUP', 'RESTORE', 'GRANT', 'REVOKE', 'DENY', 'SET', 'PRINT', 'IF', 'WHILE', 'COMMIT', 'ROLLBACK', 'RAISERROR', 'THROW', 'RETURN', 'KILL', 'DBCC', 'CHECKPOINT', 'BULK', 'TRUNCATE', 'TRANSACTION']) {
      expect(filtered).toContain(k)
    }
    expect(filtered).not.toContain('WHERE')
    expect(filtered).not.toContain('ORDER')
    expect(filtered).not.toContain('FROM')
  })

  it('keyword filtrate: dopo "FROM t " compaiono anche APPLY/PIVOT/UNPIVOT/FOR (costrutti ufficiali)', () => {
    const ctx = ctxFor('SELECT * FROM RUN_MISSIONI ')
    const filtered = filterKeywordsForContext(ctx, ['APPLY', 'PIVOT', 'UNPIVOT', 'FOR', 'COLLATE', 'EXCEPT', 'INTERSECT', 'TABLESAMPLE', 'WHERE', 'JOIN', 'SELECT'])
    for (const k of ['APPLY', 'PIVOT', 'UNPIVOT', 'FOR', 'COLLATE', 'EXCEPT', 'INTERSECT', 'TABLESAMPLE', 'WHERE', 'JOIN']) {
      expect(filtered).toContain(k)
    }
    expect(filtered).not.toContain('SELECT')
  })

  it('snippet statement compaiono solo a inizio statement', () => {
    // a inizio statement: "ins" → INSERT INTO
    expect(buildStatementSnippets('ins').some(s => s.label === 'INSERT INTO')).toBe(true)
    // NON devono comparire dentro una query (il provider li inietta solo se statementStart)
    const ctxMid = ctxFor('SELECT * FROM T WHERE ')
    expect(ctxMid.kind).not.toBe('statementStart')
  })
})

describe('INTELLIGENZA INTELLISENSE — qualità del ranking (casi reali)', () => {
  it('digitando "mis_" in WHERE: le colonne di RUN_MISSIONI sono proposte per affinità', () => {
    const stmt = 'SELECT * FROM RUN_MISSIONI WHERE mis_'
    const before = 'SELECT * FROM RUN_MISSIONI WHERE '
    const res = buildColumnContextSuggestions(stmt, before, 'mis_', summary)
    const names = res.map(s => s.name)
    // le colonne della tabella (token mis) compaiono in testa
    expect(names[0]).toBe('MIS_UDC')
    expect(names).toContain('MIS_MISSIONE')
    expect(names).toContain('MIS_OPERATORE')
  })

  it('dopo "ON mis_udc = " la controparte è UDC_UDC (FK esatta)', () => {
    const stmt = 'SELECT * FROM RUN_MISSIONI JOIN DAT_UDC ON mis_udc = '
    const before = 'SELECT * FROM RUN_MISSIONI JOIN DAT_UDC ON mis_udc = '
    const res = buildColumnContextSuggestions(stmt, before, '', summary)
    expect(res[0].name).toBe('UDC_UDC')
    expect(res[0].counterpart).toBe(true)
  })

  it('dopo "FROM RUN_MISSIONI " il contesto non ammette colonne (niente rumore)', () => {
    const ctx = ctxFor('SELECT * FROM RUN_MISSIONI ')
    expect(allows(ctx, 'columns')).toBe(false)
  })

  it('dopo la virgola di "GROUP BY a, " il contesto resta di colonne (niente tabelle)', () => {
    // scenario utente: SELECT ... FROM dbo.MAG_CORRIDOI group by COR_CORRIDOIO ,
    const ctx = ctxFor('SELECT COR_CORRIDOIO, COR_AREA FROM dbo.MAG_CORRIDOI group by COR_CORRIDOIO ,')
    expect(ctx.kind).toBe('groupBy')
    expect(allows(ctx, 'columns')).toBe(true)
    expect(allows(ctx, 'functions')).toBe(true)
    expect(allows(ctx, 'tables')).toBe(false)
  })

  it('virgola che continua liste di colonne: ORDER BY / WHERE IN / ON / SET', () => {
    expect(ctxFor('SELECT a FROM t order by a, b, ').kind).toBe('orderBy')
    expect(ctxFor('SELECT a FROM t order by a, b, ').inOrderBy).toBe(true)
    expect(ctxFor('SELECT a FROM t where x in (1, ').kind).toBe('columnContext')
    expect(ctxFor('SELECT a FROM t join u on a = b, ').kind).toBe('columnContext')
    expect(ctxFor('UPDATE t set a = 1, ').kind).toBe('columnContext')
  })

  it('la virgola di "FROM a, " resta un contesto di tabelle (lista di tabelle)', () => {
    const ctx = ctxFor('SELECT * FROM dbo.RUN_MISSIONI, ')
    expect(ctx.kind).not.toBe('columnContext')
    expect(allows(ctx, 'tables')).toBe(true)
  })
})

describe('INTELLIGENZA INTELLISENSE — "order" propone "BY"', () => {
  it('isOrderWordTyped: i prefissi di "order" (or/ord/order) → true, altro → false', () => {
    expect(isOrderWordTyped('order')).toBe(true)
    expect(isOrderWordTyped('ORDER')).toBe(true)
    expect(isOrderWordTyped('ord')).toBe(true)
    expect(isOrderWordTyped('or')).toBe(true)
    expect(isOrderWordTyped('o')).toBe(false) // troppo corto (rumore)
    expect(isOrderWordTyped('orders')).toBe(false)
    expect(isOrderWordTyped('mis')).toBe(false)
    expect(isOrderWordTyped('')).toBe(false)
  })

  it('isAfterOrderKeyword: dopo "ORDER " (spazio) serve BY — anche mentre si digita "b"', () => {
    // prefix = testo PRIMA della parola in corso (come nel provider)
    expect(isAfterOrderKeyword('SELECT * FROM T ORDER ')).toBe(true)
    expect(isAfterOrderKeyword('SELECT * FROM T ORDER  ')).toBe(true)
    expect(isAfterOrderKeyword('SELECT * FROM T order\n')).toBe(true)
    // senza spazio dopo ORDER (cursor a fine parola) → lo gestisce la voce "ORDER BY"
    expect(isAfterOrderKeyword('SELECT * FROM T ORDER')).toBe(false)
    // dopo "BY" o in altri punti → false
    expect(isAfterOrderKeyword('SELECT * FROM T ORDER BY ')).toBe(false)
    expect(isAfterOrderKeyword('SELECT * FROM T WHERE ')).toBe(false)
    expect(isAfterOrderKeyword('SELECT * FROM T GROUP ')).toBe(false)
  })
})
