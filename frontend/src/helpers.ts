import type { CellValue, ColumnInfo, DatabaseSummary, ForeignKeyInfo, FunctionInfo, ProcParamInfo, ProcedureInfo, TableCooccurrence, TableInfo, TableReportRow, TableUsage } from './types'

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
  /** Percorso transitivo: tabella intermedia quando la candidata non è collegata direttamente (B4). */
  viaTable?: string
  /** Primo percorso con chiave condivisa (per compatibilità). */
  viaPath?: ViaPath
  /** Tutti i percorsi transitivi con chiave condivisa (uno per tabella del contesto raggiunta). */
  viaPaths?: ViaPath[]
}

/** Percorso transitivo A→M→C con chiave condivisa: candidato.col = tabella-contesto.col. */
export interface ViaPath {
  midTable: string
  ctxTable: string
  candColumn: string
  ctxColumn: string
}

/**
 * Ordina le tabelle per i suggerimenti di completamento:
 * 1) quelle collegate da FK alle tabelle già presenti nella query (boost forte),
 * 2) quelle raggiungibili in 2 hop (A→B→C) tramite un'altra tabella collegata (join transitivi),
 * 3) poi quelle che nei JOIN reali delle stored procedure compaiono insieme (co-occorrenza),
 * 4) infine tutte le altre in base al punteggio di utilizzo reale nel database.
 */
export function rankTablesForJoin(
  tables: TableInfo[],
  foreignKeys: ForeignKeyInfo[],
  contextTables: string[],
  cooccurrences: TableCooccurrence[] = [],
  historyBoost: (tableName: string) => number = () => 0,
): RankedTable[] {
  const ctx = new Set(contextTables.map(t => t.trim().toLowerCase()))
  // adiacenza tra tabelle (bidirezionale) dalle FK: per i join transitivi
  const adj = new Map<string, Set<string>>()
  for (const fk of foreignKeys) {
    const a = fk.table.toLowerCase()
    const b = fk.refTable.toLowerCase()
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
  }
  // tabella intermedia per chi è a distanza 2 dal contesto, con le colonne della
  // chiave condivisa (per proporre gli ON transitivi, es. GM_PIAZZOLA = BPZ_PIAZZOLA).
  // Si raccolgono TUTTI i percorsi: una candidata può raggiungere più tabelle del contesto.
  const viaMid = new Map<string, string>()
  const viaPaths = new Map<string, ViaPath[]>()
  const connects = (fk: ForeignKeyInfo, a: string, b: string) =>
    (fk.table.toLowerCase() === a && fk.refTable.toLowerCase() === b) ||
    (fk.table.toLowerCase() === b && fk.refTable.toLowerCase() === a)
  const midColumnOf = (fk: ForeignKeyInfo, mid: string) =>
    fk.table.toLowerCase() === mid ? fk.column : fk.refColumn
  for (const t of tables) {
    const name = t.name.toLowerCase()
    if (ctx.has(name)) continue
    for (const c of ctx) {
      if (adj.get(name)?.has(c)) continue // già collegata direttamente
      for (const mid of adj.get(name) ?? []) {
        if (!adj.get(mid)?.has(c)) continue
        const midName = tables.find(x => x.name.toLowerCase() === mid)?.name ?? mid
        if (!viaMid.has(name)) viaMid.set(name, midName)
        // chiave condivisa: candidato.col → M.col e C.col → M.col (stessa colonna intermedia)
        const candFk = foreignKeys.find(f => connects(f, name, mid))
        const ctxFk = foreignKeys.find(f => connects(f, c, mid))
        if (candFk && ctxFk && midColumnOf(candFk, mid).toLowerCase() === midColumnOf(ctxFk, mid).toLowerCase()) {
          const ctxName = tables.find(x => x.name.toLowerCase() === c)?.name ?? c
          const list = viaPaths.get(name) ?? []
          list.push({
            midTable: midName,
            ctxTable: ctxName,
            candColumn: candFk.table.toLowerCase() === name ? candFk.column : candFk.refColumn,
            ctxColumn: ctxFk.table.toLowerCase() === c ? ctxFk.column : ctxFk.refColumn,
          })
          viaPaths.set(name, list)
        }
      }
    }
  }

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
      // co-occorrenza: quanto spesso questa tabella compare nei JOIN insieme alle tabelle del contesto
      let coScore = 0
      for (const co of cooccurrences) {
        if (!ctx.has(co.tableA.toLowerCase()) && !ctx.has(co.tableB.toLowerCase())) continue
        if (co.tableA.toLowerCase() === name || co.tableB.toLowerCase() === name)
          coScore += co.count
      }
      // join transitivo: raggiungibile tramite una tabella intermedia (peso minore delle FK dirette);
      // l'viaTable resta anche con FK dirette verso ALTRE tabelle del contesto (via specifica per tabella)
      const transitiva = viaMid.get(name)
      const paths = viaPaths.get(name) ?? []
      const transitiveScore = transitiva ? 400 : 0
      const histScore = historyBoost(t.name) * 300
      const score = hints.length * 1000 + transitiveScore + coScore + histScore + usageScore(t.usage)
      return { table: t, score, hints, viaTable: transitiva, viaPath: paths[0], viaPaths: paths }
    })
    .sort((a, b) => b.score - a.score)
}

/**
 * Tabelle candidate per il completamento, in base alla posizione del cursore:
 * - `freshClause` (primo FROM/INTO/UPDATE/TABLE di una clausola o inizio statement):
 *   TUTTE le tabelle ordinate per utilizzo reale. Il contesto delle query precedenti
 *   NON deve nascondere tabelle che si vogliono riscrivere: es. dopo
 *   "select * from RUN_MISSIONI … if @@ROWCOUNT > 1 BEGIN select * from RUN_MI"
 *   deve riapparire RUN_MISSIONI tra i suggerimenti del nuovo FROM.
 * - altrimenti (JOIN e contesti generici): solo le tabelle collegabili al contesto
 *   (FK dirette, transitive, co-occorrenza) più le più usate.
 */
export function rankTablesForPosition(
  tables: TableInfo[],
  foreignKeys: ForeignKeyInfo[],
  contextTables: string[],
  freshClause: boolean,
  cooccurrences: TableCooccurrence[] = [],
  historyBoost: (tableName: string) => number = () => 0,
): RankedTable[] {
  return rankTablesForJoin(tables, foreignKeys, freshClause ? [] : contextTables, cooccurrences, historyBoost)
}

