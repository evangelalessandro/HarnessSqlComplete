// @vitest-environment jsdom
// GOTO: dopo "goto " devono essere proposte TUTTE le label del documento (anche quelle
// scritte più sotto, che è il caso normale), ignorando quelle nel codice commentato.
// Il provider è quello vero, eseguito su un modello Monaco (come nell'editor).
import { describe, expect, it } from 'vitest'
import * as monaco from 'monaco-editor'
import { provideSqlCompletions } from '../sqlCompletions'
import { extractLabels } from '../labels'
import { wsbritvicLikeSummary } from './schema'

const summary = wsbritvicLikeSummary()

function suggest(sql: string, offset: number) {
  const model = monaco.editor.createModel(sql, 'sql')
  try {
    return provideSqlCompletions({
      model,
      position: model.getPositionAt(offset),
      state: { connectionId: 'test', summary, aiEnabled: true, onExecute: () => {} },
    })
  } finally {
    model.dispose()
  }
}

const PROC = `CREATE PROCEDURE dbo.p AS
BEGIN
  IF @a = 1
    GOTO lblExit
  IF @b = 2
    GOTO fine
  SELECT 1

  lblExit:
  RETURN 0

  fine:
  RETURN 1
END`

describe('extractLabels', () => {
  it('trova le label a inizio riga', () => {
    expect(extractLabels(PROC)).toEqual(['lblExit', 'fine'])
  })

  it('trova anche "…; label:" e non duplica (senza differenze di maiuscole)', () => {
    expect(extractLabels('SELECT 1; fine:\nFINE:\n  Fine:')).toEqual(['fine'])
  })

  it('ignora commenti di riga e di blocco', () => {
    const sql = `-- lblFinta:
/* lblAltra:
   ancora: */
lblVera:
SELECT 1 -- fine:
`
    expect(extractLabels(sql)).toEqual(['lblVera'])
  })

  it('non scambia per label altro codice', () => {
    expect(extractLabels("SELECT 'a:b' AS x\nDECLARE @t TABLE (a int)\nWHERE x <> 1")).toEqual([])
    expect(extractLabels('SELECT CAST(x AS int) FROM dbo.T')).toEqual([])
  })
})

describe('GOTO: suggerisce le label del documento', () => {
  it('dopo "GOTO " propone tutte le label (anche quelle definite più sotto)', () => {
    const sql = PROC.replace('GOTO lblExit', 'GOTO ')
    const res = suggest(sql, sql.indexOf('GOTO ') + 'GOTO '.length)
    const nomi = res!.suggestions.map(s => String(s.label))
    expect(nomi).toContain('lblExit')
    expect(nomi).toContain('fine')
    // solo label: niente tabelle/procedure in questo contesto
    expect(nomi).not.toContain('DAT_UDC')
  })

  it('mentre si digita la label il popup resta filtrato su quelle voci', () => {
    const sql = PROC.replace('GOTO lblExit', 'GOTO fi')
    const res = suggest(sql, sql.indexOf('GOTO fi') + 'GOTO fi'.length)
    const nomi = res!.suggestions.map(s => String(s.filterText ?? s.label))
    expect(nomi).toContain('fine')
    expect(nomi).toContain('lblExit')
  })

  it('"goto" non attiva il contesto delle label quando è parte di un altra parola', () => {
    const sql = 'SELECT * FROM dbo.T WHERE nome = 1'
    const res = suggest(sql, sql.indexOf('nome') + 2)
    expect(res!.suggestions.map(s => String(s.label))).not.toContain('lblExit')
  })

  it('la label inserita è il solo nome (niente parentesi o schema)', () => {
    const sql = PROC.replace('GOTO lblExit', 'GOTO ')
    const res = suggest(sql, sql.indexOf('GOTO ') + 'GOTO '.length)
    const voce = res!.suggestions.find(s => s.label === 'lblExit')
    expect(voce?.insertText).toBe('lblExit')
  })

  it('senza label nel documento il popup NON resta vuoto (suggerimenti normali)', () => {
    const sql = 'SELECT 1\nGOTO '
    const res = suggest(sql, sql.length)
    expect(res!.suggestions.length).toBeGreaterThan(0)
  })
})
