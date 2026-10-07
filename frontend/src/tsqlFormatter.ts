// Formattatore T-SQL basato sul profilo FormatProfile (stile Redgate/SQL Prompt).
// Due motori:
//  1) formatSqlWithProfile  → query semplici (SELECT/INSERT/UPDATE/DELETE/MERGE)
//  2) formatRoutineWithProfile → routine (procedure/funzioni/trigger) con blocchi:
//     firma con parametri allineati e virgola iniziale, AS su riga propria,
//     corpo indentato, BEGIN/END, IF/ELSE, WHILE, CASE/WHEN/THEN/END,
//     EXEC con parametri allineati, DECLARE, label a margine, GO.

import type { FormatProfile } from './formatProfile'

type Token =
  | { type: 'word'; text: string; blank?: number }
  | { type: 'string'; text: string; blank?: number }
  | { type: 'comment'; text: string; ownLine?: boolean; blank?: number }
  | { type: 'punct'; text: string; blank?: number }

/** Tokenizza il testo SQL rispettando stringhe, commenti e operatori. */
export function tokenizeSqlText(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = text.length
  // true se, da inizio riga, non è ancora comparso codice (solo spazi)
  let atLineStart = true
  // righe vuote (a-capo consecutivi) incontrate dall'ultimo token emesso
  let pendingBlank = 0
  const pushToken = (t: Token) => {
    if (pendingBlank > 0) {
      t.blank = pendingBlank
      pendingBlank = 0
    }
    tokens.push(t)
  }
  while (i < n) {
    const ch = text[i]
    // commento di riga
    if (ch === '-' && text[i + 1] === '-') {
      const end = text.indexOf('\n', i)
      const slice = text.slice(i, end === -1 ? n : end)
      pushToken({ type: 'comment', text: slice, ownLine: atLineStart })
      atLineStart = false
      i += slice.length
      continue
    }
    // commento a blocco
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const slice = text.slice(i, end === -1 ? n : end + 2)
      // su riga propria se inizia a inizio riga oppure occupa più righe
      pushToken({ type: 'comment', text: slice, ownLine: atLineStart || slice.includes('\n') })
      atLineStart = false
      i += slice.length
      continue
    }
    // stringa N'...' o '...'
    if (ch === "'" || (ch === 'N' && text[i + 1] === "'")) {
      const start = i
      i += ch === 'N' ? 2 : 1
      while (i < n) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            i += 2
            continue
          }
          i++
          break
        }
        i++
      }
      pushToken({ type: 'string', text: text.slice(start, i) })
      atLineStart = false
      continue
    }
    // identificatore tra parentesi quadre: [dbo].[Nome] resta un unico token
    if (ch === '[') {
      const end = text.indexOf(']', i + 1)
      const slice = text.slice(i, end === -1 ? n : end + 1)
      pushToken({ type: 'word', text: slice })
      atLineStart = false
      i += slice.length
      continue
    }
    // tabella temporanea: "#nome" / "##nome" restano UN token (niente spazio dopo #)
    if (ch === '#' && /[A-Za-z0-9_#]/.test(text[i + 1] ?? '')) {
      const m = /^#+[A-Za-z0-9_]*/.exec(text.slice(i))
      if (m) {
        pushToken({ type: 'word', text: m[0] })
        atLineStart = false
        i += m[0].length
        continue
      }
    }
    // parola/identificatore (con @ per variabili, e numeri)
    if (/[A-Za-z_@]/.test(ch) || (ch >= '0' && ch <= '9')) {
      const m = /^[A-Za-z_@][A-Za-z0-9_@]*|\d+(?:\.\d+)?/.exec(text.slice(i))
      if (m) {
        pushToken({ type: 'word', text: m[0] })
        atLineStart = false
        i += m[0].length
        continue
      }
    }
    // spazi bianchi: saltati (la ricostruzione decide gli spazi), ma si contano
    // le righe vuote tra i token (a-capo immediatamente seguiti da un altro a-capo)
    if (/\s/.test(ch)) {
      let blank = 0
      while (i < n && /\s/.test(text[i])) {
        if (text[i] === '\n') {
          // riga vuota: dopo questo a-capo arriva subito un altro a-capo (o spazi + a-capo)
          let j = i + 1
          while (j < n && (text[j] === ' ' || text[j] === '\t' || text[j] === '\r')) j++
          if (j < n && text[j] === '\n') blank++
          atLineStart = true
        }
        i++
      }
      pendingBlank = blank
      continue
    }
    // punteggiatura/operatori (max 2 caratteri). NEGLI operatori composti di assegnazione
    // ("@x += 1", "@y -= 2") i due caratteri sono UN SOLO operatore: senza questa fusione il
    // layout li univa con uno spazio e usciva "@x + = 1" (segnalato dall'utente).
    const two = text.slice(i, i + 2)
    if (
      ['>=', '<=', '<>', '!=', '||', '::', '->', '=>',
        '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^='].includes(two)
    ) {
      pushToken({ type: 'punct', text: two })
      atLineStart = false
      i += 2
      continue
    }
    pushToken({ type: 'punct', text: ch })
    atLineStart = false
    i++
  }
  return tokens
}

/** Parole chiave SQL T-SQL (per il case e per il riconoscimento delle clausole). */
const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER', 'ON',
  'GROUP', 'BY', 'HAVING', 'ORDER', 'UNION', 'ALL', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
  'DELETE', 'MERGE', 'USING', 'WHEN', 'MATCHED', 'NOT', 'THEN', 'AS', 'AND', 'OR', 'IN', 'IS',
  'LIKE', 'BETWEEN', 'EXISTS', 'TOP', 'DISTINCT', 'CASE', 'ELSE', 'END', 'BEGIN', 'DECLARE',
  'EXEC', 'EXECUTE', 'PRINT', 'RETURN', 'RETURNS', 'IF', 'WHILE', 'ELSE', 'GO', 'WITH', 'TRUNCATE',
  'OUTPUT', 'OPTION', 'RECOMPILE', 'NOCOUNT', 'TRANSACTION', 'COMMIT', 'ROLLBACK', 'SAVE',
  'PROCEDURE', 'FUNCTION', 'TRIGGER', 'CREATE', 'ALTER', 'DROP', 'GOTO', 'RAISERROR', 'THROW',
  'TRY', 'CATCH', 'OPEN', 'CLOSE', 'FETCH', 'DEALLOCATE', 'BREAK', 'CONTINUE', 'WAITFOR',
  'USE', 'TABLE', 'VIEW', 'CURSOR', 'LOCAL', 'FAST_FORWARD', 'READ_ONLY', 'FOR', 'INTO',
  'SCOPE_IDENTITY', 'IDENTITY', 'BULK', 'CONVERT', 'CAST', 'ROW_NUMBER', 'DENSE_RANK', 'NTILE',
  'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE', 'NEXT', 'PRIOR', 'ABSOLUTE', 'RELATIVE', 'SCROLL',
  'XACT_ABORT', 'ANSI_NULLS', 'QUOTED_IDENTIFIER', 'NOCOUNT', 'ARITHABORT', 'CONCAT_NULL_YIELDS_NULL',
  'NUMERIC_ROUNDABORT', 'ANSI_PADDING', 'ANSI_WARNINGS', 'CURSOR_CLOSE_ON_COMMIT', 'IMPLICIT_TRANSACTIONS',
  'LOCK_TIMEOUT', 'REMOTE_PROC_TRANSACTIONS', 'ROWCOUNT', 'STATISTICS', 'DATEFORMAT', 'LANGUAGE',
  // parole riservate ufficiali (elenco Microsoft) per il case coerente
  'ADD', 'ANY', 'ASC', 'AUTHORIZATION', 'BACKUP', 'BROWSE', 'CASCADE', 'CHECK', 'CHECKPOINT',
  'CLUSTERED', 'COALESCE', 'COLLATE', 'COLUMN', 'COMPUTE', 'CONSTRAINT', 'CONTAINS', 'CONTAINSTABLE',
  'CURRENT', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'CURRENT_USER', 'DATABASE', 'DBCC',
  'DEFAULT', 'DENY', 'DESC', 'DISK', 'DISTRIBUTED', 'DOUBLE', 'DUMP', 'ERRLVL', 'ESCAPE', 'EXCEPT',
  'EXIT', 'EXTERNAL', 'FILE', 'FILLFACTOR', 'FOREIGN', 'FREETEXT', 'FREETEXTTABLE', 'GRANT',
  'HOLDLOCK', 'IDENTITY_INSERT', 'IDENTITYCOL', 'INDEX', 'INTERSECT', 'KEY', 'KILL', 'LINENO',
  'LOAD', 'NATIONAL', 'NOCHECK', 'NONCLUSTERED', 'NULL', 'NULLIF', 'OF', 'OFF', 'OFFSETS',
  'OPENDATASOURCE', 'OPENQUERY', 'OPENROWSET', 'OPENXML', 'OVER', 'PERCENT', 'PIVOT', 'PLAN',
  'PRECISION', 'PRIMARY', 'PROC', 'PUBLIC', 'READ', 'READTEXT', 'RECONFIGURE', 'REFERENCES',
  'REPLICATION', 'RESTORE', 'RESTRICT', 'REVERT', 'REVOKE', 'ROWGUIDCOL', 'RULE', 'SCHEMA',
  'SECURITYAUDIT', 'SESSION_USER', 'SETUSER', 'SHUTDOWN', 'SOME', 'SYSTEM_USER', 'TABLESAMPLE',
  'TEXTSIZE', 'TO', 'TRAN', 'TRY_CONVERT', 'TSEQUAL', 'UNIQUE', 'UNPIVOT', 'UPDATETEXT', 'USER',
  'VARYING', 'WRITETEXT', 'APPLY', 'EXCEPT', 'INTERSECT', 'PIVOT', 'UNPIVOT',
])

const TYPES = new Set([
  'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'BIT', 'DECIMAL', 'NUMERIC', 'MONEY', 'SMALLMONEY',
  'FLOAT', 'REAL', 'DATE', 'DATETIME', 'DATETIME2', 'SMALLDATETIME', 'TIME', 'DATETIMEOFFSET',
  'CHAR', 'VARCHAR', 'NCHAR', 'NVARCHAR', 'TEXT', 'NTEXT', 'BINARY', 'VARBINARY', 'IMAGE',
  'UNIQUEIDENTIFIER', 'XML', 'SQL_VARIANT', 'ROWVERSION', 'TIMESTAMP',
])

/** Clausole principali di un statement (a livello top). */
const CLAUSE_KEYWORDS = [
  'FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'UNION', 'INNER', 'LEFT', 'RIGHT', 'FULL',
  'CROSS', 'JOIN', 'ON', 'SET', 'VALUES', 'USING', 'WHEN', 'OUTPUT', 'OPTION', 'INTO',
  'APPLY', 'PIVOT', 'UNPIVOT', 'FOR', 'EXCEPT', 'INTERSECT',
]

interface Row {
  indent: number
  text: string
}

/** True se il testo è una routine (procedura/funzione/trigger) o codice procedurale. */
export function isRoutineText(sql: string): boolean {
  // Consapevole di stringhe e commenti (via tokenizer): la parola "PRINT" dentro
  // 'To Print' NON è codice procedurale (bug che instradava le query al motore sbagliato).
  const words = tokenizeSqlText(sql)
    .filter(t => t.type === 'word')
    .map(t => t.text.toUpperCase())
  if (words.length === 0) return false

  // firma di routine: CREATE/ALTER [OR ALTER] PROCEDURE|FUNCTION|TRIGGER|VIEW
  let k = 0
  if (words[k] === 'CREATE' || words[k] === 'ALTER') {
    k++
    if (words[k] === 'OR' && words[k + 1] === 'ALTER') k += 2
    if (words[k] === 'PROCEDURE' || words[k] === 'PROC' || words[k] === 'FUNCTION' || words[k] === 'TRIGGER' || words[k] === 'VIEW') {
      return true
    }
  }

  // parole chiave di codice procedurale a livello di token
  const ROUTINE_WORDS = new Set(['BEGIN', 'DECLARE', 'EXEC', 'EXECUTE', 'PRINT', 'GOTO', 'RAISERROR', 'THROW'])
  if (words.some(w => ROUTINE_WORDS.has(w))) return true

  // IF ... BEGIN insieme → corpo procedurale
  const ifIdx = words.indexOf('IF')
  if (ifIdx !== -1 && words.slice(ifIdx + 1).includes('BEGIN')) return true
  return false
}

// Pulizia di una riga/porzione "inline": spaziature attorno a punteggiatura e tipi.
// Le regole valgono SOLO per il codice: stringhe, commenti e identificatori fra parentesi
// quadre vanno copiati alla lettera. Senza questa distinzione il testo dentro le stringhe
// veniva riscritto ('by p. rate' → 'by p.rate', 'a  b' → 'a b'): il confronto con i dati
// del database cambiava pur essendo "solo" una formattazione.
// NB: lo spazio PRIMA della parentesi ("IIF (x)", "ltrim (x)") e quello dopo un meno unario
// ("- 1") NON si toccano: su richiesta dell'utente restano come sono scritti.
const cleanInlineCode = (text: string) =>
  text
    // operatori composti già separati da uno spazio ("+ ="): si riuniscono. Serve anche a
    // RIPARARE il testo formattato da una versione precedente ("@x + = 1" → "@x += 1").
    .replace(/([+\-*/%&|^])\s+=(?!=)/g, '$1=')
    .replace(/\s*\.\s*/g, '.')
    .replace(/\s*,/g, ',')
    .replace(/\s+;/g, ';')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    // niente spazio tra tipo e parentesi: NVARCHAR(max), DECIMAL(18,2)
    .replace(/\b(NVARCHAR|VARCHAR|NCHAR|CHAR|DECIMAL|NUMERIC|BINARY|VARBINARY|DATETIME2|DATETIMEOFFSET)\s*\(/gi, '$1(')
    .replace(/\s+/g, ' ')

const cleanInline = (text: string): string => {
  let out = ''
  let code = ''
  const flushCode = () => {
    if (code) {
      out += cleanInlineCode(code)
      code = ''
    }
  }
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === "'") {
      // stringa: fino all'apostrofo di chiusura ('' è un apostrofo dentro la stringa)
      flushCode()
      let j = i + 1
      while (j < text.length) {
        if (text[j] === "'") {
          if (text[j + 1] === "'") {
            j += 2
            continue
          }
          j++
          break
        }
        j++
      }
      out += text.slice(i, j)
      i = j
      continue
    }
    if (c === '[') {
      // identificatore delimitato: dentro non si tocca nulla
      flushCode()
      const end = text.indexOf(']', i + 1)
      const j = end === -1 ? text.length : end + 1
      out += text.slice(i, j)
      i = j
      continue
    }
    if (c === '-' && text[i + 1] === '-') {
      // commento di riga: il resto del testo è commento
      flushCode()
      out += text.slice(i)
      i = text.length
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      flushCode()
      const end = text.indexOf('*/', i + 2)
      const j = end === -1 ? text.length : end + 2
      out += text.slice(i, j)
      i = j
      continue
    }
    code += c
    i++
  }
  flushCode()
  return out.trim()
}

/**
 * True se i token contengono UNA sola istruzione (usato per i layout speciali che
 * riscrivono l'intero testo: CREATE TABLE). Evita di perdere le istruzioni successive
 * in un batch senza ';' ("create table …\nselect …").
 */
function singleStatementTokens(tokens: Token[]): boolean {
  const STARTERS = new Set([
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'DECLARE', 'SET', 'IF', 'WHILE', 'BEGIN',
    'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'PRINT', 'RETURN', 'GOTO', 'EXEC', 'EXECUTE', 'WITH',
    'GO', 'RAISERROR', 'THROW', 'COMMIT', 'ROLLBACK', 'BACKUP', 'RESTORE', 'GRANT', 'REVOKE',
    'DENY', 'USE', 'DBCC', 'CHECKPOINT',
  ])
  let d = 0
  let seen = 0
  for (const t of tokens) {
    if (t.type === 'punct') {
      if (t.text === '(') d++
      else if (t.text === ')') d = Math.max(0, d - 1)
      continue
    }
    if (t.type !== 'word' || d !== 0) continue
    if (STARTERS.has(t.text.toUpperCase())) {
      seen++
      if (seen > 1) return false
    }
  }
  return true
}

/** Statement puri che meritano il layout "routine": CTE (WITH … AS (…) + statement)
 *  oppure SELECT con almeno 2 assegnazioni "@var = …" a livello top. */
