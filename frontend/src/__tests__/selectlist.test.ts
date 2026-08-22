import { describe, expect, it } from 'vitest'
import {
  buildSelectListSuggestions,
  completionSortText,
  extractStatementTableRefs,
  findTableRefs,
  groupTablesByPrefix,
  starFilterText,
  statementRangeAt,
} from '../helpers'
import { mkCol, mkTbl, wsbritvicLikeSummary } from './schema'

const summary = wsbritvicLikeSummary()
const SQL = `SELECT  FROM [dbo].[RUN_MISSIONI] inner join [DAT_UDC] ON [MIS_UDC] = [UDC_UDC]
 ORDER BY 1 DESC;`

describe('SELECT: colonne nella select-list ed espansione *', () => {
  it('statementRangeAt: lo statement contenente il cursore', () => {
    const cursor = SQL.indexOf('SELECT') + 7
    const r = statementRangeAt(SQL, cursor)
    expect([r.start, r.end]).toEqual([0, SQL.length])
    const sql2 = 'SELECT 1; SELECT  FROM dbo.X;'
    const c2 = sql2.indexOf('SELECT  FROM')
    const r2 = statementRangeAt(sql2, c2 + 5)
    expect([r2.start, r2.end]).toEqual([sql2.indexOf(';') + 1, sql2.length])
  })

  it('extractStatementTableRefs: inner/on non sono alias (bug)', () => {
    const refs = extractStatementTableRefs(SQL)
    expect(refs).toEqual([
      { tableName: 'RUN_MISSIONI', alias: null },
      { tableName: 'DAT_UDC', alias: null },
    ])
    const refs2 = extractStatementTableRefs('SELECT FROM dbo.Ordini o JOIN dbo.Clienti AS c ON o.id = c.id;')
    expect(refs2).toEqual([
      { tableName: 'Ordini', alias: 'o' },
      { tableName: 'Clienti', alias: 'c' },
    ])
  })

  it('suggerisce le colonne delle tabelle dello statement (anche dopo il cursore)', () => {
    const cursor = SQL.indexOf('SELECT') + 7
    const stmtRange = statementRangeAt(SQL, cursor)
    const stmtText = SQL.slice(stmtRange.start, stmtRange.end)
    const stmtBefore = stmtText.slice(0, cursor - stmtRange.start)
    const sel = buildSelectListSuggestions(stmtText, stmtBefore, summary)
    const names = sel.columns.map(c => c.name)
    expect(names).toContain('MIS_UDC')
    expect(names).toContain('UDC_UDC')
    expect(names).toContain('MIS_MISSIONE')
    // MIS_ELEV non esiste nello schema → mai suggerito
    expect(names).not.toContain('MIS_ELEV')
    // nessuna colonna condivisa tra RUN_MISSIONI e DAT_UDC
    expect(sel.columns.every(c => !c.shared)).toBe(true)
  })

  it('le colonne già scritte nella select-list vengono escluse', () => {
    const sql = 'SELECT [MIS_UDC],  FROM [dbo].[RUN_MISSIONI] inner join [DAT_UDC] ON [MIS_UDC] = [UDC_UDC];'
    // cursore subito dopo la virgola che segue [MIS_UDC]
    const cursor = sql.indexOf('[MIS_UDC]') + '[MIS_UDC]'.length + 1
    const stmtRange = statementRangeAt(sql, cursor)
    const stmtText = sql.slice(stmtRange.start, stmtRange.end)
    const stmtBefore = stmtText.slice(0, cursor - stmtRange.start)
    const sel = buildSelectListSuggestions(stmtText, stmtBefore, summary)
    expect(sel.columns.map(c => c.name)).not.toContain('MIS_UDC')
  })

  it('espansione di *: tutte le colonne, senza parentesi, senza prefissi se univoche', () => {
    const sql = 'SELECT * FROM [dbo].[RUN_MISSIONI] inner join [DAT_UDC] ON [MIS_UDC] = [UDC_UDC] ORDER BY 1 DESC;'
    const cursor = sql.indexOf('SELECT *') + 'SELECT *'.length
    const stmtRange = statementRangeAt(sql, cursor)
    const stmtText = sql.slice(stmtRange.start, stmtRange.end)
    const stmtBefore = stmtText.slice(0, cursor - stmtRange.start)
    const sel = buildSelectListSuggestions(stmtText, stmtBefore, summary)
    expect(sel.starText).not.toBeNull()
    expect(sel.starCount).toBe(8) // 3 colonne RUN_MISSIONI + 5 DAT_UDC
    expect(sel.starText).toContain('MIS_UDC')
    expect(sel.starText).toContain('UDC_UDC')
    expect(sel.starText).not.toContain('[')
    expect(sel.starText).not.toContain(']')
  })

  it('espansione * con colonna condivisa: qualifica con alias, senza parentesi', () => {
    const sql = 'SELECT * FROM dbo.Ordini o JOIN dbo.Clienti c ON o.customer_id = c.id'
    const cursor = sql.indexOf('SELECT *') + 'SELECT *'.length
    const stmtRange = statementRangeAt(sql, cursor)
    const stmtText = sql.slice(stmtRange.start, stmtRange.end)
    const stmtBefore = stmtText.slice(0, cursor - stmtRange.start)
    const sel = buildSelectListSuggestions(stmtText, stmtBefore, summary)
    expect(sel.starText).toContain('o.id')
    expect(sel.starText).toContain('c.id')
    expect(sel.starText).toContain('customer_id')
    expect(sel.starText).toContain('nome')
    expect(sel.starText).not.toContain('[')
  })

  it('espansione * con colonne già scritte: esclude i campi presenti e resta completo', () => {
    const sql = 'SELECT MIS_MISSIONE,UDC_UDC,* FROM dbo.RUN_MISSIONI inner join DAT_UDC ON MIS_UDC = UDC_UDC ORDER BY 1 DESC;'
    const starPos = sql.indexOf('*') + 1
    const stmtRange = statementRangeAt(sql, starPos)
    const stmtText = sql.slice(stmtRange.start, stmtRange.end)
    const stmtBefore = stmtText.slice(0, starPos - stmtRange.start)
    const sel = buildSelectListSuggestions(stmtText, stmtBefore, summary)
    expect(sel.starText).not.toBeNull()
    // 3 colonne RUN_MISSIONI + 5 DAT_UDC − 2 già scritte = 6
    expect(sel.starCount).toBe(6)
    const tokens = sel.starText!.split(',').map(t => t.trim())
    expect(tokens).toContain('MIS_UDC')
    expect(tokens).toContain('UDC_CORRIDOIO')
    expect(tokens).not.toContain('MIS_MISSIONE')
    expect(tokens).not.toContain('UDC_UDC')
  })

  it('espansione * con il cursore ESATTAMENTE sull asterisco', () => {
    const sql = 'SELECT MIS_MISSIONE,UDC_UDC,* FROM dbo.RUN_MISSIONI inner join DAT_UDC ON MIS_UDC = UDC_UDC ORDER BY 1 DESC;'
    const starIdx = sql.indexOf('*')
    const stmtRange = statementRangeAt(sql, starIdx)
    const stmtText = sql.slice(stmtRange.start, stmtRange.end)
    // cursore SULL'asterisco: stmtBefore NON contiene il '*'
    const stmtBefore = stmtText.slice(0, starIdx - stmtRange.start)
    const sel = buildSelectListSuggestions(stmtText, stmtBefore, summary)
    expect(sel.starText).not.toBeNull()
    expect(sel.starOffset).toBe(starIdx - stmtRange.start)
    // il range deve coprire esattamente il carattere '*'
    expect(stmtText[sel.starOffset]).toBe('*')
  })

  it('espansione * con il cursore PRIMA dell asterisco', () => {
    const sql = 'SELECT MIS_MISSIONE,UDC_UDC,* FROM dbo.RUN_MISSIONI inner join DAT_UDC ON MIS_UDC = UDC_UDC ORDER BY 1 DESC;'
    const starIdx = sql.indexOf('*')
    // cursore subito dopo la virgola, prima del '*'
    const beforeStar = starIdx - 1
    const stmtRange = statementRangeAt(sql, beforeStar)
    const stmtText = sql.slice(stmtRange.start, stmtRange.end)
    const stmtBefore = stmtText.slice(0, beforeStar - stmtRange.start)
    const sel = buildSelectListSuggestions(stmtText, stmtBefore, summary)
    expect(sel.starText).not.toBeNull()
    expect(stmtText[sel.starOffset]).toBe('*')
  })

  it('COUNT(*): l asterisco interno non viene usato per la sostituzione (ma "tutti i campi" resta proposto)', () => {
    const sql = 'SELECT COUNT(*) FROM dbo.Ordini'
    const cursor = sql.indexOf('COUNT') + 7
    const stmtRange = statementRangeAt(sql, cursor)
    const stmtText = sql.slice(stmtRange.start, stmtRange.end)
    const stmtBefore = stmtText.slice(0, cursor - stmtRange.start)
    const sel = buildSelectListSuggestions(stmtText, stmtBefore, summary)
    // il '*' di COUNT non è "usabile" → starOffset -1 (nessuna sostituzione)
    expect(sel.starOffset).toBe(-1)
    // ma "tutti i campi" viene comunque proposto (inserimento al cursore)
    expect(sel.starText).not.toBeNull()
  })

  it('SENZA asterisco: propone comunque "tutti i campi" da inserire al cursore (starOffset -1)', () => {
    const sql = 'SELECT  FROM dbo.RUN_MISSIONI inner join DAT_UDC ON MIS_UDC = UDC_UDC'
    const cursor = sql.indexOf('FROM') - 1
    const stmtRange = statementRangeAt(sql, cursor)
    const stmtText = sql.slice(stmtRange.start, stmtRange.end)
    const stmtBefore = stmtText.slice(0, cursor - stmtRange.start)
    const sel = buildSelectListSuggestions(stmtText, stmtBefore, summary)
    expect(sel.starText).not.toBeNull()
    expect(sel.starOffset).toBe(-1) // niente '*' → inserimento al cursore
    expect(sel.starCount).toBe(8) // 3 RUN_MISSIONI + 5 DAT_UDC
    const tokens = sel.starText!.split(',').map(t => t.trim())
    expect(tokens).toContain('MIS_UDC')
    expect(tokens).toContain('UDC_CORRIDOIO')
  })

  it('SENZA asterisco ma con colonne già scritte: le esclude', () => {
    const sql = 'SELECT MIS_MISSIONE,UDC_UDC, FROM dbo.RUN_MISSIONI inner join DAT_UDC ON MIS_UDC = UDC_UDC'
    const cursor = sql.indexOf(' FROM') - 1
    const stmtRange = statementRangeAt(sql, cursor)
    const stmtText = sql.slice(stmtRange.start, stmtRange.end)
    const stmtBefore = stmtText.slice(0, cursor - stmtRange.start)
    const sel = buildSelectListSuggestions(stmtText, stmtBefore, summary)
    expect(sel.starText).not.toBeNull()
    const tokens = sel.starText!.split(',').map(t => t.trim())
    expect(tokens).not.toContain('MIS_MISSIONE')
    expect(tokens).not.toContain('UDC_UDC')
    expect(sel.starCount).toBe(6)
  })

  it('findTableRefs estrae i nomi (minuscoli) per il lookup case-insensitive', () => {
    expect(findTableRefs('SELECT * FROM [dbo].[DAT_UDC]\ninner join ')).toEqual(['dat_udc'])
  })
})

