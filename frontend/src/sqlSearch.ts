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

/** Chiave stabile di un risultato (per l'elenco e la selezione). */
export function hitKey(hit: TextSearchHit): string {
  return `${hit.kind}|${hit.schema}|${hit.name}|${hit.matchIn}|${hit.line ?? ''}`
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
