// Persistenza dei colori personalizzati per database (localStorage).
const KEY = 'sqlIntelli.dbColors.v1'

export function loadDbColors(): Record<string, string> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

export function saveDbColors(colors: Record<string, string>): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(KEY, JSON.stringify(colors))
  } catch {
    /* ignora */
  }
}
