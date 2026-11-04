// TABELLE LOGICHE DEI TRIGGER: `inserted` e `deleted` (T-SQL).
//
// SEGNALAZIONE UTENTE: "nei trigger devi vedere i campi per l'intellisense dall'oggetto inserted e
// updated, adesso non sembra vederli".
// Dentro un trigger SQL Server espone due tabelle logiche con le STESSE colonne della tabella del
// trigger: `inserted` (le righe nuove) e `deleted` (le righe vecchie). (`updated` in T-SQL non esiste:
// chi scrive "updated" intende `inserted`; lo accettiamo come sinonimo per non lasciare l'utente a
// secco.) Questo modulo:
//  - trova la TABELLA del trigger dallo script (CREATE/ALTER TRIGGER … ON schema.tabella);
//  - riconosce il prefisso `inserted.` / `deleted.` / `updated.` mentre si scrive;
//  - restituisce le colonne da proporre (quelle della tabella del trigger).
import type { DatabaseSummary, TableInfo } from './types'

/** Nomi con cui si può citare una tabella logica del trigger (case-insensitive). */
export const TABELLE_LOGICHE = ['inserted', 'deleted', 'updated'] as const
export type TabellaLogica = (typeof TABELLE_LOGICHE)[number]

/** L'oggetto su cui è definito il trigger. */
export interface TabellaTrigger {
  schema: string
  tabella: string
}

/** Toglie le quadre e riduce a `schema.tabella` / `tabella`. */
function normalizza(nome: string): string {
  return nome.replace(/[[\]\s]/g, '')
}

/**
 * La tabella su cui è definito il trigger nello script aperto.
 * Guarda prima il testo (`CREATE|ALTER TRIGGER … ON <nome>`), che è la verità del momento — anche se
 * il trigger è nuovo e non è ancora nel sommario — e solo se non lo trova cerca nel sommario un
 * trigger con quel nome.
 */
export function tabellaDelTrigger(sql: string, summary?: DatabaseSummary | null): TabellaTrigger | null {
  const m = /\b(?:CREATE|ALTER)\s+(?:OR\s+ALTER\s+)?TRIGGER\s+([\w[\]."]+)[\s\S]*?\bON\s+([\w[\]."@#]+)/i.exec(sql)
  if (m) {
    const pulito = normalizza(m[2])
    const parti = pulito.split('.')
    if (parti.length >= 2) return { schema: parti[parti.length - 2], tabella: parti[parti.length - 1] }
    if (parti.length === 1 && parti[0]) return { schema: 'dbo', tabella: parti[0] }
  }
  // ripiego: un trigger del sommario con questo nome (il testo potrebbe non avere ancora la ON)
  const nomeTrigger = /\bTRIGGER\s+([\w[\]."]+)/i.exec(sql)
  if (nomeTrigger && summary) {
    const cercato = normalizza(nomeTrigger[1]).split('.').pop()?.toLowerCase() ?? ''
    const trovato = (summary.triggers ?? []).find(t => t.name.toLowerCase() === cercato)
    if (trovato) return { schema: trovato.schema, tabella: trovato.tableName }
  }
  return null
}

/** True se il testo `parola` è una tabella logica del trigger. */
export function eTabellaLogica(parola: string): boolean {
  return (TABELLE_LOGICHE as readonly string[]).includes(parola.toLowerCase())
}

/**
 * Se il cursore è subito dopo "inserted." / "deleted." / "updated." (anche con l'inizio del campo
 * digitato), restituisce la tabella logica e il prefisso del campo. Altrimenti null.
 * Attenzione a NON confondere `x.inserted` (campo di un alias) con la tabella logica: serve che il
 * nome sia isolato (inizio, spazio, parentesi, virgola…).
 */
export function contestoTabellaLogica(
  testoPrima: string,
): { logica: TabellaLogica; prefisso: string } | null {
  const m = /(^|[^\w.[\]])(inserted|deleted|updated)\s*\.\s*([A-Za-z_][\w]*)?$/.exec(testoPrima)
  if (!m) return null
  return { logica: m[2].toLowerCase() as TabellaLogica, prefisso: m[3] ?? '' }
}

/**
 * La tabella (dal sommario) su cui punta il trigger: è quella che dà le COLONNE a `inserted`/`deleted`.
 */
export function tabellaTriggerDalSommario(
  sql: string,
  summary?: DatabaseSummary | null,
): TableInfo | null {
  const target = tabellaDelTrigger(sql, summary)
  if (!target || !summary) return null
  const perNome = (summary.tables ?? []).filter(t => t.name.toLowerCase() === target.tabella.toLowerCase())
  return perNome.find(t => t.schema.toLowerCase() === target.schema.toLowerCase()) ?? perNome[0] ?? null
}

/**
 * Le colonne da proporre dopo `inserted.` / `deleted.` / `updated.`: sono quelle della tabella del
 * trigger. Restituisce anche il nome della tabella logica per il dettaglio.
 */
export function colonneTabelleLogiche(
  testoPrima: string,
  sql: string,
  summary?: DatabaseSummary | null,
): { logica: TabellaLogica; tabella: TableInfo; colonne: { name: string; dataType: string }[] } | null {
  const ctx = contestoTabellaLogica(testoPrima)
  if (!ctx) return null
  const tabella = tabellaTriggerDalSommario(sql, summary)
  if (!tabella) return null
  const colonne = (tabella.columns ?? []).map(c => ({ name: c.name, dataType: c.dataType }))
  if (colonne.length === 0) return null
  return { logica: ctx.logica, tabella, colonne }
}

/** L'editor sta mostrando un trigger? (serve a proporre `inserted`/`deleted` anche senza il punto) */
export function eUnTrigger(sql: string): boolean {
  return /\b(?:CREATE|ALTER)\s+(?:OR\s+ALTER\s+)?TRIGGER\b/i.test(sql)
}