describe('groupTablesByPrefix: raggruppamento per prefisso', () => {
  it('raggruppa BCKUP_*, DAT_*, MAG_* e mette le altre in Varie', () => {
    const groups = groupTablesByPrefix([
      mkTbl('dbo', 'MAG_BAIE', [mkCol('id')]),
      mkTbl('dbo', 'DAT_UDC', [mkCol('id')]),
      mkTbl('dbo', 'BCKUP_ARTICOLI', [mkCol('id')]),
      mkTbl('dbo', 'DAT_ORDINI', [mkCol('id')]),
      mkTbl('dbo', 'Ordini', [mkCol('id')]),
      mkTbl('dbo', 'BCKUP_UDC', [mkCol('id')]),
    ])
    expect(groups.map(g => g.label)).toEqual(['BCKUP', 'DAT', 'MAG', 'Varie'])
    expect(groups[0].tables.map(t => t.name)).toEqual(['BCKUP_ARTICOLI', 'BCKUP_UDC'])
    expect(groups[1].tables.map(t => t.name)).toEqual(['DAT_ORDINI', 'DAT_UDC'])
    expect(groups[3].tables.map(t => t.name)).toEqual(['Ordini'])
  })

  it('case-insensitive: Bckup_ e BCKUP_ nello stesso gruppo', () => {
    const groups = groupTablesByPrefix([
      mkTbl('dbo', 'BCKUP_UDC', [mkCol('id')]),
      mkTbl('dbo', 'Bckup_UDC_old_07_10_2024', [mkCol('id')]),
    ])
    expect(groups.length).toBe(1)
    expect(groups[0].tables.length).toBe(2)
  })
})

