import { describe, expect, it } from 'vitest'
import { buildJoinSuggestions, findTableRefs, rankTablesForJoin } from '../helpers'
import { wsbritvicLikeSummary } from './schema'

const summary = wsbritvicLikeSummary()

describe('JOIN in una nuova statement (dopo ;): il contesto è solo lo statement corrente', () => {
  // Scenario utente: DAT_UDC referenziata nel PRIMO statement, poi un nuovo statement
  // (separato da ';') che vuole fare JOIN su DAT_UDC — deve essere suggerita con l'ON.
  const fullTextBefore = `declare @t NVARCHAR(max)
,@prova INT

select @p
SELECT  UDC_D_CORRIDOIO,rank()  FROM dbo.DAT_UDC inner join DAT_UDC_PRED ON (UDC_UDCPRED = UPR_UDCPRED)
inner join RUN_MISSIONI ON (UDC_UDC = MIS_UDC)
inner join MAG_CELLE ON MIS_S_CORRIDOIO = CEL_CORRIDOIO AND MIS_S_CELLA = 

 ORDER BY 1 DESC;
 
  select *
  from RUN_MISSIONI INNER JOIN DAT_U`

  // statement corrente (dopo il ';'): il provider deve usare QUESTO come contesto,
  // non l'intero file (altrimenti DAT_UDC dello statement precedente viene esclusa).
  const stmtBefore = `
  select *
  from RUN_MISSIONI INNER JOIN DAT_U`

  it('il contesto dello statement corrente NON include DAT_UDC dello statement precedente', () => {
    const ctx = findTableRefs(stmtBefore)
    expect(ctx).toContain('run_missioni')
    expect(ctx).not.toContain('dat_udc')
  })

  it('a "INNER JOIN DAT_U" DAT_UDC compare con la FK verso RUN_MISSIONI e l\'ON pronto', () => {
    const ctx = findTableRefs(stmtBefore)
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ctx)
    const udc = ranked.find(r => r.table.name === 'DAT_UDC')
    expect(udc).toBeDefined()
    expect(udc!.hints.some(h => h.fk.table === 'RUN_MISSIONI')).toBe(true)
    const items = buildJoinSuggestions(udc!, summary.tables.filter(t => t.name === 'RUN_MISSIONI'), true)
    expect(items.map(i => i.insertText)).toContain('DAT_UDC ON (MIS_UDC = UDC_UDC)')
  })

  it('il vecchio contesto (intero file) escludeva DAT_UDC — la regressione che abbiamo corretto', () => {
    const ctx = findTableRefs(fullTextBefore)
    expect(ctx).toContain('dat_udc')
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ctx)
    expect(ranked.some(r => r.table.name === 'DAT_UDC')).toBe(false)
  })
})
