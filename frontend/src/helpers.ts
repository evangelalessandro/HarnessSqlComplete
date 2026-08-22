import type { CellValue, ColumnInfo, DatabaseSummary, ForeignKeyInfo, ProcParamInfo, TableInfo, TableUsage } from './types'

/**
 * Identificatore SQL: restituisce il nome senza parentesi quadre se è "sicuro"
 * (solo lettere/cifre/underscore, non inizia con una cifra, non è una parola riservata),
 * altrimenti lo racchiude tra [parentesi quadre].
 */
export function sqlIdent(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !isSqlReserved(name)) return name
  return `[${name}]`
}

/** Restituisce il nome qualificato: schema.nome (senza parentesi se non necessarie; senza schema se dbo). */
export function qualified(schema: string, name: string): string {
  if (!schema || schema === 'dbo') return sqlIdent(name)
  return `${sqlIdent(schema)}.${sqlIdent(name)}`
}

/** Estrae i riferimenti a tabelle (FROM/JOIN/UPDATE/INTO) dal testo SQL prima del cursore (nomi in minuscolo). */
export function findTableRefs(text: string): string[] {
  const re = /\b(?:from|join|update|into|table)\s+((?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*))?)/gi
  const refs = new Set<string>()
  for (const m of text.matchAll(re)) {
    const token = m[1].replace(/[\[\]\s]/g, '')
    const name = token.split('.').pop() ?? ''
    if (name) refs.add(name.toLowerCase())
  }
  return [...refs]
}

// ---------- Ranking per utilizzo reale nel database ----------

/**
 * Punteggio di utilizzo di una tabella: le FK in entrata pesano di più
 * (essere referenziati = essere "usati"), seguono le FK in uscita, le
 * dipendenze da viste/procedure/trigger e le righe (in scala logaritmica).
 */
export function usageScore(u: TableUsage | null | undefined): number {
  if (!u) return 0
  return u.fkIncoming * 2 + u.fkOutgoing + u.dependencyCount + Math.log10(Math.max(1, u.rowCount)) * 3
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.', ',') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace('.', ',') + 'k'
  return String(n)
}

/** Riepilogo leggibile dell'utilizzo, es. "12 ref. · 3 join · 5 dip. · 1,2k righe". */
export function usageDetail(u: TableUsage | null | undefined): string {
  if (!u) return ''
  const parts: string[] = []
  if (u.fkIncoming > 0) parts.push(`${u.fkIncoming} ref.`)
  if (u.fkOutgoing > 0) parts.push(`${u.fkOutgoing} join`)
  if (u.dependencyCount > 0) parts.push(`${u.dependencyCount} dip.`)
  if (u.rowCount > 0) parts.push(`${formatCount(u.rowCount)} righe`)
  return parts.join(' · ')
}

export interface JoinHint {
  fk: ForeignKeyInfo
  /** 'out' = la tabella candidata è il lato che referenzia; 'in' = è il lato referenziato. */
  direction: 'out' | 'in'
}

export interface RankedTable {
  table: TableInfo
  score: number
  hints: JoinHint[]
}

/**
 * Ordina le tabelle per i suggerimenti di completamento:
 * 1) quelle collegate da FK alle tabelle già presenti nella query (boost forte),
 * 2) poi tutte le altre in base al punteggio di utilizzo reale nel database.
 */
export function rankTablesForJoin(
  tables: TableInfo[],
  foreignKeys: ForeignKeyInfo[],
  contextTables: string[],
): RankedTable[] {
  const ctx = new Set(contextTables.map(t => t.trim().toLowerCase()))
  return tables
    .filter(t => !ctx.has(t.name.toLowerCase()))
    .map(t => {
      const hints: JoinHint[] = []
      const name = t.name.toLowerCase()
      for (const fk of foreignKeys) {
        if (fk.table.toLowerCase() === name && ctx.has(fk.refTable.toLowerCase()))
          hints.push({ fk, direction: 'out' })
        else if (fk.refTable.toLowerCase() === name && ctx.has(fk.table.toLowerCase()))
          hints.push({ fk, direction: 'in' })
      }
      const score = hints.length * 1000 + usageScore(t.usage)
      return { table: t, score, hints }
    })
    .sort((a, b) => b.score - a.score)
}

/** Testo leggibile di una cella per griglie e tooltip. */
export function cellText(v: CellValue): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'boolean') return String(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Tabella markdown (GFM) dalle colonne/righe di un result set, per l'hover dell'editor. */
export function rowsToMarkdown(columns: string[], rows: CellValue[][], maxRows = 10): string {
  if (columns.length === 0) return ''
  const escape = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
  const header = `| ${columns.map(c => escape(c)).join(' | ')} |`
  const sep = `| ${columns.map(() => '---').join(' | ')} |`
  const body = rows
    .slice(0, maxRows)
    .map(row => `| ${columns.map((_, i) => escape(cellText(row[i]))).join(' | ')} |`)
    .join('\n')
  const more = rows.length > maxRows ? `\n\n_… altre ${rows.length - maxRows} righe (top ${maxRows})_` : ''
  return `${header}\n${sep}\n${body}${more}`
}

// ---------- Parsing INSERT (completamento colonne + evidenziazione valori corrispondenti) ----------

export interface InsertSlot {
  /** Offset assoluti nel testo (inclusivo di start, esclusivo di end). */
  start: number
  end: number
  text: string
}

/** Tupla di valori (VALUES) o lista del SELECT: parens dell'insieme + slot. */
export interface InsertTuple {
  /** Offset della parentesi aperta (-1 per la forma INSERT...SELECT). */
  open: number
  /** Offset della parentesi chiusa (null se non ancora chiusa). */
  close: number | null
  slots: InsertSlot[]
}

export interface InsertContext {
  schema: string | null
  table: string
  colOpen: number
  colClose: number | null
  columnSlots: InsertSlot[]
  valueTuples: InsertTuple[]
}

/** Trova la parentesi chiusa corrispondente, ignorando stringhe, N'...' e identificatori [..]. */
function findMatchingParen(text: string, openIndex: number): number | null {
  let depth = 0
  let quote: string | null = null
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) {
        if (text[i + 1] === quote) {
          i += 1 // '' = apostrofo sfuggito
          continue
        }
        quote = null
      }
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (ch === '[') {
      quote = ']'
      continue
    }
    if (ch === ']') {
      quote = null
      continue
    }
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return null
}

