import { describe, expect, it } from 'vitest'
import { buildJoinSuggestions, findTableRefs, rankTablesForPosition } from '../helpers'
import { wsbritvicLikeSummary } from './schema'

const summary = wsbritvicLikeSummary()

describe('posizione FROM nuova: le query precedenti non nascondono le tabelle', () => {
  // Scenario reale dell'utente: RUN_MISSIONI usata in uno statement precedente,
  // poi una NUOVA clausola FROM nella stessa sessione di editing.
  const textBefore = `declare @t NVARCHAR(max)
,@prova INT

select @p
from RUN_MISSIONI rm
inner join DAT_UDC u on u.UDC_UDC = rm.MIS_UDC
where rm.MIS_OPERATORE = 'A'

if @@ROWCOUNT > 1 BEGIN select * from RUN_MI`

  it('findTableRefs vede le tabelle dello statement precedente (contesto pieno)', () => {
    const ctx = findTableRefs(textBefore)
    expect(ctx).toContain('run_missioni')
    expect(ctx).toContain('dat_udc')
  })

  it('in un nuovo FROM (clausola fresca) RUN_MISSIONI riappare tra i suggerimenti', () => {
    const ctx = findTableRefs(textBefore)
    const ranked = rankTablesForPosition(summary.tables, summary.foreignKeys, ctx, true)
    const names = ranked.map(r => r.table.name)
    expect(names).toContain('RUN_MISSIONI')
    expect(names).toContain('DAT_UDC')
    // lista completa: anche le tabelle senza relazioni sono raggiungibili
    expect(ranked.length).toBe(summary.tables.length)
  })

  it('in posizione JOIN il contesto continua a filtrare (comportamento invariato)', () => {
    const ctx = findTableRefs(textBefore)
    const ranked = rankTablesForPosition(summary.tables, summary.foreignKeys, ctx, false)
    const names = ranked.map(r => r.table.name)
    expect(names).not.toContain('RUN_MISSIONI')
    expect(names).not.toContain('DAT_UDC')
  })

  it('senza relazioni FK la voce non mostra un dettaglio fuorviante ("0 relazioni")', () => {
    const ranked = rankTablesForPosition(summary.tables, summary.foreignKeys, [], true)
    const runMissioni = ranked.find(r => r.table.name === 'RUN_MISSIONI')!
    expect(runMissioni.hints.length).toBe(0)
    const items = buildJoinSuggestions(runMissioni, [], false)
    expect(items.length).toBe(1)
    expect(items[0].insertText).toBe('RUN_MISSIONI')
    // dettaglio vuoto → il chiamante mostra l'utilizzo reale della tabella
    expect(items[0].detail).toBe('')
  })
})
