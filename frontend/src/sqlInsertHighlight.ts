// Evidenzia il campo corrispondente tra la lista colonne e i valori di un INSERT:
// cursore su una colonna → si evidenzia il valore nella tupla VALUES (e viceversa).
// Nota: import diretto di monaco-editor (stessa istanza usata da monacoSetup) per essere testabile.
import * as monaco from 'monaco-editor'
import { insertCorrespondingTarget } from './helpers'

export function registerInsertHighlight(editor: monaco.editor.IStandaloneCodeEditor): monaco.IDisposable[] {
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
    const target = insertCorrespondingTarget(text, cursorOffset)
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
