// Tabelle "locali" definite nel testo dell'editor:
//   - temporanee:  CREATE TABLE #t (…),  SELECT … INTO #t FROM …,  INSERT INTO #t (…)
//   - variabili tabella: DECLARE @t TABLE (…),  INSERT INTO @t (…)
// L'intellisense le tratta come tabelle dello schema, così propone le loro colonne
// anche dentro il batch/routine che le crea (es. "… JOIN #TBL_X t WHERE ").
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

/** True se il nome è una tabella locale: #temp, ##globale o @variabileTabella. */
export function isLocalTableName(name: string): boolean {
  return name.startsWith('#') || name.startsWith('@')
}

/**
 * Nome della tabella a partire dal token: il tokenizer NON include la '@' negli
 * identificatori ("@tbl" → token "tbl"), quindi la si riattacca leggendo il testo.
 */
function nameAt(text: string, tok: { start: number; text: string }): string {
  return text[tok.start - 1] === '@' ? `@${tok.text}` : tok.text
}

/** Parole che chiudono la definizione del tipo in una colonna. */
const TYPE_STOP =
  /\s+(?:NOT|NULL|DEFAULT|PRIMARY|FOREIGN|UNIQUE|CHECK|REFERENCES|COLLATE|CONSTRAINT|IDENTITY|SPARSE|ROWGUIDCOL|WITH|ON|ASC|DESC)\b/i

/**
 * Colonne da una lista "nome tipo, nome tipo, …": il tipo conserva le parentesi
 * (NVARCHAR(50)) e si ferma alle parole chiave di vincolo (NOT NULL, DEFAULT…).
 */
export function parseColumnDefs(defs: string): ColumnInfo[] {
  const cols: ColumnInfo[] = []
  for (const part of splitTopLevel(defs)) {
    const words = tokenizeSql(part)
    if (words.length === 0) continue
    const nameTok = words[0]
    if (/^(constraint|primary|foreign|unique|check)$/i.test(nameTok.text)) continue
    if (nameTok.text.startsWith('@')) continue
    const rest = part.slice(nameTok.end).replace(/^\s+/, '')
    const dataType = rest.split(TYPE_STOP)[0].trim()
    cols.push(makeColumn(nameTok.text, dataType))
  }
  return cols
}

/** Divide una lista per virgole a livello 0 (parentesi bilanciate, ignora stringhe/commenti). */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < text.length; i++) {
    const skipped = skipNoise(text, i)
    if (skipped !== i) {
      cur += text.slice(i, skipped)
      i = skipped - 1
      continue
    }
    const ch = text[i]
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
  return parts
}

function makeColumn(name: string, dataType: string): ColumnInfo {
  return {
    name,
    dataType,
    isNullable: true,
    isIdentity: false,
    isComputed: false,
    maxLength: null,
    description: null,
    extendedProperties: null,
  }
}

/**
 * Nomi delle colonne di una select-list (per "SELECT … INTO #t"):
 * "col", "a.col", "expr AS alias", "expr alias" → nome; espressioni senza alias → ignorate
 * (SQL Server non assegna loro un nome).
 */