/** Divide un testo sulle virgole di primo livello (profondità 0, fuori da stringhe/bracket). */
function splitTopLevel(text: string): InsertSlot[] {
  const slots: InsertSlot[] = []
  let depth = 0
  let quote: string | null = null
  let slotStart = 0
  const pushSlot = (from: number, to: number) => {
    const raw = text.slice(from, to)
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      slots.push({ start: from, end: to, text: '' })
      return
    }
    const lead = raw.length - raw.trimStart().length
    slots.push({ start: from + lead, end: to - (raw.length - trimmed.length - lead), text: trimmed })
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) {
        if (text[i + 1] === quote) {
          i += 1
          continue
        }
        quote = null
      }
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (ch === '[') {
      quote = ']'
      continue
    }
    if (ch === ']') {
      quote = null
      continue
    }
    if (ch === '(') {
      depth += 1
      continue
    }
    if (ch === ')') {
      depth -= 1
      continue
    }
    if (ch === ',' && depth === 0) {
      pushSlot(slotStart, i)
      slotStart = i + 1
    }
  }
  pushSlot(slotStart, text.length)
  return slots
}

/**
 * Analizza il contesto INSERT INTO attorno al cursore (ultimo INSERT nel testo):
 * tabella, lista colonne e tuple VALUES (con offset assoluti = relativi + base).
 */
export function parseInsertContext(text: string, base = 0): InsertContext | null {
  const re = /\bINSERT\s+INTO\s+((?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*))?)/gi
  let m: RegExpExecArray | null
  let last: RegExpExecArray | null = null
  while ((m = re.exec(text)) !== null) last = m
  if (!last) return null

  const tableEnd = last.index + last[0].length
  const parts = last[1].replace(/[\[\]\s]/g, '').split('.')
  const schema = parts.length > 1 ? parts[0] : null
  const table = parts[parts.length - 1]

  const valuesIdx = text.search(/\bVALUES\b/i)
  const selectIdx = searchSelectKeyword(text, tableEnd)
  const firstParen = text.indexOf('(', tableEnd)
  let colOpen = -1
  let colClose: number | null = null
  // la parentesi è la lista colonne solo se precede VALUES/SELECT
  if (
    firstParen !== -1 &&
    (valuesIdx === -1 || firstParen < valuesIdx) &&
    (selectIdx === -1 || firstParen < selectIdx)
  ) {
    colOpen = firstParen
    colClose = findMatchingParen(text, firstParen)
  }

  const columnSlots: InsertSlot[] = []
  if (colOpen !== -1) {
    const innerEnd = colClose ?? text.length
    for (const s of splitTopLevel(text.slice(colOpen + 1, innerEnd))) {
      columnSlots.push({ start: colOpen + 1 + s.start + base, end: colOpen + 1 + s.end + base, text: s.text })
    }
  }

  const valueTuples: InsertTuple[] = []
  if (valuesIdx !== -1) {
    let i = valuesIdx + 'VALUES'.length
    while (i < text.length) {
      if (text[i] === '(') {
        const close = findMatchingParen(text, i)
        const end = close ?? text.length
        const slots = splitTopLevel(text.slice(i + 1, end)).map(s => ({
          start: i + 1 + s.start + base,
          end: i + 1 + s.end + base,
          text: s.text,
        }))
        valueTuples.push({ open: i + base, close: close === null ? null : close + base, slots })
        i = (close ?? end) + 1
      } else {
        i += 1
      }
    }
  } else if (selectIdx !== -1) {
    // INSERT ... SELECT: la lista del SELECT mappa posizionalmente sulle colonne
    const afterSelect = selectIdx + 'SELECT'.length
    const slots = splitTopLevel(text.slice(afterSelect)).map(s => ({
      start: afterSelect + s.start + base,
      end: afterSelect + s.end + base,
      text: s.text,
    }))
    valueTuples.push({ open: -1, close: -1, slots })
  }

  return {
    schema,
    table,
    colOpen: colOpen === -1 ? -1 : colOpen + base,
    colClose: colClose === null ? null : colClose + base,
    columnSlots,
    valueTuples,
  }
}

/** Trova l'istruzione INSERT INTO che contiene l'offset (fino al prossimo ';'). */
export function findInsertStatementAt(text: string, offset: number): { start: number; end: number } | null {
  const re = /\bINSERT\s+INTO\b/gi
  let m: RegExpExecArray | null
  let lastStart = -1
  while ((m = re.exec(text)) !== null) {
    if (m.index <= offset) lastStart = m.index
    else break
  }
  if (lastStart === -1) return null
  const semi = text.indexOf(';', lastStart)
  return { start: lastStart, end: semi === -1 ? text.length : semi }
}

/** Indice dello slot che contiene l'offset; altrimenti lo slot successivo (o l'ultimo). */
export function insertSlotIndexAt(slots: InsertSlot[], offset: number): number {
  for (let i = 0; i < slots.length; i++) {
    if (offset >= slots[i].start && offset <= slots[i].end) return i
  }
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].start > offset) return i
  }
  return slots.length - 1
}

