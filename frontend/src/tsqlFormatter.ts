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
    // punteggiatura/operatori (max 2 caratteri)
    const two = text.slice(i, i + 2)
    if (['>=', '<=', '<>', '!=', '||', '::', '->', '=>'].includes(two)) {
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
  'EXEC', 'EXECUTE', 'PRINT', 'RETURN', 'IF', 'WHILE', 'ELSE', 'GO', 'WITH', 'TRUNCATE',
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
const cleanInline = (text: string) =>
  text
    .replace(/\s*\.\s*/g, '.')
    .replace(/\s*,/g, ',')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    // niente spazio tra tipo e parentesi: NVARCHAR(max), DECIMAL(18,2)
    .replace(/\b(NVARCHAR|VARCHAR|NCHAR|CHAR|DECIMAL|NUMERIC|BINARY|VARBINARY|DATETIME2|DATETIMEOFFSET)\s*\(/gi, '$1(')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Formatta una query semplice secondo il profilo (motore query: clausole su righe proprie).
 */
export function formatSqlWithProfile(sql: string, profile: FormatProfile): string {
  if (isRoutineText(sql)) return formatRoutineWithProfile(sql, profile)
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

  const words = tokens.filter(t => t.type === 'word').length
  const chars = tokens.reduce((acc, t) => acc + t.text.length, 0)
  if (profile.singleLineShort && chars <= profile.singleLineMaxChars && words <= profile.singleLineMaxWords) {
    return joinTokensInline(tokens, up, profile)
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
      lines.push({ indent: currentIndent, text: t.text })
      current = []
      continue
    }

    if (clause) {
      const isJoinModifier = ['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS'].includes(clause)
      const isJoinWord = clause === 'JOIN' || isJoinModifier
      // SELECT ... INTO #tmp su riga propria (INSERT/MERGE INTO restano attaccati)
      const isSelectStmt = /^\s*SELECT\b/i.test(lines.length > 0 ? lines[0].text : current.join(' '))
      if (isJoinModifier && profile.breakBeforeJoin) {
        const next = tokens[i + 1]
        const joinToken =
          next && next.type === 'word' && (next.text.toUpperCase() === 'JOIN' || next.text.toUpperCase() === 'APPLY')
            ? next
            : null
        if (joinToken) {
          flush()
          currentIndent = profile.joinIndent
          current = [`${up(t)} ${up(joinToken)}`]
          i++
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
        continue
      }
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

    if (
      profile.stackSelectColumns &&
      current.length > 0 &&
      current[0].toUpperCase() === 'SELECT' &&
      t.type === 'punct' &&
      t.text === ',' &&
      depth === 0 &&
      current.length > 1
    ) {
      flush()
      currentIndent = profile.selectColumnIndent
      current = []
      continue
    }

    if (t.type === 'punct' && t.text === ',' && current.length > 0) {
      current[current.length - 1] = current[current.length - 1].replace(/\s+$/, '')
      current.push(',')
      continue
    }

    if (current.length === 0) {
      current.push(up(t))
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
      .replace(/\s*\.\s*/g, '.')
      .replace(/\s*,/g, ',')
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

  const pushLine = (text: string, ind?: number) => {
    const indN = ind ?? indent
    // commento a blocco multilinea: preserva le righe interne (niente pulizia/spazi)
    if (text.startsWith('/*') && text.includes('\n')) {
      lines.push({ indent: indN, text })
      return
    }
    const clean = cleanInline(text)
    if (clean.length > 0) lines.push({ indent: indN, text: clean })
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
  // cerca la prima '(' della firma
  let sigOpen = -1
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k].type === 'word' && /^(CREATE|ALTER)$/i.test(tokens[k].text)) {
      // salta fino alla '('
      for (let m = k; m < tokens.length; m++) {
        if (tokens[m].type === 'punct' && tokens[m].text === '(') {
          sigOpen = m
          break
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
      // trova AS dopo sigClose a livello top
      depth = 0
      for (let k = sigClose + 1; k < tokens.length; k++) {
        const t = tokens[k]
        if (t.type === 'punct') {
          if (t.text === '(') depth++
          else if (t.text === ')') depth = Math.max(0, depth - 1)
          continue
        }
        if (depth === 0 && t.type === 'word' && t.text.toUpperCase() === 'AS') {
          asIndex = k
          break
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
      if (t.type === 'punct' && t.text === '(') break
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
    if (k < headerTokens.length && headerTokens[k].type === 'punct' && headerTokens[k].text === '(') {
      pushLine('(', 0)
      k++
      // parametri: una riga per parametro con virgola iniziale
      const paramLines: string[] = []
      let currentParam: string[] = []
      let parDepth = 1
      const isParamSeparator = (tok: Token) => tok.type === 'punct' && tok.text === ',' && parDepth === 1
      for (; k < headerTokens.length; k++) {
        const t = headerTokens[k]
        if (t.type === 'punct' && t.text === '(') {
          parDepth++
          currentParam.push(up(t))
          continue
        }
        if (t.type === 'punct' && t.text === ')') {
          parDepth--
          if (parDepth === 0) {
            if (currentParam.length > 0) paramLines.push(currentParam.join(' '))
            break
          }
          currentParam.push(up(t))
          continue
        }
        if (isParamSeparator(t)) {
          if (currentParam.length > 0) paramLines.push(currentParam.join(' '))
          currentParam = []
          continue
        }
        currentParam.push(up(t))
      }
      const PARAM_INDENT = 4
      paramLines.forEach((p, idx) => {
        // la prima riga senza virgola iniziale, le altre con ','
        pushLine(idx === 0 ? p : `,${p}`, PARAM_INDENT)
      })
      // parentesi chiusa su riga propria
      pushLine(')', 0)
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
    // valuta gli starter con il caseDepth ATTUALE (prima di aggiornarlo): l'END del CASE
    // non deve spezzare come fine blocco
    const isStarter =
      segDepth === 0 &&
      caseDepth === 0 &&
      t.type === 'word' &&
      (ROUTINE_STARTERS.has(upper) || upper === 'END') &&
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

  for (const segment of segments) {
    if (segment.length === 0) continue
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
      // "BEGIN TRANSACTION"/"BEGIN TRAN"/"BEGIN TRY"/"BEGIN CATCH": il resto del
      // segmento (es. TRANSACTION) NON deve andare perso (bug: scompariva dal risultato)
      const extra = segment.slice(1).map(up).join(' ')
      pushLine(extra ? `BEGIN ${extra}` : 'BEGIN', indent)
      blockStack.push('begin')
      indent++
      continue
    }
    if (firstUpper === 'END') {
      // chiude un blocco BEGIN (o il CASE inline è già gestito dentro lo statement)
      indent = Math.max(0, indent - 1)
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
      if (/\bBEGIN\b/i.test(rest)) {
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
      // commento "--" in mezzo alla condizione: chiude la riga, il codice prosegue sotto
      rowsNoDashEat(cond, up).forEach((r, idx) => pushLine(r, idx === 0 ? indent : indent + 1))
      const after = segment.slice(j)
      if (after.length > 0 && after[0].type === 'word' && after[0].text.toUpperCase() === 'BEGIN') {
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

    // EXEC: riga principale + parametri allineati con virgola iniziale
    if (firstUpper === 'EXEC' || firstUpper === 'EXECUTE') {
      const parts: string[] = []
      let cur: string[] = []
      let par = 0
      for (let j = 0; j < segment.length; j++) {
        const t = segment[j]
        if (t.type === 'punct') {
          if (t.text === '(') par++
          else if (t.text === ')') par = Math.max(0, par - 1)
        }
        if (t.type === 'punct' && t.text === ',' && par === 0 && cur.length > 0) {
          parts.push(cur.join(' '))
          cur = []
          continue
        }
        cur.push(up(t))
      }
      if (cur.length > 0) parts.push(cur.join(' '))
      if (parts.length === 1) {
        pushLine(parts[0], indent)
      } else {
        // allinea i parametri alla colonna di "exec ... " (primo token dopo exec)
        const firstLine = parts[0]
        const paramPad = firstLine.length + 1
        pushLine(firstLine, indent)
        for (let p = 1; p < parts.length; p++) {
          pushLine(`,` + parts[p], Math.max(indent, Math.round(paramPad / 2)))
        }
      }
      continue
    }

    // ; WITH <nome> AS ( SELECT … ) — CTE: apre su righe proprie con la parentesi
    // prima della SELECT interna, e spezza le clausole della subquery (FROM/JOIN/WHERE).
    const cteLayout = layoutCteSegment(segment, up)
    if (cteLayout) {
      flushLine()
      for (const r of cteLayout) pushLine(r.text, lineIndent + r.ind)
      continue
    }

    // SELECT / INSERT / UPDATE / DELETE / SET: statement con clausole, con eventuale CASE inline
    const caseLines = splitCaseLines(segment, up)
    if (caseLines.length > 1) {
      // il CASE inline viene spezzato su righe proprie indentate
      caseLines.forEach(cl => pushLine(cl.text, lineIndent + cl.delta))
    } else {
      // SELECT TOP n @a = …, @b = … FROM … WHERE …: layout "a colonna" (assegnazioni
      // verticali con virgola iniziale, condizioni AND/OR su righe proprie, ORDER BY per item)
      const unit = profile.tabSize || 2
      const basePad = ' '.repeat(lineIndent * unit)
      const assLayout = selectAssignmentLayout(segment, up, unit, basePad)
      if (assLayout) {
        flushLine()
        for (const row of assLayout) pushRawLine(row)
        continue
      }
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
 * SELECT TOP n @a = expr, @b = expr … FROM … WHERE …: impaginazione "SQL Prompt":
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
 * Restituisce righe già complete (testo + indentazione) o null se lo statement non
 * è di questo tipo (in tal caso si usa il layout a clausole semplice).
 */
function selectAssignmentLayout(
  segment: Token[],
  up: (t: Token) => string,
  unit: number,
  basePad: string,
): string[] | null {
  const groups = splitStatementClauses(segment, up)
  if (groups.length < 2) return null
  const head = groups[0].tokens

  // separa "SELECT TOP 1" dalla lista di assegnazioni "@var = …"
  const varStart = head.findIndex(t => t.type === 'word' && t.text.startsWith('@'))
  if (varStart <= 0) return null
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
  const isAssign = (toks: Token[]) =>
    toks.length > 1 &&
    toks[0].type === 'word' &&
    toks[0].text.startsWith('@') &&
    toks.some(x => x.type === 'punct' && x.text === '=')
  if (items.length < 2 || !items.every(isAssign)) return null

  const header = head.slice(0, varStart).map(up).join(' ')
  const out: string[] = []
  out.push(`${basePad}${cleanInline(header)}`)

  const maxVar = Math.max(...items.map(it => it[0].text.length))
  items.forEach((it, idx) => {
    const name = it[0].text
    const after = it.slice(1) // inizia con '='
    const gap = maxVar - name.length + 1
    const tail = cleanInline(after.map(up).join(' '))
    if (idx === 0) {
      out.push(`${basePad}   ${name}${' '.repeat(gap)}${tail}`)
    } else {
      out.push(`${basePad}  ,${name}${' '.repeat(gap)}${tail}`)
    }
  })

  // clausole successive: FROM / JOIN / WHERE / GROUP / HAVING / ORDER / UNION / OUTPUT
  for (let g = 1; g < groups.length; g++) {
    const tokens = groups[g].tokens
    const first = tokens[0]
    const kw = first.type === 'word' ? first.text.toUpperCase() : ''
    if (kw === 'FROM' || kw === 'OUTPUT' || kw === 'UNION') {
      const r = rowsNoDashEat(tokens, up)[0]
      if (r) out.push(`${basePad}${cleanInline(r)}`)
    } else if (kw === 'INNER' || kw === 'LEFT' || kw === 'RIGHT' || kw === 'FULL' || kw === 'CROSS' || kw === 'JOIN' || kw === 'APPLY') {
      const r = rowsNoDashEat(tokens, up)[0]
      if (r) out.push(`${basePad}${' '.repeat(unit)}${cleanInline(r)}`)
    } else if (kw === 'WHERE' || kw === 'HAVING') {
      out.push(...conditionRows(basePad, tokens, up, unit))
    } else if (kw === 'ORDER' || kw === 'GROUP') {
      out.push(...listRows(basePad, tokens, up, `${kw} BY `))
    }
  }
  return out.filter(Boolean)
}

/** Righe delle condizioni WHERE/HAVING: AND/OR su riga propria, parentesi indentate. */
function conditionRows(basePad: string, tokens: Token[], up: (t: Token) => string, unit: number): string[] {
  const out: string[] = []
  let buf: Token[] = []
  let open = 0
  let first = true
  const flush = (colPad: string) => {
    if (buf.length > 0) {
      const rows = rowsNoDashEat(buf, up)
      for (const r of rows) out.push(`${colPad}${cleanInline(r)}`)
      buf = []
    }
  }
  for (const t of tokens) {
    const upper = t.type === 'word' ? t.text.toUpperCase() : ''
    if ((upper === 'AND' || upper === 'OR') && buf.length > 0) {
      flush(first ? basePad : `${basePad}${' '.repeat(unit * (3 + open))}`)
      first = false
      buf.push(t)
      continue
    }
    buf.push(t)
    if (t.type === 'punct') {
      if (t.text === '(') open++
      else if (t.text === ')') open = Math.max(0, open - 1)
    }
  }
  flush(first ? basePad : `${basePad}${' '.repeat(unit * (3 + open))}`)
  return out
}

/** ORDER BY / GROUP BY: ogni elemento su riga propria con virgola allineata sotto il primo. */
function listRows(basePad: string, tokens: Token[], up: (t: Token) => string, kw: string): string[] {
  let open = 0
  const items: Token[][] = []
  let cur: Token[] = []
  const flushItem = () => {
    if (cur.length > 0) {
      items.push(cur)
      cur = []
    }
  }
  for (const t of tokens) {
    if (t.type === 'punct') {
      if (t.text === '(') open++
      else if (t.text === ')') open = Math.max(0, open - 1)
    }
    if (t.type === 'punct' && t.text === ',' && open === 0) {
      flushItem()
      continue
    }
    cur.push(t)
  }
  flushItem()
  const out: string[] = []
  const kwTrim = kw.trim()
  items.forEach((it, i) => {
    const text = cleanInline(it.map(up).join(' '))
    if (i === 0) {
      // il primo item contiene già la keyword (ORDER BY …) quando il gruppo inizia con essa
      out.push(`${basePad}${text.toLowerCase().startsWith(kwTrim.toLowerCase()) ? text : `${kwTrim} ${text}`}`)
    } else {
      out.push(`${basePad}${' '.repeat(kw.length)} ,${text}`)
    }
  })
  return out
}

/**
 * Divide i token di uno statement in righe: un commento di riga "--" seguito da altro
 * codice chiude la riga subito dopo il commento (altrimenti il codice successivo,
 * accodato sulla stessa riga dal formattatore, verrebbe COMMENTATO e romperebbe la
 * query). Le righe proseguono con lo stesso ordine dei token.
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
    cur.push(t)
    if (t.type === 'comment' && t.text.startsWith('--') && i + 1 < tokens.length) flush()
  }
  flush()
  return rows.map(r => r.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

// Clausole che iniziano una riga propria dentro SELECT/INSERT…SELECT/UPDATE/DELETE
const CLAUSE_STARTERS = new Set([
  'FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'UNION', 'OUTPUT', 'APPLY', 'JOIN',
  'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS',
])
const JOIN_MODIFIERS = new Set(['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS'])

/** Riga relativa di un layout CTE (ind relativo all'indent dello statement). */
interface CteRow {
  ind: number
  text: string
}

/**
 * Riconosce un segmento "; WITH … AS (SELECT …)" (una o più CTE) e lo impagina su più
 * righe con la parentesi PRIMA della SELECT interna:
 *   ;WITH NOME [commento] AS
 *   (
 *       SELECT …
 *       FROM …
 *       INNER JOIN …
 *   )
 * Restituisce null se il segmento non è un CTE (così lo statement prosegue normalmente).
 */
function layoutCteSegment(segment: Token[], up: (t: Token) => string): CteRow[] | null {
  let i = 0
  if (segment[i]?.type === 'punct' && segment[i].text === ';') i++
  if (!(segment[i]?.type === 'word' && segment[i].text.toUpperCase() === 'WITH')) return null
  if (i === segment.length - 1) return null

  const out: CteRow[] = []
  let depth = 0
  // trova l'indice di AS a profondità 0 (salta l'eventuale elenco colonne "nome (a, b)")
  let asIdx = -1
  for (let k = i + 1; k < segment.length; k++) {
    const t = segment[k]
    if (t.type === 'punct') {
      if (t.text === '(') depth++
      else if (t.text === ')') depth = Math.max(0, depth - 1)
      continue
    }
    if (depth === 0 && t.type === 'word' && t.text.toUpperCase() === 'AS') {
      asIdx = k
      break
    }
  }
  if (asIdx === -1) return null

  // header: "; WITH nome [AS]" (+ eventuali commenti prima della "(")
  let openIdx = -1
  for (let k = asIdx + 1; k < segment.length; k++) {
    const t = segment[k]
    if (t.type === 'comment') continue
    if (t.type === 'punct' && t.text === '(') {
      openIdx = k
      break
    }
    return null // ci si aspetta "(" subito dopo AS
  }
  if (openIdx === -1) return null

  const headerTokens = segment.slice(0, openIdx)
  out.push({ ind: 0, text: headerTokens.map(up).join(' ').replace(/\s+/g, ' ').trim() })
  out.push({ ind: 0, text: '(' })

  // corpo: fino alla ")" bilanciata
  let par = 0
  let closeIdx = -1
  for (let k = openIdx; k < segment.length; k++) {
    const t = segment[k]
    if (t.type === 'punct') {
      if (t.text === '(') par++
      else if (t.text === ')') {
        par--
        if (par === 0) {
          closeIdx = k
          break
        }
      }
    }
  }
  if (closeIdx === -1) return null
  const bodyTokens = segment.slice(openIdx + 1, closeIdx)

  // impagina il corpo come uno statement a clausole (SELECT … FROM … WHERE …)
  const groups = splitStatementClauses(bodyTokens, up)
  let any = false
  for (const g of groups) {
    for (const row of rowsNoDashEat(g.tokens, up)) {
      out.push({ ind: 1, text: row })
      any = true
    }
  }
  if (!any) return null
  out.push({ ind: 0, text: ')' })

  // CTE successive: ", NOME2 AS ( … )" — gestite ricorsivamente dopo la virgola a livello 0
  const rest = segment.slice(closeIdx + 1)
  const commaAt = rest.findIndex(t => t.type === 'punct' && t.text === ',')
  if (commaAt !== -1) {
    const next = layoutCteSegment(rest.slice(commaAt + 1), up)
    if (next) {
      for (const r of next) out.push(r)
    }
  }
  return out
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

  // attiva il layout a clausole solo se c'è almeno FROM/JOIN/APPLY a livello top
  let depth = 0
  let hasClause = false
  for (const t of segment) {
    if (t.type === 'punct') {
      if (t.text === '(') depth++
      else if (t.text === ')') depth = Math.max(0, depth - 1)
      continue
    }
    if (depth === 0 && t.type === 'word' && (t.text.toUpperCase() === 'FROM' || t.text.toUpperCase() === 'JOIN' || t.text.toUpperCase() === 'APPLY')) {
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
      if (isSelect || CLAUSE_STARTERS.has(upper)) {
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
  return out.replace(/\s+/g, ' ').trim()
}
