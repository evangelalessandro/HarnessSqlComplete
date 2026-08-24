// Cronologia utente: ricorda le tabelle e le colonne usate nelle query eseguite,
// così i suggerimenti pesano di più ciò che l'utente usa davvero.

const TABLES_KEY = 'sql-intelli:history:tables'
const COLUMNS_KEY = 'sql-intelli:history:columns'
const MAX_ENTRIES = 200

/** Legge una mappa nome→conteggio dal localStorage (safe, mai lancia). */
function readMap(key: string): Map<string, number> {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return new Map()
    const obj = JSON.parse(raw) as Record<string, number>
    return new Map(Object.entries(obj).filter(([, v]) => typeof v === 'number'))
  } catch {
    return new Map()
  }
}

function writeMap(key: string, map: Map<string, number>): void {
  try {
    const obj: Record<string, number> = {}
    // mantiene solo le voci con conteggio più alto
    const entries = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_ENTRIES)
    for (const [k, v] of entries) obj[k] = v
    localStorage.setItem(key, JSON.stringify(obj))
  } catch {
    /* storage pieno o disabilitato: ignora */
  }
}

/** Incrementa il conteggio di una tabella usata (nome minuscolo). */
export function recordTableUse(tableName: string): void {
  if (!tableName) return
  const map = readMap(TABLES_KEY)
  map.set(tableName.toLowerCase(), (map.get(tableName.toLowerCase()) ?? 0) + 1)
  writeMap(TABLES_KEY, map)
}

/** Incrementa il conteggio di una colonna usata (nome minuscolo). */
export function recordColumnUse(columnName: string): void {
  if (!columnName) return
  const map = readMap(COLUMNS_KEY)
  map.set(columnName.toLowerCase(), (map.get(columnName.toLowerCase()) ?? 0) + 1)
  writeMap(COLUMNS_KEY, map)
}

/** Conteggio di utilizzo di una tabella (0 se mai usata). */
export function tableUseCount(tableName: string): number {
  return readMap(TABLES_KEY).get(tableName.toLowerCase()) ?? 0
}

/** Conteggio di utilizzo di una colonna (0 se mai usata). */
export function columnUseCount(columnName: string): number {
  return readMap(COLUMNS_KEY).get(columnName.toLowerCase()) ?? 0
}

/** Boost di ranking per una tabella in base alla cronologia (0..1, in scala log). */
export function historyTableBoost(tableName: string): number {
  const n = tableUseCount(tableName)
  return n > 0 ? Math.min(1, Math.log10(n + 1) / 3) : 0
}

/** Boost di ranking per una colonna in base alla cronologia (0..1). */
export function historyColumnBoost(columnName: string): number {
  const n = columnUseCount(columnName)
  return n > 0 ? Math.min(1, Math.log10(n + 1) / 3) : 0
}

/** Estrae i nomi di tabella (minuscoli) da un testo SQL e li registra nella cronologia. */
export function recordTablesFromSql(sql: string): string[] {
  const re = /\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+((?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*))?)/gi
  const found: string[] = []
  const seen = new Set<string>()
  for (const m of sql.matchAll(re)) {
    const token = m[1].replace(/[\[\]\s]/g, '')
    const name = token.split('.').pop()?.toLowerCase() ?? ''
    if (name && !seen.has(name)) {
      seen.add(name)
      recordTableUse(name)
      found.push(name)
    }
  }
  return found
}

/** Azzera la cronologia (usato nei test e da un eventuale comando). */
export function clearHistory(): void {
  try {
    localStorage.removeItem(TABLES_KEY)
    localStorage.removeItem(COLUMNS_KEY)
  } catch {
    /* ignora */
  }
}