/**
 * Campo "corrispondente" da evidenziare in un INSERT:
 * - cursore nella lista colonne → slot dello stesso indice nella prima tupla VALUES;
 * - cursore in una tupla VALUES → slot dello stesso indice nella lista colonne.
 * Restituisce il range assoluto da evidenziare, o null.
 */
export function insertCorrespondingTarget(text: string, cursorOffset: number): { start: number; end: number } | null {
  const stmt = findInsertStatementAt(text, cursorOffset)
  if (!stmt) return null
  const ctx = parseInsertContext(text.slice(stmt.start, stmt.end), stmt.start)
  if (!ctx) return null

  const inColumnList =
    ctx.colOpen !== -1 && cursorOffset >= ctx.colOpen && (ctx.colClose === null || cursorOffset <= ctx.colClose)
  if (inColumnList && ctx.columnSlots.length > 0) {
    const idx = insertSlotIndexAt(ctx.columnSlots, cursorOffset)
    const target = ctx.valueTuples[0]?.slots[idx]
    return target ? { start: target.start, end: target.end } : null
  }

  for (const tuple of ctx.valueTuples) {
    if (tuple.slots.length === 0) continue
    const tupleStart = tuple.slots[0].start
    const tupleEnd = tuple.slots[tuple.slots.length - 1].end
    if (cursorOffset >= tupleStart && cursorOffset <= tupleEnd) {
      const idx = insertSlotIndexAt(tuple.slots, cursorOffset)
      const target = ctx.columnSlots[idx]
      return target ? { start: target.start, end: target.end } : null
    }
  }

  return null
}

// ---------- Valori di default per INSERT (aiuto sui VALUES) ----------

/** Valore di default SQL per un tipo di colonna (NULL se nullable). */
export function sqlDefaultForType(dataType: string, nullable: boolean): string {
  if (nullable) return 'NULL'
  const t = dataType.toLowerCase()
  if (t.includes('int') || t.includes('bit')) return '0'
  if (t.includes('decimal') || t.includes('numeric') || t.includes('money') || t.includes('float') || t.includes('real')) return '0'
  if (t.includes('char') || t.includes('text') || t.includes('sysname')) return "''"
  if (t.includes('datetime') || t.includes('date') || t.includes('time')) return 'GETDATE()'
  if (t.includes('uniqueidentifier')) return 'NEWID()'
  if (t.includes('binary') || t.includes('image')) return '0x'
  return 'NULL'
}

/** Elenco valori di default (uno per colonna), per lo snippet "tutti i valori". */
export function buildInsertValues(columns: ColumnInfo[]): string {
  return columns.map(c => sqlDefaultForType(c.dataType, c.isNullable)).join(', ')
}

/** Colonna corrispondente allo slot i-esimo della tupla (per la lista colonne o per posizione). */
export function columnForInsertSlot(
  ctx: InsertContext,
  table: TableInfo | null,
  slotIdx: number,
): ColumnInfo | null {
  const columns = table?.columns ?? []
  if (ctx.columnSlots.length > 0) {
    const slot = ctx.columnSlots[slotIdx]
    if (!slot) return columns[slotIdx] ?? null
    const name = slot.text.replace(/[\[\]\s]/g, '')
    return columns.find(c => c.name.toLowerCase() === name.toLowerCase()) ?? columns[slotIdx] ?? null
  }
  return columns[slotIdx] ?? null
}

/** Tupla di valori che contiene l'offset (o null). */
export function insertTupleAt(ctx: InsertContext, offset: number): InsertTuple | null {
  for (const tuple of ctx.valueTuples) {
    if (tuple.open >= 0) {
      if (offset >= tuple.open && (tuple.close === null || offset <= tuple.close)) return tuple
    } else if (tuple.slots.length > 0) {
      const start = tuple.slots[0].start
      const end = tuple.slots[tuple.slots.length - 1].end
      if (offset >= start && offset <= end) return tuple
    }
  }
  return null
}

/** Range interno della tupla (dentro le parentesi) da sostituire con i valori di default. */
export function insertTupleInnerRange(tuple: InsertTuple): { start: number; end: number } {
  if (tuple.open >= 0) {
    const lastSlotEnd = tuple.slots[tuple.slots.length - 1]?.end ?? tuple.open + 1
    return { start: tuple.open + 1, end: tuple.close ?? lastSlotEnd }
  }
  // INSERT ... SELECT: sostituisce l'intera lista finora digitata
  if (tuple.slots.length === 0) return { start: -1, end: -1 }
  return { start: tuple.slots[0].start, end: tuple.slots[tuple.slots.length - 1].end }
}

// ---------- Parsing EXEC (autocompletamento parametri delle stored procedure) ----------

export interface ExecContext {
  schema: string | null
  name: string
  /** Offset della fine del nome procedura (dove iniziano i parametri). */
  nameEnd: number
}

/** Trova l'ultima chiamata EXEC/EXECUTE con nome procedura nel testo. */
export function findExecContext(text: string): ExecContext | null {
  const re = /\bEXEC(?:UTE)?\s+((?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*))?)/gi
  let m: RegExpExecArray | null
  let last: RegExpExecArray | null = null
  while ((m = re.exec(text)) !== null) last = m
  if (!last) return null
  const parts = last[1].replace(/[\[\]\s]/g, '').split('.')
  const schema = parts.length > 1 ? parts[0] : null
  return { schema, name: parts[parts.length - 1], nameEnd: last.index + last[0].length }
}