describe('completionSortText: il primo suggerimento spinto è il primo mostrato', () => {
  it('rank minore → sortText minore (ascendente, quello che Monaco mostra per primo)', () => {
    const texts = [0, 1, 5, 100].map(completionSortText)
    expect(texts).toEqual(['00000', '00001', '00005', '00100'])
    // l'ordine lessicografico crescente rispetta il rank
    expect(completionSortText(0) < completionSortText(1)).toBe(true)
    expect(completionSortText(104) < completionSortText(9999)).toBe(true)
  })
})

describe('starFilterText: l item "*" deve comparire anche dopo l asterisco', () => {
  it('cursore dopo il * → filterText = testo tra * e cursore (match con la parola di Monaco)', () => {
    const sql = 'SELECT MIS_MISSIONE,UDC_UDC,* FROM dbo.RUN_MISSIONI'
    const starIdx = sql.indexOf('*')
    // cursore subito dopo il '*'
    expect(starFilterText(sql, starIdx, starIdx + 1)).toBe('*')
    // cursore dopo '* ' (spazio)
    expect(starFilterText(sql, starIdx, starIdx + 2)).toBe('* ')
  })

  it('cursore sul o prima del * → nessun filterText (comportamento attuale)', () => {
    const sql = 'SELECT MIS_MISSIONE,UDC_UDC,* FROM dbo.RUN_MISSIONI'
    const starIdx = sql.indexOf('*')
    expect(starFilterText(sql, starIdx, starIdx)).toBeUndefined()
    expect(starFilterText(sql, starIdx, starIdx - 1)).toBeUndefined()
  })
})
