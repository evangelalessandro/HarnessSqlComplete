// Persistenza delle tab dell'editor in localStorage, SEPARATA per istanza SQL:
// le query aperte su "localhost\SQL2022" non compaiono su ".\sql2019dev".
import type { EditorTab } from './types'

const TAB_KEY_PREFIX = 'sqlIntelli.tabs.v1.'

export interface PersistedTabs {
  tabs: EditorTab[]
  active: string
}

/** Chiave stabile per istanza SQL (es. "localhost\SQL2022" → "localhost_sql2022"). */
export function instanceKey(instance: string): string {
  return instance.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_')
}

export function loadPersistedTabs(instance: string): PersistedTabs | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(TAB_KEY_PREFIX + instanceKey(instance))
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedTabs
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null
    if (!parsed.tabs.some(t => t.id === parsed.active)) parsed.active = parsed.tabs[0].id
    return parsed
  } catch {
    return null
  }
}

export function persistTabs(instance: string, tabs: EditorTab[], active: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(TAB_KEY_PREFIX + instanceKey(instance), JSON.stringify({ tabs, active }))
  } catch {
    /* storage pieno o disabilitato: ignora */
  }
}
