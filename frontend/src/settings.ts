// Impostazioni dell'editor (dimensione testo e tema) persistite in localStorage.
const KEY = 'sqlIntelli.settings.v1'

export interface EditorSettings {
  fontSize: number
  theme: 'vs' | 'vs-dark'
}

const DEFAULTS: EditorSettings = { fontSize: 13, theme: 'vs-dark' }

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
