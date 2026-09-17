// Evidenzia il campo corrispondente alla posizione del cursore:
//  - INSERT: lista colonne ↔ tupla VALUES (per indice);
//  - UPDATE: colonna della SET ↔ espressione assegnata;
//  - MERGE: valori della USING ↔ lista colonne di src, colonne ↔ valori dell'INSERT del ramo
//    NOT MATCHED, e coppie "a = b" del SET (ramo MATCHED) e della condizione ON.
// Nota: import diretto di monaco-editor (stessa istanza usata da monacoSetup) per essere testabile.
import * as monaco from 'monaco-editor'
import { pairHighlightTarget } from './helpers'

export function registerPairHighlight(editor: monaco.editor.IStandaloneCodeEditor): monaco.IDisposable[] {
  const disposables: monaco.IDisposable[] = []
  const collection = editor.createDecorationsCollection()
  let contentTimer: number | null = null

  const clear = () => {
    if (collection.length > 0) collection.clear()
  }

  const refresh = () => {
    const model = editor.getModel()
    const pos = editor.getPosition()
    if (!model || !pos) return
    const text = model.getValue()
    const cursorOffset = model.getOffsetAt(pos)
    const target = pairHighlightTarget(text, cursorOffset)
    if (!target) {
      clear()
      return
    }
    const start = model.getPositionAt(target.start)
    const end = model.getPositionAt(Math.max(target.start, target.end - 1))
    const range = new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column + 1)
    collection.set([{ range, options: { className: 'sql-pair-highlight' } }])
  }

  disposables.push(editor.onDidChangeCursorPosition(refresh))
  disposables.push(
    editor.onDidChangeModelContent(() => {
      if (contentTimer !== null) window.clearTimeout(contentTimer)
      contentTimer = window.setTimeout(refresh, 250)
    }),
  )
  disposables.push({
    dispose: () => {
      if (contentTimer !== null) window.clearTimeout(contentTimer)
      collection.clear()
    },
  })

  refresh()
  return disposables
}