/** Testo leggibile di una cella per griglie e tooltip. */
export function cellText(v: CellValue): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'boolean') return String(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Numero massimo di colonne mostrate nell'anteprima hover (oltre → nota). */
const PREVIEW_MAX_COLUMNS = 10
/** Lunghezza massima di una cella nell'anteprima (oltre → troncata con …). */
const PREVIEW_MAX_CELL = 28

/**
 * Tabella markdown (GFM) dalle colonne/righe di un result set, per l'hover dell'editor.
 * Curata per la lettura: header in grassetto, valori lunghi troncati, NULL in corsivo,
 * colonne in eccesso nascoste (con nota) così l'anteprima non diventa un muro di testo.
 */
export function rowsToMarkdown(columns: string[], rows: CellValue[][], maxRows = 10): string {
  if (columns.length === 0) return ''
  const escape = (s: string) =>
    s.replace(/\|/g, '\\|').replace(/`/g, '\\`').replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ').trim()
  const cell = (v: CellValue): string => {
    const t = cellText(v)
    if (t === 'NULL') return '*NULL*'
    const short = t.length > PREVIEW_MAX_CELL ? t.slice(0, PREVIEW_MAX_CELL - 1) + '…' : t
    return escape(short)
  }
  const shown = columns.slice(0, PREVIEW_MAX_COLUMNS)
  const header = `| ${shown.map(c => `**${escape(c)}**`).join(' | ')} |`
  const sep = `| ${shown.map(() => '---').join(' | ')} |`
  const body = rows
    .slice(0, maxRows)
    .map(row => `| ${shown.map((_, i) => cell(row[i])).join(' | ')} |`)
    .join('\n')
  const notes: string[] = []
  if (rows.length > maxRows) notes.push(`_… altre ${rows.length - maxRows} righe (prime ${maxRows})_`)
  if (columns.length > shown.length) notes.push(`_… e altre ${columns.length - shown.length} colonne_`)
  const notesText = notes.length > 0 ? `\n${notes.join(' ')}` : ''
  return `${header}\n${sep}${body ? `\n${body}` : ''}${notesText}`
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

  // VALUES/SELECT contano SOLO se compaiono DOPO il nome della tabella corrente:
  // in un batch ("BEGIN TRAN … INSERT INTO LOG (a) VALUES (1) … INSERT INTO
  // TIPI_EVENTI (TI…") un VALUES di un INSERT precedente non deve far scambiare
  // la '(' del secondo INSERT per una subquery (colOpen = -1 → niente colonne).
  const valuesIdx = text.indexOf('VALUES', tableEnd)
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

// ---------- Generazione script (tasto destro) ----------

function columnTypeSql(c: ColumnInfo): string {
  const t = c.dataType.toLowerCase()
  const base = /^[a-z0-9_]+/.exec(t)?.[0] ?? t
  if (['nvarchar', 'nchar'].includes(base)) {
    return c.maxLength != null ? (c.maxLength === -1 ? 'nvarchar(max)' : `nvarchar(${Math.max(1, Math.floor(c.maxLength / 2))})`) : t
  }
  if (['varchar', 'char', 'varbinary', 'binary'].includes(base)) {
    return c.maxLength != null ? (c.maxLength === -1 ? `${base}(max)` : `${base}(${c.maxLength})`) : t
  }
  return t
}

/** Script CREATE TABLE generato dai metadati (colonne, identità, nullabilità). */
export function scriptCreateTable(table: TableInfo): string {
  const defs = (table.columns ?? []).map(c => {
    const parts = [`    ${sqlIdent(c.name)}`, columnTypeSql(c)]
    if (c.isIdentity) parts.push('IDENTITY(1,1)')
    if (!c.isNullable) parts.push('NOT NULL')
    return parts.join(' ')
  })
  return `CREATE TABLE ${qualified(table.schema, table.name)} (\n${defs.join(',\n')}\n);\n`
}

/** Script ALTER TABLE ... ADD CONSTRAINT ... CHECK: per vedere/modificare un vincolo CHECK esistente. */
export function scriptCheckConstraint(
  schema: string,
  tableName: string,
  name: string,
  definition: string,
  isDisabled = false,
): string {
  const target = qualified(schema, tableName)
  const lines = [
    `-- Vincolo CHECK "${name}" su ${target}`,
    `-- Testo originale: CHECK (${definition})`,
  ]
  if (isDisabled) {
    lines.push(
      '-- ⚠ il vincolo è DISABILITATO nel database (dati esistenti non verificati)',
      `-- per riabilitarlo: ALTER TABLE ${target} WITH CHECK CHECK CONSTRAINT ${sqlIdent(name)};`,
    )
  }
  lines.push(`ALTER TABLE ${target} WITH CHECK ADD CONSTRAINT ${sqlIdent(name)} CHECK (${definition});`)
  return lines.join('\n') + '\n'
}

/** Script MERGE generato: chiave = colonna IDENTITY (o la prima), sorgente con valori di default. */
export function scriptMergeTable(table: TableInfo): string {
  const cols = table.columns ?? []
  const pk = cols.find(c => c.isIdentity) ?? cols[0]
  const target = qualified(table.schema, table.name)
  const pkName = pk?.name ?? ''
  const colList = cols.map(c => sqlIdent(c.name)).join(', ')
  const srcCols = cols.map(c => `${sqlDefaultForType(c.dataType, false)} AS ${sqlIdent(c.name)}`).join(', ')
  const updateSet = cols
    .filter(c => c !== pk)
    .map(c => `    ${sqlIdent(c.name)} = src.${sqlIdent(c.name)}`)
    .join(',\n')
  return [
    `MERGE INTO ${target} AS tgt`,
    `USING (SELECT ${srcCols}) AS src`,
    `ON tgt.${sqlIdent(pkName)} = src.${sqlIdent(pkName)}`,
    'WHEN MATCHED THEN UPDATE SET',
    updateSet || '    -- nessuna colonna da aggiornare',
    `WHEN NOT MATCHED THEN INSERT (${colList})`,
    `VALUES (${cols.map(c => `src.${sqlIdent(c.name)}`).join(', ')});`,
  ].join('\n')
}

/** Script EXEC di una stored procedure: IN → @nome = valore (default se noto), OUTPUT → @nome OUTPUT. */
export function scriptExecProcedure(proc: ProcedureInfo): string {
  const params = proc.parameters ?? []
  const args = params
    .map(p => {
      if (p.mode === 'OUTPUT') return `@${p.name} OUTPUT`
      const def = p.defaultValue
      return `@${p.name} = ${def !== undefined && def !== null && def !== '' ? def : ''}`
    })
    .join(', ')
  return `EXEC ${qualified(proc.schema, proc.name)} ${args};\n`
}

/** Millisecondi rimanenti perché una durata minima sia rispettata (0 se già superata).
 *  Usata per l'animazione di connessione: resta visibile almeno minMs anche con server rapidi. */
export function remainingMinDelay(startedAt: number, minMs: number): number {
  return Math.max(0, minMs - (Date.now() - startedAt))
}

/** Livello del drago dopo una query eseguita: cresce di 1 fino a 100 (poi resta 100). */
export function nextDragonLevel(current: number): number {
  return Math.min(100, Math.max(0, current) + 1)
}

/** Comando magico dentro un PRINT: 'drago' evoca il drago, 'fuoco' la fiammata. */
export function detectPrintMagic(sql: string): 'drago' | 'fuoco' | null {
  const re = /\bprint\s+N?\s*['"]([^'"]*)['"]/gi
  let fuoco: 'fuoco' | null = null
  for (const m of sql.matchAll(re)) {
    const payload = (m[1] ?? '').toLowerCase()
    if (/\b(drago|dragon)\b/.test(payload)) return 'drago'
    if (/\b(fuoco|fire|fiamma)\b/.test(payload)) fuoco = 'fuoco'
  }
  return fuoco
}

/** True se l'offset è DENTRO un commento (di riga o a blocco), rispettando le stringhe. */
export function isTextOffsetInComment(text: string, offset: number): boolean {
  let i = 0
  let lineComment = false
  let block = false
  let str = false
  const n = Math.min(offset, text.length)
  while (i < n) {
    const c = text[i]
    const nx = i + 1 < text.length ? text[i + 1] : ''
    if (block) {
      if (c === '*' && nx === '/') {
        block = false
        i += 2
        continue
      }
      i++
      continue
    }
    if (str) {
      if (c === "'") {
        if (nx === "'") {
          i += 2
          continue
        }
        str = false
      }
      i++
      continue
    }
    if (c === "'") {
      str = true
      i++
      continue
    }
    if (c === '-' && nx === '-') {
      lineComment = true
      const eol = text.indexOf('\n', i)
      if (eol === -1 || eol >= n) break
      i = eol + 1
      lineComment = false
      continue
    }
    if (c === '/' && nx === '*') {
      block = true
      i += 2
      continue
    }
    i++
  }
  return lineComment || block
}

// ---------- Report utilizzo tabelle (ordinamento) ----------

export type TableReportSortKey =
  | 'name'
  | 'rowCount'
  | 'reservedKb'
  | 'usedKb'
  | 'dataKb'
  | 'indexKb'
  | 'unusedKb'
  | 'indexCount'
  | 'reads'
  | 'writes'
  | 'lastRead'
  | 'lastWrite'
  | 'createDate'

export type SortDir = 'asc' | 'desc'

/** Confronto di una riga del report per la colonna scelta (numeri e date in modo naturale). */
export function compareTableReport(
  a: TableReportRow,
  b: TableReportRow,
  key: TableReportSortKey,
): number {
  const av = a[key]
  const bv = b[key]
  if (typeof av === 'number' && typeof bv === 'number') return av - bv
  if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv)
  if (av == null && bv == null) return 0
  if (av == null) return 1 // i null vanno in fondo (asc)
  if (bv == null) return -1
  return String(av).localeCompare(String(bv))
}

/** Ordinamento stabile del report per la colonna selezionata. */
export function sortTableReport(
  rows: TableReportRow[],
  key: TableReportSortKey,
  dir: SortDir,
): TableReportRow[] {
  const mult = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => compareTableReport(a, b, key) * mult)
}

// ---------- Script "as" stile SSMS (tasto destro) ----------

export type ScriptableKind = 'table' | 'view' | 'procedure' | 'function' | 'trigger'

/** Colonna chiave di una tabella: la prima IDENTITY, altrimenti la prima colonna. */
export function scriptKeyColumn(table: TableInfo): ColumnInfo | null {
  const cols = table.columns ?? []
  return cols.find(c => c.isIdentity) ?? cols[0] ?? null
}

/** Colonne "scrivibili" per INSERT/UPDATE: esclude identity e computed. */
export function scriptWritableColumns(table: TableInfo): ColumnInfo[] {
  return (table.columns ?? []).filter(c => !c.isIdentity && !c.isComputed)
}

/** SELECT TOP (n) * — stile SSMS "Select Top 1000 Rows". */
export function scriptSelectTable(table: TableInfo, top = 1000): string {
  return `SELECT TOP (${top}) * FROM ${qualified(table.schema, table.name)};\n`
}

/** DROP per qualunque tipo di oggetto scriptabile. */
export function scriptDropObject(kind: ScriptableKind, schema: string, name: string): string {
  const kw =
    kind === 'table'
      ? 'TABLE'
      : kind === 'view'
        ? 'VIEW'
        : kind === 'procedure'
          ? 'PROCEDURE'
          : kind === 'function'
            ? 'FUNCTION'
            : 'TRIGGER'
  return `DROP ${kw} ${qualified(schema, name)};\n`
}