function needsStatementLayout(sql: string): boolean {
  const tokens = tokenizeSqlText(sql).filter(t => t.type !== 'comment')
  const meaningful = tokens.filter(t => t.type !== 'string')
  if (meaningful.length === 0) return false
  let i = 0
  if (meaningful[i]?.type === 'punct' && meaningful[i].text === ';') i++
  if (meaningful[i]?.type === 'word' && meaningful[i].text.toUpperCase() === 'WITH') return true
  if (!(meaningful[i]?.type === 'word' && meaningful[i].text.toUpperCase() === 'SELECT')) return false
  // conta le assegnazioni "@var =" a profondità 0 (pattern "@word" seguito da "=")
  let depth = 0
  let assigns = 0
  for (let k = 0; k < meaningful.length - 1; k++) {
    const t = meaningful[k]
    if (t.type === 'punct') {
      if (t.text === '(') depth++
      else if (t.text === ')') depth = Math.max(0, depth - 1)
      continue
    }
    if (depth === 0 && t.type === 'word' && t.text.startsWith('@')) {
      const next = meaningful[k + 1]
      if (next.type === 'punct' && next.text === '=') assigns++
    }
  }
  // SELECT con CASE nella TESTATA (prima di FROM/WHERE…): lo sa impaginare il motore
  // routine (CASE espanso e clausole successive su righe proprie). Un CASE dentro
  // FROM/WHERE resta invece al motore query.
  {
    let d = 0
    for (const t of meaningful) {
      if (t.type === 'punct') {
        if (t.text === '(') d++
        else if (t.text === ')') d = Math.max(0, d - 1)
        continue
      }
      if (d !== 0 || t.type !== 'word') continue
      const u = t.text.toUpperCase()
      if (u === 'CASE') return true
      if (['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'UNION', 'INTO'].includes(u)) break
    }
  }

  return assigns >= 2
}

/**
 * Formatta una query semplice secondo il profilo (motore query: clausole su righe proprie).
 */
export function formatSqlWithProfile(sql: string, profile: FormatProfile): string {
  // La formattazione interviene SEMPRE (richiesta utente: "la formattazione non fa più nulla").
  // La vecchia regola "testo già impaginato → lascialo identico" è stata tolta: due store scritte
  // nello stesso stile venivano trattate in modo diverso, e l'utente non capiva perché.
  if (isRoutineText(sql)) return formatRoutineWithProfile(sql, profile)
  // statement "a blocchi" senza parole procedurali (es. selezione di un CTE o di una
  // SELECT TOP n @a=…): il motore delle routine ha il layout CTE/assegnazioni/condizioni
  // che il motore query non possiede
  if (needsStatementLayout(sql)) return formatRoutineWithProfile(sql, profile)
  const tokens = tokenizeSqlText(sql)
  if (tokens.length === 0) return sql

  const up = (t: Token): string => {
    if (t.type === 'word') {
      const upper = t.text.toUpperCase()
      if (profile.keywordUpper && KEYWORDS.has(upper)) return upper
      if (profile.dataTypeUpper && TYPES.has(upper)) return upper
      if (t.text.startsWith('@')) return t.text
    }
    return t.text
  }

  // CREATE TABLE: colonne una per riga (con il tipo di dato), indentate
  {
    const head = tokens.find(t => t.type !== 'comment')
    if (head?.type === 'word' && head.text.toUpperCase() === 'CREATE' && singleStatementTokens(tokens)) {
      const unitC = profile.tabSize || 2
      const tableRows = createTableRows(tokens, up, unitC, '')
      if (tableRows) return tableRows.join('\n').trimEnd() + '\n'
    }
  }

  // Testo con PIÙ istruzioni (batch senza ';'): il motore query non separa gli
  // statement e i commenti "--" potrebbero "mangiare" il codice successivo → usa il
  // motore routine, che spezza gli statement e protegge i commenti.
  if (!singleStatementTokens(tokens)) {
    return formatRoutineWithProfile(sql, profile)
  }

  // INSERT … [(campi)] [VALUES (valori)]: un campo/valore per riga, allineati sotto il primo
  // (stesse regole dentro e fuori le store)
  {
    const insertLayout = insertRows(tokens, up, profile.tabSize || 2, '')
    if (insertLayout) {
      const rows = [...insertLayout.rows]
      if (insertLayout.rest.length > 0) {
        // resto dello statement (lo SELECT di "INSERT … (campi) SELECT …"): la select-list sono
        // i VALORI dell'insert, quindi UN valore per riga come per i campi (stesse regole
        // dentro e fuori le store).
        const primo = insertLayout.rest.find(t => t.type !== 'comment')
        const selectRows =
          primo?.type === 'word' && primo.text.toUpperCase() === 'SELECT'
            ? detailedSelectRows(insertLayout.rest, up, profile.tabSize || 2, '', profile.setIndent, profile, true)
            : null
        if (selectRows) rows.push(...selectRows)
        else rows.push(...formatSqlWithProfile(insertLayout.rest.map(up).join(' '), profile).trimEnd().split('\n'))
      }
      return rows.join('\n').trimEnd() + '\n'
    }
  }

  const words = tokens.filter(t => t.type === 'word').length
  const chars = tokens.reduce((acc, t) => acc + t.text.length, 0)
  // La regola "query corta su una riga" NON deve scavalcare le opzioni del profilo:
  // se il profilo chiede l'a capo prima di una clausola presente (FROM/WHERE/JOIN/SET…)
  // la query va su più righe anche se è corta (es. "select * from T where id = 1").
  const breaksRequested = (() => {
    let d = 0
    const firstWord = tokens.find(t => t.type === 'word')?.text.toUpperCase() ?? ''
    for (const t of tokens) {
      if (t.type === 'punct') {
        if (t.text === '(') d++
        else if (t.text === ')') d = Math.max(0, d - 1)
        continue
      }
      if (t.type !== 'word' || d !== 0) continue
      const u = t.text.toUpperCase()
      // FROM è una clausola da mandare a capo solo in SELECT e UPDATE (…FROM …):
      // in "DELETE FROM t" o "RESTORE … FROM DISK" resta attaccata allo statement
      if (u === 'FROM' && profile.breakBeforeFrom && (firstWord === 'SELECT' || firstWord === 'UPDATE')) return true
      if ((u === 'JOIN' || u === 'APPLY') && profile.breakBeforeJoin) return true
      if (['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS'].includes(u) && profile.breakBeforeJoin) return true
      if (u === 'ON' && profile.breakBeforeOn) return true
      if (u === 'WHERE' && profile.breakBeforeWhere) return true
      if (u === 'GROUP' && profile.breakBeforeGroupBy) return true
      if (u === 'HAVING' && profile.breakBeforeHaving) return true
      if (u === 'ORDER' && profile.breakBeforeOrderBy) return true
      if (u === 'UNION' && profile.breakBeforeUnion) return true
      if (u === 'SET' && profile.breakBeforeSet && firstWord === 'UPDATE') return true
      // INTO spezza solo in "SELECT … INTO" (in INSERT INTO resta in testa allo statement)
      if (u === 'INTO' && profile.breakBeforeInto && firstWord === 'SELECT') return true
    }
    return false
  })()
  if (
    profile.singleLineShort &&
    !breaksRequested &&
    chars <= profile.singleLineMaxChars &&
    words <= profile.singleLineMaxWords
  ) {
    return joinTokensInline(tokens, up, profile)
  }

  // CREATE TABLE: colonne una per riga (con il tipo di dato), indentate
  {
    const firstWord = tokens.find(t => t.type !== 'comment')
    if (firstWord?.type === 'word' && firstWord.text.toUpperCase() === 'CREATE') {
      const unitC = profile.tabSize || 2
      const tableRows = createTableRows(tokens, up, unitC, '')
      if (tableRows) return tableRows.join('\n').trimEnd() + '\n'
    }
  }

  // CREATE TABLE: colonne una per riga (con il tipo di dato), indentate
  {
    const firstWord = tokens.find(t => t.type !== 'comment')
    if (firstWord?.type === 'word' && firstWord.text.toUpperCase() === 'CREATE') {
      const unitC = profile.tabSize || 2
      const tableRows = createTableRows(tokens, up, unitC, '')
      if (tableRows) return tableRows.join('\n').trimEnd() + '\n'
    }
  }

  const clauseAt = new Map<number, string>()
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'comment') continue
    if (t.type === 'punct') {
      if (t.text === '(') depth++
      else if (t.text === ')') depth = Math.max(0, depth - 1)
      continue
    }
    if (t.type !== 'word') continue
    const upper = t.text.toUpperCase()
    if (depth === 0 && CLAUSE_KEYWORDS.includes(upper)) {
      clauseAt.set(i, upper)
    }
  }

  const lines: Row[] = []
  let current: string[] = []
  let currentIndent = 0
  /** Clausola iniziata per ultima: serve per spezzare i campi della SET di un UPDATE. */
  let activeClause: string | null = null
  /** True dopo un a-capo di campo SET: la virgola iniziale va attaccata al campo (",col = …"). */
  let setCommaPending = false
  /** True dopo un a-capo della select-list: virgola in testa al campo (",campo"). */
  let stackCommaPending = false

  const flush = () => {
    if (current.length > 0) {
      lines.push({ indent: currentIndent, text: current.join(' ') })
      current = []
    }
  }

  const startLine = (indent: number, tokenText: string) => {
    flush()
    currentIndent = indent
    current = [tokenText]
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const clause = clauseAt.get(i)

    // profondità parentesi reale (per non spezzare AND/virgole dentro le funzioni)
    if (t.type === 'punct') {
      if (t.text === '(') depth++
      else if (t.text === ')') depth = Math.max(0, depth - 1)
    }

    // commento su riga propria: resta sulla sua riga (i token successivi ripartono da capo)
    if (t.type === 'comment' && t.ownLine) {
      flush()
      // se il prossimo token "utile" è la virgola della select-list, il commento appartiene
      // alla lista → rientro dei campi (serve per l'idempotenza di "SELECT a\n -- c\n ,b")
      let j = i + 1
      while (j < tokens.length && tokens[j].type === 'comment') j++
      const nextTok = tokens[j]
      const lastLine = lines.length > 0 ? lines[lines.length - 1].text : ''
      const inSelectColumns = /^SELECT\b/i.test(lastLine) || lastLine.startsWith(',')
      const commentIndent =
        inSelectColumns && nextTok?.type === 'punct' && nextTok.text === ',' && depth === 0
          ? profile.selectColumnIndent
          : currentIndent
      lines.push({ indent: commentIndent, text: t.text })
      current = []
      currentIndent = commentIndent
      continue
    }
    // commento "--" in coda alla riga: chiude la riga — il codice successivo NON deve
    // finire dentro il commento (altrimenti sparirebbe dalla query)
    if (t.type === 'comment' && t.text.startsWith('--')) {
      current.push(up(t))
      flush()
      continue
    }

    if (clause) {
      const isJoinModifier = ['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER'].includes(clause)
      const isJoinWord = clause === 'JOIN' || isJoinModifier
      // SELECT ... INTO #tmp su riga propria (INSERT/MERGE INTO restano attaccati)
      const isSelectStmt = /^\s*SELECT\b/i.test(lines.length > 0 ? lines[0].text : current.join(' '))
      if (isJoinModifier && profile.breakBeforeJoin) {
        // La CATENA INTERA del join resta sulla stessa riga: "LEFT OUTER JOIN", "CROSS APPLY".
        // Prima "LEFT OUTER" finiva su una riga e "JOIN …" su quella dopo.
        const catena: Token[] = [t]
        let k = i + 1
        while (
          k < tokens.length &&
          tokens[k].type === 'word' &&
          (['OUTER', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS'].includes(tokens[k].text.toUpperCase()) ||
            ['JOIN', 'APPLY'].includes(tokens[k].text.toUpperCase()))
        ) {
          catena.push(tokens[k])
          k++
        }
        const ultimo = catena[catena.length - 1]
        if (catena.length > 1 && ['JOIN', 'APPLY'].includes(ultimo.text.toUpperCase())) {
          flush()
          currentIndent = profile.joinIndent
          current = [catena.map(up).join(' ')]
          activeClause = 'JOIN'
          i = k - 1
          continue
        }
      }
      if (
        (clause === 'FROM' && profile.breakBeforeFrom) ||
        (clause === 'INTO' && profile.breakBeforeInto && isSelectStmt) ||
        (isJoinWord && profile.breakBeforeJoin) ||
        (clause === 'APPLY' && profile.breakBeforeJoin) ||
        (clause === 'ON' && profile.breakBeforeOn) ||
        (clause === 'WHERE' && profile.breakBeforeWhere) ||
        (clause === 'GROUP' && profile.breakBeforeGroupBy) ||
        (clause === 'HAVING' && profile.breakBeforeHaving) ||
        (clause === 'ORDER' && profile.breakBeforeOrderBy) ||
        (clause === 'UNION' && profile.breakBeforeUnion) ||
        (clause === 'SET' && profile.breakBeforeSet) ||
        clause === 'VALUES' ||
        clause === 'USING' ||
        clause === 'WHEN' ||
        clause === 'OUTPUT' ||
        clause === 'OPTION' ||
        clause === 'PIVOT' ||
        clause === 'UNPIVOT' ||
        clause === 'FOR' ||
        clause === 'EXCEPT' ||
        clause === 'INTERSECT'
      ) {
        let indent = 0
        if (clause === 'FROM') indent = 0
        else if (clause === 'INTO') indent = 0
        else if (isJoinWord || clause === 'APPLY') indent = profile.joinIndent
        else if (clause === 'WHERE') indent = 0
        else if (clause === 'HAVING') indent = 0
        else if (clause === 'GROUP') indent = 0
        else if (clause === 'ORDER') indent = profile.orderByIndent
        else if (clause === 'SET') indent = profile.setIndent
        else if (clause === 'WHEN') indent = 0
        startLine(indent, up(t))
        activeClause = clause
        continue
      }
    }

    // UPDATE … SET: OGNI campo della SET va a capo (virgola allineata sotto il primo campo)
    if (
      t.type === 'punct' &&
      t.text === ',' &&
      depth === 0 &&
      activeClause === 'SET' &&
      current.length > 0
    ) {
      flush()
      currentIndent = profile.setIndent + 'SET '.length
      current = []
      setCommaPending = true
      continue
    }

    // AND/OR nelle condizioni (WHERE/HAVING/ON): vanno a capo sullo stesso livello
    const upper = t.type === 'word' ? t.text.toUpperCase() : ''
    if (
      (upper === 'AND' || upper === 'OR') &&
      depth === 0 &&
      current.length > 0 &&
      (upper === 'AND' ? profile.breakBeforeAnd : profile.breakBeforeOr)
    ) {
      flush()
      current = [up(t)]
      continue
    }

    // select-list impilata: la virgola va IN TESTA alla riga successiva (così la query
    // resta valida e la formattazione è idempotente: prima la virgola veniva persa e
    // riformattando le colonne si univano — "SELECT a b", query rotta).
    // La rottura avviene a OGNI virgola di primo livello, anche quando il campo corrente è
    // un solo token (es. "UDC_USER_TASK" senza alias): con "current.length > 1" il campo
    // senza alias restava appaiato al successivo (",UDC_USER_TASK, MIS_CAUSMISS X_CAUSMISS").
    if (
      profile.stackSelectColumns &&
      current.length > 0 &&
      (current[0].toUpperCase() === 'SELECT' || current[0].startsWith(',')) &&
      t.type === 'punct' &&
      t.text === ',' &&
      depth === 0
    ) {
      flush()
      currentIndent = profile.selectColumnIndent
      current = []
      stackCommaPending = true
      continue
    }

    // virgola all'inizio di una riga (dopo un commento della select-list): si attacca
    // al campo successivo senza spazio (",campo"), così la formattazione è idempotente
    if (t.type === 'punct' && t.text === ',' && current.length === 0) {
      stackCommaPending = true
      continue
    }

    if (t.type === 'punct' && t.text === ',' && current.length > 0) {
      current[current.length - 1] = current[current.length - 1].replace(/\s+$/, '')
      current.push(',')
      continue
    }

    if (current.length === 0) {
      current.push((setCommaPending || stackCommaPending ? ',' : '') + up(t))
      setCommaPending = false
      stackCommaPending = false
    } else {
      const prev = current[current.length - 1]
      if (t.type === 'punct' && (t.text === ',' || t.text === ')')) {
        current.push(up(t))
      } else if (prev === '(' || prev === '.') {
        current.push(up(t))
      } else {
        current.push(up(t))
      }
    }
  }
  flush()

  const cleanLine = (s: string) =>
    s
      // operatori composti separati ("+ =") riuniti, ma NON dentro le stringhe
      .replace(/('(?:[^']|'')*')|([+\-*/%&|^])\s+=(?!=)/g, (_m, str: string, op: string) =>
        str ? str : `${op}=`,
      )
      .replace(/\s*\.\s*/g, '.')
      .replace(/\s*,/g, ',')
      .replace(/\s+;/g, ';')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      .replace(/\s+/g, ' ')
      .trim()
  const rendered = lines.map(l => ' '.repeat(l.indent) + cleanLine(l.text)).join('\n')
  return rendered.trimEnd() + '\n'
}

