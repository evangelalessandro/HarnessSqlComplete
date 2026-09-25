// RICERCA TESTUALE GENERALE (stile Redgate SQL Search): helper PURI usati dal pannello di
// ricerca — evidenziazione del testo trovato, etichette dei tipi, riepilogo della scansione.
// Stanno qui per poter essere testati senza montare React.

import type { TextSearchHit, TextSearchResult } from './types'

/** Etichetta italiana del tipo di risultato. */
export function kindLabel(kind: TextSearchHit['kind']): string {
  switch (kind) {
    case 'table':
      return 'Tabella'
    case 'view':
      return 'Vista'
    case 'procedure':
      return 'Stored procedure'
    case 'function':
      return 'Funzione'
    case 'trigger':
      return 'Trigger'
    case 'column':
      return 'Colonna'
    case 'constraint':
      return 'Vincolo'
    case 'computed':
      return 'Colonna calcolata'
    case 'data':
      return 'Dato'
  }
}

/** Colore del badge per tipo (toni disponibili in components/ui.tsx). */
export function kindTone(kind: TextSearchHit['kind']): 'zinc' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet' {
  switch (kind) {
    case 'procedure':
      return 'emerald'
    case 'function':
      return 'violet'
    case 'view':
      return 'sky'
    case 'table':
    case 'column':
      return 'amber'
    case 'trigger':
    case 'constraint':
    case 'computed':
      return 'rose'
    case 'data':
      return 'sky'
  }
}

/** Dove è stato trovato il testo (per il dettaglio nel risultato). */
export function matchLabel(matchIn: TextSearchHit['matchIn']): string {
  switch (matchIn) {
    case 'name':
      return 'nel nome'
    case 'definition':
      return 'nella definizione'
    case 'column':
      return 'nel nome della colonna'
    case 'data':
      return 'nei dati'
  }
}

/**
 * Chiave stabile di un risultato (per l'elenco e la selezione).
 *
 * Per colonne, vincoli e colonne calcolate il "nome" da solo NON identifica l'oggetto: due tabelle
 * possono avere una colonna con lo stesso nome (es. UDC_UDC in BCKUP_UDC e in DAT_UDC) e le due
 * righe finivano con la STESSA chiave. React segnalava "Encountered two children with the same key"
 * e non riusciva a riconciliare l'elenco: le righe vecchie restavano visibili anche dopo una nuova
 * ricerca (risultati che sembrano duplicati/accumulati). Qui si aggiunge la TABELLA proprietaria e,
 * per gli hit sui DATI, i valori della riga (lo stesso testo può comparire in più righe).
 */
export function hitKey(hit: TextSearchHit): string {
  const perTabella = hit.kind === 'column' || hit.kind === 'constraint' || hit.kind === 'computed'
  const proprietario = perTabella ? tableOfHit(hit) || hit.name : hit.name
  const parti = [hit.kind, hit.schema, proprietario, hit.name, hit.matchIn, String(hit.line ?? '')]
  if (hit.kind === 'data' && hit.row) parti.push(hit.row.values.map(v => String(v)).join('\u0001'))
  return parti.join('|')
}

/** Nome qualificato da mostrare (per i dati e le colonne è già tutto in `name`/`detail`). */
export function hitTitle(hit: TextSearchHit): string {
  if (hit.kind === 'data') return hit.name
  if (hit.kind === 'column') return hit.name
  return hit.schema === 'dbo' ? hit.name : `${hit.schema}.${hit.name}`
}

/**
 * True se per questo risultato si può mostrare la DEFINIZIONE (script) nell'anteprima.
 * Le colonne calcolate no: il nome è quello di una colonna, non di un oggetto con definizione
 * (per quelle l'anteprima mostra la tabella con la colonna in evidenza).
 */
export function canPreviewDefinition(kind: TextSearchHit['kind']): boolean {
  return kind === 'procedure' || kind === 'function' || kind === 'view' || kind === 'trigger'
    || kind === 'constraint'
}

/** True se per questo risultato l'anteprima è l'elenco delle colonne della tabella. */
export function canPreviewColumns(kind: TextSearchHit['kind']): boolean {
  return kind === 'table' || kind === 'column' || kind === 'computed'
}

/**
 * True se l'oggetto trovato si può MODIFICARE dalla ricerca (CREATE OR ALTER in una tab),
 * come la voce "Modifica" del tasto destro nell'albero: routine, viste e trigger.
 */
export function canEdit(kind: TextSearchHit['kind']): boolean {
  return kind === 'procedure' || kind === 'function' || kind === 'view' || kind === 'trigger'
}

/** Tipo di oggetto accettato da "Modifica" (le altre hit non sono modificabili da qui). */
export function editableKind(kind: TextSearchHit['kind']): 'procedure' | 'function' | 'view' | 'trigger' | null {
  return canEdit(kind) ? (kind as 'procedure' | 'function' | 'view' | 'trigger') : null
}

/** Etichetta del tipo per il titolo della tab aperta in modifica. */
export function editTabTitle(hit: TextSearchHit, mode: 'alter' | 'open'): string {
  const prefisso = mode === 'alter' ? 'CREATE OR ALTER ' : ''
  return `${prefisso}${hit.schema === 'dbo' ? hit.name : `${hit.schema}.${hit.name}`}`
}

