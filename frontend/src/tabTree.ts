// GERARCHIA DELLE TAB (richiesta utente): una tab aperta da un link (tasto destro su tabella,
// store, funzione, diagramma, oppure un link nei messaggi d'errore) diventa FIGLIA di quella
// attiva, così le figlie restano raggruppate sotto la loro principale.
//
// Regole:
// - massimo MAX_TAB_DEPTH livelli sotto la principale; oltre il limite la nuova tab diventa
//   una SORELLA dell'ultima (non si scava oltre);
// - trascinando una tab la si STACCA dal padre: torna principale, cioè "in prima linea",
//   e si porta dietro le sue figlie;
// - chiudendo una principale si chiede se chiudere anche le figlie ancora aperte.
//
// Tutta la logica qui è PURA (nessun React): si testa da sola.

import type { EditorTab } from './types'

/** Livelli massimi di annidamento sotto una tab principale. */
export const MAX_TAB_DEPTH = 5

function mappaPerId(tabs: EditorTab[]): Map<string, EditorTab> {
  const m = new Map<string, EditorTab>()
  for (const t of tabs) m.set(t.id, t)
  return m
}

/**
 * Livello di annidamento (0 = principale). Un padre mancante (tab chiusa) o un ciclo
 * valgono 0: la tab torna di fatto principale.
 */
export function tabDepth(tabs: EditorTab[], id: string): number {
  const map = mappaPerId(tabs)
  const visti = new Set<string>([id])
  let livello = 0
  let padreId = map.get(id)?.parentId
  while (padreId) {
    if (visti.has(padreId)) return 0 // ciclo
    const padre = map.get(padreId)
    if (!padre) return 0 // padre chiuso
    visti.add(padreId)
    livello++
    padreId = padre.parentId
  }
  return livello
}

/** Id della tab e di tutte le sue discendenti (figlie, nipoti…), nell'ordine dell'array. */
export function subtreeIds(tabs: EditorTab[], id: string): string[] {
  const dentro = new Set<string>([id])
  let aggiunto = true
  while (aggiunto) {
    aggiunto = false
    for (const t of tabs) {
      if (t.parentId && dentro.has(t.parentId) && !dentro.has(t.id)) {
        dentro.add(t.id)
        aggiunto = true
      }
    }
  }
  return tabs.filter(t => dentro.has(t.id)).map(t => t.id)
}

/** Figlie DIRETTE ancora aperte. */
export function directChildren(tabs: EditorTab[], id: string): EditorTab[] {
  return tabs.filter(t => t.parentId === id)
}

/** Tutte le discendenti (figlie, nipoti…) ancora aperte. */
export function descendants(tabs: EditorTab[], id: string): EditorTab[] {
  const ids = new Set(subtreeIds(tabs, id))
  ids.delete(id)
  return tabs.filter(t => ids.has(t.id))
}

/**
 * Padre da usare per una nuova tab aperta come figlia di quella attiva:
 * - nessuna tab attiva (o attiva sparita) → undefined: la nuova tab è principale;
 * - la tab attiva è già al livello massimo → si usa il SUO padre (diventa una sorella):
 *   così il massimo resta di MAX_TAB_DEPTH livelli sotto la principale.
 */
export function childParentFor(tabs: EditorTab[], activeId: string): string | undefined {
  const attiva = tabs.find(t => t.id === activeId)
  if (!attiva) return undefined
  if (tabDepth(tabs, attiva.id) < MAX_TAB_DEPTH) return attiva.id
  return attiva.parentId
}

/**
 * Inserisce `tab` come figlia di `parentId`, in fondo al gruppo del padre (dopo l'ultima
 * discendente): le figlie restano attaccate alla loro principale. Se il padre non esiste,
 * la tab resta principale e viene accodata.
 */
export function insertTabAsChild(tabs: EditorTab[], tab: EditorTab, parentId: string): EditorTab[] {
  if (!tabs.some(t => t.id === parentId)) return [...tabs, tab]
  const gruppo = subtreeIds(tabs, parentId)
  const ultimo = gruppo[gruppo.length - 1]
  const at = ultimo ? tabs.findIndex(t => t.id === ultimo) + 1 : tabs.length
  const nuova: EditorTab = { ...tab, parentId }
  return [...tabs.slice(0, at), nuova, ...tabs.slice(at)]
}

