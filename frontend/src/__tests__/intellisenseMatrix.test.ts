// Batteria SISTEMATICA di coerenza dell'intellisense: per un insieme di query di
// riferimento prova il cursore in OGNI punto (ogni offset), a capo e non, e verifica
// invarianti generali — senza elencare a mano i singoli casi:
//  1) il contesto classificato ammette solo categorie coerenti (es. in ORDER BY mai
//     tabelle o funzioni; dopo FROM mai colonne; dopo EXEC solo procedure…);
//  2) i costruttori di suggerimenti non lanciano eccezioni e producono voci valide;
//  3) la stessa query scritta su UNA riga o su PIÙ righe riconosce gli stessi contesti
//     ("a capo o no" non deve cambiare il comportamento).
import { describe, expect, it } from 'vitest'
import {
  buildColumnContextSuggestions,
  buildSelectListSuggestions,
  extractStatementTableRefs,
  findTableRefs,
  isTextOffsetInComment,
  parseInsertContext,
  rankTablesForPosition,
  starFilterText,
  statementRangeAt,
} from '../helpers'
import { allows, classifyContext } from '../intellisenseContext'
import type { IntellisenseContext, SuggestionCategory } from '../intellisenseContext'
import { extractLocalTables } from '../localTables'
import type { DatabaseSummary } from '../types'
import { wsbritvicLikeSummary } from './schema'

const baseSummary = wsbritvicLikeSummary()

/** Query di riferimento: coprono select-list, FROM/JOIN/ON, WHERE, GROUP/ORDER, UPDATE, INSERT/VALUES, EXEC, CASE, CTE, temporanee, blocco IF/BEGIN. */
const QUERIES: string[] = [
  'SELECT MIS_UDC, MIS_MISSIONE FROM dbo.RUN_MISSIONI',
  'SELECT re.MIS_UDC, t.UDC_UDC FROM dbo.RUN_MISSIONI re INNER JOIN dbo.DAT_UDC t ON re.MIS_UDC = t.UDC_UDC WHERE re.MIS_MISSIONE = 1 AND t.UDC_CORRIDOIO = 2',
  'SELECT MIS_UDC FROM dbo.RUN_MISSIONI GROUP BY MIS_UDC HAVING COUNT(*) > 1 ORDER BY MIS_UDC',
  'SELECT TOP 10 * FROM dbo.RUN_MISSIONI ORDER BY MIS_UDC, MIS_MISSIONE DESC',
  'UPDATE dbo.RUN_MISSIONI SET MIS_MISSIONE = 1, MIS_OPERATORE = 2 WHERE MIS_UDC = 3',
  'INSERT INTO dbo.RUN_MISSIONI (MIS_UDC, MIS_MISSIONE) VALUES (1, 2)',
  'DELETE FROM dbo.RUN_MISSIONI WHERE MIS_UDC = 1',
  'EXEC dbo.zzz_test_proc @id = 1, @nome = 2',
  ';WITH c AS (SELECT MIS_UDC FROM dbo.RUN_MISSIONI) SELECT * FROM c',
  'CREATE TABLE #t (X_SSCC NVARCHAR(50), X_SKU NVARCHAR(50))\nINSERT INTO #t (X_SSCC) VALUES (1)\nSELECT X_SSCC FROM #t WHERE X_SKU = 1 ORDER BY X_SSCC',
  'DECLARE @a INT = 0\nSELECT @a = MIS_MISSIONE FROM dbo.RUN_MISSIONI WHERE MIS_UDC = 1\nIF @a > 0\nBEGIN\n  UPDATE dbo.RUN_MISSIONI SET MIS_OPERATORE = 1 WHERE MIS_UDC = 2\nEND',
  'SELECT CASE WHEN MIS_UDC IS NULL THEN 1 ELSE 2 END AS X, MIS_MISSIONE FROM dbo.RUN_MISSIONI',
]

/** Categorie che NON devono comparire in un certo contesto (coerenza). */
const FORBIDDEN: Partial<Record<IntellisenseContext['kind'], SuggestionCategory[]>> = {
  tablePosition: ['columns', 'functions', 'procedures', 'joinConditions', 'counterparts', 'values', 'insertColumns', 'orderDirections'],
  joinPosition: ['columns', 'procedures', 'values', 'insertColumns', 'orderDirections'],
  execPosition: ['columns', 'tables', 'views', 'joinTables', 'values', 'insertColumns', 'orderDirections'],
  orderBy: ['tables', 'views', 'procedures', 'functions', 'snippets', 'keywords', 'joinTables', 'insertColumns', 'values'],
  selectList: ['tables', 'views', 'procedures', 'joinTables', 'values', 'insertColumns', 'orderDirections'],
  columnContext: ['tables', 'views', 'procedures', 'snippets', 'keywords', 'insertColumns', 'values', 'orderDirections'],
  afterTableName: ['columns', 'procedures', 'snippets', 'values', 'insertColumns', 'orderDirections'],
  statementStart: ['columns', 'joinTables', 'values', 'insertColumns', 'orderDirections'],
}

