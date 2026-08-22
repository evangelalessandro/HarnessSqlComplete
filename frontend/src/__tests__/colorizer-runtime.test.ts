// @vitest-environment jsdom
// Test RUNTIME delle decorazioni Monaco: applica le decorazioni colore su un modello
// reale (createModel + deltaDecorations) e verifica che i range/classi siano corretti.
import { describe, expect, it } from 'vitest'
import * as monaco from 'monaco-editor'
import { buildColorDecorations } from '../sqlTableColors'
import { wsbritvicLikeSummary } from './schema'

function applyAndCollect(sql: string, summary: ReturnType<typeof wsbritvicLikeSummary>) {
  const model = monaco.editor.createModel(sql, 'sql')
  const items = buildColorDecorations(sql, summary).map(d => ({
    range: new monaco.Range(
      model.getPositionAt(d.start).lineNumber,
      model.getPositionAt(d.start).column,
      model.getPositionAt(Math.max(d.start, d.end - 1)).lineNumber,
      model.getPositionAt(Math.max(d.start, d.end - 1)).column + 1,
    ),
    // inlineClassName: è la proprietà che Monaco 0.56 piega nello span del token
    options: { inlineClassName: d.className, fontWeight: d.fontWeight },
  }))
  model.deltaDecorations([], items)
  const decos = model.getDecorationsInRange(model.getFullModelRange())
  const byText = new Map<string, string>()
  for (const d of decos) {
    if (!d.options.inlineClassName?.startsWith('sql-tbl-')) continue
    byText.set(model.getValueInRange(d.range), d.options.inlineClassName)
  }
  model.dispose()
  return byText
}

describe('colorizer: decorazioni applicate al modello Monaco', () => {
  const summary = wsbritvicLikeSummary()
  const SQL =
    'SELECT MIS_UDC,UDC_CORRIDOIO  FROM dbo.RUN_MISSIONI inner join DAT_UDC ON MIS_UDC = UDC_UDC ORDER BY 1 DESC;'

  it('tabelle e colonne ricevono le decorazioni con classi colore', () => {
    const byText = applyAndCollect(SQL, summary)
    // tabelle con classi diverse (enfatizzate con fontWeight nel payload)
    expect(byText.get('RUN_MISSIONI')).toBe('sql-tbl-6')
    expect(byText.get('DAT_UDC')).toBe('sql-tbl-3')
    // colonne col colore della loro tabella
    expect(byText.get('MIS_UDC')).toBe('sql-tbl-6')
    expect(byText.get('UDC_CORRIDOIO')).toBe('sql-tbl-3')
    expect(byText.get('UDC_UDC')).toBe('sql-tbl-3')
    // MIS_ELEV inesistente → nessuna decorazione
    expect(byText.has('MIS_ELEV')).toBe(false)
  })

  it('i range delle decorazioni coprono esattamente il testo del token', () => {
    const model = monaco.editor.createModel(SQL, 'sql')
    const items = buildColorDecorations(SQL, summary).map(d => ({
      range: new monaco.Range(
        model.getPositionAt(d.start).lineNumber,
        model.getPositionAt(d.start).column,
        model.getPositionAt(Math.max(d.start, d.end - 1)).lineNumber,
        model.getPositionAt(Math.max(d.start, d.end - 1)).column + 1,
      ),
      options: { inlineClassName: d.className },
    }))
    model.deltaDecorations([], items)
    const decos = model.getDecorationsInRange(model.getFullModelRange())
    const misUdc = decos.find(d => model.getValueInRange(d.range) === 'MIS_UDC')
    expect(misUdc).toBeDefined()
    // il range deve essere esattamente 'MIS_UDC' (8 caratteri)
    expect(model.getValueInRange(misUdc!.range)).toBe('MIS_UDC')
    model.dispose()
  })

  it('il payload invia inlineClassName (classe che colora il testo) sui nomi tabella', () => {
    const specs = buildColorDecorations(SQL, summary)
    const byStart = new Map(specs.map(s => [SQL.slice(s.start, s.end), s]))
    expect(byStart.get('RUN_MISSIONI')?.fontWeight).toBe('600')
    expect(byStart.get('DAT_UDC')?.fontWeight).toBe('600')
    expect(byStart.get('MIS_UDC')?.fontWeight).toBeUndefined()
    expect(byStart.get('UDC_CORRIDOIO')?.fontWeight).toBeUndefined()
    // le classi devono essere valide inline (sql-tbl-N)
    for (const s of specs) {
      expect(s.className).toMatch(/^sql-tbl-\d+$/)
    }
  })
})
