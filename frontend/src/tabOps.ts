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
