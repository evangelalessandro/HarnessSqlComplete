// Azioni di chiusura multipla delle tab in stile SSMS (tasto destro su una tab):
// logica PURA e testabile. Le tab APPUNTATE non vengono mai chiuse da queste azioni
// (come in SSMS: il pin protegge la tab dalla chiusura di massa).

import type { EditorTab } from './types'

export type TabCloseMode = 'left' | 'right' | 'others' | 'unpinned'

export interface TabClosePlan {
  /** Tab che restano aperte (in ordine). */
  kept: EditorTab[]
  /** Id delle tab chiuse (da ripulire nei dati laterali: risultati, sql…). */
  removedIds: string[]
  /**
   * Tab su cui spostare il focus quando quella attiva viene chiusa:
   * preferisce la tab su cui è stato fatto il tasto destro, altrimenti la prima
   * superstite; '' se non resta nessuna tab.
   */
  focusId: string
}

/**
 * Calcola le tab da chiudere:
 * - 'right' / 'left': le non appuntate a destra / sinistra di `anchorId`;
 * - 'others': tutte le non appuntate TRANNE `anchorId`;
 * - 'unpinned': tutte le non appuntate (ovunque).
 */
export function buildTabClosePlan(tabs: EditorTab[], anchorId: string, mode: TabCloseMode): TabClosePlan {
  const anchor = tabs.findIndex(t => t.id === anchorId)
  const removedIds: string[] = []
  const kept: EditorTab[] = []
  tabs.forEach((t, idx) => {
    const closable =
      !t.pinned &&
      (mode === 'unpinned'
        ? true
        : mode === 'others'
          ? idx !== anchor
          : mode === 'left'
            ? idx < anchor
            : idx > anchor)
    if (closable) removedIds.push(t.id)
    else kept.push(t)
  })
  const keptIds = new Set(kept.map(t => t.id))
  const focusId = keptIds.has(anchorId) ? anchorId : kept.length > 0 ? kept[0].id : ''
  return { kept, removedIds, focusId }
}

/** Quante tab non appuntate chiuderebbe l'azione (per disabilitare le voci vuote). */
export function countClosableTabs(tabs: EditorTab[], anchorId: string, mode: TabCloseMode): number {
  const anchor = tabs.findIndex(t => t.id === anchorId)
  return tabs.reduce((acc, t, idx) => {
    if (t.pinned) return acc
    switch (mode) {
      case 'unpinned':
        return acc + 1
      case 'others':
        return acc + (idx !== anchor ? 1 : 0)
      case 'left':
        return acc + (idx < anchor ? 1 : 0)
      case 'right':
        return acc + (idx > anchor ? 1 : 0)
    }
  }, 0)
}

/** Dove inserire una nuova tab: all'inizio (a sinistra), dopo quella attiva, oppure in fondo. */
export type NewTabPosition = 'start' | 'afterActive' | 'end'

/**
 * Posizione in cui inserire una nuova tab.
 * - `start`: come PRIMA tab, cioè tutto a sinistra (tab A B C → N A B C);
 * - `afterActive`: subito dopo quella attiva, l'ultima aperta (A B C con attiva B → A B N C);
 * - `end`: in fondo, a destra (A B C → A B C N).
 * Se non c'è una tab attiva (o non esiste più), `afterActive` accoda in fondo.
 */
export function newTabIndexFor(tabs: EditorTab[], activeId: string, position: NewTabPosition): number {
  if (position === 'start') return 0
  if (position === 'end') return tabs.length
  const active = tabs.findIndex(t => t.id === activeId)
  return active === -1 ? tabs.length : active + 1
}

/** Inserisce la nuova tab nella posizione richiesta, senza spostare le altre. */
export function insertTabAt(
  tabs: EditorTab[],
  tab: EditorTab,
  activeId: string,
  position: NewTabPosition = 'afterActive',
): EditorTab[] {
  const at = newTabIndexFor(tabs, activeId, position)
  return [...tabs.slice(0, at), tab, ...tabs.slice(at)]
}

/** Posizione in cui inserire una nuova tab: SUBITO DOPO quella attiva (l'ultima aperta). */
export function newTabIndex(tabs: EditorTab[], activeId: string): number {
  return newTabIndexFor(tabs, activeId, 'afterActive')
}

/** Inserisce la nuova tab dopo quella attiva, senza modificare l'ordine delle altre. */
export function insertTabAfterActive(tabs: EditorTab[], tab: EditorTab, activeId: string): EditorTab[] {
  return insertTabAt(tabs, tab, activeId, 'afterActive')
}

/**
 * Indice della tab di RICERCA già aperta (-1 se non c'è): la ricerca vive in una tab e non va
 * duplicata — se c'è, la si riporta semplicemente in primo piano.
 */
export function searchTabIndex(tabs: EditorTab[]): number {
  return tabs.findIndex(t => t.kind === 'search')
}
