// Classificazione del contesto di digitazione dell'intellisense.
// Logica PURA (testabile): dato il testo prima del cursore stabilisce in quale
// "contesto" siamo e quali categorie di suggerimenti hanno senso. Il provider
// usa questa funzione; la suite di test verifica che ogni contesto produca
// solo le voci ammesse (niente rumore fuori contesto).

export type SuggestionCategory =
  | 'columns' // colonne delle tabelle dello statement
  | 'qualifiedColumns' // colonne qualificate (alias.col)
  | 'tables' // tabelle (anche per JOIN)
  | 'joinTables' // tabelle proposte in posizione JOIN (con ON)
  | 'views'
  | 'procedures'
  | 'labels' // label di GOTO definite nel documento
  | 'functions' // funzioni SQL di sistema + utente
  | 'keywords' // parole chiave SQL
  | 'snippets' // template statement (INSERT/SELECT/...)
  | 'joinConditions' // condizioni aggiuntive dell'ON (AND a = b)
  | 'counterparts' // controparti di JOIN (FK/token)
  | 'insertColumns' // colonne della tabella in INSERT INTO t (
  | 'values' // valori di default per la colonna in VALUES
  | 'orderDirections' // ASC / DESC nella ORDER BY

/** Direzioni di ordinamento proposte nella ORDER BY. */
export const ORDER_DIRECTIONS = ['ASC', 'DESC'] as const

export interface IntellisenseContext {
  /** Nome leggibile del contesto (per debug e test). */
  kind:
    | 'statementStart'
    | 'tablePosition'
    | 'joinPosition'
    | 'afterTableName'
    | 'execPosition'
    | 'gotoPosition'
    | 'selectList'
    | 'columnContext'
    | 'orderBy'
    | 'generic'
  /** Categorie di suggerimenti ammesse in questo contesto. */
  allowed: SuggestionCategory[]
  isTablePosition: boolean
  isJoinPosition: boolean
  isExecPosition: boolean
  /** True dopo "GOTO " (o "GOTO" parziale): si propongono le label del documento. */
  isGotoPosition: boolean
  isColumnContext: boolean
  inSelectList: boolean
  /** True quando il cursore è dentro la ORDER BY (… ORDER BY a, b ▮): solo colonne + ASC/DESC. */
  inOrderBy: boolean
  /** True dopo "FROM t " / "JOIN t " (c'è già una tabella, serve la clausola successiva). */
  afterTableName: boolean
  statementStart: boolean
}

export interface ClassifyInput {
  /** Testo prima della parola in corso (per le regex di clausola). */
  prefix: string
  /** Testo dello statement prima del cursore (per SELECT/FROM). */
  stmtBefore: string
}

/** Parole chiave di clausola valide DOPO il nome di una tabella (WHERE/JOIN/...). */
const AFTER_TABLE_KEYWORDS = new Set([
  'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'ON', 'GROUP', 'ORDER', 'HAVING',
  'UNION', 'SET', 'VALUES', 'OUTPUT', 'OPTION', 'AS', 'WITH', 'AND', 'OR',
  // costrutti ufficiali T-SQL: APPLY/PIVOT/UNPIVOT, FOR XML/JSON, collation, set operatori
  'APPLY', 'PIVOT', 'UNPIVOT', 'FOR', 'COLLATE', 'EXCEPT', 'INTERSECT', 'TABLESAMPLE', 'HOLDLOCK',
])

