// @vitest-environment jsdom
// TEST SULLO SCHEMA REALE (DEMOSTORE), non su quello finto.
//
// Perché serve: lo schema di comodo dei test ha `functions: []`, `triggers: []` e nessun
// vincolo CHECK. Un provider che si aspetta una forma diversa da quella che il backend
// spedisce davvero (es. `typeDesc` invece di `type`) passerebbe tutti i test e si
// romperebbe nell'app. Qui i dati arrivano dal backend vero: 286 tabelle, 260 funzioni
// (179 scalari + 81 tabellari), 400 FK, 138 trigger, 460 vincoli CHECK.
//
// Il fixture si rigenera con: node scripts/makeSchemaFixture.mjs
import { describe, expect, it } from 'vitest'
import * as monaco from 'monaco-editor'
import { provideSqlCompletions } from '../sqlCompletions'
import { isTableValuedFunctionType } from '../helpers'
import { realSummary } from './fixtures/demoStoreReal'
import { inCommentOrString } from './sqlText'

const summary = realSummary()

const tableNames = new Set(summary.tables.map(t => t.name.toLowerCase()))
const tvfs = summary.functions.filter(f => isTableValuedFunctionType(f.type))
const scalars = summary.functions.filter(f => !isTableValuedFunctionType(f.type))

/** Esegue il provider alla posizione indicata (come fa Monaco nell'editor). */
function suggest(sql: string, offset: number) {
  const model = monaco.editor.createModel(sql, 'sql')
  try {
    const position = model.getPositionAt(offset)
    return provideSqlCompletions({
      model,
      position,
      state: { connectionId: 'test', summary, aiEnabled: true, onExecute: () => {} },
    })
  } finally {
    model.dispose()
  }
}

/** Etichette dei suggerimenti alla fine del testo. */
function labelsAfter(sql: string): string[] {
  return suggest(sql, sql.length).suggestions.map(s => String(s.label))
}

describe('schema reale: la fixture ha la forma che manda il backend', () => {
  it('è lo schema vero di DEMOSTORE', () => {
    expect(summary.tables.length).toBeGreaterThan(250)
    expect(summary.procedures.length).toBeGreaterThan(500)
    expect(summary.functions.length).toBeGreaterThan(200)
    expect(summary.foreignKeys.length).toBeGreaterThan(300)
    expect(summary.triggers.length).toBeGreaterThan(100)
    expect(summary.checkConstraints?.length ?? 0).toBeGreaterThan(400)
  })

  it('le funzioni hanno { schema, name, type } con i type_desc di SQL Server', () => {
    for (const f of summary.functions) {
      expect(typeof f.schema).toBe('string')
      expect(typeof f.name).toBe('string')
      expect(f.type.startsWith('SQL_'), `${f.name} ha type "${f.type}"`).toBe(true)
    }
  })

  it('riconosce le funzioni tabellari per tipo (incluse le INLINE)', () => {
    expect(tvfs.length).toBeGreaterThan(50)
    expect(scalars.length).toBeGreaterThan(100)
    expect(tvfs.some(f => f.type === 'SQL_INLINE_TABLE_VALUED_FUNCTION')).toBe(true)
    expect(tvfs.some(f => f.type === 'SQL_TABLE_VALUED_FUNCTION')).toBe(true)
    // le scalari non devono mai passare per tabellari
    expect(scalars.some(f => isTableValuedFunctionType(f.type))).toBe(false)
  })

  it('le co-occorrenze citano solo tabelle esistenti (niente funzioni o viste di sistema)', () => {
    const bad: string[] = []
    for (const co of summary.cooccurrences ?? []) {
      if (!tableNames.has(co.tableA.toLowerCase())) bad.push(co.tableA)
      if (!tableNames.has(co.tableB.toLowerCase())) bad.push(co.tableB)
    }
    expect(bad, `nomi che non sono tabelle: ${bad.slice(0, 5).join(', ')}`).toEqual([])
  })

  it('le tabelle chiave del DB hanno le colonne reali', () => {
    const rm = summary.tables.find(t => t.name === 'RUN_MISSIONI')
    expect(rm, 'RUN_MISSIONI assente').toBeTruthy()
    const cols = (rm?.columns ?? []).map(c => c.name)
    expect(cols.length).toBeGreaterThan(50)
    expect(cols).toContain('MIS_UDC')
    expect(cols).toContain('MIS_OPERATORE')
  })
})

