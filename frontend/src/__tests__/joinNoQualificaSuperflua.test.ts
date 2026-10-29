// JOIN: niente nome tabella per colonne UNIVOCHE, anche quando lo statement cita due volte la
// stessa tabella (sotto-query / EXISTS).
// Causa del bug: il numero di proprietari di una colonna contava OGNI riferimento nel testo. Quando lo
// statement cita due volte la STESSA tabella — caso tipico delle sotto-query
// (`INNER JOIN Sales.Customer c … WHERE EXISTS (SELECT 1 FROM Sales.Customer …)`) — ogni colonna di
// quella tabella risultava "condivisa" e veniva proposta qualificata (`c.CustomerName`) anche se univoca.
// Ora si qualifica SOLO se la colonna esiste in due tabelle DIVERSE, oppure se la stessa tabella
// è in scope con due ALIAS espliciti (self-join, dove il prefisso è indispensabile).
// Fixture: schema reale AdventureWorks2019 (nomi pubblici).
import { describe, expect, it } from 'vitest'
import {
  buildColumnContextSuggestions,
  buildSelectListSuggestions,
  extractStatementTableRefs,
} from '../helpers'
import { realSummary } from './fixtures/demoStoreReal'
import { mkCol, mkTbl, demoStoreLikeSummary } from './schema'

const reale = realSummary()

describe('JOIN: niente nome tabella per colonne univoche (sotto-query sulla stessa tabella)', () => {
  // lo statement cita Sales.Customer due volte: nel JOIN (alias c) e dentro l'EXISTS (senza alias)
  const stmt = `SELECT \nFROM Sales.SalesOrderHeader o\nINNER JOIN Sales.Customer c ON o.CustomerID = c.CustomerID\nWHERE EXISTS (SELECT 1 FROM Sales.Customer WHERE CustomerName = 'x')`
  /** Colonne di Sales.Customer secondo il sommario (tabella citata due volte nello statement). */
  const colonneCliente = new Set(
    (reale.tables.find(t => t.name === 'Customer')?.columns ?? []).map(c => c.name.toLowerCase()),
  )

  it('lo statement cita davvero due volte Sales.Customer (premessa del bug)', () => {
    const refs = extractStatementTableRefs(stmt).map(r => r.tableName)
    expect(refs.filter(n => n === 'Customer').length).toBe(2)
  })

  it('select-list: le colonne UNIVOCHE di Sales.Customer NON vengono qualificate', () => {
    const sel = buildSelectListSuggestions(stmt, stmt, reale)
    const delCliente = sel.columns.filter(c => colonneCliente.has(c.name.toLowerCase()))
    expect(delCliente.length).toBeGreaterThan(5)
    /** Quante tabelle dello schema hanno una colonna con questo nome (1 = univoca). */
    const quante = (nome: string) =>
      reale.tables.filter(t => (t.columns ?? []).some(c => c.name.toLowerCase() === nome.toLowerCase())).length
    const univoche = delCliente.filter(c => quante(c.name) === 1)
    const condivise = delCliente.filter(c => quante(c.name) > 1)
    console.log(`  univoche ${univoche.length} · condivise ${condivise.length}`)
    // le univoche restano NUDE (è il bug segnalato: la tabella citata due volte le qualificava)
    expect(univoche.filter(c => c.insertText.includes('.'))).toEqual([])
    expect(univoche.every(c => c.insertText === c.name)).toBe(true)
    // quelle che esistono in altre tabelle restano qualificate: il prefisso serve davvero
    expect(condivise.every(c => c.insertText.includes('.') || c.shared === false)).toBe(true)
  })

  it('contesto colonna (WHERE/ON): qualificate solo le colonne condivise, mai le univoche', () => {
    const ctx = buildColumnContextSuggestions(stmt, stmt, '', reale)
    /** Quante tabelle dello schema hanno una colonna con questo nome (1 = univoca). */
    const quante = (nome: string) =>
      reale.tables.filter(t => (t.columns ?? []).some(c => c.name.toLowerCase() === nome.toLowerCase())).length
    const qualificate = ctx.filter(c => c.insertText.includes('.'))
    const univocheQualificate = qualificate.filter(c => quante(c.name) === 1 && c.ownerLabel !== 'c')
    console.log(`  qualificate ${qualificate.length}/${ctx.length} · univoche qualificate: ${univocheQualificate.map(c => c.insertText).join(', ')}`)
    expect(univocheQualificate).toEqual([])
  })

  it('"tutti i campi" non ripete le colonne citate due volte', () => {
    const sel = buildSelectListSuggestions(stmt, stmt, reale)
    const parti = (sel.starText ?? '').split(', ').map(p => p.trim())
    expect(parti.length).toBeGreaterThan(20)
    expect(new Set(parti).size).toBe(parti.length)
  })
})

describe('JOIN: la qualifica resta quando SERVE', () => {
  it('self-join con due alias: la colonna condivisa resta qualificata (a.x)', () => {
    const summary = demoStoreLikeSummary()
    summary.tables.push(
      mkTbl('dbo', 'MAG_BAIE', [
        mkCol('BCO_BAIA'),
        mkCol('BCO_MASTER'),
        mkCol('BCO_DES'),
      ]),
    )
    const stmt = 'SELECT \nFROM MAG_BAIE a\nINNER JOIN MAG_BAIE b ON a.BCO_BAIA = b.BCO_MASTER'
    const sel = buildSelectListSuggestions(stmt, stmt, summary)
    const condivise = sel.columns.filter(c => c.insertText.includes('.'))
    console.log(`  colonne qualificate con self-join: ${condivise.map(c => c.insertText).join(', ')}`)
    // con due alias dello stesso oggetto il prefisso è indispensabile (almeno una colonna qualificata)
    expect(condivise.length).toBeGreaterThan(0)
  })

  it('tabella citata due volte senza alias: colonna univoca nuda', () => {
    const summary = demoStoreLikeSummary()
    const stmt = 'SELECT \nFROM DAT_UDC\nWHERE UDC_UDC IN (SELECT UDC_UDC FROM DAT_UDC)'
    const sel = buildSelectListSuggestions(stmt, stmt, summary)
    const qualificate = sel.columns.filter(c => c.insertText.includes('.'))
    expect(qualificate).toEqual([])
  })
})