/** Categorie che DEVONO essere ammesse in un certo contesto. */
const REQUIRED: Partial<Record<IntellisenseContext['kind'], SuggestionCategory[]>> = {
  tablePosition: ['tables'],
  joinPosition: ['joinTables', 'tables'],
  execPosition: ['procedures'],
  orderBy: ['columns', 'orderDirections'],
  selectList: ['columns'],
  columnContext: ['columns'],
  statementStart: ['snippets'],
}

/** Parola in corso come la calcola Monaco (i separatori includono spazio, virgola, parentesi…). */
function wordAt(text: string, offset: number): string {
  const m = /[A-Za-z0-9_@#]+$/.exec(text.slice(0, offset))
  return m ? m[0] : ''
}

/** True se l'offset cade dentro una stringa letterale ('…' con '' di escape). */
function inStringLiteral(text: string, offset: number): boolean {
  let i = 0
  let inStr = false
  while (i < text.length && i < offset) {
    const ch = text[i]
    if (ch === '-' && text[i + 1] === '-' && !inStr) {
      const eol = text.indexOf('\n', i)
      i = eol === -1 ? text.length : eol + 1
      continue
    }
    if (ch === "'") {
      if (inStr && text[i + 1] === "'") {
        i += 2
        continue
      }
      inStr = !inStr
    }
    i++
  }
  return inStr
}

/** Riproduce il provider: prefix/stmtBefore/contesto + sommario arricchito con le temporanee. */
function providerAt(fullText: string, offset: number) {
  const textBefore = fullText.slice(0, offset)
  const word = wordAt(fullText, offset)
  const prefix = textBefore.slice(0, Math.max(0, textBefore.length - word.length))
  const local = extractLocalTables(fullText)
  const summary: DatabaseSummary = local.length ? { ...baseSummary, tables: [...baseSummary.tables, ...local] } : baseSummary
  const stmtRange = statementRangeAt(fullText, offset)
  const stmtText = fullText.slice(stmtRange.start, stmtRange.end)
  const stmtBefore = stmtText.slice(0, offset - stmtRange.start)
  const ctx = classifyContext({ prefix, stmtBefore })
  return { word, prefix, ctx, stmtText, stmtBefore, summary, inComment: isTextOffsetInComment(fullText, offset) }
}

/** Variante su una sola riga: gli a-capo diventano spazi (stesse parole, stesso ordine). */
function singleLine(sql: string): string {
  return sql.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

describe('intellisense: coerenza in OGNI punto della query (a capo e non)', () => {
  for (const sql of QUERIES) {
    const label = sql.length > 60 ? sql.slice(0, 57).replace(/\n/g, ' ⏎ ') + '…' : sql
    it(`ogni offset è coerente: ${label}`, () => {
      for (let offset = 0; offset <= sql.length; offset++) {
        if (inStringLiteral(sql, offset)) continue
        const { ctx, inComment } = providerAt(sql, offset)
        if (inComment) continue // nei commenti il provider non propone nulla
        // 1) categorie coerenti col contesto
        for (const cat of FORBIDDEN[ctx.kind] ?? []) {
          expect(
            allows(ctx, cat),
            `offset ${offset} (${ctx.kind}) non deve ammettere "${cat}"\n--- contesto ---\n${sql}\n${' '.repeat(offset)}^`,
          ).toBe(false)
        }
        for (const cat of REQUIRED[ctx.kind] ?? []) {
          expect(allows(ctx, cat), `offset ${offset} (${ctx.kind}) deve ammettere "${cat}"`).toBe(true)
        }
        expect(ctx.allowed.length).toBeGreaterThan(0)
      }
    })
  }

  it('i costruttori non lanciano eccezioni e producono voci valide in ogni punto', () => {
    for (const sql of QUERIES) {
      for (let offset = 0; offset <= sql.length; offset++) {
        if (inStringLiteral(sql, offset)) continue
        const { ctx, word, stmtText, stmtBefore, summary, inComment } = providerAt(sql, offset)
        if (inComment) continue
        // estrazione riferimenti/tabelle: mai eccezioni, mai testi vuoti
        for (const r of extractStatementTableRefs(stmtText)) expect(r.tableName.trim()).not.toBe('')
        for (const name of findTableRefs(stmtBefore)) expect(name.trim()).not.toBe('')
        parseInsertContext(stmtBefore)
        rankTablesForPosition(summary.tables, summary.foreignKeys, findTableRefs(stmtBefore), ctx.isTablePosition)
        starFilterText(stmtText, 0, 0)

        if (ctx.kind === 'selectList') {
          const sel = buildSelectListSuggestions(stmtText, stmtBefore, summary)
          for (const c of sel.columns) {
            expect(c.name.trim()).not.toBe('')
            expect(c.insertText).toBe(c.insertText.trim())
          }
          if (sel.starText) expect(sel.starText).toBe(sel.starText.trim())
        }
        if (ctx.kind === 'columnContext' || ctx.kind === 'orderBy') {
          const cols = buildColumnContextSuggestions(stmtText, stmtBefore, word, summary)
          const labels = cols.map(c => c.name)
          expect(new Set(labels).size).toBe(labels.length) // nessun duplicato
          for (const c of cols) {
            expect(c.name.trim()).not.toBe('')
            expect(c.insertText).toBe(c.insertText.trim())
            expect(c.insertText.length).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  it('la stessa query su una riga o su più righe riconosce gli stessi contesti', () => {
    for (const sql of QUERIES) {
      const oneLine = singleLine(sql)
      const kinds = (text: string) => {
        const set = new Set<string>()
        for (let offset = 0; offset <= text.length; offset++) {
          if (inStringLiteral(text, offset)) continue
          const { ctx, inComment } = providerAt(text, offset)
          if (inComment) continue
          // 'statementStart' dipende dagli a-capo per definizione: non è confrontabile
          if (ctx.kind === 'statementStart') continue
          set.add(ctx.kind)
        }
        return [...set].sort()
      }
      expect(kinds(oneLine), `contesti diversi tra una riga e più righe:\n${sql}`).toEqual(kinds(sql))
    }
  })

  it('stabilità: due classificazioni dello stesso punto danno lo stesso risultato', () => {
    for (const sql of QUERIES) {
      for (let offset = 0; offset <= sql.length; offset += 7) {
        const a = providerAt(sql, offset).ctx
        const b = providerAt(sql, offset).ctx
        expect(a).toEqual(b)
      }
    }
  })

  it('copertura: la matrice tocca davvero tutti i contesti principali', () => {
    const seen = new Map<string, number>()
    let positions = 0
    for (const sql of QUERIES) {
      for (let offset = 0; offset <= sql.length; offset++) {
        if (inStringLiteral(sql, offset)) continue
        const { ctx, inComment } = providerAt(sql, offset)
        if (inComment) continue
        positions++
        seen.set(ctx.kind, (seen.get(ctx.kind) ?? 0) + 1)
      }
    }
    // niente test "vuoti": la matrice deve aver attraversato molte posizioni…
    expect(positions).toBeGreaterThan(500)
    // …e tutti i contesti principali (altrimenti le invarianti non verrebbero esercitate)
    for (const kind of [
      'tablePosition',
      'joinPosition',
      'columnContext',
      'selectList',
      'orderBy',
      'execPosition',
      'generic',
    ]) {
      expect(seen.get(kind) ?? 0, `contesto non coperto: ${kind}`).toBeGreaterThan(0)
    }
  })
})

describe('intellisense: nessuna categoria incoerente nei contesti chiave', () => {
  const ctxFor = (prefix: string) => classifyContext({ prefix, stmtBefore: prefix })

  it('ORDER BY: solo colonne + ASC/DESC (mai tabelle/procedure/funzioni)', () => {
    for (const prefix of [
      'SELECT a FROM t ORDER BY ',
      'SELECT a FROM t ORDER BY a ',
      'SELECT a FROM t ORDER BY a ASC, ',
      'SELECT a FROM t ORDER BY a DESC ',
    ]) {
      const ctx = ctxFor(prefix)
      expect(ctx.inOrderBy, prefix).toBe(true)
      expect(allows(ctx, 'orderDirections'), prefix).toBe(true)
      expect(allows(ctx, 'tables'), prefix).toBe(false)
      expect(allows(ctx, 'procedures'), prefix).toBe(false)
      expect(allows(ctx, 'functions'), prefix).toBe(false)
    }
  })

  it('FROM/JOIN: mai colonne; EXEC: mai tabelle; dopo tabella: mai colonne', () => {
    expect(allows(ctxFor('SELECT * FROM '), 'columns')).toBe(false)
    expect(allows(ctxFor('SELECT * FROM dbo.T JOIN '), 'columns')).toBe(false)
    expect(allows(ctxFor('EXEC '), 'tables')).toBe(false)
    expect(allows(ctxFor('SELECT * FROM dbo.T '), 'columns')).toBe(false)
  })
})
