// Impostazioni dell'editor (dimensione testo, tema, posizione delle nuove tab) in localStorage.
import type { NewTabPosition } from './tabOps'

const KEY = 'sqlIntelli.settings.v1'

export interface EditorSettings {
  fontSize: number
  theme: 'vs' | 'vs-dark'
  /** Dove aprire le nuove tab: a sinistra ('start'), dopo quella attiva o in fondo. */
  newTabPosition: NewTabPosition
}

const DEFAULTS: EditorSettings = { fontSize: 13, theme: 'vs-dark', newTabPosition: 'afterActive' }

/** Posizioni valide per le nuove tab (usato per validare il valore salvato). */
const TAB_POSITIONS: NewTabPosition[] = ['start', 'afterActive', 'end']

export function loadSettings(): EditorSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULTS }
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const p = JSON.parse(raw) as Partial<EditorSettings>
    return {
      fontSize:
        typeof p.fontSize === 'number' && p.fontSize >= 8 && p.fontSize <= 40 ? p.fontSize : DEFAULTS.fontSize,
      theme: p.theme === 'vs' ? 'vs' : 'vs-dark',
      newTabPosition: TAB_POSITIONS.includes(p.newTabPosition as NewTabPosition)
        ? (p.newTabPosition as NewTabPosition)
        : DEFAULTS.newTabPosition,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: EditorSettings): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignora */
  }
}