/** INSERT INTO (colonne) VALUES (default) — esclude identity/computed. */
export function scriptInsertTable(table: TableInfo): string {
  const cols = scriptWritableColumns(table)
  const colList = cols.map(c => sqlIdent(c.name)).join(', ')
  const vals = cols.map(c => sqlDefaultForType(c.dataType, c.isNullable)).join(', ')
  return `INSERT INTO ${qualified(table.schema, table.name)} (${colList})\nVALUES (${vals});\n`
}

/** UPDATE t SET col = default WHERE chiave = default — esclude identity/computed e la chiave. */
export function scriptUpdateTable(table: TableInfo): string {
  const key = scriptKeyColumn(table)
  const cols = scriptWritableColumns(table).filter(c => c !== key)
  const sets = cols
    .map(c => `    ${sqlIdent(c.name)} = ${sqlDefaultForType(c.dataType, c.isNullable)}`)
    .join(',\n')
  const where = key
    ? `WHERE ${sqlIdent(key.name)} = ${sqlDefaultForType(key.dataType, key.isNullable)}`
    : 'WHERE /* chiave */'
  return `UPDATE ${qualified(table.schema, table.name)}\nSET\n${sets || '    -- nessuna colonna da aggiornare'}\n${where};\n`
}

/** DELETE FROM t WHERE chiave = default. */
export function scriptDeleteTable(table: TableInfo): string {
  const key = scriptKeyColumn(table)
  const where = key
    ? `WHERE ${sqlIdent(key.name)} = ${sqlDefaultForType(key.dataType, key.isNullable)}`
    : 'WHERE /* chiave */'
  return `DELETE FROM ${qualified(table.schema, table.name)} ${where};\n`
}

// ---------- Snippet statement completi (stile Visual Studio) ----------

export interface StatementSnippet {
  label: string
  detail: string
  insertText: string
}

const STATEMENT_SNIPPETS: StatementSnippet[] = [
  {
    label: 'SELECT',
    detail: 'SELECT ... FROM ... (snippet completo)',
    insertText: 'SELECT ${1:*}\nFROM ${2:[schema.]tabella}\nWHERE ${3:/* condizione */}\nORDER BY ${4:1} DESC;\n',
  },
  {
    label: 'INSERT INTO',
    detail: 'INSERT INTO ... (colonne) VALUES (...)',
    insertText: 'INSERT INTO ${1:[schema.]tabella} (${2:col1, col2})\nVALUES (${3:val1, val2});\n',
  },
  {
    label: 'UPDATE',
    detail: 'UPDATE ... SET ... WHERE ...',
    insertText: 'UPDATE ${1:[schema.]tabella}\nSET ${2:colonna} = ${3:valore}\nWHERE ${4:/* condizione */};\n',
  },
  {
    label: 'DELETE FROM',
    detail: 'DELETE FROM ... WHERE ...',
    insertText: 'DELETE FROM ${1:[schema.]tabella}\nWHERE ${2:/* condizione */};\n',
  },
  {
    label: 'MERGE INTO',
    detail: 'MERGE INTO ... USING ... (upsert)',
    insertText: 'MERGE INTO ${1:[schema.]tabella} AS tgt\nUSING ${2:sorgente} AS src\nON ${3:/* condizione */}\nWHEN MATCHED THEN UPDATE SET ${4:col = src.col}\nWHEN NOT MATCHED THEN INSERT (${5:colonne})\nVALUES (${6:src.colonne});\n',
  },
]

/** Snippet statement che corrispondono al testo digitato (prefisso della keyword). */
export function buildStatementSnippets(word: string): StatementSnippet[] {
  const w = word.trim().toLowerCase()
  if (w.length < 2) return []
  return STATEMENT_SNIPPETS.filter(s => {
    const label = s.label.toLowerCase()
    return label.startsWith(w) || w.startsWith(label)
  })
}

// ---------- Ricerca: gli spazi valgono come % (LIKE) ----------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Pattern di ricerca: gli spazi separano token che devono comparire in ordine (come %token%). */
export function searchPatternFromQuery(query: string): RegExp | null {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(t => escapeRegex(t))
  if (tokens.length === 0) return null
  return new RegExp(tokens.join('.*'), 'i')
}

/** True se una delle candidate corrisponde alla query (spazi = %). */
export function searchMatches(query: string, ...candidates: string[]): boolean {
  const re = searchPatternFromQuery(query)
  if (!re) return false
  return candidates.some(c => re.test(c))
}

// ---------- Affinità colonne digitate (autocompletamento) ----------

function nameTokens(name: string): string[] {
  return name.toLowerCase().split('_').filter(Boolean)
}

/**
 * Punteggio di affinità tra il testo digitato e un nome di colonna:
 * - prefisso esatto: il più alto;
 * - sottostringa nel mezzo (es. "corr" dentro "corridoio");
 * - allineamento ordinato dei token separati da "_" (es. "mis_corr" → "mis_d_corridoio").
 * Restituisce 0 quando non c'è alcuna affinità.
 */
export function columnMatchScore(typed: string, columnName: string): number {
  const t = typed.trim().toLowerCase()
  const n = columnName.toLowerCase()
  if (!t) return 0
  if (n.startsWith(t)) return 1000 + t.length * 10
  if (n.includes(t)) return 700 + t.length * 5
  const tt = nameTokens(t)
  const nt = nameTokens(n)
  if (tt.length === 0 || nt.length === 0) return 0
  // ogni token digitato deve essere prefisso di un token colonna, in ordine
  let i = 0
  let j = 0
  let score = 0
  let gaps = 0
  while (i < tt.length && j < nt.length) {
    if (nt[j].startsWith(tt[i])) {
      score += 100 + Math.min(40, tt[i].length * 4)
      i++
      j++
    } else {
      gaps++
      j++
    }
  }
  if (i < tt.length) return 0 // non tutti i token digitati sono stati trovati
  if (nt[0].startsWith(tt[0])) score += 60
  return Math.max(0, score - gaps * 25)
}

/** Colonna sinistra di un confronto: "ON a.col = " / "WHERE col = " (prima del cursore). */
export interface OnLeftColumn {
  name: string
  /** Qualificatore se presente (alias o nome tabella). */
  qualifier: string | null
}

/**
 * filterText STABILE per le voci di colonne (select-list e contesti di colonna):
 * il NOME della colonna, mai la parola digitata. Monaco, a ogni carattere digitato,
 * RIFILTRA le voci già calcolate con la parola corrente (senza richiamare il provider):
 * se filterText fosse la parola digitata (es. "mis"), digitare un carattere in più
 * ("MIS_") renderebbe "mis_" non più corrispondente a "mis" → il popup si svuota
 * ("mi toglie tutti i campi di missioni"). Con il nome colonna ogni prefisso digitato
 * continua a matchare ("mis", "mis_", "mis_u" → "MIS_UDC"). L'ordine resta il nostro (sortText).
 */
export function completionFilterText(columnName: string): string {
  return columnName
}

/**
 * Colonna sinistra di un confronto: "ON a.col = " / "WHERE col = " (prima del cursore).
 * Accetta anche una parola già avviata dopo "=" (es. "ON mis_corr = cel") per poter
 * suggerire la controparte mentre si digita.
 */
