import type { QueryResult } from './types'

export type ResultTab = 'results' | 'print'

/**
 * Decide quale tab mostrare dopo l'esecuzione di una query:
 * - "results" se c'è un errore o almeno un VERO result set (con colonne, cioè una SELECT);
 * - "print" (messaggi/PRINT) se la query non restituisce nessuna SELECT ma solo
 *   messaggi (PRINT, righe interessate…).
 * I result set vuoti senza colonne (prodotti da UPDATE/INSERT/DELETE) non contano
 * come risultati: si va comunque nella schermata dei messaggi.
 */
export function chooseResultTab(result: Pick<QueryResult, 'error' | 'resultSets'>): ResultTab {
  const hasRealResults = result.resultSets.some(s => s.columns.length > 0)
  return result.error || hasRealResults ? 'results' : 'print'
}