export function parseSelectListNames(list: string): string[] {
  const out: string[] = []
  for (const raw of splitTopLevel(list)) {
    const item = raw.replace(/^\s*(?:DISTINCT|ALL)\s+/i, '').trim()
    if (!item || item === '*') continue
    const words = tokenizeSql(item)
    if (words.length === 0) continue
    const asIdx = words.findIndex(w => w.lower === 'as')
    if (asIdx !== -1 && words[asIdx + 1]) {
      out.push(words[asIdx + 1].text)
      continue
    }
    // nome semplice (eventualmente qualificato) o "espressione alias" senza operatori
    const simple = /^(?:\[[^\]]+\]|[A-Za-z_@#][\w#$@]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_@#][\w#$@]*))?$/
    if (simple.test(item)) {
      out.push(words[words.length - 1].text)
      continue
    }
    const hasOperators = /[+\-*/%()=<>]/.test(item)
    if (!hasOperators && words.length >= 2) out.push(words[words.length - 1].text)
  }
  return out
}

/** Trova l'indice del token '(' della lista, se il segmento è "nome (" (senza righe di mezzo). */
function columnListOf(text: string, nameTokEnd: number): ColumnInfo[] {
  const open = findOpenParen(text, nameTokEnd)
  if (open === -1) return []
  const close = matchParen(text, open)
  if (close === -1) return []
  return parseColumnDefs(text.slice(open + 1, close))
}

/**
 * Tabelle locali definite nel testo. Le definizioni dentro commenti/stringhe sono
 * ignorate; se la stessa tabella è definita più volte le colonne vengono UNITE
 * (vince il tipo già noto). Per "SELECT * INTO #t FROM x" le colonne sono copiate
 * da `knownTables` quando la tabella sorgente è nota.
 */
export function extractLocalTables(text: string, knownTables: TableInfo[] = []): TableInfo[] {
  const tokens = tokenizeSql(text)
  const byName = new Map<string, TableInfo>()

  const ensure = (name: string): TableInfo => {
    const key = name.toLowerCase()
    let t = byName.get(key)
    if (!t) {
      t = {
        schema: 'dbo',
        name,
        columnCount: 0,
        createDate: null,
        columns: [],
        usage: null,
        extendedProperties: null,
      }
      byName.set(key, t)
    }
    return t
  }
  const addColumn = (table: TableInfo, col: ColumnInfo) => {
    const cols = table.columns ?? (table.columns = [])
    const existing = cols.find(c => c.name.toLowerCase() === col.name.toLowerCase())
    if (existing) {
      if (!existing.dataType && col.dataType) existing.dataType = col.dataType
      return
    }
    cols.push(col)
    table.columnCount = cols.length
  }

  const findByLower = (name: string) => knownTables.find(t => t.name.toLowerCase() === name.toLowerCase())

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i]

    // 1) CREATE TABLE #t (…)
    if (tk.lower === 'create') {
      let k = i + 1
      while (k < tokens.length && (tokens[k].lower === 'global' || tokens[k].lower === 'temporary')) k++
      if (tokens[k]?.lower === 'table') {
        const nameTok = tokens[k + 1]
        const name = nameTok ? nameAt(text, nameTok) : ''
        if (nameTok && isLocalTableName(name)) {
          const cols = columnListOf(text, nameTok.end)
          const table = ensure(name)
          for (const c of cols) addColumn(table, c)
        }
      }
      continue
    }

    // 2) DECLARE @t TABLE (…)
    if (tk.lower === 'declare') {
      for (let k = i + 1; k < tokens.length && tokens[k].lower !== 'select'; k++) {
        if (tokens[k].lower === 'table') {
          const nameTok = tokens[k - 1]
          const name = nameTok ? nameAt(text, nameTok) : ''
          if (nameTok && name.startsWith('@')) {
            const cols = columnListOf(text, tokens[k].end)
            const table = ensure(name)
            for (const c of cols) addColumn(table, c)
          }
          break
        }
      }
      continue
    }

    // 3) SELECT … INTO #t FROM …  (+ "SELECT * INTO #t FROM x" → colonne da x)
    if (tk.lower === 'into' && i > 0) {
      const nameTok = tokens[i + 1]
      const intoName = nameTok ? nameAt(text, nameTok) : ''
      if (nameTok && isLocalTableName(intoName)) {
        // inizio dello statement: l'ultimo SELECT/DECLARE/CREATE prima di INTO
        let start = -1
        for (let k = i - 1; k >= 0; k--) {
          const u = tokens[k].lower
          if (u === 'select' || u === 'insert' || u === 'update' || u === 'declare' || u === 'create') {
            start = k
            break
          }
        }
        const isSelectInto = start !== -1 && tokens[start].lower === 'select'
        const table = ensure(intoName)
        if (isSelectInto) {
          const listText = text.slice(tokens[start].end, tk.start)
          const names = parseSelectListNames(listText)
          if (names.length > 0) {
            for (const n of names) addColumn(table, makeColumn(n, ''))
          } else if (listText.includes('*')) {
            // "SELECT * INTO #t FROM x": copia le colonne della sorgente
            const fromTok = tokens.find((t, idx) => idx > i && t.lower === 'from')
            const srcName = fromTok ? tokens[tokens.indexOf(fromTok) + 1] : undefined
            const src = srcName ? findByLower(srcName.text) : undefined
            for (const c of src?.columns ?? []) addColumn(table, makeColumn(c.name, c.dataType))
          }
        }
        continue
      }
    }

    // 4) INSERT INTO #t (col, …) / INSERT INTO @t (col, …) → le colonne citate esistono
    if (tk.lower === 'insert' && tokens[i + 1]?.lower === 'into') {
      const nameTok = tokens[i + 2]
      const insName = nameTok ? nameAt(text, nameTok) : ''
      if (nameTok && isLocalTableName(insName)) {
        const table = ensure(insName)
        const open = findOpenParen(text, nameTok.end)
        if (open !== -1) {
          const close = matchParen(text, open)
          if (close !== -1) {
            for (const part of splitTopLevel(text.slice(open + 1, close))) {
              const words = tokenizeSql(part)
              const first = words[0]
              if (first && !first.text.startsWith('@')) addColumn(table, makeColumn(first.text, ''))
            }
          }
        }
        continue
      }
    }
  }

  // le tabelle senza colonne note non servono (nessun suggerimento possibile)
  return [...byName.values()].filter(t => (t.columns?.length ?? 0) > 0)
}