/**
 * Sposta la tab (con le sue figlie) davanti a `toId` e la STACCA dal padre: trascinare una
 * tab la riporta principale, quindi anche "in prima linea". Non si sposta un gruppo dentro
 * se stesso.
 */
/**
 * Tab da mandare A CAPO nella barra: `true` quando il livello cambia rispetto alla tab
 * precedente. Serve a mettere le FIGLIE su una riga SOTTO la madre (richiesta utente): le
 * radici stanno sulla prima riga, le figlie di un gruppo sulla riga successiva, i nipoti
 * ancora sotto, e si torna a capo quando il gruppo finisce.
 */
export function tabRowBreaks(tabs: EditorTab[], depthOf: (t: EditorTab) => number): boolean[] {
  return tabs.map((t, i) => depthOf(t) !== (i > 0 ? depthOf(tabs[i - 1]) : 0))
}

/** Quante righe servono alla barra con questa gerarchia (1 + i cambi di livello). */
export function tabRowsNeeded(tabs: EditorTab[], depthOf: (t: EditorTab) => number): number {
  return Math.max(1, tabRowBreaks(tabs, depthOf).filter(Boolean).length + 1)
}

export function moveTabSubtree(tabs: EditorTab[], fromId: string, toId: string): EditorTab[] {
  if (fromId === toId) return tabs
  if (!tabs.some(t => t.id === fromId) || !tabs.some(t => t.id === toId)) return tabs
  const gruppo = new Set(subtreeIds(tabs, fromId))
  if (gruppo.has(toId)) return tabs // dentro il proprio gruppo: nessun effetto
  const resto = tabs.filter(t => !gruppo.has(t.id))
  const at = resto.findIndex(t => t.id === toId)
  if (at === -1) return tabs
  const mosse = tabs
    .filter(t => gruppo.has(t.id))
    .map(t => (t.id === fromId ? { ...t, parentId: undefined } : t))
  return [...resto.slice(0, at), ...mosse, ...resto.slice(at)]
}

/**
 * Tab da rimuovere chiudendo `id`: solo lei, oppure anche le sue discendenti.
 */
export function closeTabIds(tabs: EditorTab[], id: string, conFiglie: boolean): string[] {
  return conFiglie ? subtreeIds(tabs, id) : [id]
}

/**
 * Toglie i legami non più validi (padre chiuso, ciclo, oppure livello oltre il massimo —
 * es. tab lette da localStorage): le tab coinvolte tornano principali, invece di restare
 * appese a un padre che non c'è.
 */
export function sanitizeTabParents(tabs: EditorTab[]): EditorTab[] {
  const map = mappaPerId(tabs)
  const daStaccare = new Set<string>()
  for (const t of tabs) {
    const antenati: string[] = []
    const visti = new Set<string>()
    let corrente: EditorTab | undefined = t
    while (corrente && corrente.parentId) {
      if (visti.has(corrente.id)) {
        daStaccare.add(corrente.id) // ciclo
        break
      }
      visti.add(corrente.id)
      const padre = map.get(corrente.parentId)
      if (!padre) {
        daStaccare.add(corrente.id) // padre chiuso
        break
      }
      antenati.push(padre.id)
      corrente = padre
    }
    // antenati = dal più vicino al più lontano; il livello della tab è antenati.length.
    // Per riportare la tab entro il massimo si stacca il legame dell'antenato che sta al
    // livello massimo: dopo il taglio i suoi antenati sono esattamente MAX_TAB_DEPTH.
    if (antenati.length > MAX_TAB_DEPTH) daStaccare.add(antenati[MAX_TAB_DEPTH - 1])
  }
  if (daStaccare.size === 0) return tabs
  return tabs.map(t => (daStaccare.has(t.id) ? { ...t, parentId: undefined } : t))
}
