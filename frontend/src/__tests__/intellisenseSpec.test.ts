// @vitest-environment jsdom
// AUDIT intellisense secondo le specifiche T-SQL: in ogni contesto devono comparire
// SOLO voci utilizzabili in quel punto (controllato sui kind reali di Monaco, usando il
// provider vero). Es.: dopo FROM/JOIN solo tabelle/viste/funzioni tabellari; nella
// WHERE/SET solo colonne e funzioni; nella ORDER BY solo colonne e ASC/DESC; dopo EXEC
// solo stored procedure; nei commenti nulla.
import { describe, expect, it } from 'vitest'
import * as monaco from 'monaco-editor'
import { provideSqlCompletions } from '../sqlCompletions'
import type { DatabaseSummary } from '../types'
import { mkCol, mkTbl, wsbritvicLikeSummary } from './schema'

const K = monaco.languages.CompletionItemKind

function summaryFixture(): DatabaseSummary {
  const s = wsbritvicLikeSummary()
  s.tables.push(
    mkTbl('dbo', 'MAG_CORRIDOI', [mkCol('COR_CORRIDOIO', 'int'), mkCol('COR_AREA', 'nvarchar')]),
  )
  s.functions.push(
    { schema: 'dbo', name: 'fn_GetMissioni', type: 'SQL_INLINE_TABLE_VALUED_FUNCTION' },
    { schema: 'dbo', name: 'fn_td', type: 'SQL_SCALAR_FUNCTION' },
  )
  return s
}
const summary = summaryFixture()

function items(sql: string) {
  const model = monaco.editor.createModel(sql, 'sql')
  try {
    const position = model.getPositionAt(sql.length)
    const res = provideSqlCompletions({
      model,
      position,
      state: { connectionId: 'test', summary, aiEnabled: true, onExecute: () => {} },
    })
    return res.suggestions
  } finally {
    model.dispose()
  }
}

/** Kind presenti nei suggerimenti. */
function kinds(sql: string): Set<monaco.languages.CompletionItemKind> {
  return new Set(items(sql).map(i => i.kind as monaco.languages.CompletionItemKind))
}

/** Asserisce che compaiano SOLO i kind ammessi. */
function expectOnly(sql: string, allowed: monaco.languages.CompletionItemKind[]) {
  const got = kinds(sql)
  for (const k of got) {
    expect(allowed.includes(k), `kind non ammesso (${k}) in: ${sql}\nkind presenti: ${[...got].join(',')}`).toBe(true)
  }
}

/** Asserisce che compaia almeno una voce con quel kind. */
function expectSome(sql: string, kind: monaco.languages.CompletionItemKind) {
  expect([...kinds(sql)].includes(kind), `manca il kind ${kind} in: ${sql}`).toBe(true)
}

const LABELS = (sql: string) => items(sql).map(i => String(i.label))

describe('intellisense T-SQL: dopo FROM/JOIN solo SORGENTI (tabelle, viste, funzioni tabellari)', () => {
  it('FROM: tabelle/viste/funzioni tabellari, mai colonne o procedure', () => {
    expectOnly('SELECT * FROM ', [K.Struct, K.Interface, K.Class])
    expectSome('SELECT * FROM ', K.Struct)
    expect(LABELS('SELECT * FROM ')).toContain('dbo.fn_GetMissioni')
  })

  it('JOIN: stesse sorgenti (e le funzioni tabellari, non quelle scalari)', () => {
    expectOnly('SELECT * FROM dbo.RUN_MISSIONI inner join ', [K.Struct, K.Interface, K.Class])
    const l = LABELS('SELECT * FROM dbo.RUN_MISSIONI inner join ')
    expect(l).toContain('dbo.fn_GetMissioni')
    expect(l).not.toContain('dbo.fn_td')
  })

  it('le tabelle NON sono proposte dove servono espressioni (WHERE/SELECT-list)', () => {
    for (const sql of ['SELECT * FROM dbo.RUN_MISSIONI WHERE ', 'SELECT ', 'SELECT * FROM dbo.RUN_MISSIONI ORDER BY ']) {
      const got = kinds(sql)
      expect(got.has(K.Struct), `tabella proposta a torto in: ${sql}`).toBe(false)
      expect(got.has(K.Interface), `vista proposta a torto in: ${sql}`).toBe(false)
    }
  })
})