/** Classifica il contesto corrente. */
export function classifyContext({ prefix, stmtBefore }: ClassifyInput): IntellisenseContext {
  const isTablePosition = /(?:FROM|JOIN|UPDATE|INTO|TABLE)\s*$/i.test(prefix)
  const isJoinPosition = /(?:(?:LEFT|RIGHT|INNER|OUTER|CROSS|FULL)\s+)?JOIN\s*$/i.test(prefix)
  const isExecPosition = /(?:^|\s)EXEC(?:UTE)?\s*$/i.test(prefix)
  // "GOTO " (anche con la parola in corso: "goto lb") → label del documento
  const isGotoPosition = /(?:^|[\s;])GOTO\s*$/i.test(prefix)
  // dopo una virgola che CONTINUA una lista di colonne (es. "GROUP BY a, ",
  // "ORDER BY a, b, ", "WHERE x IN (1, ", "ON a = b, "): il contesto resta di colonne.
  // Il testo prima dell'ultima virgola deve appartenere a una clausola di colonne,
  // così "FROM a, " resta un contesto di TABELLE.
  const commaContinuation = (() => {
    const m = /,\s*$/.exec(prefix)
    if (!m) return false
    const before = prefix.slice(0, m.index)
    // l'ultima clausola di colonne prima della virgola (la coda può contenere altre virgole:
    // "ORDER BY a, b, ")
    return /(?:\bGROUP\s+BY|\bORDER\s+BY|\bWHERE\b|\bHAVING\b|\bON\b|\bSET\b)[^;]*$/i.test(before)
  })()
  const isColumnContext =
    /(?:WHERE|ON|HAVING|AND|OR|SET|BY|GROUP|ORDER)\s*$/i.test(prefix) ||
    /(?:=|<>|!=|<=|>=|<|>)\s*$/i.test(prefix) ||
    commaContinuation
  // Zona "select-list": il cursore è tra l'ULTIMO SELECT e il suo FROM. La flag vale
  // solo se dopo quell'SELECT non è già comparsa una clausola che chiude la lista o
  // apre un'altra istruzione (FROM/JOIN/INTO/UPDATE/TABLE) — e NON se la posizione
  // corrente è una di quelle clausole (fine del prefix).
  // Senza questo controllo, in un batch scritto senza ';' ("BEGIN TRAN … DECLARE …
  // SELECT @caus = 1 … INSERT INTO ti…") lo statement si estende sulle istruzioni
  // precedenti e una posizione INTO/JOIN verrebbe scambiata per select-list: invece
  // delle TABELLE (es. dbo.TIPI_EVENTI) il provider proporrebbe solo colonne
  // (bug utente: "quando scrivo 'insert into tipi' non mi suggerisce le tabelle").
  const inSelectList = (() => {
    const selects = [...stmtBefore.matchAll(/\bSELECT\b/gi)]
    if (selects.length === 0) return false
    const last = selects[selects.length - 1]
    const after = stmtBefore.slice(last.index + last[0].length)
    if (/(?:FROM|JOIN|INTO|UPDATE|TABLE)\b/i.test(after)) return false
    return !isTablePosition && !isJoinPosition && !isExecPosition
  })()
  const statementStart = /(?:^|;|\bGO\b|\n\s*\n)\s*$/i.test(prefix)

  // ORDER BY: se l'ULTIMA clausola di column-list dello statement è "ORDER BY" e non
  // sono comparse clausole successive (WHERE/GROUP/HAVING/UNION/SET/FROM), il cursore
  // è nella lista di ordinamento. Lì servono SOLO colonne delle tabelle dello statement
  // più ASC/DESC: niente tabelle, procedure o funzioni.
  const inOrderBy = (() => {
    let last = ''
    for (const m of stmtBefore.matchAll(/\b(ORDER\s+BY|GROUP\s+BY|WHERE|HAVING|UNION|FROM|SET)\b/gi)) {
      last = m[1].toUpperCase()
    }
    return last.startsWith('ORDER')
  })()

  // dopo "FROM t " / "JOIN t " (spazio dopo il nome tabella): la clausola successiva
  const afterTableName =
    /(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+[^\s,;()]+\s*$/i.test(prefix) &&
    !isJoinPosition &&
    !isTablePosition

  let kind: IntellisenseContext['kind']
  let allowed: SuggestionCategory[]

  if (isExecPosition) {
    kind = 'execPosition'
    allowed = ['procedures']
  } else if (isGotoPosition) {
    // dopo GOTO servono SOLO le label del documento
    kind = 'gotoPosition'
    allowed = ['labels']
  } else if (isJoinPosition) {
    kind = 'joinPosition'
    allowed = ['joinTables', 'tables', 'views']
  } else if (isTablePosition) {
    kind = 'tablePosition'
    allowed = ['tables', 'views']
  } else if (inOrderBy) {
    // dentro la ORDER BY: colonne dello statement + ASC/DESC (niente funzioni/procedure/tabelle)
    kind = 'orderBy'
    allowed = ['columns', 'orderDirections']
  } else if (inSelectList) {
    kind = 'selectList'
    allowed = ['columns', 'functions', 'snippets']
  } else if (isColumnContext) {
    kind = 'columnContext'
    allowed = ['columns', 'functions', 'joinConditions', 'counterparts']
  } else if (afterTableName) {
    // dopo "FROM t ": serve la clausola successiva (WHERE/JOIN/...) o un'altra tabella
    kind = 'afterTableName'
    allowed = ['keywords', 'tables', 'views']
  } else if (statementStart) {
    kind = 'statementStart'
    allowed = ['snippets', 'tables', 'views', 'procedures', 'keywords']
  } else {
    kind = 'generic'
    allowed = ['tables', 'views', 'procedures', 'keywords', 'columns']
  }

  return {
    kind,
    allowed,
    isTablePosition,
    isJoinPosition,
    isExecPosition,
    isGotoPosition,
    isColumnContext,
    inSelectList,
    inOrderBy,
    afterTableName,
    statementStart,
  }
}

/** True se una categoria è ammessa nel contesto. */
export function allows(ctx: IntellisenseContext, cat: SuggestionCategory): boolean {
  return ctx.allowed.includes(cat)
}

/**
 * True se la parola in corso è un prefisso significativo di "order"
 * ("or", "ord", "order", …): in quel caso si propone "ORDER BY" come voce unica.
 */
export function isOrderWordTyped(word: string): boolean {
  const w = word.trim().toLowerCase()
  return w.length >= 2 && w.length <= 5 && 'order'.startsWith(w)
}

/**
 * True se il cursore è subito dopo "ORDER" con spazio (parola vuota o già avviata,
 * es. "order b"): il `prefix` (testo PRIMA della parola in corso) termina con
 * "ORDER " → serve "BY" per completare "ORDER BY".
 */
export function isAfterOrderKeyword(prefix: string): boolean {
  return /\bORDER\s+$/i.test(prefix)
}

/**
 * Le condizioni ON aggiuntive ("AND a = b") si propongono SOLO quando non si sta
 * digitando una colonna E c'è già una condizione COMPLETA: subito dopo "col = "
 * (lato destro) servono le colonne, non gli "AND ...". Così "ON (a = b" propone
 * gli AND, mentre "ON (a = " no. Inoltre il cursore deve essere DENTRO l'ultima
 * clausola ON: se dopo l'ON c'è ORDER BY/GROUP BY/HAVING/WHERE/… gli "AND a = b"
 * del JOIN sarebbero rumore (in ORDER BY servono PRIMA i campi delle tabelle).
 */
export function shouldSuggestJoinConditions(word: string, stmtBefore: string): boolean {
  if (word.length > 0 || !/\bON\b/i.test(stmtBefore)) return false
  const onMatches = [...stmtBefore.matchAll(/\bON\b/gi)]
  if (onMatches.length === 0) return false
  const afterLastOn = stmtBefore.slice(onMatches[onMatches.length - 1].index + 2)
  if (/\b(?:ORDER|GROUP|HAVING|WHERE|SET|UNION|LIMIT|OFFSET|INTO|VALUES)\b/i.test(afterLastOn)) return false
  // l'ultimo '=' non deve essere "vuoto" alla destra (lì si vogliono le colonne)
  const m = /=([^=]*)$/.exec(stmtBefore)
  if (m && m[1].trim() === '') return false
  return true
}

/** Filtra le keyword SQL per il contesto "dopo tabella": solo quelle di clausola. */
export function filterKeywordsForContext(ctx: IntellisenseContext, keywords: string[]): string[] {
  if (ctx.kind === 'afterTableName') {
    return keywords.filter(k => AFTER_TABLE_KEYWORDS.has(k.toUpperCase()))
  }
  if (ctx.kind === 'statementStart' || ctx.kind === 'generic') {
    // all'inizio servono le keyword di statement; in generic le più utili
    if (ctx.kind === 'statementStart') {
      // statement ufficiali T-SQL (riferimento Microsoft): DML/DDL/permessi/backup/sessione/controllo
      return keywords.filter(k =>
        /^(SELECT|INSERT|UPDATE|DELETE|MERGE|EXEC|EXECUTE|DECLARE|CREATE|ALTER|DROP|USE|GO|BEGIN|WITH|BACKUP|RESTORE|GRANT|REVOKE|DENY|TRUNCATE|SET|PRINT|IF|WHILE|COMMIT|ROLLBACK|SAVE|TRANSACTION|RAISERROR|THROW|RETURN|KILL|DBCC|CHECKPOINT|BULK|EXCEPT|INTERSECT|BREAK|CONTINUE|GOTO|WAITFOR)$/i.test(k),
      )
    }
  }
  return keywords
}
