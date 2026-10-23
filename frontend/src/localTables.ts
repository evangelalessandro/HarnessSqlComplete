// Tabelle "locali" definite nel testo dell'editor:
//   - temporanee:  CREATE TABLE #t (…),  SELECT … INTO #t FROM …,  INSERT INTO #t (…)
//   - variabili tabella: DECLARE @t TABLE (…),  INSERT INTO @t (…)
// L'intellisense le tratta come tabelle dello schema, così propone le loro colonne
// anche dentro il batch/routine che le crea (es. "… JOIN #TBL_X t WHERE ").
// Logica PURA e testabile: nessuna dipendenza da Monaco o dal backend.

import { tokenizeSql } from './helpers'
import type { SqlToken } from './helpers'
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

/**
 * Indice della prossima '(' fuori da stringhe/commenti, anche a capo (o -1).
 * Nelle store di questo database la lista delle colonne comincia sulla riga DOPO il nome
 * ("create table #t\n  ("): una ricerca che si ferma al primo a capo lasciava la temporanea
 * senza colonne e l'intellisense non ne proponeva i campi.
 * Fra il nome e la parentesi sono ammessi SOLO spazi, a capo e commenti: se il primo
 * carattere "vero" non è una parentesi non c'è nessuna lista e non si va a prendere la
 * parentesi di un altro statement.
 */