/**
 * Formatta una routine (procedura/funzione/trigger) con indentazione a blocchi,
 * nello stile dell'esempio Redgate: firma con parametri allineati e virgola iniziale,
 * AS su riga propria, corpo indentato, BEGIN/END, IF/ELSE, WHILE, CASE/WHEN/THEN/END,
 * EXEC con parametri allineati, DECLARE con virgola iniziale, label a margine.
 */
export function formatRoutineWithProfile(sql: string, profile: FormatProfile): string {
  const tokens = tokenizeSqlText(sql)
  if (tokens.length === 0) return sql

  const up = (t: Token): string => {
    if (t.type === 'word') {
      const upper = t.text.toUpperCase()
      if (profile.keywordUpper && KEYWORDS.has(upper)) return upper
      if (profile.dataTypeUpper && TYPES.has(upper)) return upper
      if (t.text.startsWith('@')) return t.text
    }
    return t.text
  }

  const lines: Row[] = []
  let indent = 0

  const pushLine = (text: string, ind?: number, keepIndent = false) => {
    const indN = ind ?? indent
    // commento a blocco multilinea: preserva le righe interne (niente pulizia/spazi)
    if (text.startsWith('/*') && text.includes('\n')) {
      lines.push({ indent: indN, text })
      return
    }
    // keepIndent: la riga porta già i suoi spazi di allineamento (select-list impilata),
    // che la pulizia inline toglierebbe con il trim finale
    const lead = keepIndent ? text.length - text.trimStart().length : 0
    const clean = cleanInline(text)
    if (clean.length > 0) lines.push({ indent: indN, text: ' '.repeat(lead) + clean })
  }

  // Riga già formattata con spaziature significative (allineamenti a colonna):
  // nessuna pulizia dello whitespace interno. text include l'indentazione base.
  const pushRawLine = (text: string) => {
    const t = text.replace(/\s+$/, '')
    if (t.length > 0) lines.push({ indent: 0, text: t })
  }

  // Passo 1: separa la firma (CREATE/ALTER ... fino alla parentesi di chiusura + AS) dal corpo
  let depth = 0
  let asIndex = -1
  // cerca la '(' dei parametri. La ricerca NON deve scavalcare l'inizio del corpo:
  // in "CREATE PROCEDURE p AS BEGIN INSERT INTO @t (a) SELECT …" la prima '(' del testo
  // è quella della tabella, non dei parametri (la procedura non ne ha): prenderla per
  // la firma spezzava lo statement e faceva sparire la SELECT.
  const SIG_STOP = new Set([
    'BEGIN', 'AS', 'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'DECLARE', 'SET', 'IF',
    'WHILE', 'RETURN', 'EXEC', 'EXECUTE', 'PRINT', 'GOTO', 'RAISERROR', 'THROW', 'END',
    'ELSE', 'COMMIT', 'ROLLBACK', 'TRUNCATE', 'GO',
  ])
  let sigOpen = -1
  // true quando i parametri sono dichiarati SENZA parentesi
  // ("CREATE PROCEDURE p @a int, @b nvarchar(10) AS"): la prima '(' del testo è quella
  // di un TIPO, non l'elenco parametri, e prenderla per la firma spezzava lo statement.
  let firmaSenzaParen = false
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k].type === 'word' && /^(CREATE|ALTER)$/i.test(tokens[k].text)) {
      for (let m = k + 1; m < tokens.length; m++) {
        const t = tokens[m]
        if (t.type === 'comment' || t.type === 'string') continue
        if (t.type === 'punct' && t.text === '(') {
          if (firmaSenzaParen) continue // parentesi di un tipo (es. nvarchar(10))
          sigOpen = m
          break
        }
        if (t.type === 'word') {
          const u = t.text.toUpperCase()
          // firma senza elenco parametri: "CREATE PROCEDURE p AS" → l'AS è quello della firma
          if (u === 'AS') {
            asIndex = m
            break
          }
          if (SIG_STOP.has(u)) break // è già iniziato il corpo: nessuna firma da separare
          // un parametro (@nome) prima di qualsiasi '(' → firma senza parentesi
          if (t.text.startsWith('@')) firmaSenzaParen = true
        }
      }
      break
    }
  }

  if (sigOpen !== -1) {
    // chiudi la firma
    depth = 0
    let sigClose = -1
    for (let k = sigOpen; k < tokens.length; k++) {
      const t = tokens[k]
      if (t.type === 'punct' && t.text === '(') depth++
      else if (t.type === 'punct' && t.text === ')') {
        depth--
        if (depth === 0) {
          sigClose = k
          break
        }
      }
    }
    if (sigClose !== -1) {
      // trova AS dopo sigClose a livello top (senza scavalcare l'inizio del corpo)
      depth = 0
      for (let k = sigClose + 1; k < tokens.length; k++) {
        const t = tokens[k]
        if (t.type === 'punct') {
          if (t.text === '(') depth++
          else if (t.text === ')') depth = Math.max(0, depth - 1)
          continue
        }
        if (t.type === 'comment' || t.type === 'string') continue
        if (depth === 0 && t.type === 'word') {
          const u = t.text.toUpperCase()
          if (u === 'AS') {
            asIndex = k
            break
          }
          if (SIG_STOP.has(u)) break
        }
      }
    }
  }

  // Passo 2: costruisci la firma (CREATE/ALTER ... NOME ( ... )) su righe proprie
  const headerTokens = asIndex !== -1 ? tokens.slice(0, asIndex) : []
  const bodyTokens = asIndex !== -1 ? tokens.slice(asIndex) : tokens

  if (headerTokens.length > 0) {
    // riga intestazione: CREATE/ALTER PROCEDURE [schema].[nome]
    // I commenti iniziali (es. blocco di documentazione che termina con "*/") vanno su
    // righe proprie: la CREATE/ALTER deve iniziare su una NUOVA riga, non dopo il "*/".
    let k = 0
    while (k < headerTokens.length && headerTokens[k].type === 'comment') {
      pushLine(headerTokens[k].text, 0)
      k++
    }
    const header: string[] = []
    while (k < headerTokens.length) {
      const t = headerTokens[k]
      // solo la parentesi dell'elenco parametri chiude l'intestazione: in una firma senza
      // parentesi le '(' del testo sono quelle dei tipi (es. "@pB nvarchar(10) = 'x'")
      if (sigOpen !== -1 && t.type === 'punct' && t.text === '(') break
      if (t.type === 'comment') {
        // commento inline nell'intestazione: lo si accoda alla riga (senza perdere testo)
        header.push(t.text)
        k++
        continue
      }
      header.push(up(t))
      k++
    }
    pushLine(header.join(' '), 0)

    // parentesi aperta su riga propria
    if (sigOpen !== -1 && k < headerTokens.length && headerTokens[k].type === 'punct' && headerTokens[k].text === '(') {
      pushLine('(', 0)
      k++
      // parametri: una riga per parametro con virgola iniziale e TIPO INCOLONNATO
      // (stessa impaginazione del DECLARE: "@nome" allineato, tipo sempre dalla stessa colonna)
      const paramTokens: Token[][] = []
      let currentParam: Token[] = []
      let parDepth = 1
      const isParamSeparator = (tok: Token) => tok.type === 'punct' && tok.text === ',' && parDepth === 1
      for (; k < headerTokens.length; k++) {
        const t = headerTokens[k]
        if (t.type === 'punct' && t.text === '(') {
          parDepth++
          currentParam.push(t)
          continue
        }
        if (t.type === 'punct' && t.text === ')') {
          parDepth--
          if (parDepth === 0) {
            if (currentParam.length > 0) paramTokens.push(currentParam)
            break
          }
          currentParam.push(t)
          continue
        }
        if (isParamSeparator(t)) {
          if (currentParam.length > 0) paramTokens.push(currentParam)
          currentParam = []
          continue
        }
        currentParam.push(t)
      }
      const PARAM_INDENT = 4
      const unitP = profile.tabSize || 2
      const basePadP = ' '.repeat(PARAM_INDENT * unitP)
      const nomeParam = (it: Token[]) => (it[0]?.type === 'word' ? it[0].text : '')
      const maxNome = Math.max(0, ...paramTokens.map(it => nomeParam(it).length))
      paramTokens.forEach((it, idx) => {
        const nome = nomeParam(it)
        const resto = it.slice(1)
        // il TIPO finisce dove inizia il valore di default ("=") o un commento
        let fine = resto.length
        let depth = 0
        for (let q = 0; q < resto.length; q++) {
          const t = resto[q]
          if (t.type === 'comment') {
            fine = q
            break
          }
          if (t.type === 'punct') {
            if (t.text === '(') depth++
            else if (t.text === ')') depth = Math.max(0, depth - 1)
            else if (t.text === '=' && depth === 0) {
              fine = q
              break
            }
          }
        }
        const tipo = cleanInline(resto.slice(0, fine).map(up).join(' '))
        const coda = cleanInline(resto.slice(fine).map(up).join(' '))
        // la virgola iniziale delle righe successive occupa una colonna: il tipo deve cadere
        // nella stessa colonna della prima riga (dove la virgola non c'è). Il minimo di uno
        // spazio evita che nome e tipo si incollino sul parametro dal nome più lungo.
        const gap = paramTokens.length > 1 ? Math.max(1, maxNome - nome.length + (idx === 0 ? 2 : 1)) : 1
        const tail = `${tipo}${coda ? ` ${coda}` : ''}`
        // pushRawLine: gli spazi di allineamento non vanno persi con la pulizia inline
        pushRawLine(`${basePadP}${idx === 0 ? '' : ','}${nome}${' '.repeat(gap)}${tail}`)
      })
      // parentesi chiusa su riga propria
      pushLine(')', 0)

      // clausola fra ")" e "AS": nelle funzioni è "RETURNS INT" (scalari) oppure
      // "RETURNS @t TABLE (...)" (table-valued). Senza questa riga la clausola spariva:
      // il ciclo dei parametri si fermava alla ")" e il testo riprendeva da AS.
      const codaFirma = headerTokens.slice(k + 1)
      if (codaFirma.length > 0) pushLine(codaFirma.map(up).join(' '), 0)
    }
    // AS su riga propria
    pushLine('AS', 0)
  }

  // Passo 3: corpo — indentazione a blocchi
  const body = bodyTokens // inizia con AS (o direttamente il codice se non c'era firma)
  if (bodyTokens.length > 0 && bodyTokens[0].type === 'word' && bodyTokens[0].text.toUpperCase() === 'AS') {
    // salta AS, il corpo inizia dopo
  }

  let startIdx = 0
  if (body.length > 0 && body[0].type === 'word' && body[0].text.toUpperCase() === 'AS') startIdx = 1

  // blocchi: BEGIN/END, IF/ELSE, WHILE, CASE/END, TRY/CATCH — il corpo di una routine
  // con firma (CREATE/ALTER PROCEDURE/…) parte da 1 (dopo AS); un frammento
  // procedurale senza firma (es. "IF … BEGIN … END") parte da 0
  const hasRoutineHeader = /^(?:\s)*(?:CREATE|ALTER)\s+(?:OR\s+ALTER\s+)?(?:PROCEDURE|PROC|FUNCTION|TRIGGER|VIEW)\b/i.test(sql)
  indent = hasRoutineHeader ? 1 : 0
  // livelli di indentazione degli IF aperti (per allineare l'ELSE all'IF giusto)
  const ifStack: number[] = []
  const blockStack: ('begin' | 'case' | 'try')[] = []
  let line: string[] = []
  let lineIndent = indent

  const flushLine = () => {
    if (line.length > 0) {
      pushLine(line.join(' '), lineIndent)
      line = []
    }
  }

  // Gestisce un "segmento" (statement) come sequenza di token fino a ';' o GO,
  // spezzando a ogni keyword di statement a livello top, MA non dentro un CASE
  // (CASE/WHEN/THEN/ELSE/END interni restano nel segmento).
  const ROUTINE_STARTERS = new Set([
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'SET', 'DECLARE', 'PRINT', 'RETURN', 'GOTO',
    'RAISERROR', 'THROW', 'OPEN', 'CLOSE', 'FETCH', 'DEALLOCATE', 'BREAK', 'CONTINUE', 'WAITFOR',
    'COMMIT', 'ROLLBACK', 'EXEC', 'EXECUTE', 'IF', 'WHILE', 'BEGIN', 'GO',
    // statement di batch (riferimento Microsoft): ognuno inizia un segmento proprio
    'BACKUP', 'RESTORE', 'GRANT', 'REVOKE', 'DENY', 'USE', 'KILL', 'CHECKPOINT', 'DBCC',
    'RECONFIGURE', 'SHUTDOWN', 'TRUNCATE', 'BULK', 'ALTER', 'CREATE', 'DROP', 'DISABLE', 'ENABLE',
    'EXCEPT', 'INTERSECT',
  ])
  let seg: Token[] = []
  const segments: Token[][] = []
  let segDepth = 0
  let caseDepth = 0
  // statement che CONTENGONO altre keyword di statement (GRANT SELECT, BULK INSERT, …):
  // dentro di essi uno starter interno ammesso NON spezza (altrimenti "GRANT" resterebbe
  // troncato). GRANT/REVOKE/DENY terminano al TO <principal>: dopo TO gli starter tornano
  // a spezzare (es. lo SELECT di uno statement successivo).
  const STATEMENT_CONTAINERS = new Map<string, Set<string>>([
    ['GRANT', new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'EXECUTE', 'EXEC', 'REFERENCES', 'ALTER', 'CONTROL', 'CREATE', 'VIEW'])],
    ['REVOKE', new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'EXECUTE', 'EXEC', 'REFERENCES', 'ALTER', 'CONTROL', 'CREATE', 'VIEW'])],
    ['DENY', new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'EXECUTE', 'EXEC', 'REFERENCES', 'ALTER', 'CONTROL', 'CREATE', 'VIEW'])],
    ['BULK', new Set(['INSERT'])],
  ])
  const insideContainer = (segTokens: Token[], innerUpper: string): boolean => {
    const first = segTokens[0]
    if (!first || first.type !== 'word') return false
    const firstUpper = first.text.toUpperCase()
    const inner = STATEMENT_CONTAINERS.get(firstUpper)
    if (!inner) return false
    if (
      firstUpper !== 'BULK' &&
      segTokens.some(t => t.type === 'word' && t.text.toUpperCase() === 'TO')
    ) {
      return false
    }
    return inner.has(innerUpper)
  }
  const isLabelAt = (tokens: Token[], idx: number) =>
    tokens[idx]?.type === 'word' &&
    tokens[idx + 1]?.type === 'punct' &&
    tokens[idx + 1].text === ':' &&
    segDepth === 0

  /** Prossima parola significativa (salta commenti) dopo l'indice dato. */
  const nextMeaningfulWordAfter = (tokens: Token[], idx: number): string => {
    for (let m = idx + 1; m < tokens.length; m++) {
      const tok = tokens[m]
      if (tok.type === 'comment') continue
      if (tok.type === 'word') return tok.text.toUpperCase()
      break // punct/stringa: non è una parola → stop
    }
    return ''
  }
  for (let k = startIdx; k < body.length; k++) {
    const t = body[k]
    // commento su riga propria (già indentato): segmento a sé, così resta sulla sua riga
    // invece di essere aggregato allo statement precedente o scartato da BEGIN/END/IF
    if (t.type === 'comment' && t.ownLine && segDepth === 0 && caseDepth === 0) {
      if (seg.length > 0) segments.push(seg)
      segments.push([t])
      seg = []
      continue
    }
    if (t.type === 'punct') {
      if (t.text === '(') segDepth++
      else if (t.text === ')') segDepth = Math.max(0, segDepth - 1)
    }
    const upper = t.type === 'word' ? t.text.toUpperCase() : ''
    const isCaseOpen = segDepth === 0 && upper === 'CASE'
    const isCaseEnd = segDepth === 0 && upper === 'END' && caseDepth > 0
    // "SET" continua lo statement quando il segmento corrente è un UPDATE
    // ("update t\n set a = 1\n where …" è UN solo statement, non due)
    const continuesUpdate =
      upper === 'SET' && seg.length > 0 && seg[0].type === 'word' && seg[0].text.toUpperCase() === 'UPDATE'
    // valuta gli starter con il caseDepth ATTUALE (prima di aggiornarlo): l'END del CASE
    // non deve spezzare come fine blocco
    const isStarter =
      segDepth === 0 &&
      caseDepth === 0 &&
      t.type === 'word' &&
      (ROUTINE_STARTERS.has(upper) || upper === 'END') &&
      !continuesUpdate &&
      !(seg.length > 0 && insideContainer(seg, upper))
    const isElse = segDepth === 0 && caseDepth === 0 && t.type === 'word' && upper === 'ELSE'
    const isSemi = t.type === 'punct' && t.text === ';' && segDepth === 0
    const isLab = isLabelAt(body, k)
    if (isCaseOpen) caseDepth++
    if (isCaseEnd) caseDepth = Math.max(0, caseDepth - 1)
    if (isStarter || isElse || isSemi || isLab) {
      if (seg.length > 0) segments.push(seg)
      seg = []
      if (isSemi) {
        // ";WITH …" (CTE): il ';' è significativo — senza, "END WITH …" sarebbe sintassi
        // invalida. Va conservato come primo token del segmento che inizia con WITH.
        if (nextMeaningfulWordAfter(body, k) === 'WITH') seg.push(t)
        else if (segments.length > 0) {
          // il ';' chiude lo statement precedente: resta in coda (fidelity del testo)
          const prev = segments[segments.length - 1]
          const last = prev[prev.length - 1]
          if (!(last?.type === 'punct' && last.text === ';')) segments[segments.length - 1] = [...prev, t]
        }
        continue
      }
    }
    seg.push(t)
  }
  if (seg.length > 0) segments.push(seg)

  const isLabel = (tokens: Token[], idx: number) =>
    tokens[idx]?.type === 'word' && tokens[idx + 1]?.type === 'punct' && tokens[idx + 1].text === ':'

  let pendingIndent: number | null = null
  // true quando è già stata emessa almeno una riga (la firma conta): le righe vuote
  // iniziali del documento non vengono riprodotte
  let emittedAny = headerTokens.length > 0

  for (let si = 0; si < segments.length; si++) {
    const segment = segments[si]
    if (segment.length === 0) continue
    // True se lo statement PRECEDENTE è un INSERT: la SELECT che segue sono i VALORI
    // dell'insert (il segmentatore la stacca dall'INSERT), quindi va impaginata un valore per riga.
    const dopoInsert =
      si > 0 && segments[si - 1].some(t => t.type === 'word' && t.text.toUpperCase() === 'INSERT')
    // righe vuote tra le istruzioni: preservate così come sono nell'originale.
    // Dentro un'istruzione (token interni allo stesso segmento) vengono invece tolte.
    const blanks = segment[0].blank ?? 0
    if (blanks > 0 && emittedAny) {
      for (let b = 0; b < blanks; b++) lines.push({ indent: 0, text: '' })
    }
    emittedAny = true
    // GO → a margine
    if (segment.length === 1 && segment[0].type === 'word' && segment[0].text.toUpperCase() === 'GO') {
      flushLine()
      pendingIndent = null
      pushLine('GO', 0)
      continue
    }
    // label (es. "end_ok:") → a margine
    if (isLabel(segment, 0)) {
      flushLine()
      pushLine(`${up(segment[0])}:`, 0)
      const rest = segment.slice(2)
      if (rest.length > 0) {
        // il resto dello statement parte dall'indent corrente del blocco
        indent = Math.max(1, indent)
        lineIndent = indent
        line = rest.map(up)
        flushLine()
      }
      continue
    }

    // primo token del segmento
    const first = segment[0]
    const firstUpper = first.type === 'word' ? first.text.toUpperCase() : ''

    // commento su riga propria: resta sulla sua riga all'indent corrente del blocco.
    // Non consuma pendingIndent: se è il corpo di un IF/WHILE senza BEGIN, lo statement
    // successivo eredita comunque l'indentazione pendente.
    if (segment.length === 1 && first.type === 'comment') {
      flushLine()
      pushLine(first.text, pendingIndent ?? indent)
      continue
    }

    // BEGIN / IF / WHILE / CASE: apri blocco
    if (firstUpper === 'BEGIN') {
      flushLine()
      // "BEGIN TRANSACTION"/"BEGIN TRAN"/"BEGIN DISTRIBUTED TRAN(SACTION)": NON è un
      // blocco (non si chiude con END): niente indentazione dei statement successivi
      if (isBeginTransaction(segment)) {
        // "BEGIN TRANSACTION" come corpo di un IF/ELSE resta al livello dell'IF
        // (stile del resto del formattatore, dove BEGIN sta al livello dell'IF)
        const lvl = pendingIndent !== null ? Math.max(0, pendingIndent - 1) : indent
        pushLine(segment.map(up).join(' '), lvl)
        pendingIndent = null
        continue
      }
      // "BEGIN TRY"/"BEGIN CATCH": il resto del segmento NON deve andare perso
      const extra = segment.slice(1).map(up).join(' ')
      pushLine(extra ? `BEGIN ${extra}` : 'BEGIN', indent)
      blockStack.push('begin')
      indent++
      continue
    }
    if (firstUpper === 'END') {
      // chiude un blocco BEGIN (o il CASE inline è già gestito dentro lo statement)
      indent = Math.max(0, indent - 1)
      // gli IF chiusi DENTRO questo blocco non possono più ricevere il loro ELSE: si tolgono
      // dallo stack, altrimenti l'ELSE esterno si allinea a un IF interno e finisce spostato
      // di due spazi rispetto al suo END (segnalazione utente su "END / ELSE / BEGIN")
      while (ifStack.length > 0 && ifStack[ifStack.length - 1] > indent) ifStack.pop()
      pendingIndent = null
      flushLine()
      const extra = segment.slice(1).map(up).join(' ')
      pushLine(extra ? `END ${extra}` : 'END', indent)
      if (blockStack.length > 0) blockStack.pop()
      continue
    }
    if (firstUpper === 'ELSE') {
      // l'ELSE si allinea all'IF a cui appartiene (livello registrato quando è stato
      // emesso l'IF); il corpo dell'ELSE senza BEGIN parte indentato di +1
      flushLine()
      const rest = segment.slice(1).map(up).join(' ')
      const level = ifStack.pop() ?? Math.max(0, indent - 1)
      pushLine(rest ? `ELSE ${rest}` : 'ELSE', level)
      if (/\bBEGIN\b/i.test(rest) && !/\bBEGIN\s+(?:TRAN|TRANSACTION|DISTRIBUTED)\b/i.test(rest)) {
        blockStack.push('begin')
        indent = level + 1
      } else {
        // ELSE IF riapre un IF allo stesso livello; altrimenti è il corpo dell'ELSE
        if (/\bIF\b/i.test(rest)) ifStack.push(level)
        pendingIndent = level + 1
      }
      continue
    }
    if (firstUpper === 'IF' || firstUpper === 'WHILE') {
      flushLine()
      // registra il livello dell'IF (per allineare il suo ELSE)
      if (firstUpper === 'IF') ifStack.push(indent)
      // condizione sulla stessa riga, ma "BEGIN" successivo va su riga propria
      const cond: Token[] = []
      let j = 0
      let par = 0
      for (; j < segment.length; j++) {
        const t = segment[j]
        if (t.type === 'punct') {
          if (t.text === '(') par++
          else if (t.text === ')') par = Math.max(0, par - 1)
        }
        if (t.type === 'word' && t.text.toUpperCase() === 'BEGIN' && par === 0 && j > 0) break
        cond.push(t)
      }
      // commento "--" in mezzo alla condizione: chiude la riga, il codice prosegue sotto.
      // Le condizioni lunghe vengono spezzate (AND/OR a capo, sotto-query impaginate).
      condRows(cond, up, profile.tabSize || 2, indent, profile).forEach(pushRawLine)
      const after = segment.slice(j)
      if (after.length > 0 && after[0].type === 'word' && after[0].text.toUpperCase() === 'BEGIN') {
        if (isBeginTransaction(after)) {
          // "IF @trancount < 1 BEGIN TRANSACTION": è il corpo dell'IF, ma NON apre un
          // blocco → la transazione resta al livello dell'IF e i statement successivi
          // NON vengono indentati
          pushLine(after.map(up).join(' '), indent)
          pendingIndent = null
          continue
        }
        pushLine('BEGIN', indent)
        blockStack.push('begin')
        indent++
        const rest = after.slice(1)
        if (rest.length > 0) {
          lineIndent = indent
          line = rest.map(up)
          flushLine()
        }
      } else {
        // IF/WHILE senza BEGIN: il prossimo statement è il corpo condizionale (indentato +1)
        pendingIndent = indent + 1
      }
      continue
    }
    if (firstUpper === 'CASE' || (firstUpper === 'SELECT' && segment.some(t => t.type === 'word' && t.text.toUpperCase() === 'CASE'))) {
      // CASE espressione: apri case inline
      if (firstUpper === 'CASE') {
        flushLine()
        pushLine('CASE', indent)
        blockStack.push('case')
        indent++
        const rest = segment.slice(1)
        if (rest.length > 0) {
          lineIndent = indent
          line = rest.map(up)
          flushLine()
        }
        continue
      }
    }

    // statement normale (SET, DECLARE, SELECT, INSERT, UPDATE, DELETE, EXEC, RETURN, PRINT...)
    flushLine()
    // se è il corpo di un IF/WHILE senza BEGIN, usa l'indentazione pendente
    if (pendingIndent !== null) {
      lineIndent = pendingIndent
      pendingIndent = null
    } else {
      lineIndent = indent
    }

    // DECLARE: variabili su righe proprie con virgola iniziale e TIPI ALLINEATI in colonna
    // (stile SQL Prompt):
    //   DECLARE @nDestinationType INT
    //          ,@nSourceBay       INT
    if (firstUpper === 'DECLARE') {
      const vars: string[][] = []
      let cur: string[] = []
      let par = 0
      for (let j = 0; j < segment.length; j++) {
        const t = segment[j]
        if (t.type === 'punct') {
          if (t.text === '(') par++
          else if (t.text === ')') par = Math.max(0, par - 1)
        }
        if (t.type === 'punct' && t.text === ',' && par === 0) {
          if (cur.length > 0) vars.push(cur)
          cur = []
          continue
        }
        cur.push(up(t))
      }
      if (cur.length > 0) vars.push(cur)

      // estrai per ogni riga: nome variabile, tipo e valore iniziale ("= ...")
      const parsed = vars.map((row, idx) => {
        const start = idx === 0 ? 1 : 0 // la prima riga inizia con "DECLARE"
        const name = row[start]
        if (!name || !name.startsWith('@')) return null
        const rest = row.slice(start + 1)
        const eq = rest.indexOf('=')
        return {
          name,
          type: eq === -1 ? rest : rest.slice(0, eq),
          val: eq === -1 ? [] : rest.slice(eq),
        }
      })

      if (parsed.length > 1 && parsed.every(p => p !== null)) {
        const unit = profile.tabSize || 2
        const basePad = ' '.repeat(lineIndent * unit)
        const maxName = Math.max(...parsed.map(p => p!.name.length))
        parsed.forEach((p, i) => {
          const gap = maxName - p!.name.length + 1
          const tail = cleanInline(p!.type.join(' ') + (p!.val.length > 0 ? ` ${p!.val.join(' ')}` : ''))
          if (i === 0) {
            pushRawLine(`${basePad}DECLARE ${p!.name}${' '.repeat(gap)}${tail}`)
          } else {
            // virgola allineata sotto lo spazio dopo "DECLARE" (colonna fissa)
            pushRawLine(`${basePad}${' '.repeat('DECLARE'.length)},${p!.name}${' '.repeat(gap)}${tail}`)
          }
        })
        continue
      }

      vars.forEach((v, idx) => {
        if (idx === 0) pushLine(v.join(' '), lineIndent)
        else pushLine(`,` + v.join(' '), lineIndent)
      })
      continue
    }

    // EXEC: parametri e valori incolonnati (virgola allineata sotto il primo parametro)
    if (firstUpper === 'EXEC' || firstUpper === 'EXECUTE') {
      const unitE = profile.tabSize || 2
      const basePad = ' '.repeat(lineIndent * unitE)
      const parts = splitExecParts(segment, up)
      if (parts.length === 1) {
        pushLine(parts[0], indent)
      } else {
        const aligned = execParamRows(parts, basePad)
        if (aligned) {
          flushLine()
          for (const row of aligned) pushRawLine(row)
        } else {
          // parametri posizionali (non "@nome = valore"): riga EXEC + un parametro per riga,
          // incolonnati sotto il primo parametro quando è individuabile
          flushLine()
          const firstLine = cleanInline(parts[0])
          const paramAt = firstLine.search(/@[A-Za-z_]/)
          pushRawLine(`${basePad}${firstLine}`)
          const col = paramAt === -1 ? basePad.length + 2 : basePad.length + paramAt
          for (let p = 1; p < parts.length; p++) {
            pushRawLine(`${' '.repeat(Math.max(0, col - 1))},${cleanInline(parts[p])}`)
          }
        }
      }
      continue
    }

    // ; WITH <nome> AS ( SELECT … ) — CTE: apre su righe proprie con la parentesi
    // prima della SELECT interna, e spezza le clausole della subquery (FROM/JOIN/WHERE).
    const cteLayout = layoutCteSegment(segment, up, profile)
    if (cteLayout) {
      flushLine()
      for (const r of cteLayout.rows) pushLine(r.text, lineIndent + r.ind, true)
      // codice dopo l'elenco delle CTE (es. lo statement principale se lo spezzatore non
      // l'ha separato): va stampato comunque, mai perso
      if (cteLayout.rest.length > 0) {
        const resto = rowsNoDashEat(cteLayout.rest, up)
        if (resto.length === 0) pushLine(cteLayout.rest.map(up).join(' '), lineIndent)
        else resto.forEach(r => pushLine(r, lineIndent))
      }
      continue
    }

    // CREATE TABLE: ogni colonna (col tipo di dato) su riga propria, indentata
    if (firstUpper === 'CREATE') {
      const unitC = profile.tabSize || 2
      const tableRows = createTableRows(segment, up, unitC, ' '.repeat(lineIndent * unitC))
      if (tableRows) {
        flushLine()
        for (const row of tableRows) pushRawLine(row)
        continue
      }
    }

    // SELECT / INSERT / UPDATE / DELETE / SET: statement con clausole, con eventuale CASE inline.
    // Prima il layout "a colonna" (SELECT TOP n @a = …, @b = …), poi CASE, poi clausole semplici.
    {
      const unit = profile.tabSize || 2
      const basePad = ' '.repeat(lineIndent * unit)
      // INSERT … [(campi)] [VALUES (valori)]: un campo/valore per riga, allineati sotto il primo
      if (firstUpper === 'INSERT') {
        const insertLayout = insertRows(segment, up, unit, basePad)
        if (insertLayout) {
          flushLine()
          insertLayout.rows.forEach(pushRawLine)
          if (insertLayout.rest.length > 0) {
            // INSERT … SELECT: la lista dei VALORI è la select-list della SELECT, quindi si
            // impagina come quella dei campi (un valore per riga, allineati sotto il primo).
            // Prima il resto restava su una riga sola, anche con venti valori.
            const primo = insertLayout.rest.find(t => t.type !== 'comment')
            const selectRows =
              primo?.type === 'word' && primo.text.toUpperCase() === 'SELECT'
                ? detailedSelectRows(insertLayout.rest, up, unit, basePad, profile.setIndent, profile, true)
                : null
            if (selectRows) selectRows.forEach(pushRawLine)
            else {
              rowsNoDashEat(insertLayout.rest, up).forEach(r => pushLine(r, lineIndent))
            }
          }
          continue
        }
      }
      const detailedRows = detailedSelectRows(
        segment,
        up,
        unit,
        basePad,
        profile.setIndent,
        profile,
        dopoInsert && firstUpper === 'SELECT',
      )
      if (detailedRows) {
        flushLine()
        for (const row of detailedRows) pushRawLine(row)
        continue
      }
      const caseParts = splitHeadCase(segment)
      const caseLines = caseParts ? splitCaseLines(caseParts.casePart, up) : splitCaseLines(segment, up)
      /**
       * Testata con ASSEGNAZIONE ("SELECT @e = CASE …"): la coda sono altre assegnazioni, che
       * hanno il loro allineamento — non si impila come una select-list.
       */
      const testaAssegnazione = (() => {
        if (!caseParts) return false
        let d = 0
        let vistoAt = false
        for (const t of caseParts.head) {
          if (t.type === 'word' && t.text.startsWith('@')) vistoAt = true
          if (t.type !== 'punct') continue
          if (t.text === '(') d++
          else if (t.text === ')') d = Math.max(0, d - 1)
          else if (t.text === ',' && d === 0) return false
          else if (t.text === '=' && d === 0 && vistoAt) return true
        }
        return false
      })()
      if (caseLines.length > 1 || (caseParts && caseParts.tail.length > 0)) {
        // SELECT con CASE nella testata: testa, blocco CASE, poi coda con le clausole
        // (FROM/JOIN/WHERE) su righe proprie — la coda non resta attaccata a "END"
        if (caseParts) {
          rowsNoDashEat(caseParts.head, up).forEach(r => pushLine(r, lineIndent))
          splitCaseLines(caseParts.casePart, up).forEach(cl => pushLine(cl.text, lineIndent + cl.delta))
          const groups = splitClauseGroups(caseParts.tail)
          groups.forEach((g, gi) => {
            const kw = g[0]?.type === 'word' ? g[0].text.toUpperCase() : ''
            const isJoin = ['JOIN', 'APPLY', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS'].includes(kw)
            if (kw === 'WHERE' || kw === 'HAVING') {
              conditionRows(basePad, g, up, unit).forEach(r => pushRawLine(r))
            } else if (kw === 'ORDER' || kw === 'GROUP') {
              listRows(basePad, g, up, `${kw} BY `).forEach(r => pushRawLine(r))
            } else {
              // primo gruppo = resto della select-list (indentato), FROM a margine,
              // JOIN/altre clausole un livello più in dentro; virgola in testa attaccata
              const ind = gi === 0 || isJoin ? lineIndent + 1 : lineIndent
              if (gi === 0 && !isJoin && profile.stackSelectColumns && !testaAssegnazione) {
                // Resto della select-list DOPO il CASE: si impila come la lista dei valori
                // (un elemento per riga). Prima restava tutta su una riga sola: con un CASE in
                // testa, i quaranta campi che seguono finivano in una riga da mille caratteri.
                stackSelectList(
                  g, up, ' '.repeat(ind * unit), profile, true,
                ).forEach(r => pushRawLine(r))
              } else {
                rowsNoDashEat(g, up)
                  .map(r => r.replace(/^,\s+/, ','))
                  .forEach(r => pushLine(r, ind))
              }
            }
          })
        } else {
          // il CASE non è nella testata: comportamento precedente
          caseLines.forEach(cl => pushLine(cl.text, lineIndent + cl.delta))
        }
      } else {
        // statement con clausole FROM/JOIN/WHERE…: spezza le clausole su righe proprie
        // (come il motore delle query semplici) invece di compattare tutto su una riga
        const clauseRows = splitStatementClauses(segment, up)
        if (clauseRows.length > 1) {
          clauseRows.forEach((r, idx) => {
            // la prima riga (INSERT INTO t / SELECT …) all'indent dello statement;
            // le clausole (SELECT, FROM, JOIN, WHERE…) un livello più in profondità
            for (const sub of rowsNoDashEat(r.tokens, up))
              pushLine(sub, idx === 0 ? lineIndent : lineIndent + 1)
          })
        } else {
          // un commento "--" dentro lo statement chiude la riga: il codice dopo NON deve
          // finire commentato sulla stessa riga (romperebbe la query)
          rowsNoDashEat(segment, up).forEach((r, idx) => pushLine(r, idx === 0 ? lineIndent : lineIndent + 1))
        }
      }
    }
  }

  flushLine()

  const unit = profile.tabSize || 2
  const rendered = lines.map(l => ' '.repeat(l.indent * unit) + l.text).join('\n')
  return rendered.trimEnd() + '\n'
}

