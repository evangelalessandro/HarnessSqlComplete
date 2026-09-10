// Caso utente (riga ~343 di ws_L2_OneTrans_SearchComp): statement su tabelle LOCALI
//   select distinct MFC_BLOCK, a.COR_CORRIDOIO, CEL_CELLA, cor_area
//   from #TBL_SEARCH_COMP a
//     inner join mag_corridoi b where a.cor_corridoio = b.cor_corridoio
// #TBL_SEARCH_COMP è creata con "SELECT … INTO" e @tblParallelOut è una variabile
// tabella: prima non erano note → l'intellisense non proponeva NULLA (nemmeno i campi
// di mag_corridoi, perché lo scope risultava senza colonne).
import { describe, expect, it } from 'vitest'
import {
  buildColumnContextSuggestions,
  isInsideValuesTuple,
  parseInsertContext,
  rankTablesForPosition,
  statementRangeAt,
} from '../helpers'
import { allows, classifyContext } from '../intellisenseContext'
import { extractLocalTables } from '../localTables'
import type { DatabaseSummary } from '../types'
import { mkCol, mkTbl, wsbritvicLikeSummary } from './schema'

function summaryWithCorridoi(): DatabaseSummary {
  const s = wsbritvicLikeSummary()
  s.tables.push(
    mkTbl('dbo', 'MAG_CORRIDOI', [
      mkCol('COR_CORRIDOIO', 'int'),
      mkCol('COR_AREA', 'nvarchar'),
      mkCol('COR_ABIPREN', 'bit'),
      mkCol('COR_TIPOCORR', 'nvarchar'),
    ]),
  )
  return s
}

/** Testo ridotto ma fedele alla procedura dell'utente. */
const FULL = `declare @tblParallelOut table (TPO_BLOCK int, TPO_CORRIDOR int, TPO_CELL int, TPO_NUM_COMP int default(0), TPO_COR_AREA nvarchar(50) default(''))
select MFC_BLOCK, COR_CORRIDOIO, CEL_CELLA, cor_area, TPO_CORRIDOR
  into #TBL_SEARCH_COMP
  from MAG_CORRIDOI
insert into @tblParallelOut (TPO_BLOCK, TPO_CORRIDOR, TPO_CELL, TPO_COR_AREA)
select distinct MFC_BLOCK, a.COR_CORRIDOIO, CEL_CELLA, cor_area
from #TBL_SEARCH_COMP a
  inner join mag_corridoi b where `

