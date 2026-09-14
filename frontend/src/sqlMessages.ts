// Visualizzazione dei messaggi di SQL Server come nella finestra "Messaggi" di SSMS.
//
// Il problema risolto: quando una query richiama più stored procedure e una fallisce, il
// messaggio di SQL Server contiene la PROCEDURA che ha eseguito il RAISERROR e la riga
// (es. "Msg 50000, Livello 16, Stato 1, Procedura ws_X, Riga 42"). Il backend ora manda sia
// il testo già composto sia i campi separati: qui si evidenzia il pezzo che serve — il nome
// della procedura — invece di mostrare tutto uguale.
import type { QueryMessage } from './types'

/** Intestazione in stile SSMS: "Msg 50000, Livello 16, Stato 1 · Procedura ws_X · Riga 42". */
export function messageHeader(m: QueryMessage): string {
  if (m.number === 0) return ''
  const proc = m.procedure ? ` · Procedura ${m.procedure}` : ''
  return `Msg ${m.number}, Livello ${m.severity}, Stato ${m.state}${proc} · Riga ${m.line}`
}

/**
 * Indice dei messaggi che sono errori, per la chiave `display`: permette di colorare in
 * rosso le righe giuste nell'elenco senza duplicare la logica di formattazione (che sta nel
 * backend). Si tiene il primo che compare per ogni testo.
 */
export function errorMessagesByDisplay(messages: QueryMessage[] | null | undefined): Map<string, QueryMessage> {
  const map = new Map<string, QueryMessage>()
  for (const m of messages ?? []) {
    if (!m.isError) continue
    if (!map.has(m.display)) map.set(m.display, m)
  }
  return map
}

/** true se c'è almeno un errore fra i messaggi (per evidenziare la tab dei messaggi). */
export function hasErrorMessage(messages: QueryMessage[] | null | undefined): boolean {
  return (messages ?? []).some(m => m.isError)
}

/** Riepilogo compatto per la barra di errore: errori raggruppati per procedura. */
export function errorProcedureNames(messages: QueryMessage[] | null | undefined): string[] {
  const names = new Set<string>()
  for (const m of messages ?? []) {
    if (m.isError && m.procedure) names.add(m.procedure)
  }
  return [...names]
}