describe('intellisense T-SQL: nelle espressioni solo COLONNE e FUNZIONI', () => {
  it('WHERE: colonne (Field) e funzioni (Keyword/Function), niente tabelle o procedure', () => {
    expectOnly('SELECT * FROM dbo.RUN_MISSIONI WHERE ', [K.Field, K.Keyword, K.Function, K.Snippet])
    expectSome('SELECT * FROM dbo.RUN_MISSIONI WHERE ', K.Field)
  })

  it('SET di un UPDATE: colonne della tabella target', () => {
    expectOnly('UPDATE dbo.RUN_MISSIONI SET ', [K.Field, K.Keyword, K.Function, K.Snippet])
    expect(LABELS('UPDATE dbo.RUN_MISSIONI SET ')).toContain('MIS_MISSIONE')
  })

  it('SELECT-list: campi e funzioni SCALARI, ma nessuna stored procedure', () => {
    expectOnly('SELECT ', [K.Field, K.Keyword, K.Function, K.Snippet])
    // le voci "Function" qui sono le funzioni SCALARI dell'utente, non le stored procedure
    const l = LABELS('SELECT ')
    expect(l).toContain('dbo.fn_td')
    expect(l.some(x => x.includes('zzz_test_proc'))).toBe(false)
  })

  it('ORDER BY: solo colonne + ASC/DESC (e "BY" dopo ORDER)', () => {
    expectOnly('SELECT MIS_UDC FROM dbo.RUN_MISSIONI ORDER BY MIS_UDC ', [K.Field, K.Keyword])
    const l = LABELS('SELECT MIS_UDC FROM dbo.RUN_MISSIONI ORDER BY MIS_UDC ')
    expect(l).toContain('ASC')
    expect(l).toContain('DESC')
    // niente tabelle/funzioni/procedure nella ORDER BY
    const got = kinds('SELECT MIS_UDC FROM dbo.RUN_MISSIONI ORDER BY MIS_UDC ')
    for (const k of [K.Struct, K.Interface, K.Class, K.Function]) expect(got.has(k)).toBe(false)
  })
})

describe('intellisense T-SQL: chiamate e valori', () => {
  it('EXEC: SOLO stored procedure', () => {
    expectOnly('EXEC ', [K.Function])
    expect(LABELS('EXEC ').some(l => l.includes('zzz_test_proc'))).toBe(true)
  })

  it('INSERT INTO t (: colonne della tabella + "tutte le colonne"', () => {
    expectOnly('INSERT INTO dbo.RUN_MISSIONI (', [K.Field, K.Snippet])
    expect(LABELS('INSERT INTO dbo.RUN_MISSIONI (')).toContain('MIS_UDC')
    expect(LABELS('INSERT INTO dbo.RUN_MISSIONI (').some(l => l.includes('tutte le colonne'))).toBe(true)
  })

  it('VALUES (: costanti e snippet, niente campi o tabelle', () => {
    expectOnly('INSERT INTO dbo.RUN_MISSIONI (MIS_UDC) VALUES (', [K.Constant, K.Snippet])
  })

  it('nei commenti non si propone nulla', () => {
    // commento di riga: cursore dentro il commento
    expect(items('SELECT 1 -- commento')).toHaveLength(0)
    // commento a blocco non chiuso: cursore dentro il blocco
    expect(items('SELECT 1 /* blocco')).toHaveLength(0)
    // cursore DOPO la chiusura del blocco: si torna a proporre
    expect(items('SELECT 1 /* blocco */ ').length).toBeGreaterThan(0)
  })

  it('senza schema (sessione scaduta) propone comunque qualcosa (mai vuoto)', () => {
    const model = monaco.editor.createModel('SELECT * FROM ', 'sql')
    try {
      const res = provideSqlCompletions({
        model,
        position: model.getPositionAt(14),
        state: { connectionId: 'test', summary: null, aiEnabled: true, onExecute: () => {} },
      })
      expect(res.suggestions.length).toBeGreaterThan(0)
    } finally {
      model.dispose()
    }
  })
})
