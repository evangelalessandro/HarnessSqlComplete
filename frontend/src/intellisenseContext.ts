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
  | 'functions' // funzioni SQL di sistema + utente
  | 'keywords' // parole chiave SQL
  | 'snippets' // template statement (INSERT/SELECT/...)
  | 'joinConditions' // condizioni aggiuntive dell'ON (AND a = b)
  | 'counterparts' // controparti di JOIN (FK/token)
  | 'insertColumns' // colonne della tabella in INSERT INTO t (
  | 'values' // valori di default per la colonna in VALUES

export interface IntellisenseContext {
  /** Nome leggibile del contesto (per debug e test). */
  kind:
    | 'statementStart'
    | 'tablePosition'
    | 'joinPosition'
    | 'afterTableName'
    | 'execPosition'
    | 'selectList'
    | 'columnContext'
    | 'generic'
  /** Categorie di suggerimenti ammesse in questo contesto. */
  allowed: SuggestionCategory[]
  isTablePosition: boolean
  isJoinPosition: boolean
  isExecPosition: boolean
  isColumnContext: boolean
  inSelectList: boolean
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
])

/** Classifica il contesto corrente. */
export function classifyContext({ prefix, stmtBefore }: ClassifyInput): IntellisenseContext {
  const isTablePosition = /(?:FROM|JOIN|UPDATE|INTO|TABLE)\s*$/i.test(prefix)
  const isJoinPosition = /(?:(?:LEFT|RIGHT|INNER|OUTER|CROSS|FULL)\s+)?JOIN\s*$/i.test(prefix)
  const isExecPosition = /(?:^|\s)EXEC(?:UTE)?\s*$/i.test(prefix)
  const isColumnContext =
    /(?:WHERE|ON|HAVING|AND|OR|SET|BY|GROUP|ORDER)\s*$/i.test(prefix) ||
    /(?:=|<>|!=|<=|>=|<|>)\s*$/i.test(prefix)
  const inSelectList = /\bSELECT\b/i.test(stmtBefore) && !/\bFROM\b/i.test(stmtBefore)
  const statementStart = /(?:^|;|\bGO\b|\n\s*\n)\s*$/i.test(prefix)

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
  } else if (isJoinPosition) {
    kind = 'joinPosition'
    allowed = ['joinTables', 'tables', 'views']
  } else if (isTablePosition) {
    kind = 'tablePosition'
    allowed = ['tables', 'views']
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
    isColumnContext,
    inSelectList,
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
      return keywords.filter(k => /^(SELECT|INSERT|UPDATE|DELETE|MERGE|EXEC|EXECUTE|DECLARE|CREATE|ALTER|DROP|USE|GO|BEGIN|WITH)$/i.test(k))
    }
  }
  return keywords
}
