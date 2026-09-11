// Riconosce la STORED PROCEDURE o FUNZIONE sotto il cursore, per poterla aprire con
// il tasto destro ("Modifica" = CREATE OR ALTER / "Apri definizione") in un'altra tab.
// Logica PURA e testabile: nessuna dipendenza da Monaco o dal backend.
import type { DatabaseSummary } from './types'

export type CallableKind = 'procedure' | 'function'

export interface CallableRef {
  kind: CallableKind
  schema: string
  name: string
}

const IDENT_CHAR = /[A-Za-z0-9_@#]/

/**
 * Estrae l'identificatore (eventualmente qualificato "schema.nome" o "[schema].[nome]")
 * che contiene l'offset. Restituisce le parti senza parentesi quadre.
 */
export function identifierPartsAt(text: string, offset: number): string[] {
  const isPart = (i: number) =>
    i >= 0 && i < text.length && (IDENT_CHAR.test(text[i]) || text[i] === '.' || text[i] === '[' || text[i] === ']')
  // il cursore può stare subito dopo la fine del nome: arretra di uno
  let at = offset
  if (!isPart(at) && isPart(at - 1)) at -= 1
  if (!isPart(at)) return []
  let start = at
  let end = at
  while (isPart(start - 1)) start--
  while (isPart(end)) end++
  const raw = text.slice(start, end)
  return raw
    .split('.')
    .map(p => p.replace(/[[\]]/g, '').trim())
    .filter(Boolean)
}

/**
 * Risolve la procedura/funzione richiamata nel punto indicato. Accetta sia il nome
 * qualificato ("dbo.ws_X") sia quello semplice ("ws_X", coerente con lo schema del
 * sommario). Le tabelle NON sono considerate "chiamabili" (→ null).
 */
export function resolveCallableAt(
  text: string,
  offset: number,
  summary: DatabaseSummary | null | undefined,
): CallableRef | null {
  if (!summary) return null
  const parts = identifierPartsAt(text, offset)
  if (parts.length === 0) return null
  const name = parts[parts.length - 1]
  const schema = parts.length > 1 ? parts[parts.length - 2] : null
  const match = (s: string) => s.toLowerCase() === name.toLowerCase()
  const schemaOk = (s: string) => !schema || s.toLowerCase() === schema.toLowerCase()

  const proc = summary.procedures.find(p => match(p.name) && schemaOk(p.schema))
  if (proc) return { kind: 'procedure', schema: proc.schema, name: proc.name }
  const fn = summary.functions.find(f => match(f.name) && schemaOk(f.schema))
  if (fn) return { kind: 'function', schema: fn.schema, name: fn.name }
  return null
}

/**
 * True se sotto il cursore c'è una stored procedure o una funzione: è la condizione con cui
 * il tasto destro fa COMPARIRE la voce "Modifica (CREATE OR ALTER in una nuova tab)".
 * Su tabelle, campi (colonne) e su testo qualsiasi deve essere false, così la voce non
 * compare nemmeno nel menu.
 */
export function isCallableAt(
  text: string,
  offset: number,
  summary: DatabaseSummary | null | undefined,
): boolean {
  return resolveCallableAt(text, offset, summary) !== null
}