export function detectLeftColumnInOn(textBefore: string): OnLeftColumn | null {
  // accetta anche la parentesi subito dopo la keyword: "ON (GM_PIAZZOLA = pia"
  const re = /(?:\bON\b|\bAND\b|\bOR\b|\bWHERE\b|\bHAVING\b)\s*\(?\s*(?:\[?([A-Za-z_][\w]*)\]?\s*\.\s*)?\[?([A-Za-z_][\w]*)\]?\s*=\s*(?:\[?[A-Za-z_][\w]*\]?)?$/i
  const m = re.exec(textBefore)
  if (!m) return null
  return { name: m[2], qualifier: m[1] ?? null }
}

/** Colonna "corrispondente" su un'altra tabella (controparte di un JOIN). */
export interface JoinCounterpart {
  column: ColumnInfo
  table: TableInfo
  score: number
  viaFk: boolean
}

/** Condizione aggiuntiva di JOIN suggerita: "AND colA = colB". */
export interface JoinConditionSuggestion {
  text: string
  left: string
  right: string
  score: number
}

/** Token iniziali condivisi (famiglia): "mis_d_corridoio" e "mis_d_cella" → ["mis","d"]. */
function sharedLeadingTokens(a: string, b: string): number {
  const ta = a.toLowerCase().split('_').filter(Boolean)
  const tb = b.toLowerCase().split('_').filter(Boolean)
  let n = 0
  while (n < ta.length && n < tb.length && ta[n] === tb[n]) n++
  return n
}

/**
 * Condizioni di JOIN aggiuntive per la clausola ON corrente:
 * quando l'ON ha già "MIS_D_CORRIDOIO = CEL_CORRIDOIO" propone le altre coppie FK
 * tra le stesse tabelle ("AND MIS_D_CELLA = CEL_CELLA"), dando priorità a quelle
 * della stessa relazione (stessa famiglia di token, es. MIS_D_*), come Visual Studio.
 */
export function buildJoinConditionSuggestions(
  stmtText: string,
  stmtBefore: string,
  summary: DatabaseSummary,
): JoinConditionSuggestion[] {
  const refs = extractStatementTableRefs(stmtText)
    .map(r => ({ r, table: summary.tables.find(t => t.name.toLowerCase() === r.tableName.toLowerCase()) }))
    .filter((x): x is { r: StatementTableRef; table: TableInfo } => x.table !== undefined)
  if (refs.length < 2) return []

  // testo dell'ultima clausola ON (dopo l'ultima parola ON nel testo prima del cursore)
  const onMatches = [...stmtBefore.matchAll(/\bON\b/gi)]
  if (onMatches.length === 0) return []
  const onText = stmtBefore.slice(onMatches[onMatches.length - 1].index)

  // coppie già scritte dentro l'ON (in qualsiasi ordine)
  const used = new Set<string>()
  for (const m of onText.matchAll(/([A-Za-z_][\w]*)\s*=\s*([A-Za-z_][\w]*)/gi)) {
    used.add([m[1].toLowerCase(), m[2].toLowerCase()].sort().join('='))
  }
  // l'ON ha già almeno una condizione? → le ulteriori coppie iniziano con "AND";
  // con l'ON VUOTO la prima condizione non deve avere "AND" (non c'è nulla da concatenare)
  const hasConditions = used.size > 0

  // con l'ON vuoto: la tabella appena unita (dopo l'ultimo JOIN) — le prime condizioni
  // devono collegare QUELLA tabella al resto, non proporre coppie di altri JOIN
  const joinMatches = [...stmtText.matchAll(/\bJOIN\s+((?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*))?)/gi)]
  const lastJoinTable = joinMatches.length > 0
    ? joinMatches[joinMatches.length - 1][1].replace(/[\[\]\s]/g, '').split('.').pop()?.toLowerCase()
    : null

  // nomi colonna per tabella (minuscoli) per decidere la qualifica
  const colByKey = new Map<string, Set<string>>()
  for (const { table } of refs) {
    const key = `${table.schema}.${table.name}`
    colByKey.set(key, new Set((table.columns ?? []).map(c => c.name.toLowerCase())))
  }

  // Coppia di tabelle dell'ON corrente (dalle colonne scritte, qualificate o univoche):
  // le condizioni aggiuntive devono riguardare SOLO quelle due tabelle, altrimenti
  // con più join comparirebbero coppie di altri JOIN o self-FK (rumore).
  const onTableKeys = new Set<string>()
  for (const m of onText.matchAll(/(?:\[?([A-Za-z_][\w]*)\]?\s*\.\s*)?\[?([A-Za-z_][\w]*)\]?/gi)) {
    const qual = m[1]?.toLowerCase()
    const col = m[2].toLowerCase()
    if (!col) continue
    if (qual) {
      const ref = refs.find(x => (x.r.alias ?? x.r.tableName).toLowerCase() === qual)
      if (ref) onTableKeys.add(`${ref.table.schema}.${ref.table.name}`)
    } else {
      const owners = refs.filter(x => (x.table.columns ?? []).some(c => c.name.toLowerCase() === col))
      if (owners.length === 1) onTableKeys.add(`${owners[0].table.schema}.${owners[0].table.name}`)
    }
  }
  const hasOnPair = onTableKeys.size >= 2

  // Raggruppa le FK per NOME del vincolo: ogni voce = un vincolo con le sue coppie
  // non ancora scritte (es. "AND MIS_D_CORRIDOIO = CEL_CORRIDOIO AND MIS_D_CELLA = CEL_CELLA").
  const byFk = new Map<string, ForeignKeyInfo[]>()
  for (const fk of summary.foreignKeys) {
    const parentKey = `${fk.schema}.${fk.table}`
    const childKey = `${fk.refSchema}.${fk.refTable}`
    // self-FK: quasi mai utili come condizione aggiuntiva di un ON tra tabelle diverse
    if (parentKey.toLowerCase() === childKey.toLowerCase()) continue
    // se l'ON ha una coppia determinata, restano solo le relazioni tra quelle due tabelle
    if (hasOnPair && (!onTableKeys.has(parentKey) || !onTableKeys.has(childKey))) continue
    // con l'ON vuoto restano solo le relazioni che coinvolgono la tabella appena unita
    if (!hasConditions && lastJoinTable) {
      const parentName = fk.table.toLowerCase()
      const childName = fk.refTable.toLowerCase()
      if (parentName !== lastJoinTable && childName !== lastJoinTable) continue
    }
    const parent = refs.find(r => `${r.table.schema}.${r.table.name}`.toLowerCase() === parentKey.toLowerCase())
    const child = refs.find(r => `${r.table.schema}.${r.table.name}`.toLowerCase() === childKey.toLowerCase())
    if (!parent || !child) continue
    const pairKey = [fk.column.toLowerCase(), fk.refColumn.toLowerCase()].sort().join('=')
    if (used.has(pairKey)) continue
    const key = fk.name || `${fk.table}.${fk.refTable}`
    const list = byFk.get(key)
    if (list) list.push(fk)
    else byFk.set(key, [fk])
  }

  const out: JoinConditionSuggestion[] = []
  // famiglia dell'ultima coppia scritta (per dare priorità alla stessa relazione)
  let lastLeft = ''
  for (const m of onText.matchAll(/([A-Za-z_][\w]*)\s*=\s*([A-Za-z_][\w]*)/gi)) lastLeft = m[1]

  for (const fks of byFk.values()) {
    const parts: string[] = []
    const first = fks[0]
    const parent = refs.find(r => `${r.table.schema}.${r.table.name}`.toLowerCase() === `${first.schema}.${first.table}`.toLowerCase())!
    const child = refs.find(r => `${r.table.schema}.${r.table.name}`.toLowerCase() === `${first.refSchema}.${first.refTable}`.toLowerCase())!
    const parentCols = colByKey.get(`${parent.table.schema}.${parent.table.name}`) ?? new Set()
    const childCols = colByKey.get(`${child.table.schema}.${child.table.name}`) ?? new Set()
    let famScore = 0
    for (const fk of fks) {
      const leftPart = parentCols.has(fk.column.toLowerCase()) && !childCols.has(fk.column.toLowerCase())
        ? fk.column
        : `${parent.table.name}.${fk.column}`
      const rightPart = childCols.has(fk.refColumn.toLowerCase()) && !parentCols.has(fk.refColumn.toLowerCase())
        ? fk.refColumn
        : `${child.table.name}.${fk.refColumn}`
      parts.push(`${sqlIdent(leftPart)} = ${sqlIdent(rightPart)}`)
      if (lastLeft) famScore = Math.max(famScore, sharedLeadingTokens(lastLeft, fk.column) * 400)
    }
    out.push({
      text: `${hasConditions ? 'AND ' : ''}${parts.join(' AND ')}`,
      left: fks[0].column,
      right: fks[0].refColumn,
      score: 1000 + famScore,
    })
  }

  return out.sort((a, b) => b.score - a.score)
}

/**
 * Controparti di una colonna tra le tabelle dello statement:
 * prima le FK esatte (colonna sinistra = colonna di una FK → colonna referenziata),
 * poi le colonne che condividono almeno un token di nome (es. "mis_d_cella" → "cel_cella").
 */