interface CaseLine {
  text: string
  delta: number
}

/**
 * Se il segmento contiene un CASE inline (es. "SELECT @x = CASE WHEN ... THEN ... ELSE ... END"),
 * lo spezza in righe: CASE / WHEN / THEN / ELSE / END, ciascuna con la propria indentazione.
 * Restituisce più righe solo se c'è un CASE; altrimenti una sola riga con delta 0.
 */
function splitCaseLines(segment: Token[], up: (t: Token) => string): CaseLine[] {
  const idx = segment.findIndex(t => t.type === 'word' && t.text.toUpperCase() === 'CASE')
  if (idx === -1) return [{ text: segment.map(up).join(' '), delta: 0 }]

  const out: CaseLine[] = []
  const head = segment.slice(0, idx)
  if (head.length > 0) {
    // commenti "--" nel preambolo: spezza anche qui (il codice dopo non va commentato)
    for (const row of rowsNoDashEat(head, up)) out.push({ text: row, delta: 0 })
  }

  let depth = 0
  let cur: Token[] = []
  let curDelta = 1
  const flush = (delta: number) => {
    // ogni "--" in mezzo ai token chiude la riga: il codice prosegue sulla successiva
    for (const row of rowsNoDashEat(cur, up)) out.push({ text: row, delta })
    cur = []
  }
  for (let i = idx; i < segment.length; i++) {
    const t = segment[i]
    const upper = t.type === 'word' ? t.text.toUpperCase() : ''
    if (t.type === 'punct') {
      if (t.text === '(') depth++
      else if (t.text === ')') depth = Math.max(0, depth - 1)
    }
    // separatori del CASE a profondità 0
    const isWhen = upper === 'WHEN' && depth === 0 && cur.length > 0
    const isThen = upper === 'THEN' && depth === 0 && cur.length > 0
    const isElse = upper === 'ELSE' && depth === 0 && cur.length > 0
    const isEnd = upper === 'END' && depth === 0
    if (isWhen || isThen || isElse || isEnd) {
      flush(curDelta)
      if (upper === 'WHEN') curDelta = 2
      else if (upper === 'THEN') curDelta = 3
      else if (upper === 'ELSE') curDelta = 2
      else curDelta = 1
      cur.push(t)
      if (isEnd) {
        // END chiude: flush immediato e il resto continua sullo stesso livello
        flush(1)
        curDelta = 0
        continue
      }
      continue
    }
    cur.push(t)
  }
  if (cur.length > 0) flush(curDelta)
  return out
}

