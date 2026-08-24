// Formattatore T-SQL basato sul profilo FormatProfile (stile Redgate/SQL Prompt).
// Tokenizza il testo (rispettando stringhe e commenti), poi ricostruisce le righe
// applicando le regole del profilo: a-capo prima delle clausole, indentazioni,
// stacked select list, INSERT/VALUES, UPDATE/SET, case delle keyword.

import type { FormatProfile } from './formatProfile'

type Token =
  | { type: 'word'; text: string }
  | { type: 'string'; text: string }
  | { type: 'comment'; text: string }
  | { type: 'punct'; text: string }

/** Tokenizza il testo SQL rispettando stringhe, commenti e operatori. */
export function tokenizeSqlText(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    // commento di riga
    if (ch === '-' && text[i + 1] === '-') {
      const end = text.indexOf('\n', i)
      const slice = text.slice(i, end === -1 ? n : end)
      tokens.push({ type: 'comment', text: slice })
      i += slice.length
      continue
    }
    // commento a blocco
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const slice = text.slice(i, end === -1 ? n : end + 2)
      tokens.push({ type: 'comment', text: slice })
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
      tokens.push({ type: 'string', text: text.slice(start, i) })
      continue
    }
    // parola/identificatore (con @ per variabili, e numeri)
    if (/[A-Za-z_@]/.test(ch) || (ch >= '0' && ch <= '9')) {
      const m = /^[A-Za-z_@][A-Za-z0-9_@]*|\d+(?:\.\d+)?/.exec(text.slice(i))
      if (m) {
        tokens.push({ type: 'word', text: m[0] })
        i += m[0].length
        continue
      }
    }
    // spazi bianchi: saltati (la ricostruzione decide gli spazi)
    if (/\s/.test(ch)) {
      i++
      continue
    }
    // punteggiatura/operatori (max 2 caratteri)
    const two = text.slice(i, i + 2)
    if (['>=', '<=', '<>', '!=', '||', '::', '->', '=>'].includes(two)) {
      tokens.push({ type: 'punct', text: two })
      i += 2
      continue
    }
    tokens.push({ type: 'punct', text: ch })
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
  'CROSS', 'JOIN', 'ON', 'SET', 'VALUES', 'USING', 'WHEN', 'OUTPUT', 'OPTION',
]

interface Row {
  indent: number
  text: string
}

/**
 * Formatta un testo T-SQL secondo il profilo. La logica principale:
 * - se la query è "corta" e il profilo lo permette → una sola riga;
 * - altrimenti a-capo prima delle clausole principali con l'indentazione del profilo;
 * - select list impilata se richiesto; INSERT/VALUES e UPDATE/SET su righe separate.
 */
export function formatSqlWithProfile(sql: string, profile: FormatProfile): string {
  const tokens = tokenizeSqlText(sql)
  if (tokens.length === 0) return sql

  // case delle keyword/datatype
  const up = (t: Token): string => {
    if (t.type === 'word') {
      const upper = t.text.toUpperCase()
      if (profile.keywordUpper && KEYWORDS.has(upper)) return upper
      if (profile.dataTypeUpper && TYPES.has(upper)) return upper
      if (t.text.startsWith('@')) return t.text // variabili invariati
    }
    return t.text
  }

  // query corta → una riga (con spazi normalizzati)
  const words = tokens.filter(t => t.type === 'word').length
  const chars = tokens.reduce((acc, t) => acc + t.text.length, 0)
  if (profile.singleLineShort && chars <= profile.singleLineMaxChars && words <= profile.singleLineMaxWords) {
    return joinTokensInline(tokens, up, profile)
  }

  // trova le posizioni delle clausole a livello top (profondità parentesi 0)
  const clauseAt = new Map<number, string>()
  let depth = 0
  let lastWord = ''
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
      // current contiene già stringhe convertite (up applicato nel loop)
      const text = current.join(' ')
      lines.push({ indent: currentIndent, text })
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

    if (clause) {
      const isJoinModifier = ['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS'].includes(clause)
      const isJoinWord = clause === 'JOIN' || isJoinModifier
      // "INNER JOIN": il modificatore e JOIN stanno sulla stessa riga
      if (isJoinModifier && profile.breakBeforeJoin) {
        const next = tokens[i + 1]
        const joinToken = next && next.type === 'word' && next.text.toUpperCase() === 'JOIN' ? next : null
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
        (isJoinWord && profile.breakBeforeJoin) ||
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
        clause === 'OPTION'
      ) {
        let indent = 0
        if (clause === 'FROM') indent = 0
        else if (isJoinWord) indent = profile.joinIndent
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

    // gestione della select list impilata: dopo SELECT, la prima virgola a livello top
    // spezza in righe ogni colonna
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

    // spaziatura: virgola senza spazio prima, spazio dopo; operatori binari con spazi
    if (t.type === 'punct' && t.text === ',' && current.length > 0) {
      // se non è inizio riga, evita lo spazio prima della virgola
      current[current.length - 1] = current[current.length - 1].replace(/\s+$/, '')
      current.push(',')
      continue
    }

    if (current.length === 0) {
      current.push(up(t))
    } else {
      const prev = current[current.length - 1]
      // niente spazio prima di ',' o ')'
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

  // normalizza la spaziatura di ogni riga: niente spazi attorno al punto, prima della virgola
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
        // spazio prima di '(' tranne per le chiamate di funzione di sistema (COUNT(, ISNULL(, ...)
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
    out += (out.endsWith(' ') || out.endsWith('(') || out.length === 0 ? '' : ' ') + text
  }
  return out.replace(/\s+/g, ' ').trim()
}