function findOpenParenMultiRiga(text: string, from: number): number {
  const limite = Math.min(text.length, from + 4000)
  let i = from
  while (i < limite) {
    const skipped = skipNoise(text, i)
    if (skipped !== i) {
      i = skipped
      continue
    }
    const ch = text[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    return ch === '(' ? i : -1
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

/** TableInfo "locale" (temporanea, variabile tabella o CTE) con le colonne note. */
function makeLocalTable(name: string, columns: ColumnInfo[]): TableInfo {
  return {
    schema: 'dbo',
    name,
    columnCount: columns.length,
    createDate: null,
    columns,
    usage: null,
    extendedProperties: null,
  }
}

/**
 * Indice della parola 'as' a livello 0 nell'elemento (quello di alias), o -1.
 * Serve a NON scambiare per alias l'`as` interno di una funzione:
 * "CAST('' as nvarchar(50)) as X_SSCC_DEST" → l'alias è X_SSCC_DEST, non nvarchar.
 */
function topLevelAs(item: string): number {
  let depth = 0
  let i = 0
  while (i < item.length) {
    const skipped = skipNoise(item, i)
    if (skipped !== i) {
      i = skipped
      continue
    }
    const ch = item[i]
    if (ch === '(') {
      depth++
      i++
      continue
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1)
      i++
      continue
    }
    if (depth === 0 && (ch === 'a' || ch === 'A') && (item[i + 1] === 's' || item[i + 1] === 'S') && !/[\w$#]/.test(item[i + 2] ?? '') && !/[\w$#]/.test(item[i - 1] ?? '')) {
      return i
    }
    i++
  }
  return -1
}

/** True se fra il testo precedente e il token c'è un OPERATORE o una parentesi aperta (allora
 *  non è un alias): "a + b" → b non è un alias; "CAST(x as int) Y" → Y è un alias. */
function operatorePrimaDi(item: string, tokStart: number): boolean {
  let k = tokStart - 1
  while (k >= 0 && /\s/.test(item[k])) k--
  if (k < 0) return true
  return '+-*/%=<>|&,(['.includes(item[k])
}

/** Parole che non sono mai un alias (chiudono un'espressione o un CASE). */
const NON_ALIAS = new Set([
  'end', 'then', 'else', 'when', 'case', 'null', 'as', 'and', 'or', 'not', 'asc', 'desc',
  'distinct', 'all', 'by', 'from', 'where', 'on', 'over', 'partition',
])

/** Elementi di una select-list: nomi di colonna e presenza di '*'. */
export function selectListInfo(list: string): { names: string[]; star: boolean } {
  const names: string[] = []
  let star = false
  // "SELECT TOP 10 *", "SELECT DISTINCT *": il prefisso non fa parte della lista
  const senzaPrefisso = list
    .replace(/^\s*(?:DISTINCT|ALL)\s+/i, '')
    .replace(/^\s*TOP\s*(?:\(\s*\d+\s*\)|\d+)\s*(?:PERCENT)?\s*(?:WITH\s+TIES\s*)?/i, '')
  for (const raw of splitTopLevel(senzaPrefisso)) {
    const item = raw.replace(/^\s*(?:DISTINCT|ALL)\s+/i, '').trim()
    if (!item) continue
    // "*" oppure "alias.*": tutte le colonne della sorgente
    if (item === '*' || /(?:^|\.)\s*\*$/.test(item)) {
      star = true
      continue
    }
    const words = tokenizeSql(item)
    if (words.length === 0) continue
    const asAt = topLevelAs(item)
    if (asAt !== -1) {
      const afterAs = item.slice(asAt + 2)
      const alias = tokenizeSql(afterAs)[0]
      if (alias) {
        names.push(alias.text)
        continue
      }
    }
    // nome semplice (eventualmente qualificato)
    const simple = /^(?:\[[^\]]+\]|[A-Za-z_@#][\w#$@]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_@#][\w#$@]*))?$/
    if (simple.test(item)) {
      names.push(words[words.length - 1].text)
      continue
    }
    // "espressione ALIAS": l'ultimo identificatore è l'alias se non ha un operatore davanti
    // (es. "SCO_GIAC + SCO_VER X_GIAC", "0 X_CORRIDOIO", "CAST(0 as decimal(15,0)) X_UDC_DEST")
    const ultimo = words[words.length - 1]
    if (!ultimo || NON_ALIAS.has(ultimo.lower)) continue
    if (operatorePrimaDi(item, ultimo.start)) continue
    // il token che precede non deve essere 'as' (sarebbe il tipo di un CAST: "cast(x as int)")
    const precedente = words[words.length - 2]
    if (precedente?.lower === 'as') continue
    names.push(ultimo.text)
  }
  return { names, star }
}

/**
 * Nomi delle colonne di una select-list (per "SELECT … INTO #t"):
 * "col", "a.col", "expr AS alias", "expr alias" → nome; espressioni senza alias → ignorate
 * (SQL Server non assegna loro un nome).
 */
export function parseSelectListNames(list: string): string[] {
  return selectListInfo(list).names
}

/** Trova l'indice della '(' della lista colonne, anche se è sulla riga successiva al nome. */
function columnListOf(text: string, nameTokEnd: number): ColumnInfo[] {
  const open = findOpenParenMultiRiga(text, nameTokEnd)
  if (open === -1) return []
  const close = matchParen(text, open)
  if (close === -1) return []
  return parseColumnDefs(text.slice(open + 1, close))
}

/** Parola (o carattere) che precede `from`, saltando SOLO spazi: serve a capire se il nome di
 *  una CTE è preceduto da "with" o da una virgola. Scansione all'indietro, niente regex:
 *  la versione con `text.slice(0, i).replace(/(?:\s|…)*$/, '')` esplodeva con i file grandi
 *  (backtracking catastrofico → la pagina si bloccava digitando in una store lunga). */
function primaPrimaDi(text: string, from: number): string {
  let k = from - 1
  while (k >= 0 && /\s/.test(text[k])) k--
  if (k < 0) return ''
  if (!/[A-Za-z_]/.test(text[k])) return text[k]
  let inizio = k
  while (inizio > 0 && /[A-Za-z0-9_]/.test(text[inizio - 1])) inizio--
  return text.slice(inizio, k + 1)
}

/**
 * Nome della tabella sorgente dopo FROM, saltando la qualifica dello schema:
 * "from dbo.DAT_UDC x" → "DAT_UDC" (l'alias non serve: le colonne sono quelle della tabella).
 * Senza questo lo "*" di "[dbo].[T]" non si risolveva (il token dopo FROM è "dbo").
 */
function sourceNameAfter(text: string, tokens: SqlToken[], fromIdx: number): string {
  let nome = ''
  for (let i = fromIdx + 1; i < tokens.length; i++) {
    const t = tokens[i]
    if (!nome) {
      nome = nameAt(text, t)
      continue
    }
    // si prosegue solo se i due token sono uniti da un punto (stesso nome qualificato);
    // altrimenti è un alias, un hint ("with (nolock)") o l'inizio di un'altra clausola
    if (!text.slice(tokens[i - 1].end, t.start).includes('.')) break
    nome = nameAt(text, t)
  }
  return nome
}

/**
 * Colonne della SELECT-list di una sottoquery racchiusa fra `open` (la sua "(") e `close`.
 * `columnsOf` risolve una sorgente nota quando la lista è "*" (tabelle dello schema,
 * temporanee, CTE). Vale sia per il corpo di una CTE sia per una tabella derivata.
 */
function subqueryColumns(
  text: string,
  open: number,
  close: number,
  columnsOf: (name: string, depth?: number) => ColumnInfo[],
  depth = 0,
): ColumnInfo[] {
  const body = text.slice(open + 1, close)
  const bodyTokens = tokenizeSql(body)
  const selectTok = bodyTokens.find(t => t.lower === 'select')
  if (!selectTok) return []
  let fromTok: SqlToken | undefined
  let par = 0
  for (let i = 0; i < bodyTokens.length; i++) {
    const t = bodyTokens[i]
    if (t.start < selectTok.start) continue
    // il FROM di primo livello del corpo chiude la select-list
    const between = body.slice(bodyTokens[i - 1]?.end ?? 0, t.start)
    par += (between.match(/\(/g) ?? []).length - (between.match(/\)/g) ?? []).length
    if (par <= 0 && t.lower === 'from') {
      fromTok = t
      break
    }
  }
  const listText = body.slice(selectTok.end, fromTok ? fromTok.start : body.length)
  const info = selectListInfo(listText)
  const cols: ColumnInfo[] = info.names.map(n => makeColumn(n, ''))
  if (info.star && fromTok) {
    const src = sourceNameAfter(body, bodyTokens, bodyTokens.indexOf(fromTok))
    for (const c of columnsOf(src, depth + 1)) {
      if (!cols.some(x => x.name.toLowerCase() === c.name.toLowerCase())) cols.push(makeColumn(c.name, c.dataType))
    }
  }
  return cols
}

/**
 * Colonne delle CTE definite nel testo ("with tbl as (select …), altra as (…)"), così una
 * "SELECT * INTO #t FROM tbl" può copiarle: senza questo le colonne della CTE (che spesso
 * sono alias: "SCO_SCOMPARTO X_SCO") non arrivano all'intellisense.
 * La risoluzione dello '*' dentro una CTE usa le tabelle note e le altre CTE.
 */
function extractCteColumns(
  text: string,
  tokens: SqlToken[],
  knownTables: TableInfo[],
): Map<string, { name: string; columns: ColumnInfo[] }> {
  const map = new Map<string, { name: string; columns: ColumnInfo[] }>()

  /** Colonne di una sorgente risolvibile: CTE o tabella nota. */
  const columnsOf = (name: string, depth = 0): ColumnInfo[] => {
    if (depth > 4 || !name) return []
    const cte = map.get(name.toLowerCase())
    if (cte) return cte.columns
    const known = knownTables.find(t => t.name.toLowerCase() === name.toLowerCase())
    return known?.columns ?? []
  }

  /** Colonne del corpo di una CTE a partire dalla sua SELECT. */
  const bodyColumns = (openParen: number, closeParen: number, depth: number): ColumnInfo[] =>
    subqueryColumns(text, openParen, closeParen, columnsOf, depth)

  // "with NOME as ( … )" e le CTE successive ", NOME as ( … )": il tokenizer non restituisce
  // la virgola, quindi si guarda il TESTO prima del nome
  for (let i = 2; i < tokens.length; i++) {
    if (tokens[i].lower !== 'as') continue
    const nameTok = tokens[i - 1]
    if (!nameTok || nameTok.lower === 'as') continue
    if (isLocalTableName(nameAt(text, nameTok))) continue
    const prima = primaPrimaDi(text, nameTok.start)
    if (!/^with$/i.test(prima) && prima !== ',') continue
    // la "(" della CTE può essere a capo ("with nome\n as (select …)"): non si usa
    // findOpenParen, che si ferma al newline (va bene per "nome (colonne)" ma non qui).
    // Ricerca LIMITATA: la parentesi è sempre a pochi caratteri dal nome.
    let open = -1
    const limite = Math.min(text.length, tokens[i].end + 4000)
    for (let k = tokens[i].end; k < limite; k++) {
      const skipped = skipNoise(text, k)
      if (skipped !== k) {
        k = skipped - 1
        continue
      }
      if (text[k] === '(') {
        open = k
        break
      }
      if (text[k] === ';') break
    }
    if (open === -1) continue
    // il corpo di una CTE inizia con SELECT (evita di scambiare per CTE altro codice)
    const dopoParen = text.slice(open + 1).replace(/^[\s(]+/, '')
    if (!/^select\b/i.test(dopoParen)) continue
    const close = matchParen(text, open)
    if (close === -1) continue
    map.set(nameTok.lower, { name: nameTok.text, columns: bodyColumns(open, close, 0) })
  }
  return map
}

/**
 * CTE del testo come "tabelle" locali (nome della CTE + colonne della sua select-list).
 * Servono all'intellisense per "from c where c." / "from c pippo where pippo." e per le
 * colonne non qualificate: le CTE, come le temporanee, non sono nello schema del database.
 */
export function extractCteTables(text: string, knownTables: TableInfo[] = []): TableInfo[] {
  const tokens = tokenizeSql(text)
  return [...extractCteColumns(text, tokens, knownTables).values()]
    .filter(cte => cte.columns.length > 0)
    .map(cte => makeLocalTable(cte.name, cte.columns))
}

/** Parole che non possono essere l'alias di una tabella derivata ("… ) on …", "… ) where …"). */
const NON_ALIAS_DERIVATA = new Set([
  'on', 'where', 'group', 'order', 'having', 'inner', 'left', 'right', 'full', 'cross', 'outer',
  'join', 'union', 'except', 'intersect', 'select', 'and', 'or', 'not', 'set', 'values', 'when',
  'then', 'else', 'end', 'option', 'for', 'with', 'as', 'pivot', 'unpivot', 'apply', 'return',
  'begin', 'if', 'go', 'insert', 'update', 'delete', 'from', 'into', 'declare', 'exec', 'execute',
])

/** Salta spazi e commenti a partire da `i` (per leggere l'alias dopo la ")" di una derivata). */
function saltaSpaziECommenti(text: string, from: number): number {
  let i = from
  const n = text.length
  for (;;) {
    if (i >= n) return n
    if (/\s/.test(text[i])) {
      i++
      continue
    }
    const skipped = skipNoise(text, i)
    if (skipped !== i) {
      i = skipped
      continue
    }
    return i
  }
}

/** Alias dopo la ")" di una tabella derivata: "… ) t", "… ) AS t", "… ) AS [t]". */
function aliasDopoParen(text: string, from: number): string | null {
  let i = saltaSpaziECommenti(text, from)
  // "AS" facoltativo (confronto su una fetta minima: nessuna scansione del testo intero)
  if (text.slice(i, i + 2).toLowerCase() === 'as' && !/[A-Za-z0-9_]/.test(text[i + 2] ?? '')) {
    i = saltaSpaziECommenti(text, i + 2)
  }
  if (text[i] === '[') {
    const close = text.indexOf(']', i + 1)
    if (close === -1) return null
    const nome = text.slice(i + 1, close).trim()
    return nome && !NON_ALIAS_DERIVATA.has(nome.toLowerCase()) ? nome : null
  }
  const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i, i + 128))
  if (!m) return null
  return NON_ALIAS_DERIVATA.has(m[0].toLowerCase()) ? null : m[0]
}

/**
 * Tabelle derivate: "( select … ) alias" nel FROM/JOIN, comprese le funzioni tabellari
 * richiamate nel FROM ("from dbo.fn_Mia(1) t"). Il sommario le porta con il NOME DELL'ALIAS,
 * così scrivendo "t." compaiono le colonne della sottoquery (segnalazione utente: con
 * "inside join (select dbo.fn_X() X_BAIA) t on …" il "t." non proponeva X_BAIA).
 * Lo "*" dentro la sottoquery si risolve con le tabelle note (schema, temporanee, CTE).
 */
export function extractDerivedTables(text: string, knownTables: TableInfo[] = []): TableInfo[] {
  const out: TableInfo[] = []
  const byAlias = new Map<string, TableInfo>()
  const columnsOf = (name: string, depth = 0): ColumnInfo[] => {
    if (depth > 4 || !name) return []
    return knownTables.find(t => t.name.toLowerCase() === name.toLowerCase())?.columns ?? []
  }
  // "from (…)", "join (…)" e anche "cross/outer apply (…)" (tutte tabelle derivate)
  const re = /\b(?:from|join|apply)\s*\(/gi
  for (const m of text.matchAll(re)) {
    const open = m.index + m[0].length - 1
    const close = matchParen(text, open)
    if (close === -1) continue
    const alias = aliasDopoParen(text, close + 1)
    if (!alias) continue
    const key = alias.toLowerCase()
    if (byAlias.has(key)) continue
    // una parentesi su un join ("from (t1 join t2 on …) x") non ha una select-list: si scarta
    const cols = subqueryColumns(text, open, close, columnsOf, 0)
    if (cols.length === 0) continue
    const tabella = makeLocalTable(alias, cols)
    byAlias.set(key, tabella)
    out.push(tabella)
  }
  return out
}

/**
 * Tabelle locali definite nel testo. Le definizioni dentro commenti/stringhe sono
 * ignorate; se la stessa tabella è definita più volte le colonne vengono UNITE
 * (vince il tipo già noto). Per "SELECT * INTO #t FROM x" le colonne sono copiate
 * da `knownTables` (o dalla CTE) quando la tabella sorgente è nota.
 */
export function extractLocalTables(text: string, knownTables: TableInfo[] = []): TableInfo[] {
  const tokens = tokenizeSql(text)
  const byName = new Map<string, TableInfo>()
  const cteColumns = extractCteColumns(text, tokens, knownTables)

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
          const info = selectListInfo(listText)
          for (const n of info.names) addColumn(table, makeColumn(n, ''))
          if (info.star) {
            // "SELECT … * … INTO #t FROM x": le colonne arrivano dalla sorgente, che può
            // essere una CTE del testo, un'altra tabella locale o una tabella dello schema
            const fromTok = tokens.find((t, idx) => idx > i && t.lower === 'from')
            const srcTok = fromTok ? tokens[tokens.indexOf(fromTok) + 1] : undefined
            const srcName = srcTok ? nameAt(text, srcTok) : ''
            const srcCols =
              cteColumns.get(srcName.toLowerCase())?.columns ??
              byName.get(srcName.toLowerCase())?.columns ??
              findByLower(srcName)?.columns ??
              []
            for (const c of srcCols) addColumn(table, makeColumn(c.name, c.dataType))
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
        const open = findOpenParenMultiRiga(text, nameTok.end)
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
