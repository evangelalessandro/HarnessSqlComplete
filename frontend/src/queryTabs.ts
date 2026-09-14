import type { QueryMessage, QueryResult } from './types'
import { hasQueryError } from './sqlMessages'

export type ResultTab = 'results' | 'print'

/**
 * Decide quale tab mostrare dopo l'esecuzione di una query.
 *
 * - **ERRORE → "print" (Messaggi) per primo**, come in SSMS: se la query restituisce sia un
 *   errore sia dei risultati, si apre sui messaggi con l'errore (numero, procedura, riga, e i
 *   pulsanti per aprire gli oggetti citati); i risultati restano nella loro tab, a un clic.
 * - senza errore: "results" se c'è almeno un VERO result set (con colonne, cioè una SELECT);
 * - "print" (messaggi/PRINT) se la query non restituisce nessuna SELECT ma solo messaggi.
 *
 * I result set vuoti senza colonne (prodotti da UPDATE/INSERT/DELETE) non contano come
 * risultati: si va comunque nella schermata dei messaggi.
 */
export function chooseResultTab(
  result: Pick<QueryResult, 'error' | 'resultSets'> & { errors?: QueryMessage[] | null },
): ResultTab {
  if (hasQueryError(result)) return 'print'
  const hasRealResults = result.resultSets.some(s => s.columns.length > 0)
  return hasRealResults ? 'results' : 'print'
}