/** Tabella a cui appartiene un risultato su colonna (dal `detail` del backend). */
export function tableOfHit(hit: TextSearchHit): string {
  if (hit.kind === 'table') return hit.name
  const m = /di\s+\S+\.(\S+)$/.exec(hit.detail)
  return m ? m[1] : ''
}

export interface HighlightPart {
  text: string
  /** True se questa parte è un'occorrenza del testo cercato (da evidenziare). */
  hit: boolean
}

/**
 * Spezza il testo nelle parti da evidenziare: ritorna i segmenti in ordine, con `hit = true`
 * sulle occorrenze del testo cercato (confronto senza distinzione di maiuscole).
 */
export function splitHighlight(text: string, query: string): HighlightPart[] {
  const q = query.trim()
  if (!q) return [{ text, hit: false }]
  const hay = text.toLowerCase()
  const needle = q.toLowerCase()
  const parti: HighlightPart[] = []
  let da = 0
  for (;;) {
    const at = hay.indexOf(needle, da)
    if (at === -1) break
    if (at > da) parti.push({ text: text.slice(da, at), hit: false })
    parti.push({ text: text.slice(at, at + needle.length), hit: true })
    da = at + needle.length
    // limite di sicurezza: un testo enorme con molte occorrenze non deve generare migliaia di nodi
    if (parti.length > 400) break
  }
  if (da < text.length) parti.push({ text: text.slice(da), hit: false })
  return parti.length > 0 ? parti : [{ text, hit: false }]
}

/** Riepilogo della ricerca: quanti risultati, in quanto tempo, quante tabelle scandite. */
export function searchMeta(r: TextSearchResult, conDati: boolean): string {
  const n = r.hits.length
  const parti = [`${n} ${n === 1 ? 'risultato' : 'risultati'}`, `${r.elapsedMs} ms`]
  if (conDati) parti.push(`${r.scannedTables} tabelle scandite su ${r.totalTables}`)
  if (r.truncated) parti.push('limite raggiunto: restringi la ricerca')
  return parti.join(' · ')
}

/** Plurale delle etichette (per il riepilogo). */
const PLURALE: Record<TextSearchHit['kind'], string> = {
  table: 'tabelle',
  view: 'viste',
  procedure: 'stored procedure',
  function: 'funzioni',
  trigger: 'trigger',
  column: 'colonne',
  constraint: 'vincoli',
  computed: 'colonne calcolate',
  data: 'dati',
}

/**
 * Conteggio per tipo, per l'intestazione dell'elenco:
 * "3 stored procedure · 1 colonna · 2 dati".
 */
export function countByKind(hits: TextSearchHit[]): string {
  const ordine: TextSearchHit['kind'][] = [
    'procedure', 'function', 'view', 'trigger', 'table', 'column', 'constraint', 'computed', 'data',
  ]
  const conteggi = new Map<TextSearchHit['kind'], number>()
  for (const h of hits) conteggi.set(h.kind, (conteggi.get(h.kind) ?? 0) + 1)
  return ordine
    .filter(k => (conteggi.get(k) ?? 0) > 0)
    .map(k => {
      const n = conteggi.get(k) ?? 0
      return `${n} ${n === 1 ? kindLabel(k).toLowerCase() : PLURALE[k]}`
    })
    .join(' · ')
}

// ---------- cronologia delle ricerche ----------

/** Quante ricerche si ricordano (richiesta utente: le ultime 10 parole cercate). */
export const MAX_RICERCHE_RICORDATE = 10

/** Chiave in localStorage della cronologia delle ricerche. */
export const SEARCH_HISTORY_KEY = 'sqlIntelli.searchHistory.v1'

/**
 * Aggiunge una ricerca in testa alla cronologia: la più recente per prima, senza duplicati
 * (confronto senza maiuscole) e con un tetto di MAX_RICERCHE_RICORDATE voci. Testi vuoti o
 * più corti di 2 caratteri (la stessa soglia della ricerca) vengono ignorati.
 */
export function pushSearchHistory(cronologia: string[], termine: string): string[] {
  const t = termine.trim()
  if (t.length < 2) return cronologia
  const senzaDuplicato = cronologia.filter(v => v.toLowerCase() !== t.toLowerCase())
  return [t, ...senzaDuplicato].slice(0, MAX_RICERCHE_RICORDATE)
}

/** Toglie una voce dalla cronologia (confronto senza maiuscole). */
export function removeFromSearchHistory(cronologia: string[], termine: string): string[] {
  return cronologia.filter(v => v.toLowerCase() !== termine.trim().toLowerCase())
}

/** Legge la cronologia salvata: accetta solo un array di stringhe valide (max 10). */
export function parseSearchHistory(raw: string | null): string[] {
  if (!raw) return []
  try {
    const dati: unknown = JSON.parse(raw)
    if (!Array.isArray(dati)) return []
    return dati
      .filter((v): v is string => typeof v === 'string')
      .map(v => v.trim())
      .filter(v => v.length >= 2)
      .slice(0, MAX_RICERCHE_RICORDATE)
  } catch {
    return []
  }
}
