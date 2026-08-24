import { describe, expect, it } from 'vitest'
import { buildJoinText, findTableRefs, rankTablesForJoin, usageScore } from '../helpers'
import type { TableUsage } from '../types'
import { mkCol, mkTbl, wsbritvicLikeSummary } from './schema'

const summary = wsbritvicLikeSummary()

describe('JOIN: suggerimenti e clausola ON', () => {
  it('findTableRefs è case-insensitive (bug DAT_UDC maiuscolo)', () => {
    const refs = findTableRefs('SELECT * FROM [dbo].[DAT_UDC]\ninner join ')
    expect(refs).toEqual(['dat_udc'])
    // il lookup deve trovare la tabella (era il bug: nome maiuscolo non trovato)
    expect(summary.tables.some(t => t.name.toLowerCase() === refs[0])).toBe(true)
  })

  it('la tabella collegata da FK viene proposta per prima, con ON già compilato', () => {
    const ctx = findTableRefs('SELECT * FROM [dbo].[DAT_UDC]\ninner join ')
    const ctxInfos = ctx
      .map(n => summary.tables.find(t => t.name.toLowerCase() === n))
      .filter((x): x is NonNullable<typeof x> => x !== undefined)
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ctx)
    expect(ranked[0].table.name).toBe('RUN_MISSIONI')
    expect(ranked[0].hints.length).toBe(1)

    // scenario esatto dell'utente: niente prefisso per colonne univoche, parentesi sull'ON (stile SP reali)
    const text = buildJoinText(ranked[0].table, ranked[0].hints[0], [...ctxInfos, ranked[0].table])
    expect(text).toBe('RUN_MISSIONI ON (UDC_UDC = MIS_UDC)')
  })

  it('JOIN da RUN_MISSIONI: propone DAT_UDC', () => {
    const ctx = findTableRefs('SELECT * FROM [dbo].[RUN_MISSIONI] inner join ')
    const ctxInfos = ctx
      .map(n => summary.tables.find(t => t.name.toLowerCase() === n))
      .filter((x): x is NonNullable<typeof x> => x !== undefined)
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ctx)
    expect(ranked[0].table.name).toBe('DAT_UDC')
    const text = buildJoinText(ranked[0].table, ranked[0].hints[0], [...ctxInfos, ranked[0].table])
    expect(text).toBe('DAT_UDC ON (MIS_UDC = UDC_UDC)')
  })

  it('colonna condivisa tra le tabelle in scope: prefisso necessario', () => {
    const clienti = summary.tables.find(t => t.name === 'Clienti')!
    const ordini = summary.tables.find(t => t.name === 'Ordini')!
    const fk = summary.foreignKeys.find(f => f.table === 'Ordini')!
    // scope: Clienti + Ordini; 'id' è in entrambe → qualificata, ma senza parentesi
    const text = buildJoinText(ordini, { fk, direction: 'out' }, [clienti, ordini])
    expect(text).toBe('Ordini ON (Clienti.id = customer_id)')
  })

  it('colonna con nome pericoloso: parentesi solo per quella', () => {
    const we = mkTbl('dbo', 'Order Details', [mkCol('id')])
    const ordini = mkTbl('dbo', 'Ordini', [mkCol('customer_id'), mkCol('totale')])
    const fk = { name: 'FK_ORDINI_ORDERDETAILS', schema: 'dbo', table: 'Ordini', column: 'customer_id', refSchema: 'dbo', refTable: 'Order Details', refColumn: 'id' }
    const text = buildJoinText(we, { fk, direction: 'in' }, [ordini, we])
    expect(text).toBe('[Order Details] ON (customer_id = id)')
  })

  it('usageScore: molte FK in entrata battono una tabella grande ma isolata', () => {
    const a: TableUsage = { fkIncoming: 10, fkOutgoing: 0, dependencyCount: 0, rowCount: 1000 }
    const b: TableUsage = { fkIncoming: 0, fkOutgoing: 0, dependencyCount: 0, rowCount: 1000000 }
    expect(usageScore(a)).toBeGreaterThan(usageScore(b))
  })

  it('il ranking esclude le tabelle già presenti nella query', () => {
    const ctx = findTableRefs('SELECT * FROM dbo.DAT_UDC')
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ctx)
    expect(ranked.some(r => r.table.name === 'DAT_UDC')).toBe(false)
    expect(ranked.some(r => r.table.name === 'RUN_MISSIONI')).toBe(true)
  })
})
