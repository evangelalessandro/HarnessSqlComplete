// Persistenza delle tab dell'editor in localStorage: l'ultima query viene
// riproposta all'apertura.
import type { EditorTab } from './types'

const TABS_KEY = 'sqlIntelli.tabs.v1'

export interface PersistedTabs {
  tabs: EditorTab[]
  active: string
}

export function loadPersistedTabs(): PersistedTabs | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(TABS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedTabs
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null
    if (!parsed.tabs.some(t => t.id === parsed.active)) parsed.active = parsed.tabs[0].id
    return parsed
  } catch {
    return null
  }
}

export function persistTabs(tabs: EditorTab[], active: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, active }))
  } catch {
    /* storage pieno o disabilitato: ignora */
  }
}