export function findJoinCounterparts(
  leftColumnName: string,
  leftTable: TableInfo | null,
  statementTables: TableInfo[],
  foreignKeys: ForeignKeyInfo[],
): JoinCounterpart[] {
  const out: JoinCounterpart[] = []
  const seen = new Set<string>()
  const leftKey = leftTable ? `${leftTable.schema}.${leftTable.name}` : ''
  const add = (c: ColumnInfo, t: TableInfo, score: number, viaFk: boolean) => {
    const key = `${t.schema}.${t.name}.${c.name}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ column: c, table: t, score, viaFk })
  }
  if (leftTable) {
    for (const fk of foreignKeys) {
      const fkMatch =
        fk.schema.toLowerCase() === leftTable.schema.toLowerCase() &&
        fk.table.toLowerCase() === leftTable.name.toLowerCase() &&
        fk.column.toLowerCase() === leftColumnName.toLowerCase()
      if (!fkMatch) continue
      const refTable = statementTables.find(
        t =>
          t.schema.toLowerCase() === fk.refSchema.toLowerCase() &&
          t.name.toLowerCase() === fk.refTable.toLowerCase(),
      )
      const refCol = refTable?.columns?.find(
        c => c.name.toLowerCase() === fk.refColumn.toLowerCase(),
      )
      if (refTable && refCol) add(refCol, refTable, 2000, true)
    }
  }

  // Partner con chiave condivisa: colonne di ALTRE tabelle che referenziano lo STESSO
  // target della colonna sinistra (es. GM_PIAZZOLA → PZ_PIAZZOLA e BPZ_PIAZZOLA → PZ_PIAZZOLA:
  // sono i partner di join naturali, da proporre per primi).
  if (leftTable) {
    const leftTargets = new Set<string>()
    for (const fk of foreignKeys) {
      if (
        fk.schema.toLowerCase() === leftTable.schema.toLowerCase() &&
        fk.table.toLowerCase() === leftTable.name.toLowerCase() &&
        fk.column.toLowerCase() === leftColumnName.toLowerCase()
      ) {
        leftTargets.add(`${fk.refSchema}.${fk.refTable}.${fk.refColumn}`.toLowerCase())
      }
    }
    if (leftTargets.size > 0) {
      for (const t of statementTables) {
        if (t.schema.toLowerCase() === leftTable.schema.toLowerCase() && t.name.toLowerCase() === leftTable.name.toLowerCase()) continue
        for (const c of t.columns ?? []) {
          for (const fk of foreignKeys) {
            if (
              fk.table.toLowerCase() === t.name.toLowerCase() &&
              fk.column.toLowerCase() === c.name.toLowerCase() &&
              leftTargets.has(`${fk.refSchema}.${fk.refTable}.${fk.refColumn}`.toLowerCase())
            ) {
              add(c, t, 1500, true)
              break
            }
          }
        }
      }
    }
  }
  const leftTokens = nameTokens(leftColumnName).filter(tok => tok.length >= 3)
  if (leftTokens.length > 0) {
    for (const t of statementTables) {
      if (leftTable && `${t.schema}.${t.name}` === leftKey) continue
      for (const c of t.columns ?? []) {
        const cTokens = nameTokens(c.name).filter(tok => tok.length >= 3)
        let shared = 0
        for (const lt of leftTokens) {
          if (cTokens.some(ct => ct.startsWith(lt) || lt.startsWith(ct))) shared++
        }
        if (shared > 0 && c.name.toLowerCase() !== leftColumnName.toLowerCase()) {
          add(c, t, 100 + shared * 50, false)
        }
      }
    }
  }
  return out.sort((a, b) => b.score - a.score)
}

/** Suggerimento di colonna per i contesti WHERE/ON/HAVING/GROUP/ORDER/SET. */
export interface ColumnContextSuggestion {
  name: string
  insertText: string
  dataType: string
  isNullable: boolean
  isIdentity: boolean
  ownerLabel: string
  shared: boolean
  documentation: string
  score: number
  /** True se è una controparte di JOIN (FK o token condiviso), non una colonna dello statement. */
  counterpart: boolean
}

/** Nomi (minuscoli) delle colonne coinvolte in foreign key: sono le "chiavi" usate nei JOIN/WHERE reali. */
export function fkColumnNames(foreignKeys: ForeignKeyInfo[]): Set<string> {
  const set = new Set<string>()
  for (const fk of foreignKeys) {
    set.add(fk.column.toLowerCase())
    set.add(fk.refColumn.toLowerCase())
  }
  return set
}

/**
 * Elenco ordinato di colonne per il contesto colonna corrente:
 * - se c'è una colonna sinistra in "ON/WHERE ... = " → prima le sue controparti (FK, poi token);
 * - se il cursore è dentro una parola → solo le colonne con affinità, ordinate per punteggio;
 * - altrimenti tutte le colonne delle tabelle dello statement.
 */
export function buildColumnContextSuggestions(
  stmtText: string,
  stmtBefore: string,
  typedWord: string,
  summary: DatabaseSummary,
  columnHistoryBoost: (columnName: string) => number = () => 0,
): ColumnContextSuggestion[] {
  const refTables = extractStatementTableRefs(stmtText)
    .map(r => ({ r, table: summary.tables.find(t => t.name.toLowerCase() === r.tableName.toLowerCase()) }))
    .filter((x): x is { r: StatementTableRef; table: TableInfo } => x.table !== undefined)

  // proprietari per nome colonna (label = alias o nome tabella) e chiave per alias/tabella
  const colOwners = new Map<string, { col: ColumnInfo; table: TableInfo; label: string }[]>()
  const aliasToKey = new Map<string, string>()
  for (const { r, table } of refTables) {
    const label = r.alias ?? table.name
    aliasToKey.set(label.toLowerCase(), `${table.schema}.${table.name}`)
    for (const c of table.columns ?? []) {
      const lower = c.name.toLowerCase()
      const list = colOwners.get(lower)
      if (list) list.push({ col: c, table, label })
      else colOwners.set(lower, [{ col: c, table, label }])
    }
  }

  const statementTables = refTables.map(x => x.table)

  // controparti (FK esatte + token condivisi) della colonna sinistra se presente
  const left = detectLeftColumnInOn(stmtBefore)
  let leftTable: TableInfo | null = null
  if (left) {
    if (left.qualifier) {
      const key = aliasToKey.get(left.qualifier.toLowerCase())
      leftTable = statementTables.find(t => `${t.schema}.${t.name}` === key) ?? null
    }
    if (!leftTable) {
      const owners = colOwners.get(left.name.toLowerCase())
      if (owners && owners.length === 1) leftTable = owners[0].table
    }
  }
  const counterpartKey = new Set<string>()
  const counterpartList: JoinCounterpart[] = left
    ? findJoinCounterparts(left.name, leftTable, statementTables, summary.foreignKeys)
    : []
  for (const cp of counterpartList) counterpartKey.add(`${cp.table.schema}.${cp.table.name}.${cp.column.name}`)

  const insertTextFor = (c: ColumnInfo, t: TableInfo): string => {
    const owners = colOwners.get(c.name.toLowerCase()) ?? []
    const shared = owners.length > 1
    if (!shared) return sqlIdent(c.name)
    const entry = owners.find(o => `${o.table.schema}.${o.table.name}` === `${t.schema}.${t.name}`)
    return `${sqlIdent(entry?.label ?? t.name)}.${sqlIdent(c.name)}`
  }

  const docFor = (c: ColumnInfo, t: TableInfo): string => {
    const owners = colOwners.get(c.name.toLowerCase()) ?? []
    return columnInfoMarkdown(
      t,
      c,
      owners.map(o => ({ table: o.table, alias: o.label !== o.table.name ? o.label : null })),
    )
  }

  const out: ColumnContextSuggestion[] = []
  // 1) controparti del JOIN (filtrate per affinità se si sta già digitando una parola)
  const wantTyped = typedWord.trim().length > 0
  for (const cp of counterpartList) {
    if (wantTyped && columnMatchScore(typedWord, cp.column.name) <= 0) continue
    out.push({
      name: cp.column.name,
      insertText: insertTextFor(cp.column, cp.table),
      dataType: cp.column.dataType,
      isNullable: cp.column.isNullable,
      isIdentity: cp.column.isIdentity,
      ownerLabel: `${cp.table.schema}.${cp.table.name}${cp.viaFk ? ' · FK' : ' · corrispondente'}`,
      shared: (colOwners.get(cp.column.name.toLowerCase()) ?? []).length > 1,
      documentation: docFor(cp.column, cp.table),
      score: cp.score,
      counterpart: true,
    })
  }
  // 2) colonne dello statement (con affinità se si sta digitando)
  const fkCols = fkColumnNames(summary.foreignKeys)
  const ranked: { s: ColumnContextSuggestion }[] = []
  for (const [, owners] of colOwners) {
    const first = owners[0]
    const key = `${first.table.schema}.${first.table.name}.${first.col.name}`
    if (counterpartKey.has(key)) continue
    // la colonna sinistra del confronto è già scritta: non va riproposta
    if (left && first.col.name.toLowerCase() === left.name.toLowerCase()) continue
    const base = wantTyped ? columnMatchScore(typedWord, first.col.name) : 1
    if (base <= 0) continue
    const fkBoost = fkCols.has(first.col.name.toLowerCase()) ? 150 : 0
    const histBoost = columnHistoryBoost(first.col.name) * 120
    ranked.push({
      s: {
        name: first.col.name,
        insertText: insertTextFor(first.col, first.table),
        dataType: first.col.dataType,
        isNullable: first.col.isNullable,
        isIdentity: first.col.isIdentity,
        ownerLabel:
          owners.length === 1 ? owners[0].label : owners.map(o => o.label).join(', '),
        shared: owners.length > 1,
        documentation: docFor(first.col, first.table),
        score: base + fkBoost + histBoost,
        counterpart: false,
      },
    })
  }
  ranked.sort((a, b) => b.s.score - a.s.score)
  out.push(...ranked.map(x => x.s))
  return out
}

/** Colonne di una tabella qualificata con il suo alias/nome (es. dopo "r." o "RUN_MISSIONI."). */
export interface QualifiedColumnSuggestion {
  name: string
  insertText: string
  dataType: string
  isNullable: boolean
  documentation: string
}

/**
 * Suggerisce le colonne di una tabella quando il testo prima del cursore termina
 * con "alias." o "tabella." (es. "FROM RUN_MISSIONI r WHERE r.").
 * Restituisce l'elenco qualificato con il prefisso digitato.
 */
export function buildQualifiedColumnSuggestions(
  stmtText: string,
  prefix: string,
  summary: DatabaseSummary,
): QualifiedColumnSuggestion[] {
  // estrae l'identificatore prima del punto finale (es. "r." → "r")
  const m = /([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*$/i.exec(prefix)
  if (!m) return []
  const qualifier = m[1]

  // mappa alias/tabella → TableInfo per lo statement
  const refs = extractStatementTableRefs(stmtText)
    .map(r => ({ r, table: summary.tables.find(t => t.name.toLowerCase() === r.tableName.toLowerCase()) }))
    .filter((x): x is { r: StatementTableRef; table: TableInfo } => x.table !== undefined)

  const table = refs.find(({ r }) => (r.alias ?? r.tableName).toLowerCase() === qualifier.toLowerCase())?.table
  if (!table?.columns) return []

  const qual = sqlIdent(qualifier)
  return table.columns.map(c => ({
    name: c.name,
    insertText: `${qual}.${sqlIdent(c.name)}`,
    dataType: c.dataType,
    isNullable: c.isNullable,
    documentation: columnInfoMarkdown(table, c),
  }))
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
    if (/[A-Za-z_#]/.test(ch)) {
      // '#' ammesso: identificatori di tabelle temporanee (#temp, ##temp)
      let j = i
      while (j < n && /[A-Za-z0-9_#]/.test(text[j])) j++
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
  'bulk',
  // parole riservate ufficiali (elenco Microsoft) mancanti sopra
  'add', 'authorization', 'browse', 'cascade', 'checkpoint', 'clustered', 'collate', 'column',
  'compute', 'current', 'current_date', 'current_time', 'current_timestamp', 'current_user',
  'database', 'dbcc', 'deallocate', 'disk', 'distributed', 'double', 'dump', 'errlvl', 'escape',
  'except', 'exit', 'external', 'file', 'fillfactor', 'holdlock', 'identity_insert', 'identitycol',
  'intersect', 'lineno', 'load', 'national', 'nocheck', 'nonclustered', 'offsets', 'opendatasource',
  'openquery', 'openrowset', 'openxml', 'percent', 'plan', 'precision', 'proc', 'public', 'readtext',
  'reconfigure', 'replication', 'restrict', 'rowcount', 'rowguidcol', 'securityaudit', 'session_user',
  'setuser', 'shutdown', 'statistics', 'system_user', 'tablesample', 'textsize', 'to', 'tran',
  'try_convert', 'tsequal', 'updatetext', 'varying', 'writetext', 'openjson', 'generate_series',
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

/** Palette dei colori disponibili (per il selettore colore dei database). */
export const dbColorPalette = DB_TAB_COLORS

/**
 * Colore stabile della tab in base al nome del database associato;
 * se esiste un colore personalizzato (override) vince quello.
 */
export function dbTabColor(dbName: string, overrides?: Record<string, string>): string {
  const custom = overrides?.[dbName]
  if (custom) return custom
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
/** Descrizione (proprietà estesa MS_Description) da una lista di proprietà, se presente. */
function msDescription(props: { name: string; value: string }[] | null | undefined): string | null {
  const p = props?.find(x => x.name === 'MS_Description')
  return p ? p.value : null
}

/**
 * Separa le funzioni utente del database per tipo d'uso:
 * - `scalars` (FN e tipi sconosciuti): utilizzabili nelle ESPRESSIONI (SELECT/WHERE/GROUP BY/…);
 * - `tableValued` (IF inline / TF): utilizzabili SOLO come sorgente (FROM/JOIN/APPLY), come le tabelle.
 */
export function splitUserFunctions(functions: FunctionInfo[]): { scalars: FunctionInfo[]; tableValued: FunctionInfo[] } {
  const scalars: FunctionInfo[] = []
  const tableValued: FunctionInfo[] = []
  for (const f of functions) {
    if (f.type === 'IF' || f.type === 'TF') tableValued.push(f)
    else scalars.push(f)
  }
  return { scalars, tableValued }
}

/**
 * Documentazione markdown per tooltip/autocompletamento: layout curato a sezioni
 * (intestazione, tabella riassuntiva, descrizione, proprietà estese) invece del
 * testo piatto di prima.
 */
export function columnInfoMarkdown(table: TableInfo, column: ColumnInfo | null, owners?: ResolvedToken['owners']): string {
  const lines: string[] = []
  if (column) {
    const size = column.maxLength ? `(${column.maxLength})` : ''
    const flags = [
      column.isNullable ? 'NULL' : 'NOT NULL',
      column.isIdentity ? 'IDENTITY' : null,
      column.isComputed ? 'COMPUTED' : null,
    ]
      .filter(Boolean)
      .join(' · ')
    lines.push(`**📄 ${column.name}** — \`${column.dataType}${size}\` · ${flags}`)
    lines.push('')
    lines.push('| | |')
    lines.push('| --- | --- |')
    lines.push(`| **Tabella** | \`${table.schema}.${table.name}\` |`)
    if (column.isIdentity) lines.push('| **Identity** | Sì |')
    if (column.isComputed) lines.push('| **Calcolata** | Sì |')
    if (owners && owners.length > 1) {
      lines.push(`| **Presente anche in** | ${owners.map(o => `\`${o.table.schema}.${o.table.name}\``).join(', ')} |`)
    }
    if (column.description) lines.push('', `**Descrizione:** ${column.description}`)
    const props = column.extendedProperties ?? []
    if (props.length > 0) {
      lines.push('', '**Proprietà estese:**')
      for (const p of props) lines.push(`- **${p.name}:** ${p.value}`)
    }
  } else {
    lines.push(`**🗄️ ${table.schema}.${table.name}** · *${table.columnCount} colonne*`)
    if (table.usage) {
      lines.push('')
      lines.push('| | |')
      lines.push('| --- | --- |')
      if (table.usage.rowCount > 0) lines.push(`| **Righe** | ${formatCount(table.usage.rowCount)} |`)
      if (table.usage.fkIncoming > 0) lines.push(`| **Riferimenti** | ${table.usage.fkIncoming} |`)
      if (table.usage.fkOutgoing > 0) lines.push(`| **JOIN** | ${table.usage.fkOutgoing} |`)
      if (table.usage.dependencyCount > 0) lines.push(`| **Dipendenze** | ${table.usage.dependencyCount} |`)
    }
    const desc = msDescription(table.extendedProperties)
    if (desc) lines.push('', `**Descrizione:** ${desc}`)
    const props = (table.extendedProperties ?? []).filter(p => p.name !== 'MS_Description')
    if (props.length > 0) {
      lines.push('', '**Proprietà estese:**')
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
  /** True se la colonna è coinvolta in una foreign key (chiave usata nei JOIN). */
  isFk: boolean
  /** Testo da inserire: qualificato (alias.tabella.col) se il nome è condiviso tra più tabelle. */
  insertText: string
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
  const fkCols = fkColumnNames(summary.foreignKeys)
  for (const [, entry] of colMap) {
    const shared = entry.owners.length > 1
    columns.push({
      name: entry.c.name,
      dataType: entry.c.dataType,
      isNullable: entry.c.isNullable,
      isIdentity: entry.c.isIdentity,
      ownerLabel:
        entry.owners.length === 1 ? entry.owners[0].label : entry.owners.map(o => o.label).join(', '),
      shared,
      documentation: columnInfoMarkdown(
        entry.owners[0].table,
        entry.c,
        entry.owners.map(o => ({ table: o.table, alias: null })),
      ),
      isFk: fkCols.has(entry.c.name.toLowerCase()),
      // colonna condivisa tra più tabelle: insert qualificato per non essere ambigua
      insertText: shared
        ? `${sqlIdent(entry.owners[0].label)}.${sqlIdent(entry.c.name)}`
        : sqlIdent(entry.c.name),
    })
  }
  // Colonne coinvolte in FK (chiavi) prima delle altre: sono quelle usate nei JOIN reali
  columns.sort((a, b) => (b.isFk ? 1 : 0) - (a.isFk ? 1 : 0))
  return { starText, starCount, starOffset, columns }
}

/**
 * Colonne della select-list filtrate per affinità con la parola digitata e ordinate
 * per punteggio. Il boost FK (+150) si applica SOLO alle colonne che matchano già:
 * digitando "uso" non devono comparire le chiavi estranee che non contengono "uso".
 */
export function rankSelectListForTyped(
  columns: SelectListColumn[],
  typedWord: string,
): { col: SelectListColumn; score: number }[] {
  return columns
    .map(col => ({ col, base: columnMatchScore(typedWord, col.name) }))
    .filter(x => x.base > 0)
    .map(x => ({ col: x.col, score: x.base + (x.col.isFk ? 150 : 0) }))
    .sort((a, b) => b.score - a.score)
}

// ---------- Parametri EXEC ----------

/** Parametri di una procedura non ancora digitati nel testo dopo il nome (afterProc). */
export function filterUnusedParams(parameters: ProcParamInfo[], afterProc: string): ProcParamInfo[] {
  const used = new Set([...afterProc.matchAll(/@([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1].toLowerCase()))
  return parameters.filter(p => !used.has(p.name.toLowerCase()))
}

/** Snippet "tutti i parametri": IN → @p1=${1:default} (tab-stop con default se noto), OUTPUT → @nome OUTPUT. */
export function buildExecParamSnippet(parameters: ProcParamInfo[]): string {
  return parameters
    .map((par, i) => {
      if (par.mode === 'OUTPUT') return `@${par.name} OUTPUT`
      const def = par.defaultValue
      return def !== undefined && def !== null && def !== '' ? `@${par.name}=\${${i + 1}:${def}}` : `@${par.name}=\${${i + 1}}`
    })
    .join(', ')
}

// ---------- Definizioni oggetti (Create or Alter) ----------

/**
 * Prepara una definizione per la modifica: "CREATE PROCEDURE ..." o "ALTER PROCEDURE ..."
 * → "CREATE OR ALTER PROCEDURE ..." (eseguibile anche su un oggetto esistente).
 * "CREATE OR ALTER ..." resta invariato; se non inizia con CREATE/ALTER, testo invariato.
 * Prima dell'intestazione salta BOM, spazi e commenti iniziali (riga o a blocco), così
 * "Modifica" apre SEMPRE in CREATE OR ALTER anche se la definizione non parte
 * letteralmente con CREATE/ALTER.
 */
export function toCreateOrAlterStatement(definition: string): string {
  let i = definition.charCodeAt(0) === 0xfeff ? 1 : 0
  const n = definition.length
  let prefix = ''
  for (;;) {
    // spazi e righe vuote: non fanno parte del prefisso conservato
    while (i < n && (definition[i] === ' ' || definition[i] === '\t' || definition[i] === '\n' || definition[i] === '\r')) i += 1
    const ch = definition[i]
    if (ch === '-' && definition[i + 1] === '-') {
      const eol = definition.indexOf('\n', i + 2)
      const end = eol === -1 ? n : eol + 1
      prefix += definition.slice(i, end)
      i = end
      continue
    }
    if (ch === '/' && definition[i + 1] === '*') {
      const close = definition.indexOf('*/', i + 2)
      const end = close === -1 ? n : close + 2
      prefix += definition.slice(i, end)
      i = end
      continue
    }
    break
  }
  const head = definition.slice(i)
  const m = /^(?:CREATE|ALTER)\s+(?:OR\s+ALTER\s+)?/i.exec(head)
  if (!m) return definition
  return prefix + 'CREATE OR ALTER ' + head.slice(m[0].length)
}

/** Parole chiave che non possono essere alias di tabella: se seguono il nome, la tabella non ha alias. */
const TABLE_ALIAS_BLOCK =
  'JOIN|INNER|LEFT|RIGHT|CROSS|FULL|OUTER|ON|WHERE|AND|OR|NOT|GROUP|ORDER|BY|HAVING|UNION|ALL|' +
  'SET|VALUES|INTO|FROM|UPDATE|DELETE|INSERT|SELECT|GO|WITH|WHEN|THEN|ELSE|END|CASE|IN|IS|' +
  'LIKE|BETWEEN|EXISTS|TOP|DISTINCT|USE|EXEC|EXECUTE|RETURN|MERGE|TRUNCATE|TABLE|AS|' +
  'APPLY|PIVOT|UNPIVOT|FOR|COLLATE|EXCEPT|INTERSECT|OUTPUT|OPTION|OVER|PARTITION|ROW_NUMBER|' +
  'RANK|DENSE_RANK|NTILE|LAG|LEAD|OFFSET|FETCH|NOCOUNT|RECOMPILE|TABLESAMPLE|BACKUP|RESTORE|' +
  'GRANT|REVOKE|DENY|KILL|DBCC|CHECKPOINT|RECONFIGURE|SHUTDOWN|TRAN|TRANSACTION|COMMIT|ROLLBACK|' +
  'SAVE|DECLARE|PRINT|IF|WHILE|BREAK|CONTINUE|GOTO|WAITFOR|RAISERROR|THROW|TRY|CATCH|OPEN|CLOSE|' +
  'CURSOR|DEALLOCATE|BULK|CONTAINS|CONTAINSTABLE|FREETEXT|FREETEXTTABLE|OPENROWSET|OPENQUERY|' +
  'OPENDATASOURCE|TABLESAMPLE|INTERSECT|EXCEPT|WITHIN|ADMINISTER|ASSEMBLY|ASYMMETRIC|AUTHORIZATION|' +
  'CASCADE|CHECKPOINT|CLUSTERED|COLUMN|COMPUTE|CONSTRAINT|CURRENT|DATABASE|DEFAULT|DISK|DOUBLE|' +
  'DUMP|ERRLVL|ESCAPE|EXIT|EXTERNAL|FILE|FILLFACTOR|FOREIGN|FREETEXTTABLE|HOLDLOCK|IDENTITY|' +
  'INDEX|KEY|LINENO|LOAD|NATIONAL|NOCHECK|NONCLUSTERED|OF|OFF|OFFSETS|PERCENT|PLAN|PRECISION|' +
  'PRIMARY|PROC|PROCEDURE|PUBLIC|READ|READTEXT|REFERENCES|REPLICATION|RESTRICT|REVERT|ROWGUIDCOL|' +
  'RULE|SCHEMA|SECURITYAUDIT|SESSION_USER|SETUSER|SOME|STATISTICS|SYSTEM_USER|TEXTSIZE|TO|TSEQUAL|' +
  'UNIQUE|UPDATETEXT|USER|VARYING|VIEW|WRITETEXT|ADD|ANY|ASC|DESC|CURRENT_DATE|CURRENT_TIME|' +
  'CURRENT_TIMESTAMP|CURRENT_USER|IDENTITYCOL|IDENTITY_INSERT|ROWCOUNT|NULLIF|COALESCE|GROUPING'

/**
 * Regex condivisa per estrarre i riferimenti a tabelle (FROM/JOIN/UPDATE/INTO/TABLE):
 * il gruppo alias è preceduto da un lookahead negativo che blocca le parole chiave,
 * così "FROM a JOIN b" NON cattura JOIN come alias di a (bug che nascondeva b).
 */
const TABLE_REF_RE = new RegExp(
  '\\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\\s+' +
    '((?:\\[[^\\]]+\\]|[A-Za-z_][A-Za-z0-9_]*)(?:\\s*\\.\\s*(?:\\[[^\\]]+\\]|[A-Za-z_][A-Za-z0-9_]*))?)' +
    '(?:\\s+(?:AS\\s+)?(?!(?:' + TABLE_ALIAS_BLOCK + ')\\b)([A-Za-z_][A-Za-z0-9_]*))?',
  'gi',
)

/** Estrae le tabelle referenziate (FROM/JOIN/UPDATE/INTO) da un intero statement, con eventuale alias. */
export function extractStatementTableRefs(text: string): StatementTableRef[] {
  const re = TABLE_REF_RE
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
  // funzioni TABELLARI (IF = inline, TF = table-valued): colorate come le tabelle
  const tvfByLower = new Map<string, FunctionInfo>()
  for (const f of summary.functions) {
    if (f.type === 'IF' || f.type === 'TF') tvfByLower.set(f.name.toLowerCase(), f)
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
    const re = TABLE_REF_RE
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
      // colonna di una tabella temporanea ("#temp.col"): col colore della #temp
      if (qLower.startsWith('#')) {
        result.push({ index: i, tableKey: tok.qualifier, isTableName: false })
        continue
      }
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
      // funzione tabellare qualificata (es. dbo.fn_…): colorata come le tabelle
      const fnQ = tvfByLower.get(tok.lower)
      if (fnQ) {
        result.push({ index: i, tableKey: `${fnQ.schema}.${fnQ.name}`, isTableName: true })
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

    // funzione tabellare: colorata come le tabelle (es. FROM dbo.fn_… o senza schema)
    const fn = tvfByLower.get(tok.lower)
    if (fn) {
      result.push({ index: i, tableKey: `${fn.schema}.${fn.name}`, isTableName: true })
      continue
    }

    // tabella temporanea (#temp / ##temp): colore stabile per nome
    if (tok.lower.startsWith('#')) {
      result.push({ index: i, tableKey: tok.text, isTableName: true })
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
 * Costruisce la clausola ON del JOIN dalla FK: "ON (tabellaContesto.col = candidata.col)".
 * Le parentesi seguono la convenzione dominante nelle stored procedure reali (~2/3 degli ON).
 * Se un nome di colonna è univoco tra le tabelle in scope della query, il prefisso
 * con il nome della tabella viene omesso (es. "ON (UDC_UDC = MIS_UDC)"). Le parentesi
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
  return `${qualified(candidate.schema, candidate.name)} ON (${ctxPart} = ${candPart})`
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

/** Voce di completamento per una relazione (JOIN) selezionabile. */
export interface JoinSuggestionItem {
  /** Testo mostrato nel widget (nome tabella + eventuale colonna della relazione). */
  label: string
  /** Dettaglio: quale FK/colonna collega. */
  detail: string
  /** Testo inserito: nome tabella oppure "tabella ON (a.x = b.y)" in posizione JOIN. */
  insertText: string
  /** Testo usato da Monaco per il filtro (nome tabella). */
  filterText: string
}

/** Genera un alias breve per una tabella (iniziali delle parole, es. RUN_MISSIONI → rm). */
export function tableAlias(name: string): string {
  const parts = name
    .split(/[_\s]+/)
    .filter(Boolean)
    .map(p => p[0].toLowerCase())
  if (parts.length === 0) return name[0]?.toLowerCase() ?? 't'
  if (parts.length === 1) return (name[0] + name[1]).toLowerCase()
  return parts.join('')
}

/**
 * Costruisce le voci di completamento per una tabella candidata:
 * - in posizione JOIN, UNA voce per ogni relazione FK verso le tabelle del contesto
 *   (ognuna con la propria clausola ON), come Visual Studio che propone i casi possibili;
 * - con una sola relazione (o fuori da JOIN) una voce unica con la tabella.
 * Gli alias si usano SOLO quando servono: `useAliases` per la tabella candidata
 * (es. self-join, dove senza alias il nome sarebbe ambiguo) e `aliasedCtxTables`
 * per le tabelle del contesto che nell'editor hanno GIÀ un alias (in quel caso
 * l'ON deve riferirsi all'alias, non al nome tabella). Altrimenti l'ON usa i nomi
 * delle tabelle o la colonna nuda se non ambigua.
 */
export function buildJoinSuggestions(
  candidate: RankedTable,
  contextTableInfos: TableInfo[],
  isJoinPosition: boolean,
  useAliases = false,
  aliasedCtxTables: Set<string> = new Set(),
): JoinSuggestionItem[] {
  const t = candidate.table
  const base = qualified(t.schema, t.name)
  const candAlias = useAliases ? tableAlias(t.name) : null
  // alias per le tabelle del contesto (per qualificare l'altro lato dell'ON)
  const ctxAlias = new Map<string, string>()
  for (const ct of contextTableInfos) ctxAlias.set(`${ct.schema}.${ct.name}`, tableAlias(ct.name))
  const scope = [...contextTableInfos, t]

  if (!isJoinPosition) {
    const fkNames = new Set(candidate.hints.map(h => h.fk.name))
    return [
      {
        label: base,
        // senza relazioni (es. lista completa in un nuovo FROM) il dettaglio resta
        // vuoto così il chiamante mostra l'utilizzo reale della tabella
        detail: candidate.hints.length === 0
          ? ''
          : fkNames.size === 1 && candidate.hints.length === 1
            ? `${candidate.hints[0].fk.column} = ${candidate.hints[0].fk.refColumn}`
            : `${fkNames.size} relazioni disponibili`,
        insertText: base,
        filterText: t.name,
      },
    ]
  }

  // In posizione JOIN: PRIMA le relazioni FK dirette, poi quelle transitive (via),
  // così il suggerimento più diretto non viene sepolto sotto i join a 2 hop.
  const items: JoinSuggestionItem[] = []

  // Raggruppa gli hint per NOME del vincolo FK: le FK composite (DEST, SORG, SYNCRON)
  // generano UNA voce con tutte le coppie nell'ON (es. "ON (a = b AND c = d)").
  const byFk = new Map<string, JoinHint[]>()
  for (const h of candidate.hints) {
    const key = h.fk.name || `${h.fk.table}.${h.fk.refTable}:${h.fk.column}=${h.fk.refColumn}`
    const list = byFk.get(key)
    if (list) list.push(h)
    else byFk.set(key, [h])
  }

  for (const hints of byFk.values()) {
    const first = hints[0].fk
    const on = hints
      .map(h => {
        const fk = h.fk
        const ctxColumn = h.direction === 'out' ? fk.refColumn : fk.column
        const candColumn = h.direction === 'out' ? fk.column : fk.refColumn
        const ctxTableName = h.direction === 'out' ? fk.refTable : fk.table
        // lato contesto: l'alias si usa se richiesto (useAliases) o se la query lo usa
        // già (ctxHasAlias, altrimenti l'ON sarebbe SQL invalido)
        const ctxHasAlias = aliasedCtxTables.has(ctxTableName.toLowerCase())
        const ctxQual = useAliases || ctxHasAlias
          ? ctxAlias.get(`${fk.schema}.${ctxTableName}`) ?? sqlIdent(ctxTableName)
          : sqlIdent(ctxTableName)
        const ctxPart =
          useAliases || ctxHasAlias || columnAppearsIn(scope, ctxColumn) > 1
            ? `${ctxQual}.${sqlIdent(ctxColumn)}`
            : sqlIdent(ctxColumn)
        const candPart =
          useAliases || columnAppearsIn(scope, candColumn) > 1
            ? `${useAliases ? candAlias : sqlIdent(t.name)}.${sqlIdent(candColumn)}`
            : sqlIdent(candColumn)
        return `${ctxPart} = ${candPart}`
      })
      .join(' AND ')
    // etichetta con la prima colonna del contesto per distinguere i vincoli (DEST/SORG/SYNCRON)
    const firstCtxCol = hints[0].direction === 'out' ? first.refColumn : first.column
    items.push({
      label: byFk.size > 1 ? `${base} · via ${firstCtxCol}` : base,
      detail: `JOIN ${byFk.size > 1 ? `(${hints.length} col.) ` : ''}su ${on}`,
      insertText: useAliases ? `${base} AS ${candAlias} ON (${on})` : `${base} ON (${on})`,
      filterText: t.name,
    })
  }

  // voci transitive con chiave condivisa (es. "GESTORI_MODULI ON (GM_PIAZZOLA = BPZ_PIAZZOLA)")
  const viaPaths = candidate.viaPaths && candidate.viaPaths.length > 0
    ? candidate.viaPaths
    : candidate.viaPath
      ? [candidate.viaPath]
      : []
  for (const v of viaPaths) {
    const onText = `${sqlIdent(v.candColumn)} = ${sqlIdent(v.ctxColumn)}`
    items.push({
      label: base,
      detail: `JOIN via ${v.midTable} su ${onText}`,
      insertText: `${base} ON (${onText})`,
      filterText: t.name,
    })
  }

  if (items.length > 0) return items
  return [
    {
      label: base,
      detail: candidate.viaTable ? `raggiungibile via ${candidate.viaTable} (join transitivo)` : 'nessuna relazione FK nota',
      insertText: base,
      filterText: t.name,
    },
  ]
}

// ---------- Self-join (il corso T-SQL dedica lezioni a "Cross Joins and Self Joins") ----------

export interface SelfJoinSuggestion {
  label: string
  detail: string
  insertText: string
  filterText: string
}

/**
 * Suggerimenti di SELF-JOIN: le tabelle già presenti nello statement (FROM/JOIN)
 * vengono riproposte come "tabella AS alias" per unire la tabella con sé stessa.
 * L'ON viene compilato dalle FK autoreferenziali (es. manager_id → id) usando il
 * riferimento esistente (alias o nome) sul lato contesto e un nuovo alias sull'altro.
 */
export function buildSelfJoinSuggestions(stmtText: string, summary: DatabaseSummary): SelfJoinSuggestion[] {
  const refs = extractStatementTableRefs(stmtText)
  const tablesByLower = new Map<string, TableInfo>()
  for (const t of summary.tables) tablesByLower.set(t.name.toLowerCase(), t)
  const existingAliases = new Set(refs.filter(r => r.alias).map(r => r.alias!.toLowerCase()))
  const out: SelfJoinSuggestion[] = []
  const seen = new Set<string>()
  for (const r of refs) {
    const key = r.tableName.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const table = tablesByLower.get(key)
    if (!table) continue
    const ctxQual = r.alias ?? table.name
    // alias nuovo che non collide con quelli già scritti nello statement
    let newAlias = tableAlias(table.name)
    while (
      existingAliases.has(newAlias.toLowerCase()) ||
      newAlias.toLowerCase() === ctxQual.toLowerCase()
    ) {
      newAlias += '2'
    }
    const selfFks = summary.foreignKeys.filter(
      fk => fk.table.toLowerCase() === key && fk.refTable.toLowerCase() === key,
    )
    const base = qualified(table.schema, table.name)
    const aliasText = `${base} AS ${newAlias}`
    if (selfFks.length === 0) {
      out.push({
        label: aliasText,
        detail: 'self-join (scrivi l\'ON)',
        insertText: aliasText,
        filterText: table.name,
      })
      continue
    }
    // un elemento per ogni FK autoreferenziale (come "una voce per FK" dei JOIN)
    for (const fk of selfFks) {
      // il lato figlio (colonna FK) è il nuovo alias, il lato padre (refColumn) è il riferimento esistente
      const on = `${newAlias}.${sqlIdent(fk.column)} = ${sqlIdent(ctxQual)}.${sqlIdent(fk.refColumn)}`
      out.push({
        label: aliasText,
        detail: `self-join su ${on}`,
        insertText: `${aliasText} ON (${on})`,
        filterText: table.name,
      })
    }
  }
  return out
}