/** Contesto come lo calcola il provider alla fine del testo. */
function ctxAtEnd(sql: string) {
  const offset = sql.length
  const textBefore = sql
  const word = /[A-Za-z0-9_@#]+$/.exec(textBefore)?.[0] ?? ''
  const prefix = textBefore.slice(0, Math.max(0, textBefore.length - word.length))
  const r = statementRangeAt(sql, offset)
  const stmtText = sql.slice(r.start, r.end)
  const stmtBefore = stmtText.slice(0, offset - r.start)
  return { ctx: classifyContext({ prefix, stmtBefore }), stmtText, stmtBefore, offset }
}

function mergedSummary(known: DatabaseSummary, text: string): DatabaseSummary {
  const local = extractLocalTables(text, known.tables)
  return { ...known, tables: [...known.tables, ...local] }
}

describe('tabelle locali: SELECT … INTO e variabili tabella', () => {
  it('legge le colonne di "SELECT … INTO #t" (nomi dalla select-list)', () => {
    const local = extractLocalTables(FULL)
    const t = local.find(x => x.name.toLowerCase() === '#tbl_search_comp')
    expect(t).toBeDefined()
    const names = t!.columns!.map(c => c.name.toLowerCase())
    for (const n of ['mfc_block', 'cor_corridoio', 'cel_cella', 'cor_area', 'tpo_corridor']) {
      expect(names).toContain(n)
    }
  })

  it('legge le colonne della variabile tabella "DECLARE @t TABLE (…)" e le integra con l\'INSERT', () => {
    const local = extractLocalTables(FULL)
    const t = local.find(x => x.name.toLowerCase() === '@tblparallelout')
    expect(t).toBeDefined()
    const names = t!.columns!.map(c => c.name.toUpperCase())
    expect(names).toContain('TPO_BLOCK')
    expect(names).toContain('TPO_CORRIDOR')
    expect(names).toContain('TPO_NUM_COMP')
    expect(names).toContain('TPO_COR_AREA')
  })

  it('SELECT * INTO #t FROM tabella nota: copia le colonne della sorgente', () => {
    const known = summaryWithCorridoi()
    const sql = 'select * into #tmp from MAG_CORRIDOI'
    const local = extractLocalTables(sql, known.tables)
    const t = local.find(x => x.name.toLowerCase() === '#tmp')
    expect(t?.columns?.map(c => c.name)).toContain('COR_CORRIDOIO')
  })
})

describe("statement con tabelle locali: l'intellisense propone (era il popup vuoto)", () => {
  const known = summaryWithCorridoi()
  const summary = mergedSummary(known, FULL)

  it('nel WHERE finale propone i campi di MAG_CORRIDOI e delle tabelle locali', () => {
    const { ctx, stmtText, stmtBefore } = ctxAtEnd(FULL)
    expect(ctx.kind).toBe('columnContext')
    expect(allows(ctx, 'columns')).toBe(true)
    const names = buildColumnContextSuggestions(stmtText, stmtBefore, '', summary).map(c => c.name.toLowerCase())
    // colonne reali dello statement
    expect(names).toContain('cor_corridoio')
    expect(names).toContain('cor_area')
    // colonne della temporanea (#TBL_SEARCH_COMP): prima non erano note → popup vuoto
    expect(names).toContain('mfc_block')
    expect(names).toContain('cel_cella')
    // @tblParallelOut NON è nello scope di questo statement (è il target dell'INSERT):
    // le sue colonne si propongono dove è davvero usata (vedi test "JOIN @t")
    expect(names).not.toContain('tpo_block')
  })

  it('dopo "inner join " propone le tabelle (comprese le locali)', () => {
    const sql = FULL.replace(/ where $/, '') + ' inner join '
    const { ctx } = ctxAtEnd(sql)
    // "JOIN " = posizione di join: propone comunque tabelle/viste
    expect(['joinPosition', 'tablePosition']).toContain(ctx.kind)
    expect(allows(ctx, 'tables')).toBe(true)
    const ranked = rankTablesForPosition(summary.tables, summary.foreignKeys, [], true)
    expect(ranked.some(r => r.table.name === 'MAG_CORRIDOI')).toBe(true)
    expect(ranked.some(r => r.table.name.toLowerCase() === '#tbl_search_comp')).toBe(true)
  })

  it('la variabile tabella è risolta come tabella nei riferimenti (JOIN @t)', () => {
    const sql =
      'select 1\nfrom #TBL_SEARCH_COMP t\n  inner join @tblParallelOut on (TPO_CORRIDOR = COR_CORRIDOIO and TPO_CELL = CEL_CELLA)\nwhere '
    const { stmtText, stmtBefore } = ctxAtEnd(sql)
    const names = buildColumnContextSuggestions(
      stmtText,
      stmtBefore,
      '',
      mergedSummary(known, FULL + '\n' + sql),
    ).map(c => c.name.toLowerCase())
    expect(names).toContain('tpo_corridor')
    expect(names).toContain('cor_corridoio')
  })
})

describe('INSERT…SELECT con variabile tabella: nessun popup vuoto dal ramo VALUES', () => {
  const sql = 'INSERT INTO @tblParallelOut (TPO_BLOCK, TPO_CORRIDOR) SELECT MFC_BLOCK, COR_CORRIDOIO FROM MAG_CORRIDOI'

  it('il target "@variabile" non è una tabella dello schema → parseInsertContext non lo vede', () => {
    expect(parseInsertContext(sql)).toBeNull()
  })

  it('isInsideValuesTuple: true solo dentro la tupla VALUES, false nella lista colonne', () => {
    const valuesSql = 'INSERT INTO dbo.RUN_MISSIONI (MIS_UDC, MIS_MISSIONE) VALUES (1, 2)'
    const ctx = parseInsertContext(valuesSql)!
    expect(isInsideValuesTuple(ctx, valuesSql.indexOf('MIS_UDC') + 1)).toBe(false)
    expect(isInsideValuesTuple(ctx, valuesSql.indexOf('1') + 1)).toBe(true)
    expect(isInsideValuesTuple(ctx, valuesSql.length - 1)).toBe(true)
    // INSERT…SELECT: nessuna tupla con parentesi → false
    const selSql = 'INSERT INTO t (a, b) SELECT x, y FROM u'
    expect(isInsideValuesTuple(parseInsertContext(selSql)!, selSql.indexOf('y'))).toBe(false)
  })
})