/**
 * SELECT [TOP n] [@a = …,] @x = …, col … FROM … WHERE …: impaginazione "dettagliata"
 * per le SELECT con clausole:
 *   SELECT TOP 1
 *      @nDestBay           = BCO_BAIA
 *     ,@nDestPitch         = PZ_PIAZZOLA
 *   FROM dbo.T
 *     INNER JOIN dbo.U ON (…)
 *   WHERE cond1
 *         AND cond2
 *           OR (…)
 *   ORDER BY a
 *           ,b
 * La lista di assegnazioni è verticale solo se ci sono ≥2 "@var = …"; altrimenti la
 * testata (colonne o singola assegnazione) resta su una riga. Se la TESTATA contiene
 * un CASE (es. SELECT @x = CASE …) si restituisce null (percorso CASE dedicato).
 */
function detailedSelectRows(
  segment: Token[],
  up: (t: Token) => string,
  unit: number,
  basePad: string,
  setIndent: number = unit,
  profile?: FormatProfile,
  /** True quando questa SELECT sono i VALORI di un "INSERT … SELECT": un valore per riga. */
  unoPerRiga = false,
): string[] | null {
  const groups = splitStatementClauses(segment, up)
  const head = groups[0].tokens
  // Un CASE nella testata: il percorso "impilato" lo sa espandere (CASE/WHEN/THEN/ELSE/END dentro
  // l'elemento della lista), quindi si torna null SOLO quando la lista non è impilabile
  // (nessuna virgola di primo livello, oppure INTO che richiede il percorso dedicato).
  let listaConCase = false
  if (head.some(t => t.type === 'word' && t.text.toUpperCase() === 'CASE')) {
    // Un'assegnazione in testata ("SELECT @x = CASE …") ha il suo percorso dedicato: qui no.
    // (il tokenizer non tiene la '@' nel testo, quindi si guarda la forma: un "=" di primo
    //  livello prima della prima virgola)
    let primoComma = -1
    let primoUguale = -1
    let dd = 0
    for (let i = 0; i < head.length; i++) {
      const t = head[i]
      if (t.type !== 'punct') continue
      if (t.text === '(') dd++
      else if (t.text === ')') dd = Math.max(0, dd - 1)
      else if (t.text === ',' && dd === 0) {
        primoComma = i
        break
      } else if (t.text === '=' && dd === 0 && primoUguale === -1) primoUguale = i
    }
    const assegnazione = primoUguale >= 0 && (primoComma === -1 || primoUguale < primoComma)
    const impilabile =
      !!profile?.stackSelectColumns &&
      !assegnazione &&
      !head.some((t, i) => t.type === 'word' && t.text.toUpperCase() === 'INTO' && i > 0) &&
      (() => {
        let d = 0
        for (const t of head) {
          if (t.type === 'punct') {
            if (t.text === '(') d++
            else if (t.text === ')') d = Math.max(0, d - 1)
            else if (t.text === ',' && d === 0) return true
          }
        }
        return false
      })()
    if (!impilabile) return null
    listaConCase = true
  }
  // commenti "--" nella testata SENZA l'impilamento a colonna: niente layout a colonna (il
  // codice dopo il commento non deve finire commentato); si ripiega sul percorso CASE/clausole.
  // Con stackSelectColumns attivo l'impilamento sa gestire i commenti (chiudono la riga e il
  // campo successivo riparte sotto, virgola in testa), quindi il commento NON è più un motivo
  // per rinunciare all'impaginazione: segnalazione utente su una SELECT con "--sorgente" in
  // mezzo ai campi, che restava tutta storta (niente colonne, niente INTO a capo, WHERE su una riga).
  if (!profile?.stackSelectColumns && head.some(t => t.type === 'comment' && t.text.startsWith('--'))) {
    return null
  }

  const out: string[] = []
  const varStart = head.findIndex(t => t.type === 'word' && t.text.startsWith('@'))
  /** Elementi della lista di assegnazioni "@var = …" (virgole di primo livello). */
  const assignItems = (() => {
    if (varStart <= 0) return [] as Token[][]
    let depth = 0
    const items: Token[][] = []
    let cur: Token[] = []
    const flushItem = () => {
      if (cur.length > 0) {
        items.push(cur)
        cur = []
      }
    }
    for (let i = varStart; i < head.length; i++) {
      const t = head[i]
      if (t.type === 'punct') {
        if (t.text === '(') depth++
        else if (t.text === ')') depth = Math.max(0, depth - 1)
      }
      if (t.type === 'punct' && t.text === ',' && depth === 0) {
        flushItem()
        continue
      }
      cur.push(t)
    }
    flushItem()
    return items
  })()
  const isAssign = (toks: Token[]) =>
    toks.length > 1 &&
    toks[0].type === 'word' &&
    toks[0].text.startsWith('@') &&
    toks.some(x => x.type === 'punct' && x.text === '=')
  const listaAssegnazioni = assignItems.length >= 2 && assignItems.every(isAssign)
  // Senza clausole (nessun FROM/JOIN) c'è comunque qualcosa da impaginare se la testata è
  // una lista di assegnazioni "@var = …": "SELECT @a = …, @b = …" va a capo come le altre liste
  if (groups.length < 2 && !listaAssegnazioni) {
    // Testata con CASE e lista impilabile, ma clausole non riconosciute (succede alla select-list
    // di un "INSERT … SELECT" staccata dal segmentatore, che arriva senza la parola SELECT e con
    // il FROM dentro la testata): si impila comunque la lista e si accoda il resto (FROM/WHERE…).
    if (!listaConCase) return null
    let d = 0
    let taglio = head.length
    for (let i = 0; i < head.length; i++) {
      const t = head[i]
      if (t.type === 'punct') {
        if (t.text === '(') d++
        else if (t.text === ')') d = Math.max(0, d - 1)
        continue
      }
      if (
        d === 0 &&
        t.type === 'word' &&
        ['FROM', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'OPTION', 'UNION'].includes(t.text.toUpperCase())
      ) {
        taglio = i
        break
      }
    }
    const righe = stackSelectList(head.slice(0, taglio), up, basePad, profile ?? ({} as FormatProfile), unoPerRiga)
    const coda = [...head.slice(taglio), ...segment.slice(head.length)]
    if (coda.length > 0) righe.push(...rowsNoDashEat(coda, up).map(r => `${basePad}${cleanInline(r)}`))
    return righe
  }

  if (varStart > 0) {
    const items = assignItems
    if (listaAssegnazioni) {
      out.push(`${basePad}${cleanInline(head.slice(0, varStart).map(up).join(' '))}`)
      const maxVar = Math.max(...items.map(it => it[0].text.length))
      items.forEach((it, idx) => {
        const name = it[0].text
        const tail = cleanInline(it.slice(1).map(up).join(' '))
        const gap = maxVar - name.length + 1
        if (idx === 0) out.push(`${basePad}   ${name}${' '.repeat(gap)}${tail}`)
        else out.push(`${basePad}  ,${name}${' '.repeat(gap)}${tail}`)
      })
    } else {
      // NON è una lista di assegnazioni: la testata è una select-list che contiene una
      // VARIABILE (caso tipico "INSERT … SELECT @udc, 'SYSTEM', 0"): si impila come tutte le
      // altre select-list. Prima restava su una riga sola (venti valori di fila).
      if (profile?.stackSelectColumns) {
        out.push(...stackSelectList(head, up, basePad, profile, unoPerRiga))
      } else {
        const r = rowsNoDashEat(head, up)[0]
        if (r) out.push(`${basePad}${cleanInline(r)}`)
      }
    }
  } else {
    // SELECT "normale" (nessuna assegnazione @var = …): con l'opzione attiva la select-list
    // si impila come nel formattatore delle query — virgole in testa e INTO su riga propria.
    // Serve soprattutto DENTRO procedure e blocchi, dove prima la lista restava tutta su
    // una riga mentre da sola veniva impilata: due risultati diversi per lo stesso testo.
    if (profile?.stackSelectColumns) {
      out.push(...stackSelectList(head, up, basePad, profile, unoPerRiga))
    } else {
      const r = rowsNoDashEat(head, up)[0]
      if (r) out.push(`${basePad}${cleanInline(r)}`)
    }
  }

  // clausole successive: FROM / JOIN / WHERE / GROUP / HAVING / ORDER / UNION / OUTPUT
  for (let g = 1; g < groups.length; g++) {
    const tokens = groups[g].tokens
    const first = tokens[0]
    const kw = first.type === 'word' ? first.text.toUpperCase() : ''
    if (kw === 'FROM' || kw === 'OUTPUT' || kw === 'UNION') {
      // tutte le righe: se la clausola porta un commento "--" in coda, rowsNoDashEat ne
      // restituisce più di una e prenderne solo la prima perderebbe il commento
      for (const r of rowsNoDashEat(tokens, up)) out.push(`${basePad}${cleanInline(r)}`)
    } else if (kw === 'INNER' || kw === 'LEFT' || kw === 'RIGHT' || kw === 'FULL' || kw === 'CROSS' || kw === 'JOIN' || kw === 'APPLY') {
      for (const r of rowsNoDashEat(tokens, up)) out.push(`${basePad}${' '.repeat(unit)}${cleanInline(r)}`)
    } else if (kw === 'WHERE' || kw === 'HAVING') {
      out.push(...conditionRows(basePad, tokens, up, unit))
    } else if (kw === 'SET') {
      out.push(...setClauseRows(basePad, tokens, up, setIndent))
    } else if (kw === 'ORDER' || kw === 'GROUP') {
      out.push(...listRows(basePad, tokens, up, `${kw} BY `))
    } else if (kw === 'SELECT') {
      // select-list di un ramo UNION o di un INSERT…SELECT: si impila come la prima
      if (profile?.stackSelectColumns) {
        out.push(...stackSelectList(tokens, up, basePad, profile))
      } else {
        const r = rowsNoDashEat(tokens, up)[0]
        if (r) out.push(`${basePad}${cleanInline(r)}`)
      }
    } else {
      // clausola non prevista: la si stampa comunque — nessun gruppo può andare perso
      for (const r of rowsNoDashEat(tokens, up)) out.push(`${basePad}${cleanInline(r)}`)
    }
  }
  return out.filter(Boolean)
}

/**
 * Select-list impilata (usata dal formattatore delle routine, che non ha il ciclo del
 * formattatore query): la virgola va IN TESTA alla riga successiva, così la query resta
 * valida e riformattare non la cambia. Le regole sono le stesse del formattatore query:
 * - si va a capo solo quando la riga corrente ha già più di un token (i primi campi restano
 *   raggruppati allo stesso modo nei due motori);
 * - `INTO #tabella` finisce su una riga propria;
 * - le virgole dentro le parentesi (funzioni, IN (…)) NON si toccano.
 */
