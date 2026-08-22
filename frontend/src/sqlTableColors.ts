// Colorizza i nomi delle tabelle e delle loro colonne nella query:
// ogni tabella ha un colore stabile, condiviso dalle sue colonne (i nomi di tabella sono enfatizzati).
// Nota: import diretto di monaco-editor (stessa istanza usata da monacoSetup) per essere testabile.
import * as monaco from 'monaco-editor'
import { colorClassFor, colorizeSqlTokens, tokenizeSql } from './helpers'
import type { DatabaseSummary } from './types'

export interface ColorDecorationSpec {
  /** Offset assoluti nel testo. */
  start: number
  end: number
  className: string
  fontWeight: string | undefined
}

/** Calcola le decorazioni colore per il testo (pura e testabile). */
export function buildColorDecorations(text: string, summary: DatabaseSummary): ColorDecorationSpec[] {
  const tokens = tokenizeSql(text)
  return colorizeSqlTokens(text, summary).map(c => {
    const tok = tokens[c.index]
    return {
      start: tok.start,
      end: tok.end,
      className: colorClassFor(c.tableKey),
      fontWeight: c.isTableName ? '600' : undefined,
    }
  })
}

export function registerTableColorizer(
  editor: monaco.editor.IStandaloneCodeEditor,
  summary: DatabaseSummary,
): monaco.IDisposable[] {
  const disposables: monaco.IDisposable[] = []
  const collection = editor.createDecorationsCollection()
  let timer: number | null = null

  const refresh = () => {
    const model = editor.getModel()
    if (!model) return
    const text = model.getValue()
    const items: monaco.editor.IModelDeltaDecoration[] = []
    for (const d of buildColorDecorations(text, summary)) {
      const start = model.getPositionAt(d.start)
      const end = model.getPositionAt(Math.max(d.start, d.end - 1))
      items.push({
        range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column + 1),
        // inlineClassName (non className): è ciò che Monaco 0.56 piega nello span del
        // token, permettendo di colorare il testo (className rende solo un overlay vuoto).
        options: { inlineClassName: d.className, fontWeight: d.fontWeight },
      })
    }
    collection.set(items)
  }

  disposables.push(
    editor.onDidChangeModelContent(() => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(refresh, 400)
    }),
  )
  // se il modello viene sostituito, riapplica subito i colori
  disposables.push(editor.onDidChangeModel(refresh))
  disposables.push({
    dispose: () => {
      if (timer !== null) window.clearTimeout(timer)
      collection.clear()
    },
  })

  refresh()
  return disposables
}