// ---------- Palette colori tabelle ----------

const TABLE_COLOR_PALETTE = [
  'sql-tbl-0',
  'sql-tbl-1',
  'sql-tbl-2',
  'sql-tbl-3',
  'sql-tbl-4',
  'sql-tbl-5',
  'sql-tbl-6',
  'sql-tbl-7',
  'sql-tbl-8',
  'sql-tbl-9',
  'sql-tbl-10',
  'sql-tbl-11',
]

/** Classe colore stabile per tabella (hash del nome): tabelle diverse → colori diversi. */
export function colorClassFor(tableKey: string): string {
  let h = 0
  for (let i = 0; i < tableKey.length; i++) h = (h * 31 + tableKey.charCodeAt(i)) >>> 0
  return TABLE_COLOR_PALETTE[h % TABLE_COLOR_PALETTE.length]
}

// ---------- Tokenizer SQL + colorazione tabelle/colonne ----------

export interface SqlToken {
  /** Offset assoluti nel testo. */
  start: number
  end: number
  text: string
  lower: string
  /** True se il token è preceduto da un punto (riferimento qualificato es. alias.col). */
  qualified: boolean
  /** Testo del token qualificatore (prima del punto), se presente. */
  qualifier: string | null
}

function skipSqlString(text: string, start: number): number {
  const q = text[start]
  let i = start + 1
  while (i < text.length) {
    if (text[i] === q) {
      if (text[i + 1] === q) {
        i += 2
        continue
      }
      return i + 1
    }
    i++
  }
  return text.length
}