function stackSelectList(
  head: Token[],
  up: (t: Token) => string,
  basePad: string,
  profile: FormatProfile,
  /** True per la select-list dei VALORI di un "INSERT … SELECT": UN elemento per riga
   *  (come per i campi/valori di un INSERT), invece del raggruppamento normale. */
  unoPerRiga = false,
): string[] {
  const indent = profile.selectColumnIndent
  // "SELECT … INTO #t": l'INTO va su riga propria. L'INTO di un "INSERT INTO …" invece
  // appartiene alla testata dell'INSERT e non si spezza.
  const isSelectHead = head[0]?.type === 'word' && head[0].text.toUpperCase() === 'SELECT'
  const out: string[] = []
  /**
   * Info di ogni riga emessa (stessa posizione di `out`): serve all'ALLINEAMENTO DEGLI ALIAS
   * in una passata finale, quando si conosce la larghezza massima delle espressioni.
   * `null` per le righe che non sono un campo con alias (commenti, INTO, CASE multiriga…).
   */
  const items: (RigaItem | null)[] = []
  let depth = 0
  let cur: string[] = []
  /** Stessi token di `cur`: servono per espandere un CASE dentro l'elemento. */
  let curTokens: Token[] = []
  /** True dopo un a-capo della lista: la virgola si attacca al campo successivo (",campo"). */
  let commaPending = false
  /** True se la virgola in testa all'elemento corrente è stata AGGIUNTA da noi (non era nel testo). */
  let commaAggiunta = false
  /** False per le righe di clausola (INTO): restano allineate alla SELECT, non rientrano. */
  let indentLine = true
  const push = () => {
    if (cur.length === 0) return
    // la prima riga resta allineata alla clausola, le successive rientrano di `indent`
    const rientro = out.length === 0 || !indentLine ? '' : ' '.repeat(indent)
    // CASE dentro l'elemento: si espande (CASE / WHEN / THEN / ELSE / END) invece di lasciarlo
    // tutto su una riga — segnalazione utente: "c'è un case when in una select che non è indentata"
    if (curTokens.some(t => t.type === 'word' && t.text.toUpperCase() === 'CASE')) {
      const unit = profile.tabSize || 2
      // la virgola in testa aggiunta da noi sta solo in `cur`, non nei token
      let virgola = commaAggiunta
      let tokensCaso = curTokens
      // virgola iniziale dell'elemento (arrivata dalla riga precedente): si attacca alla prima
      // riga del CASE invece di finire su una riga da sola
      if (tokensCaso[0]?.type === 'punct' && tokensCaso[0].text === ',') {
        virgola = true
        tokensCaso = tokensCaso.slice(1)
      }
      for (const riga of splitCaseLines(tokensCaso, up)) {
        const testo = cleanInline(riga.text)
        if (!testo) continue
        const extra = riga.delta > 1 ? ' '.repeat((riga.delta - 1) * unit) : ''
        out.push(`${basePad}${rientro}${virgola ? ',' : ''}${extra}${testo}`)
        // un CASE occupa più righe: resta fuori dall'allineamento degli alias
        items.push(null)
        virgola = false
      }
      cur = []
      curTokens = []
      commaAggiunta = false
      indentLine = true
      return
    }
    const testo = cleanInline(cur.join(' '))
    if (!testo) return
    const virgola = cur[0].startsWith(',') ? ',' : ''
    const split = splitAliasItem(curTokens, up)
    out.push(`${basePad}${rientro}${testo}`)
    items.push(
      split
        ? {
            prefisso: `${basePad}${rientro}`,
            expr: `${virgola}${split.expr}`,
            alias: split.alias,
            commento: split.commento,
          }
        : null,
    )
    cur = []
    curTokens = []
    commaAggiunta = false
    indentLine = true
  }
  for (const t of head) {
    if (t.type === 'punct') {
      if (t.text === '(') depth++
      else if (t.text === ')') depth = Math.max(0, depth - 1)
    }
    // commento "--": chiude la riga, il codice successivo riparte sotto (mai codice
    // "inghiottito" dal commento). La virgola resta in testa al campo seguente.
    if (t.type === 'comment' && t.text.startsWith('--')) {
      const testo = up(t)
      // MAI attaccare un commento a una riga che è GIÀ un commento: il secondo commento
      // finirebbe dentro il primo e il codice (o i commenti) dopo di lui risulterebbero
      // commentati. Caso reale: una select-list con più righe di SQL commentato
      // ("--when exists(…)" seguito da "--and …", "--left join …", "--then …").
      const ultimaRiga = out.length > 0 ? out[out.length - 1] : ''
      const ultimaECommento = ultimaRiga.trimStart().startsWith('--')
      if (cur.length === 0 && out.length > 0 && !ultimaECommento && !t.ownLine) {
        out[out.length - 1] += ` ${testo}`
        // il commento in coda fa parte della riga: l'allineamento non deve perderlo
        const info = items[items.length - 1]
        if (info) info.commento = info.commento ? `${info.commento} ${testo}` : testo
      } else {
        cur.push(testo)
        curTokens.push(t)
        push()
      }
      continue
    }
    // INTO della SELECT ... INTO #tmp: riga propria, allineata alla SELECT (come nel formato query)
    if (
      depth === 0 &&
      t.type === 'word' &&
      t.text.toUpperCase() === 'INTO' &&
      cur.length > 0 &&
      isSelectHead &&
      profile.breakBeforeInto
    ) {
      push()
      cur = [up(t)]
      curTokens = [t]
      commaPending = false
      commaAggiunta = false
      indentLine = false
      continue
    }
    if (
      t.type === 'punct' &&
      t.text === ',' &&
      depth === 0 &&
      (unoPerRiga || cur.length > 0) &&
      // la virgola da sola (arrivata dalla riga precedente) non fa riga a sé: resta in testa
      cur.join('') !== ','
    ) {
      push()
      commaPending = true
      continue
    }
    // virgola a inizio riga (dopo un commento "--" della select-list): si attacca al campo
    // successivo SENZA spazio (",campo"), come fa il motore delle query. Prima diventava un
    // elemento a sé e il campo usciva con uno spazio di troppo (", UDC_UDC").
    if (t.type === 'punct' && t.text === ',' && depth === 0 && cur.length === 0) {
      commaPending = true
      continue
    }
    cur.push((commaPending ? ',' : '') + up(t))
    if (commaPending) commaAggiunta = true
    curTokens.push(t)
    commaPending = false
  }
  push()

  // ALLINEAMENTO DEGLI ALIAS (richiesta utente: "i campi nella select non si allineano così come
  // gli alias"): in una lista con più campi "espressione [AS] alias", tutti gli alias partono
  // dalla stessa colonna. Con un solo campo con alias non cambia nulla.
  const conAlias = items.filter((i): i is RigaItem => !!i?.alias)
  if (conAlias.length > 1) {
    const colonna = Math.max(...conAlias.map(i => i.prefisso.length + i.expr.length)) + 1
    items.forEach((info, idx) => {
      if (!info?.alias) return
      const finOra = info.prefisso.length + info.expr.length
      const spazi = ' '.repeat(Math.max(1, colonna - finOra))
      out[idx] = `${info.prefisso}${info.expr}${spazi}${info.alias}${info.commento ? ` ${info.commento}` : ''}`
    })
  }
  return out
}

/** Riga di una select-list scomposta per l'allineamento degli alias. */
interface RigaItem {
  /** Indentazione della riga (basePad + rientro dell'elemento). */
  prefisso: string
  /** Espressione del campo (compresa la virgola in testa agli elementi impilati). */
  expr: string
  /** Alias, con l'eventuale AS ("X_SCO" oppure "AS X_SSCC_DEST"). */
  alias: string
  /** Commento "--" in coda al campo (resta dopo l'alias). */
  commento: string
}

/** Token (di un elemento della select-list) che NON possono precedere un alias. */
const PRIMA_DI_ALIAS_NO = new Set(['.', '(', ',', '+', '-', '*', '/', '%', '=', '<', '>', '|', '&', '^', '~'])

/**
 * Scompone un elemento della select-list in "espressione [AS] alias [-- commento]".
 * Restituisce null quando non c'è un alias: un solo token ("UDC_UDC"), un campo qualificato
 * ("t.col"), un "*" ("a.*"), un'assegnazione ("@x = 1") o una stringa non si toccano.
 */
function splitAliasItem(
  tokens: Token[],
  up: (t: Token) => string,
): { expr: string; alias: string; commento: string } | null {
  // la virgola in testa (elemento impilato) non fa parte dell'espressione
  let toks = tokens.slice()
  while (toks.length > 0 && toks[0].type === 'punct' && toks[0].text === ',') toks = toks.slice(1)
  // commenti in coda: restano DOPO l'alias
  const commenti: Token[] = []
  while (toks.length > 0 && toks[toks.length - 1].type === 'comment') commenti.unshift(toks.pop()!)
  if (toks.length < 2) return null
  const testo = (ts: Token[]) => cleanInline(ts.map(up).join(' '))
  const commento = commenti.length > 0 ? testo(commenti) : ''
  const n = toks.length
  const last = toks[n - 1]
  const prev = toks[n - 2]
  /** L'espressione deve contenere qualcosa che NON sia una parola chiave (non "SELECT x"). */
  const exprPiena = (ts: Token[]) =>
    ts.some(t => t.type !== 'word' || !KEYWORDS.has(t.text.toUpperCase()))
  // "… AS alias"
  if (
    n >= 3 &&
    prev.type === 'word' &&
    prev.text.toUpperCase() === 'AS' &&
    last.type === 'word' &&
    !last.text.startsWith('@') &&
    exprPiena(toks.slice(0, n - 2))
  ) {
    return { expr: testo(toks.slice(0, n - 2)), alias: `AS ${testo([last])}`, commento }
  }
  // "espressione alias": l'alias è l'ultimo identificatore, non preceduto da punto/operatore
  const aliasOk =
    last.type === 'word' &&
    /^[A-Za-z_#]/.test(last.text) &&
    !last.text.startsWith('@') &&
    !KEYWORDS.has(last.text.toUpperCase())
  const prevOk = !(prev.type === 'punct' && PRIMA_DI_ALIAS_NO.has(prev.text))
  if (aliasOk && prevOk && exprPiena(toks.slice(0, n - 1))) {
    return { expr: testo(toks.slice(0, n - 1)), alias: testo([last]), commento }
  }
  return null
}

/** Layout di un INSERT: le righe da stampare e i token che restano dopo (es. lo SELECT di
 *  un "INSERT … (campi) SELECT …"): il chiamante li formatta a parte, mai persi. */
interface InsertLayout {
  rows: string[]
  rest: Token[]
}

/**
 * INSERT … [(campi)] [VALUES (valori)…]: campi e valori vanno UNO PER RIGA, allineati sotto
 * il primo campo / primo valore (l'utente: "quando fa le insert deve mettere a capo e
 * allineati tutti i campi e i valori").
 *   INSERT INTO dbo.T (COL1
 *                     ,COL2)
 *   VALUES (@a
 *          ,@b)
 * Restituisce null se lo statement non ha nulla da impilare (nessun campo/valore oltre il
 * primo) o se la forma non è riconosciuta: in quel caso resta il percorso normale.
 */
function insertRows(
  segment: Token[],
  up: (t: Token) => string,
  unit: number,
  basePad: string,
): InsertLayout | null {
  let start = 0
  while (segment[start]?.type === 'comment') start++
  if (!(segment[start]?.type === 'word' && segment[start].text.toUpperCase() === 'INSERT')) return null
  // Un commento "--" DENTRO un elemento chiuderebbe la riga a metà lista: non si abbandona più
  // l'impaginazione (prima bastava un "--ORD_FIX" fra le colonne per lasciare tutta la lista e i
  // valori su una riga sola lunghissima), il commento va su una riga propria e il campo riparte
  // sotto. Qui resta il divieto solo dove non c'è spazio per metterlo in sicurezza.
  const commentoRiga = (tokens: Token[]) => tokens.some(t => t.type === 'comment' && t.text.startsWith('--'))

  /** "(" di primo livello a partire da `from` (-1 se non c'è). */
  const openParenAfter = (from: number): number => {
    let depth = 0
    for (let k = from; k < segment.length; k++) {
      const t = segment[k]
      if (t.type !== 'punct') continue
      if (t.text === '(') {
        if (depth === 0) return k
        depth++
      } else if (t.text === ')') depth = Math.max(0, depth - 1)
    }
    return -1
  }
  /** ")" che chiude la "(" all'indice `open` (-1 se non c'è). */
  const closeParenOf = (open: number): number => {
    let depth = 0
    for (let k = open; k < segment.length; k++) {
      const t = segment[k]
      if (t.type !== 'punct') continue
      if (t.text === '(') depth++
      else if (t.text === ')') {
        depth--
        if (depth === 0) return k
      }
    }
    return -1
  }
  /** Divide i token in elementi separati dalle virgole di primo livello. */
  const splitItems = (tokens: Token[]): Token[][] => {
    const items: Token[][] = []
    let depth = 0
    let cur: Token[] = []
    for (const t of tokens) {
      if (t.type === 'punct') {
        if (t.text === '(') depth++
        else if (t.text === ')') depth = Math.max(0, depth - 1)
        if (t.text === ',' && depth === 0) {
          items.push(cur)
          cur = []
          continue
        }
      }
      cur.push(t)
    }
    items.push(cur)
    return items.filter(it => it.length > 0)
  }
  const inline = (tokens: Token[]) => cleanInline(tokens.map(up).join(' '))

  // Primo "(" di primo livello dopo INSERT: la lista dei campi. Se la parentesi appartiene a
  // un'altra parola chiave (TOP (…), DEFAULT (…)) la forma non è prevista.
  const colsOpen = openParenAfter(start + 1)
  let columns: Token[][] = []
  let afterColumns = -1
  if (colsOpen !== -1) {
    let prev: Token | undefined
    for (let k = colsOpen - 1; k > start; k--) {
      if (segment[k].type !== 'comment') {
        prev = segment[k]
        break
      }
    }
    if (prev?.type === 'word' && ['VALUES', 'TOP', 'DEFAULT'].includes(prev.text.toUpperCase())) return null
    const colsClose = closeParenOf(colsOpen)
    if (colsClose === -1) return null
    columns = splitItems(segment.slice(colsOpen + 1, colsClose))
    if (columns.length === 0) return null
    afterColumns = colsClose + 1
  }

  // VALUES dopo la lista dei campi (o subito dopo il nome della tabella)
  let valuesAt = -1
  const afterTarget = afterColumns === -1 ? start + 1 : afterColumns
  for (let k = afterTarget; k < segment.length; k++) {
    const t = segment[k]
    if (t.type === 'comment') continue
    if (t.type === 'word' && t.text.toUpperCase() === 'VALUES') {
      valuesAt = k
      break
    }
    // altra forma (OUTPUT…, EXEC…, SELECT di un INSERT…SELECT già spezzato a parte): qui si
    // impagina solo la lista dei campi e il resto lo formatta il chiamante
    break
  }

  const targetEnd = colsOpen === -1 ? valuesAt === -1 ? segment.length : valuesAt : colsOpen
  const targetText = inline(segment.slice(0, targetEnd))

  /** Righe di un elemento della lista (commenti in testa, CASE espanso su più righe). */
  const itemRows = (item: Token[], indice: number, apreRiga: string, pad: string): string[] => {
    const testa = indice === 0 ? apreRiga : `${pad},`
    // commenti "--" in TESTA all'elemento: righe proprie, il campo riparte sotto
    const commenti: Token[] = []
    let k = 0
    while (k < item.length && item[k].type === 'comment') {
      commenti.push(item[k])
      k++
    }
    const corpo = item.slice(k)
    const righeCommenti = commenti.map(c => `${pad}${cleanInline(up(c))}`)
    if (corpo.length === 0) return righeCommenti
    const cases = splitCaseLines(corpo, up)
    const righeCorpo =
      cases.length === 1
        ? [`${testa}${inline(corpo)}`]
        : cases.map((cl, i) =>
            i === 0 ? `${testa}${cleanInline(cl.text)}` : `${pad}${' '.repeat(cl.delta * unit)}${cleanInline(cl.text)}`,
          )
    return [...righeCommenti, ...righeCorpo]
  }

  /** La ")" di chiusura va sull'ultima riga di CODICE (mai dopo un commento: finirebbe dentro). */
  const chiudiLista = (righe: string[]) => {
    for (let i = righe.length - 1; i >= 0; i--) {
      if (!righe[i].trimStart().startsWith('--')) {
        righe[i] += ')'
        return
      }
    }
  }

  const rows: string[] = []
  // lista dei campi (una per riga) — solo se ce n'è più d'uno
  if (columns.length > 1) {
    const apreRiga = `${basePad}${targetText} (`
    const pad = ' '.repeat(apreRiga.length)
    columns.forEach((col, idx) => rows.push(...itemRows(col, idx, apreRiga, pad)))
    chiudiLista(rows)
  } else if (columns.length === 1) {
    rows.push(`${basePad}${targetText} (${inline(columns[0])})`)
  } else {
    rows.push(`${basePad}${targetText}`)
  }

  let rest: Token[] = []
  let valoriDaImpilare = false
  if (valuesAt !== -1) {
    // gruppi di valori: uno o più "( … )"
    const tuples: Token[][] = []
    let p = valuesAt + 1
    while (p < segment.length) {
      const t = segment[p]
      if (t.type === 'comment') {
        p++
        continue
      }
      if (t.type === 'punct' && t.text === '(') {
        const close = closeParenOf(p)
        if (close === -1) return null
        tuples.push(segment.slice(p + 1, close))
        p = close + 1
        if (segment[p]?.type === 'punct' && segment[p].text === ',') {
          p++
          continue
        }
        break
      }
      return null
    }
    if (tuples.length === 0) return null
    // nei VALUES un commento "--" dentro la tupla non ha una riga propria dove stare: qui si
    // lascia fare al percorso normale (che non impagina, ma non rompe il codice)
    if (tuples.some(commentoRiga)) return null
    // resta solo la ";" finale (altro codice non previsto → percorso normale)
    const coda = segment.slice(p)
    for (const t of coda) {
      if (t.type === 'comment' && !t.text.startsWith('--')) continue
      if (t.type === 'punct' && t.text === ';') continue
      return null
    }
    const apreRiga = `${basePad}VALUES (`
    const pad = ' '.repeat(apreRiga.length)
    if (tuples.length > 1) {
      // più righe di valori: un gruppo per riga
      valoriDaImpilare = true
      tuples.forEach((tuple, idx) => {
        rows.push(idx === 0 ? `${apreRiga}${inline(tuple)})` : `${pad},(${inline(tuple)})`)
      })
    } else {
      const values = splitItems(tuples[0])
      if (values.length > 1) valoriDaImpilare = true
      values.forEach((val, idx) => rows.push(...itemRows(val, idx, apreRiga, pad)))
      chiudiLista(rows)
    }
    const codaTesto = inline(coda)
    if (codaTesto) {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (!rows[i].trimStart().startsWith('--')) {
          rows[i] += codaTesto
          break
        }
      }
    }
  } else if (afterColumns !== -1) {
    rest = segment.slice(afterColumns)
  }

  // Niente da impilare (un solo campo e un solo valore): lascia fare al percorso normale
  if (columns.length <= 1 && !valoriDaImpilare) return null
  if (rows.length === 0) return null
  return { rows, rest }
}

