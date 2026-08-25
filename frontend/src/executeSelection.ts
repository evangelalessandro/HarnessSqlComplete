/**
 * Scelta del testo da eseguire: come SSMS, se c'è una selezione nell'editor
 * si esegue SOLO la selezione, altrimenti tutto il contenuto.
 */

/**
 * @param selection Testo selezionato, o null/undefined se non c'è selezione (cursore fermo).
 * @param fullText  Contenuto completo dell'editor.
 * @returns La selezione (ripulita dagli spazi ai bordi) se non vuota, altrimenti il testo completo.
 */
export function pickSqlToExecute(selection: string | null | undefined, fullText: string): string {
  if (selection !== null && selection !== undefined) {
    const trimmed = selection.trim()
    if (trimmed.length > 0) return trimmed
  }
  return fullText
}

export interface FormatTarget {
  /** Testo da formattare. */
  text: string
  /** True se è stata usata la selezione (quindi il range da sostituire è la selezione). */
  usesSelection: boolean
}

/**
 * Scelta del testo da formattare (come l'esecuzione): se c'è una selezione non vuota
 * si formatta SOLO quella parte (ripulita dai bordi); altrimenti tutto il contenuto.
 */
export function pickFormatTarget(selection: string | null | undefined, fullText: string): FormatTarget {
  if (selection !== null && selection !== undefined && selection.trim().length > 0) {
    return { text: selection.trim(), usesSelection: true }
  }
  return { text: fullText, usesSelection: false }
}
