// Tabelle TEMPORANEE definite nel testo dell'editor (#temp, ##globale):
// l'intellisense le tratta come tabelle dello schema, così propone le loro colonne
// anche dentro il batch che le crea (es. "CREATE TABLE #t (a int) … WHERE ").
// Logica PURA e testabile: nessuna dipendenza da Monaco o dal backend.

import { tokenizeSql } from './helpers'
import type { ColumnInfo, TableInfo } from './types'

/** Salta stringhe e commenti a partire da `i` (ritorna l'indice successivo, o `i`). */
function skipNoise(text: string, i: number): number {
  const n = text.length
  const ch = text[i]
  if (ch === "'" || ch === '"') {
    let k = i + 1
    while (k < n) {
      if (text[k] === ch) {
        if (text[k + 1] === ch) {
          k += 2
          continue
        }
        return k + 1
      }
      k++
    }
    return n
  }
  if (ch === '-' && text[i + 1] === '-') {
    const eol = text.indexOf('\n', i)
    return eol === -1 ? n : eol + 1
  }
  if (ch === '/' && text[i + 1] === '*') {
    const end = text.indexOf('*/', i + 2)
    return end === -1 ? n : end + 2
  }
  return i
}

/** Indice della prossima '(' fuori da stringhe/commenti (o -1). */
function findOpenParen(text: string, from: number): number {
  const n = text.length
  let i = from
  while (i < n) {
    const skipped = skipNoise(text, i)
    if (skipped !== i) {
      i = skipped
      continue
    }
    const ch = text[i]
    if (ch === '(') return i
    // fine dello statement o parentesi chiusa prima di una lista colonne → non è CREATE TABLE
    if (ch === ';' || ch === ')' || ch === '\n') return -1
    i++
  }
  return -1
}

/** Indice della ')' che chiude quella aperta in `openIndex` (o -1). */
function matchParen(text: string, openIndex: number): number {
  const n = text.length
  let depth = 0
  let i = openIndex
  while (i < n) {
    const skipped = skipNoise(text, i)
    if (skipped !== i) {
      i = skipped
      continue
    }
    const ch = text[i]
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

/** Parole che chiudono la definizione del tipo in una colonna. */
const TYPE_STOP =
  /\s+(?:NOT|NULL|DEFAULT|PRIMARY|FOREIGN|UNIQUE|CHECK|REFERENCES|COLLATE|CONSTRAINT|IDENTITY|SPARSE|ROWGUIDCOL|WITH|ON|ASC|DESC)\b/i

/**
 * Colonne da una lista "nome tipo, nome tipo, …": il tipo conserva le parentesi
 * (NVARCHAR(50)) e si ferma alle parole chiave di vincolo (NOT NULL, DEFAULT…).
 */
export function parseColumnDefs(defs: string): ColumnInfo[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < defs.length; i++) {
    const skipped = skipNoise(defs, i)
    if (skipped !== i) {
      cur += defs.slice(i, skipped)
      i = skipped - 1
      continue
    }
    const ch = defs[i]
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) parts.push(cur)

  const cols: ColumnInfo[] = []
  for (const part of parts) {
    const words = tokenizeSql(part)
    if (words.length === 0) continue
    const nameTok = words[0]
    if (/^(constraint|primary|foreign|unique|check)$/i.test(nameTok.text)) continue
    if (nameTok.text.startsWith('@')) continue
    const rest = part.slice(nameTok.end).replace(/^\s+/, '')
    const dataType = rest.split(TYPE_STOP)[0].trim()
    cols.push({
      name: nameTok.text,
      dataType,
      isNullable: true,
      isIdentity: false,
      isComputed: false,
      maxLength: null,
      description: undefined,
    })
  }
  return cols
}

/**
 * Tabelle temporanee definite nel testo (`CREATE TABLE #t (…)`, `##globale`).
 * Le definizioni dentro commenti/stringhe sono ignorate; l'ultima definizione
 * dello stesso nome vince.
 */
export function extractLocalTables(text: string): TableInfo[] {
  const tokens = tokenizeSql(text)
  const byName = new Map<string, TableInfo>()
  for (let idx = 0; idx < tokens.length; idx++) {
    if (tokens[idx].lower !== 'create') continue
    let k = idx + 1
    while (k < tokens.length && (tokens[k].lower === 'global' || tokens[k].lower === 'temporary')) k++
    if (tokens[k]?.lower !== 'table') continue
    const nameTok = tokens[k + 1]
    if (!nameTok || !nameTok.text.startsWith('#')) continue
    const open = findOpenParen(text, nameTok.end)
    if (open === -1) continue
    const close = matchParen(text, open)
    if (close === -1) continue
    const cols = parseColumnDefs(text.slice(open + 1, close))
    if (cols.length === 0) continue
    byName.set(nameTok.lower, {
      schema: 'dbo',
      name: nameTok.text,
      columnCount: cols.length,
      createDate: null,
      columns: cols,
      usage: null,
      extendedProperties: null,
    })
  }
  return [...byName.values()]
}