/**
/**
 * Rende una lista di token in righe "sicure" rispetto ai commenti "--": il commento
 * chiude la riga e il codice che segue riparte su una riga nuova (mai codice dopo "--").
 */
function tokensToSafeLines(tokens: Token[], up: (t: Token) => string): string[] {
  const out: string[] = []
  let cur: string[] = []
  for (const t of tokens) {
    if (t.type === 'comment' && t.text.startsWith('--')) {
      cur.push(up(t))
      const text = cleanInline(cur.join(' '))
      if (text) out.push(text)
      cur = []
      continue
    }
    cur.push(up(t))
  }
  if (cur.length > 0) {
    const text = cleanInline(cur.join(' '))
    if (text) out.push(text)
  }
  return out
}

/**
 * CREATE TABLE: intestazione con la parentesi aperta sulla prima riga, OGNI COLONNA
 * (con il suo tipo di dato) su una riga propria indentata, virgola in testa, e la
 * parentesi di chiusura su riga propria:
 *   CREATE TABLE #t (
 *     X_SSCC NVARCHAR(50)
 *     ,X_SKU NVARCHAR(50)
 *   )
 * Restituisce null se il segmento non è un CREATE TABLE con la lista colonne.
 */
function createTableRows(
  segment: Token[],
  up: (t: Token) => string,
  unit: number,
  basePad: string,
): string[] | null {
  const first = segment[0]
  if (!(first?.type === 'word' && first.text.toUpperCase() === 'CREATE')) return null
  // CREATE TABLE / CREATE TABLE #t / CREATE GLOBAL TEMPORARY… (basta la parola TABLE a livello 0)
  let depth = 0
  let tableAt = -1
  for (let i = 1; i < segment.length; i++) {
    const t = segment[i]
    if (t.type === 'punct') {
      if (t.text === '(') depth++
      else if (t.text === ')') depth = Math.max(0, depth - 1)
      continue
    }
    if (depth === 0 && t.type === 'word' && t.text.toUpperCase() === 'TABLE') {
      tableAt = i
      break
    }
  }
  if (tableAt === -1) return null

  // parentesi aperta della lista colonne
  let openIdx = -1
  depth = 0
  for (let i = tableAt + 1; i < segment.length; i++) {
    const t = segment[i]
    if (t.type === 'punct' && t.text === '(' && depth === 0) {
      openIdx = i
      break
    }
  }
  if (openIdx === -1) return null

  // parentesi chiusa bilanciata
  let par = 0
  let closeIdx = -1
  for (let i = openIdx; i < segment.length; i++) {
    const t = segment[i]
    if (t.type === 'punct' && t.text === '(') par++
    else if (t.type === 'punct' && t.text === ')') {
      par--
      if (par === 0) {
        closeIdx = i
        break
      }
    }
  }
  const innerEnd = closeIdx === -1 ? segment.length : closeIdx
  const inner = segment.slice(openIdx + 1, innerEnd)
  if (inner.length === 0) return null

  // colonne: split sulle virgole a livello 0 (i tipi hanno parentesi: NVARCHAR(50))
  const items: Token[][] = []
  let cur: Token[] = []
  let d = 0
  for (const t of inner) {
    if (t.type === 'punct') {
      if (t.text === '(') d++
      else if (t.text === ')') d = Math.max(0, d - 1)
      if (t.text === ',' && d === 0) {
        if (cur.length > 0) items.push(cur)
        cur = []
        continue
      }
    }
    cur.push(t)
  }
  if (cur.length > 0) items.push(cur)
  if (items.length === 0) return null

  const out: string[] = []
  const headerLines = tokensToSafeLines(segment.slice(0, openIdx + 1), up)
  for (const h of headerLines) out.push(`${basePad}${h}`)
  items.forEach((it, idx) => {
    const lines = tokensToSafeLines(it, up)
    lines.forEach((text, li) => {
      const comma = idx > 0 && li === 0 ? ',' : ''
      out.push(`${basePad}${' '.repeat(unit)}${comma}${text}`)
    })
  })
  const tailLines = tokensToSafeLines(closeIdx === -1 ? [] : segment.slice(closeIdx), up)
  if (tailLines.length === 0) out.push(`${basePad})`)
  else for (const t of tailLines) out.push(`${basePad}${t}`)
  return out
}

/**
 * True se il segmento è "BEGIN TRANSACTION" / "BEGIN TRAN" / "BEGIN DISTRIBUTED
 * TRAN(SACTION)": apre una TRANSAZIONE, non un blocco BEGIN…END (quindi i statement
 * successivi NON vanno indentati).
 */
function isBeginTransaction(segment: Token[]): boolean {
  if (!(segment[0]?.type === 'word' && segment[0].text.toUpperCase() === 'BEGIN')) return false
  const next = segment.find((t, i) => i > 0 && t.type === 'word')
  if (!next || next.type !== 'word') return false
  const w = next.text.toUpperCase()
  return w === 'TRAN' || w === 'TRANSACTION' || w === 'DISTRIBUTED'
}

/**
 * Divide i token di un EXEC nei singoli parametri (virgole a livello 0, così le
 * virgole dentro le funzioni nei valori non spezzano).
 */
function splitExecParts(tokens: Token[], up: (t: Token) => string): string[] {
  const parts: string[] = []
  let cur: string[] = []
  let par = 0
  for (const t of tokens) {
    if (t.type === 'punct') {
      if (t.text === '(') par++
      else if (t.text === ')') par = Math.max(0, par - 1)
    }
    if (t.type === 'punct' && t.text === ',' && par === 0 && cur.length > 0) {
      parts.push(cleanInline(cur.join(' ')))
      cur = []
      continue
    }
    cur.push(up(t))
  }
  if (cur.length > 0) parts.push(cleanInline(cur.join(' ')))
  return parts
}

/**
 * EXEC con più parametri: parametri e valori INCOLONNATI. Il primo parametro resta
 * sulla riga dell'EXEC, gli altri con la virgola allineata sotto il primo parametro
 * e i valori allineati dopo "=" (nomi paddati alla stessa larghezza):
 *   EXEC ws_PROC @user = @user
 *              ,@udc  = @pUDC
 * Restituisce null se i parametri non sono tutti nella forma "@nome = valore"
 * (in quel caso si usa il layout semplice).
 */
function execParamRows(parts: string[], basePad: string): string[] | null {
  const parsed: { prefix: string; name: string; value: string }[] = []
  for (const p of parts) {
    const m = /^(.*?)(@[A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/.exec(p)
    if (!m) return null
    parsed.push({ prefix: m[1], name: m[2], value: m[3] })
  }
  if (parsed.length < 2) return null
  const firstCol = basePad.length + parsed[0].prefix.length
  const maxName = Math.max(...parsed.map(p => p.name.length))
  return parsed.map((p, idx) => {
    const namePad = p.name + ' '.repeat(maxName - p.name.length)
    if (idx === 0) return `${basePad}${p.prefix}${namePad} = ${p.value}`
    return `${' '.repeat(Math.max(0, firstCol - 1))},${namePad} = ${p.value}`
  })
}

/**
 * Divide i token nelle clausole di uno statement (FROM/JOIN/WHERE/GROUP…/UNION)
 * a profondità 0. Usato per la CODA di un SELECT con CASE: dopo "END" restano i
 * campi residui della select-list e poi FROM/JOIN/WHERE, che vanno su righe proprie.
 */
function splitClauseGroups(tokens: Token[]): Token[][] {
  const groups: Token[][] = []
  let cur: Token[] = []
  let par = 0
  for (const t of tokens) {
    const upper = t.type === 'word' ? t.text.toUpperCase() : ''
    if (t.type === 'punct') {
      if (t.text === '(') par++
      else if (t.text === ')') par = Math.max(0, par - 1)
    }
    if (par === 0 && t.type === 'word') {
      const isJoinTail =
        (upper === 'JOIN' || upper === 'APPLY') &&
        cur.length > 0 &&
        cur[cur.length - 1].type === 'word' &&
        JOIN_MODIFIERS.has(cur[cur.length - 1].text.toUpperCase())
      if (!isJoinTail && CLAUSE_STARTERS.has(upper)) {
        if (cur.length > 0) groups.push(cur)
        cur = [t]
        continue
      }
    }
    cur.push(t)
  }
  if (cur.length > 0) groups.push(cur)
  return groups
}

/**
 * Individua il CASE di testa del segmento e lo separa in tre parti:
 * testa (SELECT @x =), CASE … END, coda (',@y = … FROM … JOIN …').
 * Restituisce null se il CASE non è nella testata (es. dentro la WHERE):
 * in quel caso si usa il layout CASE precedente.
 */
function splitHeadCase(segment: Token[]): { head: Token[]; casePart: Token[]; tail: Token[] } | null {
  let depth = 0
  let caseIdx = -1
  for (let i = 0; i < segment.length; i++) {
    const t = segment[i]
    if (t.type === 'punct') {
      if (t.text === '(') depth++
      else if (t.text === ')') depth = Math.max(0, depth - 1)
      continue
    }
    if (depth !== 0 || t.type !== 'word') continue
    const upper = t.text.toUpperCase()
    if (upper === 'CASE') {
      caseIdx = i
      break
    }
    // una clausola prima del CASE → il CASE non è nella testata
    if (CLAUSE_STARTERS.has(upper)) return null
  }
  if (caseIdx === -1) return null

  // fine del CASE: END che chiude il primo CASE (conteggio CASE/END annidati)
  let level = 0
  let endIdx = -1
  for (let i = caseIdx; i < segment.length; i++) {
    const t = segment[i]
    if (t.type !== 'word') continue
    const upper = t.text.toUpperCase()
    if (upper === 'CASE') level++
    else if (upper === 'END') {
      level--
      if (level === 0) {
        endIdx = i
        break
      }
    }
  }
  if (endIdx === -1) return null
  return {
    head: segment.slice(0, caseIdx),
    casePart: segment.slice(caseIdx, endIdx + 1),
    tail: segment.slice(endIdx + 1),
  }
}

/**
 * UPDATE … SET: OGNI campo della SET su riga propria, con la virgola allineata sotto
 * il primo campo (stile del resto del formattatore):
 *   UPDATE t
 *     SET COL1 = 1
 *        ,COL2 = 2
 *   WHERE …
 */
function setClauseRows(basePad: string, tokens: Token[], up: (t: Token) => string, setIndent: number): string[] {
  const isSet = (t: Token) => t.type === 'word' && t.text.toUpperCase() === 'SET'
  const body = tokens.length > 0 && isSet(tokens[0]) ? tokens.slice(1) : tokens
  const out: string[] = []
  let open = 0
  let cur: Token[] = []
  let firstItem = true
  const flushItem = () => {
    if (cur.length === 0) return
    const text = cleanInline(cur.map(up).join(' '))
    if (firstItem) {
      out.push(`${basePad}${' '.repeat(setIndent)}SET ${text}`)
      firstItem = false
    } else {
      // virgola allineata sotto il primo campo ("SET " è lungo 4)
      out.push(`${basePad}${' '.repeat(setIndent + 'SET '.length)},${text}`)
    }
    cur = []
  }
  for (const t of body) {
    if (t.type === 'punct') {
      if (t.text === '(') open++
      else if (t.text === ')') open = Math.max(0, open - 1)
      if (t.text === ',' && open === 0) {
        flushItem()
        continue
      }
      cur.push(t)
      continue
    }
    if (t.type === 'comment' && (t.ownLine || t.text.startsWith('--'))) {
      flushItem()
      out.push(`${basePad}${' '.repeat(setIndent + 'SET '.length)}${up(t)}`)
      continue
    }
    cur.push(t)
  }
  flushItem()
  return out
}

/** Righe delle condizioni WHERE/HAVING: AND/OR su riga propria, parentesi indentate,
 *  ed eventuale CASE espanso (… = CASE WHEN … END) su righe proprie. */
function conditionRows(basePad: string, tokens: Token[], up: (t: Token) => string, unit: number): string[] {
  const out: string[] = []
  let buf: Token[] = []
  let open = 0
  let first = true
  /**
   * Profondità delle parentesi ALL'INIZIO del segmento da stampare: l'indentazione di una riga
   * dipende da quanto è annidata la condizione in quel punto, non dalle parentesi che la riga
   * stessa apre/chiude. Prima si contava la profondità al momento del taglio, così l'ultima
   * riga di un gruppo chiuso rientrava ALL'INDIETRO ("AND RIG_NESE = 0)))" più a sinistra della
   * riga che aveva aperto la parentesi).
   */
  let openInizio = 0
  const flush = (colPad: string) => {
    if (buf.length === 0) return
    const hasCase = buf.some(t => t.type === 'word' && t.text.toUpperCase() === 'CASE')
    if (hasCase) {
      const cls = splitCaseLines(buf, up)
      for (const cl of cls) out.push(`${colPad}${' '.repeat(cl.delta * unit)}${cl.text}`)
    } else {
      const rows = rowsNoDashEat(buf, up)
      for (const r of rows) out.push(`${colPad}${cleanInline(r)}`)
    }
    buf = []
  }
  for (const t of tokens) {
    const upper = t.type === 'word' ? t.text.toUpperCase() : ''
    if ((upper === 'AND' || upper === 'OR') && buf.length > 0) {
      flush(first ? basePad : `${basePad}${' '.repeat(unit * (3 + openInizio))}`)
      first = false
      buf.push(t)
      openInizio = open
      continue
    }
    buf.push(t)
    if (t.type === 'punct') {
      if (t.text === '(') open++
      else if (t.text === ')') open = Math.max(0, open - 1)
    }
  }
  flush(first ? basePad : `${basePad}${' '.repeat(unit * (3 + openInizio))}`)
  return out
}

/** ORDER BY / GROUP BY: ogni elemento su riga propria con virgola allineata sotto il
 *  primo; i commenti in mezzo restano su righe proprie (mai codice dopo un "--"). */
function listRows(basePad: string, tokens: Token[], up: (t: Token) => string, kw: string): string[] {
  let open = 0
  let cur: Token[] = []
  let firstCode = true
  let lastWasComma = false
  const out: string[] = []
  const flushItem = () => {
    if (cur.length === 0) return
    const text = cleanInline(cur.map(up).join(' '))
    if (firstCode) {
      // il primo item contiene già la keyword (ORDER BY …)
      out.push(`${basePad}${text.toLowerCase().startsWith(kw.trim().toLowerCase()) ? text : `${kw.trim()} ${text}`}`)
      firstCode = false
    } else {
      out.push(`${basePad}${' '.repeat(kw.length)} ,${text}`)
    }
    cur = []
    lastWasComma = false
  }
  for (const t of tokens) {
    if (t.type === 'punct') {
      if (t.text === '(') open++
      else if (t.text === ')') open = Math.max(0, open - 1)
      if (t.text === ',' && open === 0) {
        flushItem()
        lastWasComma = true
        continue
      }
      cur.push(t)
      continue
    }
    if (t.type === 'comment' && (t.ownLine || t.text.startsWith('--'))) {
      flushItem()
      out.push(`${basePad}${' '.repeat(kw.length)}${up(t)}`)
      continue
    }
    cur.push(t)
  }
  flushItem()
  // se la lista terminava con una virgola (continua oltre un commento successivo),
  // non si perde il delimitatore: lo si riattacca all'ultima riga emessa
  if (lastWasComma && cur.length === 0 && out.length > 0 && !out[out.length - 1].endsWith(',')) {
    out[out.length - 1] += ','
  }
  return out
}

/**
 * Divide i token di uno statement in righe rispettando la POSIZIONE dei commenti:
 * - un commento che nell'originale stava su una riga propria (ownLine) resta su una
 *   riga propria (mai accodato al codice precedente, mai seguito da codice sulla stessa
 *   riga: un "--" commenterebbe il resto della riga e romperebbe la query);
 * - un commento a fine riga resta in coda alla sua riga di codice.
 * Le righe proseguono con lo stesso ordine dei token.
 */
function rowsNoDashEat(tokens: Token[], up: (t: Token) => string): string[] {
  const rows: string[] = []
  let cur: Token[] = []
  const flush = () => {
    if (cur.length > 0) {
      rows.push(cur.map(up).join(' '))
      cur = []
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'comment') {
      if (t.text.startsWith('--')) {
        if (t.ownLine) {
          // commento "--" su riga propria nell'originale: riga dedicata
          flush()
          rows.push(up(t))
        } else {
          // commento a fine riga: resta in coda alla riga di codice, poi a capo
          cur.push(t)
          flush()
        }
        continue
      }
      // commento a blocco: se occupava una riga propria resta su una riga propria,
      // altrimenti resta inline (tra i token della stessa riga)
      if (t.ownLine) {
        flush()
        rows.push(up(t))
      } else {
        cur.push(t)
      }
      continue
    }
    cur.push(t)
  }
  flush()
  return rows.map(r => r.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

/**
 * Oltre questa larghezza la condizione di un IF/WHILE viene spezzata alle congiunzioni
 * AND/OR; sotto, la condizione corta resta su una riga (come prima).
 */
const CONDIZIONE_MAX_RIGA = 100

/**
 * Righe di una condizione IF/WHILE. Come nella WHERE, le congiunzioni AND/OR di primo
 * livello vanno a capo; una sotto-query fra parentesi ("EXISTS (SELECT …)", "IN (SELECT …)")
 * viene impaginata come uno statement a clausole invece di restare tutta su una riga.
 * Segnalazione utente: la condizione di "WHILE EXISTS (SELECT … FROM … WHERE … AND …)"
 * non veniva formattata (restava una riga lunghissima).
 * Le righe escono già complete della loro indentazione, pronte per pushRawLine.
 */
function condRows(
  tokens: Token[],
  up: (t: Token) => string,
  unit: number,
  baseIndent: number,
  profile: FormatProfile,
): string[] {
  const pad = (n: number) => ' '.repeat(Math.max(0, n) * unit)
  /** ")" che chiude la "(" all'indice `open` (-1 se non c'è). */
  const closeParenOf = (open: number): number => {
    let depth = 0
    for (let k = open; k < tokens.length; k++) {
      const t = tokens[k]
      if (t.type !== 'punct') continue
      if (t.text === '(') depth++
      else if (t.text === ')') {
        depth--
        if (depth === 0) return k
      }
    }
    return -1
  }
  /** True se la condizione contiene una sotto-query: "EXISTS (SELECT …)", "IN (SELECT …)". */
  const haSottoQuery = (() => {
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]
      if (t.type !== 'punct' || t.text !== '(') continue
      const close = closeParenOf(i)
      if (close <= i) continue
      const primo = tokens.slice(i + 1, close).find(x => x.type !== 'comment')
      if (primo?.type === 'word' && ['SELECT', 'WITH'].includes(primo.text.toUpperCase())) return true
    }
    return false
  })()
  // un commento "--" in mezzo alla condizione non si può schiacciare su una riga sola
  // (commenterebbe il resto); un blocco "/* … */" su più righe non si deve comprimere
  const haCommento = tokens.some(
    t => t.type === 'comment' && (t.text.startsWith('--') || t.text.includes('\n')),
  )
  const piatto = cleanInline(tokens.map(up).join(' ')).trim()
  // condizione corta e senza sotto-query: resta su una riga (comportamento storico)
  if (!haSottoQuery && !haCommento && baseIndent * unit + piatto.length <= CONDIZIONE_MAX_RIGA) {
    return piatto ? [pad(baseIndent) + piatto] : []
  }

  const rows: string[] = []
  let cur: Token[] = []
  let curInd = baseIndent
  const flush = () => {
    if (cur.length === 0) return
    // commento a blocco su più righe: conservato così com'è (la pulizia lo schiaccerebbe)
    if (cur.length === 1 && cur[0].type === 'comment' && cur[0].text.includes('\n')) {
      rows.push(pad(curInd) + cur[0].text.replace(/\s+$/, ''))
      cur = []
      return
    }
    const testo = cleanInline(cur.map(up).join(' ')).trim()
    if (testo) rows.push(pad(curInd) + testo)
    cur = []
  }

  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'comment') {
      // storico: il "--" su riga propria resta una riga a sé, quello in coda chiude la riga
      if (t.ownLine || cur.length === 0) {
        flush()
        rows.push(pad(curInd) + cleanInline(up(t)).trim())
      } else {
        cur.push(t)
        if (t.text.startsWith('--')) flush()
      }
      continue
    }
    // sotto-query fra parentesi: impaginata come uno statement a clausole
    if (t.type === 'punct' && t.text === '(') {
      const close = closeParenOf(i)
      if (close > i) {
        const inner = tokens.slice(i + 1, close)
        const primo = inner.find(x => x.type !== 'comment')
        if (primo?.type === 'word' && ['SELECT', 'WITH'].includes(primo.text.toUpperCase())) {
          cur.push(t)
          flush()
          const detailed = detailedSelectRows(
            inner,
            up,
            unit,
            pad(baseIndent + 1),
            profile.setIndent,
            profile,
          )
          const body =
            detailed ??
            splitStatementClauses(inner, up).flatMap(g =>
              rowsNoDashEat(g.tokens, up).map(r => pad(baseIndent + 1) + r),
            )
          rows.push(...body)
          rows.push(pad(baseIndent) + ')')
          curInd = baseIndent + 1
          i = close
          continue
        }
      }
      depth++
      cur.push(t)
      continue
    }
    if (t.type === 'punct' && t.text === ')') {
      depth = Math.max(0, depth - 1)
      cur.push(t)
      continue
    }
    // AND/OR di primo livello: a capo, come nella WHERE
    const upper = t.type === 'word' ? t.text.toUpperCase() : ''
    if (
      depth === 0 &&
      cur.length > 0 &&
      (upper === 'AND' ? profile.breakBeforeAnd : upper === 'OR' ? profile.breakBeforeOr : false)
    ) {
      flush()
      curInd = baseIndent + 1
      cur.push(t)
      continue
    }
    cur.push(t)
  }
  flush()
  return rows
}