describe('schema reale: suggerimenti corretti sul database vero', () => {
  it('la query dell utente: dopo "inner join" arrivano le funzioni tabellari reali', () => {
    // caso segnalato: SELECT MIS_UDC,MIS_OPERATORE FROM dbo.RUN_MISSIONI inner join ▮
    const labels = labelsAfter('SELECT MIS_UDC,MIS_OPERATORE FROM dbo.RUN_MISSIONI inner join ')
    const lower = labels.map(l => l.toLowerCase())
    const tvfProposte = tvfs.filter(f => lower.includes(`${f.schema}.${f.name}`.toLowerCase()))
    expect(tvfProposte.length, 'nessuna funzione tabellare proposta dopo inner join').toBeGreaterThan(10)
    // nessuna funzione SCALARE: non è una sorgente di righe, dopo JOIN non va proposta
    const scalariProposte = scalars.filter(f => lower.includes(`${f.schema}.${f.name}`.toLowerCase()))
    expect(scalariProposte.map(f => f.name)).toEqual([])
    // e restano proposte le tabelle
    expect(labels.some(l => l.toUpperCase().includes('RUN_MISSIONI'))).toBe(true)
  })

  it('dopo FROM propone tabelle reali e funzioni tabellari, mai funzioni scalari', () => {
    const labels = labelsAfter('SELECT * FROM ')
    const lower = labels.map(l => l.toLowerCase())
    expect(labels.length).toBeGreaterThan(50)
    expect(scalars.some(f => lower.includes(`${f.schema}.${f.name}`.toLowerCase()))).toBe(false)
    expect(tvfs.some(f => lower.includes(`${f.schema}.${f.name}`.toLowerCase()))).toBe(true)
  })

  it('nella WHERE propone le colonne reali della tabella dello statement', () => {
    const labels = labelsAfter('SELECT * FROM dbo.RUN_MISSIONI WHERE ')
    expect(labels).toContain('MIS_UDC')
    expect(labels).toContain('MIS_OPERATORE')
  })

  it('dopo EXEC propone le stored procedure reali', () => {
    const labels = labelsAfter('EXEC ')
    const lower = new Set(labels.map(l => l.toLowerCase()))
    const proposte = summary.procedures.filter(p => lower.has(`${p.schema}.${p.name}`.toLowerCase()))
    expect(proposte.length, 'nessuna stored procedure proposta dopo EXEC').toBeGreaterThan(10)
  })

  it('nella JOIN propone le tabelle collegate da FK reali', () => {
    // DAT_UDC è collegata a RUN_MISSIONI dalla FK FK_RUN_MISSIONI_DAT_UDC
    const labels = labelsAfter('SELECT * FROM dbo.RUN_MISSIONI JOIN ')
    expect(labels.some(l => l.toUpperCase().includes('DAT_UDC'))).toBe(true)
  })
})

describe('schema reale: il provider non si spacca su query vere', () => {
  const QUERIES = [
    'SELECT MIS_UDC, MIS_OPERATORE FROM dbo.RUN_MISSIONI',
    'SELECT * FROM dbo.RUN_MISSIONI WHERE MIS_UDC = ',
    'SELECT a.UDC_UDC FROM dbo.DAT_UDC a JOIN dbo.RUN_MISSIONI b ON a.UDC_UDC = b.MIS_UDC',
    'EXEC dbo.',
    'SELECT * FROM dbo.MAG_CELLE ORDER BY ',
  ]

  // timeout ampio: il provider viene eseguito a OGNI offset di diverse query vere e, con la
  // suite in parallelo, supera i 5s di default (falliva a intermittenza per il tempo, non per il codice)
  it('nessuna eccezione e mai popup vuoto, a ogni offset', { timeout: 60000 }, () => {
    for (const sql of QUERIES) {
      for (let offset = 0; offset <= sql.length; offset++) {
        if (inCommentOrString(sql, offset)) continue
        const where = `\n--- "${sql.slice(0, 40)}…" offset ${offset} ---`
        let res: monaco.languages.CompletionList | undefined
        expect(() => {
          res = suggest(sql, offset)
        }, `il provider ha lanciato un'eccezione${where}`).not.toThrow()
        expect(res!.suggestions.length, `nessun suggerimento nel codice${where}`).toBeGreaterThan(0)
      }
    }
  })
})
