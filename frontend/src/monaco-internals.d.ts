// Monaco non esporta i tipi dei suoi moduli interni: questa dichiarazione serve ai test
// che verificano la selezione della parola (doppio click) usando il VERO codice di Monaco.
declare module 'monaco-editor/editor/common/cursor/cursorWordOperations.js' {
  import type { Position, editor } from 'monaco-editor'

  export interface WordAtPosition {
    word: string
    startColumn: number
    endColumn: number
  }

  export class WordOperations {
    /** Calcola la parola alla posizione dati i separatori di parola (stessa logica del doppio click). */
    static getWordAtPosition(
      model: editor.ITextModel,
      wordSeparators: string,
      intlSegmenterLocales: string[],
      position: Position,
    ): WordAtPosition | null
  }
}
