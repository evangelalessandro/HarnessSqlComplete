// Segnalazione utente: "l'intellisense mi aggiunge ancora nome tabella quando si fa il join,
// anche se il nome colonna è univoco".
// Causa: il numero di proprietari di una colonna contava OGNI riferimento nel testo. Quando lo
// statement cita due volte la STESSA tabella — caso tipico delle sotto-query
// (`INNER JOIN DAT_UDC du … WHERE EXISTS (SELECT 1 FROM DAT_UDC …)`) — ogni colonna di quella
// tabella risultava "condivisa" e veniva proposta qualificata (`du.UDC_CODICE`) anche se univoca.
// Ora si qualifica SOLO se la colonna esiste in due tabelle DIVERSE, oppure se la stessa tabella
// è in scope con due ALIAS espliciti (self-join, dove il prefisso è indispensabile).
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
  // lo statement cita DAT_UDC due volte: nel JOIN (alias du) e dentro l'EXISTS (senza alias)
  const stmt = `SELECT \nFROM RUN_MISSIONI rm\nINNER JOIN DAT_UDC du ON rm.MIS_UDC = du.UDC_UDC\nWHERE EXISTS (SELECT 1 FROM DAT_UDC WHERE UDC_CODICE = 'x')`

  it('lo statement cita davvero due volte DAT_UDC (premessa del bug)', () => {
    const refs = extractStatementTableRefs(stmt).map(r => r.tableName)
    expect(refs.filter(n => n === 'DAT_UDC').length).toBe(2)
  })

  it('select-list: le colonne univoche di DAT_UDC NON vengono qualificate', () => {
    const sel = buildSelectListSuggestions(stmt, stmt, reale)
    const udc = sel.columns.filter(c => c.name.startsWith('UDC_'))
    expect(udc.length).toBeGreaterThan(20)
    const qualificate = udc.filter(c => c.insertText.includes('.'))
    console.log(`  colonne UDC_* qualificate: ${qualificate.length}/${udc.length}`)
    for (const c of qualificate.slice(0, 10)) console.log(`    ${c.name} -> ${c.insertText}`)
    expect(qualificate).toEqual([])
    // il nome nudo è davvero quello della colonna (UDC_UBIUDC non è scritta nello statement:
    // le colonne già presenti nel testo vengono escluse dall'elenco)
    const ubi = udc.find(c => c.name === 'UDC_UBIUDC')
    expect(ubi?.insertText).toBe('UDC_UBIUDC')
    expect(ubi?.shared).toBe(false)
    expect(ubi?.ownerLabel).toBe('du')
  })

  it('contesto colonna (WHERE/ON): le colonne univoche NON vengono qualificate', () => {
    const ctx = buildColumnContextSuggestions(stmt, stmt, '', reale)
    const qualificate = ctx.filter(c => c.insertText.includes('.'))
    console.log(`  colonne qualificate nel contesto: ${qualificate.length}/${ctx.length}`)
    for (const c of qualificate.slice(0, 10)) console.log(`    ${c.name} -> ${c.insertText}`)
    expect(qualificate).toEqual([])
    expect(ctx.find(c => c.name === 'UDC_UBIUDC')?.insertText).toBe('UDC_UBIUDC')
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
        mkCol('BCO_BAIA', 'int'),
        mkCol('BCO_MASTER', 'int'),
        mkCol('BCO_ALTRO', 'int'),
      ]),
    )
    const stmt = 'SELECT \nFROM MAG_BAIE a\nINNER JOIN MAG_BAIE b ON a.BCO_BAIA = b.BCO_MASTER'
    const sel = buildSelectListSuggestions(stmt, stmt, summary)
    const altro = sel.columns.find(c => c.name === 'BCO_ALTRO')
    expect(altro?.shared).toBe(true)
    expect(altro?.insertText).toBe('a.BCO_ALTRO')
  })

  it('due tabelle diverse con la stessa colonna: qualificata', () => {
    const summary = demoStoreLikeSummary()
    summary.tables.push(
      mkTbl('dbo', 'Fake_A', [mkCol('cod', 'int'), mkCol('solo_a', 'int')]),
      mkTbl('dbo', 'Fake_B', [mkCol('cod', 'int'), mkCol('solo_b', 'int')]),
    )
    const stmt = 'SELECT \nFROM Fake_A\nINNER JOIN Fake_B ON Fake_A.cod = Fake_B.cod'
    const sel = buildSelectListSuggestions(stmt, stmt, summary)
    // 'cod' è scritta nello statement → esclusa; si guardano le colonne NON scritte
    const soloA = sel.columns.find(c => c.name === 'solo_a')
    expect(soloA?.shared).toBe(false)
    expect(soloA?.insertText).toBe('solo_a')
    // con una colonna non citata nel testo e presente in entrambe, la qualifica scatta
    const stmt2 = 'SELECT \nFROM Fake_A\nINNER JOIN Fake_B ON Fake_A.solo_a = Fake_B.solo_b'
    const sel2 = buildSelectListSuggestions(stmt2, stmt2, summary)
    const cod = sel2.columns.find(c => c.name === 'cod')
    expect(cod?.shared).toBe(true)
    expect(cod?.insertText).toBe('Fake_A.cod')
  })

  it('tabella citata due volte senza alias: colonna univoca nuda', () => {
    const summary = demoStoreLikeSummary()
    const stmt = 'SELECT \nFROM DAT_UDC\nWHERE UDC_UDC IN (SELECT UDC_UDC FROM DAT_UDC)'
    const sel = buildSelectListSuggestions(stmt, stmt, summary)
    const qualificate = sel.columns.filter(c => c.insertText.includes('.'))
    expect(qualificate).toEqual([])
  })
})