// Clausole che iniziano una riga propria dentro SELECT/INSERT…SELECT/UPDATE/DELETE
const CLAUSE_STARTERS = new Set([
  'FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'UNION', 'OUTPUT', 'APPLY', 'JOIN',
  'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS',
])
const JOIN_MODIFIERS = new Set(['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER'])

/** Riga relativa di un layout CTE (ind relativo all'indent dello statement). */
interface CteRow {
  ind: number
  text: string
}

/** Layout di un elenco di CTE: le righe da stampare e i token che restano dopo l'ultima
 *  CTE (che il chiamante DEVE comunque stampare: nulla può andare perso). */
interface CteLayout {
  rows: CteRow[]
  rest: Token[]
}

/** Parole che non possono comparire fra il nome di una CTE e il suo AS: se ne incontro una
 *  vuol dire che l'elenco delle CTE è finito (es. ", x" di un GROUP BY). */
const CTE_HEADER_STOP = new Set([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'EXEC', 'EXECUTE', 'SET', 'DECLARE',
  'IF', 'WHILE', 'BEGIN', 'END', 'PRINT', 'RETURN', 'GOTO', 'UNION', 'EXCEPT', 'INTERSECT',
])

/**
 * Riconosce un segmento "; WITH … AS (SELECT …)" (una o più CTE) e lo impagina su più
 * righe con la parentesi PRIMA della SELECT interna:
 *   ;WITH NOME [commento] AS
 *   (
 *       SELECT …
 *       FROM …
 *       INNER JOIN …
 *   )
 *   , NOME2 AS
 *   (
 *       …
 *   )
 * Restituisce null se il segmento non è un CTE (così lo statement prosegue normalmente).
 */
function layoutCteSegment(segment: Token[], up: (t: Token) => string, profile: FormatProfile): CteLayout | null {
  let start = 0
  if (segment[start]?.type === 'punct' && segment[start].text === ';') start++
  if (!(segment[start]?.type === 'word' && segment[start].text.toUpperCase() === 'WITH')) return null
  if (start === segment.length - 1) return null

  const rows: CteRow[] = []
  /** Inizio dell'intestazione da stampare: 0 (include "; WITH") per la prima CTE,
   *  l'indice della virgola per le successive. */
  let headerStart = 0
  let p = start + 1
  let consumedEnd = -1

  while (p < segment.length) {
    // intestazione: nome [(colonne)] AS — la "(" delle colonne non deve confondere la
    // ricerca dell'AS; un'altra virgola a livello 0 chiude l'elenco.
    let par = 0
    let asIdx = -1
    for (let k = p; k < segment.length; k++) {
      const t = segment[k]
      if (t.type === 'comment') continue
      if (t.type === 'punct') {
        if (t.text === ',' && par === 0) break
        if (t.text === '(') par++
        else if (t.text === ')') par = Math.max(0, par - 1)
        continue
      }
      if (par === 0 && t.type === 'word') {
        const u = t.text.toUpperCase()
        if (u === 'AS') {
          asIdx = k
          break
        }
        if (CTE_HEADER_STOP.has(u)) break
      }
    }
    if (asIdx === -1) break

    // "(" subito dopo AS (eventuali commenti in mezzo sono ammessi)
    let openIdx = -1
    for (let k = asIdx + 1; k < segment.length; k++) {
      const t = segment[k]
      if (t.type === 'comment') continue
      if (t.type === 'punct' && t.text === '(') openIdx = k
      break
    }
    if (openIdx === -1) break

    // corpo: fino alla ")" bilanciata
    let par2 = 0
    let closeIdx = -1
    for (let k = openIdx; k < segment.length; k++) {
      const t = segment[k]
      if (t.type !== 'punct') continue
      if (t.text === '(') par2++
      else if (t.text === ')') {
        par2--
        if (par2 === 0) {
          closeIdx = k
          break
        }
      }
    }
    if (closeIdx === -1) break

    const headerTokens = segment.slice(headerStart, openIdx)
    rows.push({ ind: 0, text: headerTokens.map(up).join(' ').replace(/\s+/g, ' ').trim() })
    rows.push({ ind: 0, text: '(' })

    // impagina il corpo come uno statement a clausole (SELECT … FROM … WHERE …), con la
    // stessa select-list impilata usata fuori dalle routine (formattazione coerente)
    const bodyTokens = segment.slice(openIdx + 1, closeIdx)
    const unit = profile.tabSize || 2
    const detailedBody = detailedSelectRows(bodyTokens, up, unit, '', profile.setIndent, profile)
    const bodyRows: string[] = detailedBody
      ? [...detailedBody]
      : splitStatementClauses(bodyTokens, up).flatMap(g => rowsNoDashEat(g.tokens, up))
    if (bodyRows.length === 0) return null
    for (const row of bodyRows) rows.push({ ind: 1, text: row })
    rows.push({ ind: 0, text: ')' })
    consumedEnd = closeIdx + 1

    // CTE successiva: una virgola a livello 0 seguita da "nome [(colonne)] AS (…)"
    const comma = segment[consumedEnd]
    if (comma?.type === 'punct' && comma.text === ',') {
      headerStart = consumedEnd
      p = consumedEnd + 1
      continue
    }
    break
  }

  if (rows.length === 0 || consumedEnd === -1) return null
  return { rows, rest: segment.slice(consumedEnd) }
}

/**
 * Spezza un segmento statement (SELECT / INSERT…SELECT / UPDATE / DELETE) in gruppi di
 * clausole: la prima riga contiene l'intestazione (INSERT INTO t / SELECT lista…), poi
 * FROM, JOIN, WHERE… ciascuna su un gruppo proprio — come fa il motore delle query
 * semplici. Restituisce un solo gruppo se non ci sono clausole a livello top.
 */
function splitStatementClauses(segment: Token[], _up: (t: Token) => string): { tokens: Token[] }[] {
  const first = segment[0]
  const firstUpper = first.type === 'word' ? first.text.toUpperCase() : ''
  if (!['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(firstUpper)) return [{ tokens: segment }]

  // attiva il layout a clausole se c'è almeno FROM/JOIN/APPLY a livello top, oppure
  // (per l'UPDATE) una SET o una WHERE: "update t set a = 1 where id = 1" deve andare
  // su più righe (SET e WHERE a capo) come nel motore delle query
  let depth = 0
  let hasClause = false
  const isUpdate = firstUpper === 'UPDATE'
  for (const t of segment) {
    if (t.type === 'punct') {
      if (t.text === '(') depth++
      else if (t.text === ')') depth = Math.max(0, depth - 1)
      continue
    }
    if (depth !== 0 || t.type !== 'word') continue
    const u = t.text.toUpperCase()
    if (u === 'FROM' || u === 'JOIN' || u === 'APPLY') {
      hasClause = true
      break
    }
    if (isUpdate && (u === 'SET' || u === 'WHERE')) {
      hasClause = true
      break
    }
  }
  if (!hasClause) return [{ tokens: segment }]

  const groups: { tokens: Token[] }[] = []
  let cur: Token[] = []
  let par = 0
  const startsSegment = firstUpper === 'SELECT'
  const flush = () => {
    if (cur.length > 0) groups.push({ tokens: cur })
    cur = []
  }
  for (let i = 0; i < segment.length; i++) {
    const t = segment[i]
    const upper = t.type === 'word' ? t.text.toUpperCase() : ''
    if (t.type === 'punct') {
      if (t.text === '(') par++
      else if (t.text === ')') par = Math.max(0, par - 1)
    }
    if (par === 0 && t.type === 'word') {
      const isSelect = upper === 'SELECT' && !(i === 0 && startsSegment)
      const isJoinTail =
        (upper === 'JOIN' || upper === 'APPLY') &&
        cur.length > 0 &&
        cur[cur.length - 1].type === 'word' &&
        JOIN_MODIFIERS.has(cur[cur.length - 1].text.toUpperCase())
      // SET apre un gruppo proprio solo nell'UPDATE (altrove "SET x = …" è un'assegnazione)
      const isSetBoundary = isUpdate && upper === 'SET' && i > 0
      if (isSelect || isSetBoundary || CLAUSE_STARTERS.has(upper)) {
        if (!isJoinTail) {
          flush()
          cur = [t]
          continue
        }
      }
    }
    cur.push(t)
  }
  flush()
  return groups.length > 0 ? groups : [{ tokens: segment }]
}

/** Unisce i token in una sola riga con spaziatura normale. */
function joinTokensInline(tokens: Token[], up: (t: Token) => string, profile: FormatProfile): string {
  let out = ''
  for (const t of tokens) {
    const text = up(t)
    if (t.type === 'comment') {
      out += (out.endsWith(' ') || out.length === 0 ? '' : ' ') + text
      continue
    }
    if (t.type === 'punct') {
      if (t.text === ',') {
        out += profile.spaceAfterComma ? ', ' : ','
        continue
      }
      if (t.text === '(' || t.text === '.') {
        if (t.text === '(' && !/(COUNT|SUM|AVG|MIN|MAX|COALESCE|ISNULL|NULLIF|CAST|CONVERT|UPPER|LOWER|LEN|SUBSTRING|LEFT|RIGHT|ROUND|ABS|DATEADD|DATEDIFF|YEAR|MONTH|DAY|IIF|GETDATE|GETUTCDATE|NEWID|POWER|SQRT|REPLACE|TRIM|RTRIM|LTRIM|CHARINDEX|PATINDEX|REVERSE|STUFF|FORMAT|TRY_CAST|TRY_CONVERT|SQUARE|CEILING|FLOOR|SIGN|EXP|LOG|LOG10|ISDATE|ISNUMERIC|IDENTITY|ROW_NUMBER|RANK|DENSE_RANK|NTILE|LAG|LEAD|FIRST_VALUE|LAST_VALUE)\($/i.test(out)) {
          out += ' ('
        } else {
          out += text
        }
        continue
      }
      if (t.text === ')') {
        out = out.replace(/\s+$/, '') + text
        continue
      }
      out += (out.endsWith(' ') || out.length === 0 ? '' : ' ') + text + ' '
      continue
    }
    out += (out.endsWith(' ') || out.endsWith('(') || out.endsWith('.') || out.length === 0 ? '' : ' ') + text
  }
  // operatori composti già separati ("+ =") riuniti, senza toccare le stringhe
  return out.replace(/('(?:[^']|'')*')|([+\-*/%&|^])\s+=(?!=)/g, (_m, str: string, op: string) =>
    str ? str : `${op}=`,
  )
  return out.replace(/\s+/g, ' ').trim()
}