/** Estrae gli identificatori (parole e [bracket]) dal testo, ignorando stringhe e commenti. */
export function tokenizeSql(text: string): SqlToken[] {
  const tokens: SqlToken[] = []
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    if (ch === "'" || ch === '"') {
      i = skipSqlString(text, i)
      continue
    }
    if (ch === '-' && text[i + 1] === '-') {
      while (i < n && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    if (ch === '[') {
      const end = text.indexOf(']', i + 1)
      if (end === -1) break
      const raw = text.slice(i, end + 1)
      const prev = tokens[tokens.length - 1]
      tokens.push({
        start: i,
        end: end + 1,
        text: raw.replace(/[\[\]]/g, ''),
        lower: raw.replace(/[\[\]]/g, '').toLowerCase(),
        qualified: i > 0 && text[i - 1] === '.',
        qualifier: i > 0 && text[i - 1] === '.' && prev && prev.end === i - 1 ? prev.text : null,
      })
      i = end + 1
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i
      while (j < n && /[A-Za-z0-9_]/.test(text[j])) j++
      const prev = tokens[tokens.length - 1]
      tokens.push({
        start: i,
        end: j,
        text: text.slice(i, j),
        lower: text.slice(i, j).toLowerCase(),
        qualified: i > 0 && text[i - 1] === '.',
        qualifier: i > 0 && text[i - 1] === '.' && prev && prev.end === i - 1 ? prev.text : null,
      })
      i = j
      continue
    }
    i++
  }
  return tokens
}

/** Offset di inizio di ogni statement SQL (dopo i ';' fuori da stringhe/commenti). */
export function findSqlStatementStarts(text: string): number[] {
  const starts = [0]
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    if (ch === "'" || ch === '"') {
      i = skipSqlString(text, i)
      continue
    }
    if (ch === '-' && text[i + 1] === '-') {
      while (i < n && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    if (ch === ';') {
      starts.push(i + 1)
      i++
      continue
    }
    i++
  }
  return starts
}

/** Range dello statement (tra ';') che contiene l'offset. */
export function statementRangeAt(text: string, offset: number): { start: number; end: number } {
  const starts = findSqlStatementStarts(text)
  let start = 0
  for (const s of starts) {
    if (s <= offset) start = s
    else break
  }
  let end = text.length
  for (const s of starts) {
    if (s > start) {
      end = s
      break
    }
  }
  return { start, end }
}

/** Indice dello statement (in `starts`) che contiene l'offset. */
export function statementIndexAt(starts: number[], offset: number): number {
  let lo = 0
  let hi = starts.length - 1
  let res = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (starts[mid] <= offset) {
      res = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return res
}

export interface StatementTableRef {
  tableName: string
  alias: string | null
}

/** Parole riservate SQL: mai usate come alias di tabella né come identificatori senza parentesi. */
const SQL_RESERVED = new Set([
  // JOIN / clausole
  'inner', 'left', 'right', 'cross', 'full', 'outer', 'join', 'on', 'where', 'and', 'or', 'not',
  'group', 'order', 'by', 'having', 'union', 'all', 'select', 'from', 'update', 'delete', 'insert',
  'into', 'set', 'values', 'as', 'with', 'option', 'for', 'when', 'then', 'else', 'end', 'case',
  'in', 'is', 'like', 'between', 'exists', 'top', 'distinct', 'apply', 'using', 'index', 'table',
  'go', 'limit', 'offset', 'fetch', 'over', 'partition', 'return', 'output', 'exec', 'execute',
  // parole riservate T-SQL comuni
  'user', 'primary', 'foreign', 'key', 'references', 'check', 'constraint', 'default', 'identity',
  'procedure', 'view', 'trigger', 'function', 'database', 'schema', 'transaction', 'commit',
  'rollback', 'save', 'goto', 'declare', 'print', 'if', 'else', 'while', 'break', 'continue',
  'waitfor', 'raiserror', 'throw', 'try', 'catch', 'cast', 'convert', 'null', 'true', 'false',
  'asc', 'desc', 'open', 'close', 'cursor', 'fetch', 'grant', 'revoke', 'deny', 'use', 'backup',
  'restore', 'kill', 'read', 'write', 'of', 'any', 'some', 'create', 'alter', 'drop', 'truncate',
  'begin', 'merge', 'row', 'rows', 'range', 'identity', 'noexpand', 'pivot', 'unpivot', 'revert',
  'cube', 'rollup', 'sys', 'rule', 'audit', 'contains', 'containstable', 'freetext', 'freetexttable',
])

export function isSqlReserved(word: string): boolean {
  return SQL_RESERVED.has(word.toLowerCase())
}

/** Trova la parola chiave SELECT a partire da un offset (ignorando i commenti). */
function searchSelectKeyword(text: string, from: number): number {
  const re = /\bSELECT\b/i
  let searchFrom = from
  // salta eventuali commenti -- tra nome tabella e SELECT
  for (;;) {
    const m = re.exec(text.slice(searchFrom))
    if (!m) return -1
    const at = searchFrom + m.index
    const lineStart = text.lastIndexOf('\n', at - 1) + 1
    const linePrefix = text.slice(lineStart, at)
    if (linePrefix.trimStart().startsWith('--')) {
      searchFrom = text.indexOf('\n', at)
      if (searchFrom === -1) return -1
      continue
    }
    return at
  }
}

/** Ordina i suggerimenti Monaco: rank minore = prima (sortText ascendente, 5 cifre). */
export function completionSortText(rank: number): string {
  return String(rank).padStart(5, '0')
}

/**
 * filterText per l'item di espansione '*': quando il cursore è DOPO l'asterisco,
 * Monaco filtra col testo tra '*' e cursore; restituiamo lo stesso testo per
 * garantire il match (altrimenti l'item sparisce dal widget).
 */
export function starFilterText(stmtText: string, starOffset: number, cursorRel: number): string | undefined {
  return cursorRel > starOffset ? stmtText.slice(starOffset, cursorRel) : undefined
}

// ---------- Colore delle tab in base al database ----------

const DB_TAB_COLORS = [
  '#f59e0b',
  '#38bdf8',
  '#34d399',
  '#a78bfa',
  '#fb7185',
  '#2dd4bf',
  '#fb923c',
  '#a3e635',
  '#22d3ee',
  '#e879f9',
  '#facc15',
  '#818cf8',
]

/** Colore stabile della tab in base al nome del database associato. */
export function dbTabColor(dbName: string): string {
  let h = 0
  for (let i = 0; i < dbName.length; i++) h = (h * 31 + dbName.charCodeAt(i)) >>> 0
  return DB_TAB_COLORS[h % DB_TAB_COLORS.length]
}

// ---------- Raggruppamento tabelle per prefisso ----------

export interface TableGroup {
  key: string
  label: string
  tables: TableInfo[]
}

/**
 * Raggruppa le tabelle per prefisso del nome (parte prima del primo underscore):
 * BCKUP_UDC e BCKUP_ARTICOLI → gruppo "BCKUP", DAT_* → "DAT", MAG_* → "MAG", ...
 * Le tabelle senza underscore finiscono nel gruppo "Varie". Case-insensitive.
 */
export function groupTablesByPrefix(tables: TableInfo[]): TableGroup[] {
  const map = new Map<string, TableGroup>()
  for (const t of tables) {
    const raw = t.name.includes('_') ? t.name.split('_')[0] : 'Varie'
    const key = raw.toLowerCase()
    let g = map.get(key)
    if (!g) {
      g = { key, label: raw, tables: [] }
      map.set(key, g)
    }
    g.tables.push(t)
  }
  return [...map.values()]
    .map(g => ({ ...g, tables: [...g.tables].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => {
      if (a.label === 'Varie') return 1
      if (b.label === 'Varie') return -1
      return a.label.localeCompare(b.label)
    })
}

// ---------- Risoluzione token → tabella/colonna (hover) ----------

export interface ResolvedToken {
  kind: 'table' | 'column'
  table: TableInfo
  column: ColumnInfo | null
  /** Proprietari (per colonne ambigue: presenti in più tabelle). */
  owners: { table: TableInfo; alias: string | null }[]
}

/**
 * Risolve l'identificatore che contiene l'offset: nome tabella, colonna (qualificata
 * con alias/tabella o univoca nel DB/statement). Restituisce null per parole chiave
 * e identificatori sconosciuti.
 */
export function resolveTokenAt(text: string, offset: number, summary: DatabaseSummary): ResolvedToken | null {
  const tokens = tokenizeSql(text)
  const idx = tokens.findIndex(t => t.start <= offset && offset < t.end)
  if (idx === -1) return null
  const tok = tokens[idx]

  const tableByLower = new Map<string, TableInfo>()
  const tableByKey = new Map<string, TableInfo>()
  for (const t of summary.tables) {
    tableByLower.set(t.name.toLowerCase(), t)
    tableByKey.set(`${t.schema}.${t.name}`.toLowerCase(), t)
  }
  const colOwners = new Map<string, TableInfo[]>()
  for (const t of summary.tables) {
    for (const c of t.columns ?? []) {
      const lower = c.name.toLowerCase()
      const list = colOwners.get(lower)
      if (list) list.push(t)
      else colOwners.set(lower, [t])
    }
  }

  // alias e scope dello statement contenente il token
  const starts = findSqlStatementStarts(text)
  const stmtIdx = statementIndexAt(starts, offset)
  const stmtStart = starts[stmtIdx]
  const stmtEnd = stmtIdx + 1 < starts.length ? starts[stmtIdx + 1] : text.length
  const aliasMap = new Map<string, string>()
  const scopeKeys = new Set<string>()
  for (const r of extractStatementTableRefs(text.slice(stmtStart, stmtEnd))) {
    const t = tableByLower.get(r.tableName.toLowerCase())
    if (!t) continue
    const key = `${t.schema}.${t.name}`.toLowerCase()
    scopeKeys.add(key)
    aliasMap.set((r.alias ?? r.tableName).toLowerCase(), key)
  }

  const columnOf = (table: TableInfo): ColumnInfo | null =>
    table.columns?.find(c => c.name.toLowerCase() === tok.lower) ?? null

  if (tok.qualified && tok.qualifier) {
    const ownerKey = aliasMap.get(tok.qualifier.toLowerCase())
    if (ownerKey) {
      const table = tableByKey.get(ownerKey)
      if (table) {
        const column = columnOf(table)
        if (column) return { kind: 'column', table, column, owners: [{ table, alias: tok.qualifier }] }
      }
    }
    const tbl = tableByLower.get(tok.lower)
    if (tbl) return { kind: 'table', table: tbl, column: null, owners: [] }
  }

  const table = tableByLower.get(tok.lower)
  if (table) return { kind: 'table', table, column: null, owners: [] }

  const owners = colOwners.get(tok.lower)
  if (owners && owners.length > 0) {
    const inScope = owners.filter(t => scopeKeys.has(`${t.schema}.${t.name}`.toLowerCase()))
    const picked = inScope.length === 1 ? inScope : owners
    const first = picked[0]
    const ownerList = picked.map(t => ({ table: t, alias: null }))
    return { kind: 'column', table: first, column: columnOf(first), owners: ownerList }
  }

  return null
}

/** Markdown informativo per hover e documentazione dei suggerimenti: tipo, flag, descrizione e proprietà estese. */
export function columnInfoMarkdown(table: TableInfo, column: ColumnInfo | null, owners?: ResolvedToken['owners']): string {
  const lines: string[] = []
  if (column) {
    const size = column.maxLength ? `(${column.maxLength})` : ''
    lines.push(
      `**${column.name}** — \`${column.dataType}${size}\`${column.isNullable ? ' · NULL' : ' · NOT NULL'}${column.isIdentity ? ' · IDENTITY' : ''}${column.isComputed ? ' · COMPUTED' : ''}`,
    )
    lines.push(`Tabella: \`${table.schema}.${table.name}\``)
    if (owners && owners.length > 1) {
      lines.push(`*Colonna presente anche in:* ${owners.map(o => `\`${o.table.schema}.${o.table.name}\``).join(', ')}`)
    }
    if (column.description) lines.push(`\n**Descrizione:** ${column.description}`)
    const props = column.extendedProperties ?? []
    if (props.length > 0) {
      lines.push('\n**Proprietà estese:**')
      for (const p of props) lines.push(`- **${p.name}:** ${p.value}`)
    }
  } else {
    lines.push(`**${table.schema}.${table.name}** — ${table.columnCount} colonne`)
    if (table.usage) {
      lines.push(
        `Utilizzo: ${table.usage.fkIncoming} ref. · ${table.usage.fkOutgoing} join · ${table.usage.dependencyCount} dip. · ${table.usage.rowCount.toLocaleString('it-IT')} righe`,
      )
    }
    const props = table.extendedProperties ?? []
    if (props.length > 0) {
      lines.push('\n**Proprietà estese:**')
      for (const p of props) lines.push(`- **${p.name}:** ${p.value}`)
    }
  }
  return lines.join('\n')
}

// ---------- Select-list: colonne suggeribili ed espansione "*" ----------

export interface SelectListColumn {
  name: string
  dataType: string
  isNullable: boolean
  isIdentity: boolean
  ownerLabel: string
  shared: boolean
  /** Markdown con descrizione e proprietà estese (per il widget suggerimenti). */
  documentation: string
}

export interface SelectListSuggestions {
  /** Testo con tutti i campi dello statement (null se nessuna tabella referenziata). */
  starText: string | null
  starCount: number
  /** Offset dell'asterisco dentro stmtText; -1 = nessun '*': il testo va inserito al cursore. */
  starOffset: number
  /** Colonne suggeribili singolarmente (escluse quelle già scritte nella select-list). */
  columns: SelectListColumn[]
}

/**
 * Calcola i suggerimenti per la select-list di uno statement:
 * colonne delle tabelle referenziate (anche dopo il cursore), deduplicate,
 * con l'eventuale testo di espansione dell'asterisco. L'asterisco viene cercato
 * in TUTTA la select-list (prima di FROM), quindi il suggerimento "tutti i campi"
 * compare con Ctrl+Spazio sia prima che dopo il cursore.
 */
export function buildSelectListSuggestions(
  stmtText: string,
  stmtBefore: string,
  summary: DatabaseSummary,
): SelectListSuggestions {
  const usedCols = new Set<string>()
  const selMatch = /\bSELECT\b/i.exec(stmtBefore)
  if (selMatch) {
    for (const m of stmtBefore
      .slice(selMatch.index + selMatch[0].length)
      .matchAll(/\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*/g)) {
      usedCols.add(m[0].replace(/[\[\]]/g, '').toLowerCase())
    }
  }

  const refTables = extractStatementTableRefs(stmtText)
    .map(r => ({ r, table: summary.tables.find(t => t.name.toLowerCase() === r.tableName.toLowerCase()) }))
    .filter((x): x is { r: StatementTableRef; table: TableInfo } => x.table !== undefined)

  const colOwners = new Map<string, string[]>()
  for (const { table } of refTables) {
    for (const c of table.columns ?? []) {
      const lower = c.name.toLowerCase()
      const list = colOwners.get(lower)
      if (list) list.push(`${table.schema}.${table.name}`)
      else colOwners.set(lower, [`${table.schema}.${table.name}`])
    }
  }

  let starText: string | null = null
  let starCount = 0
  let starOffset = -1
  // il '*' deve comparire con Ctrl+Spazio PRIMA, SUL o DOPO il cursore:
  // cerca il primo asterisco "usabile" in tutta la select-list (prima di FROM)
  const starSelMatch = /\bSELECT\b/i.exec(stmtText)
  const selectListStart = starSelMatch ? starSelMatch.index + starSelMatch[0].length : 0
  const fromRel = /\bFROM\b/i.exec(stmtText.slice(selectListStart))
  const selectListEnd = fromRel ? selectListStart + fromRel.index : stmtText.length
  let starIdx = -1
  for (let i = selectListStart; i < selectListEnd && i < stmtText.length; i++) {
    if (stmtText[i] === '*' && (i === 0 || stmtText[i - 1] !== '(')) {
      starIdx = i
      break
    }
  }
  const starUsable = starIdx !== -1
  if (starUsable) starOffset = starIdx
  // "tutti i campi": proposto SEMPRE nella select-list (con '*' lo sostituisce,
  // senza '*' inserisce tutti i campi al cursore), escludendo quelli già scritti
  {
    const parts: string[] = []
    for (const { r, table } of refTables) {
      const alias = r.alias ?? table.name
      for (const c of table.columns ?? []) {
        if (usedCols.has(c.name.toLowerCase())) continue
        const owners = colOwners.get(c.name.toLowerCase()) ?? []
        parts.push(owners.length === 1 ? sqlIdent(c.name) : `${sqlIdent(alias)}.${sqlIdent(c.name)}`)
      }
    }
    if (parts.length > 0) {
      starText = parts.join(', ')
      starCount = parts.length
    }
  }

  const colMap = new Map<string, { c: ColumnInfo; owners: { key: string; label: string; table: TableInfo }[] }>()
  for (const { r, table } of refTables) {
    for (const c of table.columns ?? []) {
      const lower = c.name.toLowerCase()
      if (usedCols.has(lower)) continue
      let entry = colMap.get(lower)
      if (!entry) {
        entry = { c, owners: [] }
        colMap.set(lower, entry)
      }
      const key = `${table.schema}.${table.name}#${r.alias ?? ''}`
      if (!entry.owners.some(o => o.key === key)) {
        entry.owners.push({ key, label: r.alias ?? table.name, table })
      }
    }
  }
  const columns: SelectListColumn[] = []
  for (const [, entry] of colMap) {
    columns.push({
      name: entry.c.name,
      dataType: entry.c.dataType,
      isNullable: entry.c.isNullable,
      isIdentity: entry.c.isIdentity,
      ownerLabel:
        entry.owners.length === 1 ? entry.owners[0].label : entry.owners.map(o => o.label).join(', '),
      shared: entry.owners.length > 1,
      documentation: columnInfoMarkdown(
        entry.owners[0].table,
        entry.c,
        entry.owners.map(o => ({ table: o.table, alias: null })),
      ),
    })
  }
  return { starText, starCount, starOffset, columns }
}

// ---------- Parametri EXEC ----------

/** Parametri di una procedura non ancora digitati nel testo dopo il nome (afterProc). */
export function filterUnusedParams(parameters: ProcParamInfo[], afterProc: string): ProcParamInfo[] {
  const used = new Set([...afterProc.matchAll(/@([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1].toLowerCase()))
  return parameters.filter(p => !used.has(p.name.toLowerCase()))
}

/** Snippet "tutti i parametri": @p1=${1}, @p2=${2}, ... (con tab-stop). */
export function buildExecParamSnippet(parameters: ProcParamInfo[]): string {
  return parameters.map((par, i) => `@${par.name}=\${${i + 1}}`).join(', ')
}

// ---------- Definizioni oggetti (Alter) ----------

/**
 * Converte una definizione CREATE in ALTER:
 * "CREATE PROCEDURE ..." → "ALTER PROCEDURE ...", "CREATE OR ALTER ..." → "ALTER ...".
 * Se non inizia con CREATE, restituisce il testo invariato.
 */
export function toAlterStatement(definition: string): string {
  const m = /^\s*CREATE\s+(?:OR\s+ALTER\s+)?/i.exec(definition)
  if (!m) return definition
  return 'ALTER ' + definition.slice(m[0].length)
}

/** Estrae le tabelle referenziate (FROM/JOIN/UPDATE/INTO) da un intero statement, con eventuale alias. */
export function extractStatementTableRefs(text: string): StatementTableRef[] {
  const re =
    /\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+((?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*))?)(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?/gi
  const out: StatementTableRef[] = []
  for (const m of text.matchAll(re)) {
    const parts = m[1].replace(/[\[\]\s]/g, '').split('.')
    const maybeAlias = m[2] ?? null
    out.push({
      tableName: parts[parts.length - 1],
      alias: maybeAlias && !isSqlReserved(maybeAlias) ? maybeAlias : null,
    })
  }
  return out
}

export interface ColorizedToken {
  /** Indice del token nell'array restituito da tokenizeSql. */
  index: number
  /** Chiave tabella "schema.nome" proprietaria del colore. */
  tableKey: string
  /** True se è un'occorrenza del nome della tabella (stile enfatizzato). */
  isTableName: boolean
}

/**
 * Classifica i token SQL attribuendo a ciascuno la tabella proprietaria del colore:
 * - nomi di tabella → sempre colorati (enfatizzati);
 * - riferimenti qualificati (alias.col / tabella.col) → colorati con la tabella risolta;
 * - colonne non qualificate → colorate se univoche nel DB o univoche tra le tabelle dello statement.
 */
export function colorizeSqlTokens(text: string, summary: DatabaseSummary): ColorizedToken[] {
  if (text.length > 400_000) return []
  const tokens = tokenizeSql(text)
  if (tokens.length === 0) return []
  const starts = findSqlStatementStarts(text)

  const tableByLower = new Map<string, TableInfo>()
  const tableByKey = new Map<string, TableInfo>()
  for (const t of summary.tables) {
    tableByLower.set(t.name.toLowerCase(), t)
    tableByKey.set(`${t.schema}.${t.name}`, t)
  }
  const columnOwners = new Map<string, string[]>()
  for (const t of summary.tables) {
    const key = `${t.schema}.${t.name}`
    for (const c of t.columns ?? []) {
      const lower = c.name.toLowerCase()
      const list = columnOwners.get(lower)
      if (list) list.push(key)
      else columnOwners.set(lower, [key])
    }
  }

  const refCache = new Map<number, { tables: Set<string>; aliases: Map<string, string> }>()
  const refsFor = (stmtIdx: number) => {
    const cached = refCache.get(stmtIdx)
    if (cached) return cached
    const start = starts[stmtIdx]
    const end = stmtIdx + 1 < starts.length ? starts[stmtIdx + 1] : text.length
    const slice = text.slice(start, end)
    const tables = new Set<string>()
    const aliases = new Map<string, string>()
    const re =
      /\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+((?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*))?)(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(slice)) !== null) {
      const parts = m[1].replace(/[\[\]\s]/g, '').split('.')
      const tableName = parts[parts.length - 1].toLowerCase()
      const table = tableByLower.get(tableName)
      if (!table) continue
      const key = `${table.schema}.${table.name}`
      tables.add(key)
      const maybeAlias = m[2] ?? null
      aliases.set(maybeAlias && !isSqlReserved(maybeAlias) ? maybeAlias.toLowerCase() : tableName, key)
    }
    refCache.set(stmtIdx, { tables, aliases })
    return refCache.get(stmtIdx)!
  }

  const stmtIndexOf = (offset: number) => {
    let lo = 0
    let hi = starts.length - 1
    let res = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (starts[mid] <= offset) {
        res = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return res
  }

  const result: ColorizedToken[] = []
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]

    if (tok.qualified && tok.qualifier) {
      const refs = refsFor(stmtIndexOf(tok.start))
      const qLower = tok.qualifier.toLowerCase()
      const ownerKey =
        refs.aliases.get(qLower) ??
        (tableByLower.has(qLower) ? `${tableByLower.get(qLower)!.schema}.${tableByLower.get(qLower)!.name}` : undefined)
      if (ownerKey) {
        const owner = tableByKey.get(ownerKey)
        if (owner?.columns?.some(c => c.name.toLowerCase() === tok.lower)) {
          result.push({ index: i, tableKey: ownerKey, isTableName: false })
          continue
        }
      }
      // qualificatore non risolto: se il token è un nome tabella, coloralo come tabella
      const tbl = tableByLower.get(tok.lower)
      if (tbl) {
        result.push({ index: i, tableKey: `${tbl.schema}.${tbl.name}`, isTableName: true })
        continue
      }
      const single = columnOwners.get(tok.lower)
      if (single && single.length === 1) result.push({ index: i, tableKey: single[0], isTableName: false })
      continue
    }

    const table = tableByLower.get(tok.lower)
    if (table) {
      result.push({ index: i, tableKey: `${table.schema}.${table.name}`, isTableName: true })
      continue
    }

    const owners = columnOwners.get(tok.lower)
    if (owners) {
      if (owners.length === 1) {
        result.push({ index: i, tableKey: owners[0], isTableName: false })
      } else {
        const inScope = owners.filter(k => refsFor(stmtIndexOf(tok.start)).tables.has(k))
        if (inScope.length === 1) result.push({ index: i, tableKey: inScope[0], isTableName: false })
      }
    }
  }
  return result
}

/**
 * Costruisce la clausola ON del JOIN dalla FK: "ON tabellaContesto.col = candidata.col".
 * Se un nome di colonna è univoco tra le tabelle in scope della query, il prefisso
 * con il nome della tabella viene omesso (es. "ON UDC_UDC = MIS_UDC"). Le parentesi
 * quadre compaiono solo quando il nome lo richiede (spazi, parole riservate, ecc.).
 */
export function buildJoinText(candidate: TableInfo, hint: JoinHint, scope: TableInfo[]): string {
  const fk = hint.fk
  const ctxTableName = hint.direction === 'out' ? fk.refTable : fk.table
  const ctxColumn = hint.direction === 'out' ? fk.refColumn : fk.column
  const candColumn = hint.direction === 'out' ? fk.column : fk.refColumn

  const ctxPart =
    columnAppearsIn(scope, ctxColumn) === 1
      ? sqlIdent(ctxColumn)
      : `${sqlIdent(ctxTableName)}.${sqlIdent(ctxColumn)}`
  const candPart =
    columnAppearsIn(scope, candColumn) === 1
      ? sqlIdent(candColumn)
      : `${sqlIdent(candidate.name)}.${sqlIdent(candColumn)}`
  return `${qualified(candidate.schema, candidate.name)} ON ${ctxPart} = ${candPart}`
}

/** Quante tabelle dello scope contengono una colonna con quel nome. */
function columnAppearsIn(scope: TableInfo[], columnName: string): number {
  const lower = columnName.toLowerCase()
  let count = 0
  for (const t of scope) {
    if (t.columns?.some(c => c.name.toLowerCase() === lower)) count += 1
  }
  return count
}
