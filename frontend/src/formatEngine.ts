// MOTORE DI FORMATTAZIONE: si può formattare con il motore "nostro" (quello usato fino ad oggi,
// con il profilo T-SQL dell'app) oppure con la libreria di terze parti `sql-formatter`
// (https://github.com/sql-formatter-org/sql-formatter, dialetto `tsql`).
//
// La libreria ha le SUE opzioni (rientri, maiuscole, larghezza delle espressioni…): qui stanno i
// valori di default, la validazione e la traduzione in quello che si passa alla libreria. Senza
// queste opzioni l'output risultava "piatto" (tutto su poche righe, con i rientri di default).
import { format as formatLibreria } from 'sql-formatter'
import type { FormatProfile } from './formatProfile'
import { formatSqlWithProfile } from './tsqlFormatter'

export type MotoreFormattazione = 'nostro' | 'sql-formatter'

export const MOTORI_FORMATTAZIONE: MotoreFormattazione[] = ['nostro', 'sql-formatter']

/** Etichetta mostrata nell'interfaccia. */
export function etichettaMotore(m: MotoreFormattazione): string {
  return m === 'nostro' ? 'Nostro (profilo T-SQL dell\u2019app)' : 'sql-formatter (libreria esterna)'
}

/** Opzioni della libreria sql-formatter esposte nell'interfaccia. */
export interface OpzioniSqlFormatter {
  /** Larghezza di un rientro (spazi). */
  tabWidth: number
  /** Maiuscole: parole chiave, tipi di dato e funzioni. */
  keywordCase: 'preserve' | 'upper' | 'lower'
  dataTypeCase: 'preserve' | 'upper' | 'lower'
  functionCase: 'preserve' | 'upper' | 'lower'
  /** Stile del rientro: standard oppure tabellare (a colonne). */
  indentStyle: 'standard' | 'tabularLeft' | 'tabularRight'
  /** AND/OR a inizio riga o in coda. */
  logicalOperatorNewline: 'before' | 'after'
  /**
   * Larghezza massima di un'espressione su una riga: sopra questa soglia la lista si spezza su
   * più righe. È la voce che rende il risultato "piatto" se troppo alta.
   */
  expressionWidth: number
  /** Operatori senza spazi ("a+b" invece di "a + b"). */
  denseOperators: boolean
  /** Punto e virgola su riga propria. */
  newlineBeforeSemicolon: boolean
  /** Righe vuote fra due query dello stesso testo. */
  linesBetweenQueries: number
}

/** Valori di partenza (quelli che danno un risultato leggibile, non piatto). */
export const OPZIONI_SQLFORMATTER_DEFAULT: OpzioniSqlFormatter = {
  tabWidth: 2,
  keywordCase: 'upper',
  dataTypeCase: 'upper',
  functionCase: 'preserve',
  indentStyle: 'standard',
  logicalOperatorNewline: 'before',
  expressionWidth: 50,
  denseOperators: false,
  newlineBeforeSemicolon: true,
  linesBetweenQueries: 1,
}

const CASE_VALUES = ['preserve', 'upper', 'lower'] as const
const INDENT_VALUES = ['standard', 'tabularLeft', 'tabularRight'] as const
const LOGICAL_VALUES = ['before', 'after'] as const

/**
 * Unisce le opzioni salvate ai default, scartando i valori non validi (un valore inventato non
 * deve rompere la formattazione).
 */
export function normalizzaOpzioniSqlFormatter(p: Partial<OpzioniSqlFormatter> | undefined): OpzioniSqlFormatter {
  const d = OPZIONI_SQLFORMATTER_DEFAULT
  const num = (v: unknown, def: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : def
  return {
    tabWidth: num(p?.tabWidth, d.tabWidth, 1, 8),
    keywordCase: CASE_VALUES.includes(p?.keywordCase as never) ? (p!.keywordCase as never) : d.keywordCase,
    dataTypeCase: CASE_VALUES.includes(p?.dataTypeCase as never) ? (p!.dataTypeCase as never) : d.dataTypeCase,
    functionCase: CASE_VALUES.includes(p?.functionCase as never) ? (p!.functionCase as never) : d.functionCase,
    indentStyle: INDENT_VALUES.includes(p?.indentStyle as never) ? (p!.indentStyle as never) : d.indentStyle,
    logicalOperatorNewline: LOGICAL_VALUES.includes(p?.logicalOperatorNewline as never)
      ? (p!.logicalOperatorNewline as never)
      : d.logicalOperatorNewline,
    expressionWidth: num(p?.expressionWidth, d.expressionWidth, 10, 500),
    denseOperators: typeof p?.denseOperators === 'boolean' ? p.denseOperators : d.denseOperators,
    newlineBeforeSemicolon:
      typeof p?.newlineBeforeSemicolon === 'boolean' ? p.newlineBeforeSemicolon : d.newlineBeforeSemicolon,
    linesBetweenQueries: num(p?.linesBetweenQueries, d.linesBetweenQueries, 0, 5),
  }
}

/** Nomi ed etichette delle opzioni mostrate nel pannello (l'ordine è quello dell'interfaccia). */
export const OPZIONI_SQLFORMATTER_UI: {
  key: keyof OpzioniSqlFormatter
  label: string
  tipo: 'numero' | 'scelta'
  scelte?: { valore: string; label: string }[]
  min?: number
  max?: number
  aiuto?: string
}[] = [
  { key: 'tabWidth', label: 'Rientro (spazi)', tipo: 'numero', min: 1, max: 8 },
  {
    key: 'keywordCase',
    label: 'Parole chiave',
    tipo: 'scelta',
    scelte: [
      { valore: 'upper', label: 'MAIUSCOLE' },
      { valore: 'preserve', label: 'come scritte' },
      { valore: 'lower', label: 'minuscole' },
    ],
  },
  {
    key: 'dataTypeCase',
    label: 'Tipi di dato',
    tipo: 'scelta',
    scelte: [
      { valore: 'upper', label: 'MAIUSCOLI' },
      { valore: 'preserve', label: 'come scritti' },
      { valore: 'lower', label: 'minuscoli' },
    ],
  },
  {
    key: 'functionCase',
    label: 'Funzioni',
    tipo: 'scelta',
    scelte: [
      { valore: 'preserve', label: 'come scritte' },
      { valore: 'upper', label: 'MAIUSCOLE' },
      { valore: 'lower', label: 'minuscole' },
    ],
  },
  {
    key: 'indentStyle',
    label: 'Stile rientro',
    tipo: 'scelta',
    scelte: [
      { valore: 'standard', label: 'standard' },
      { valore: 'tabularLeft', label: 'tabellare a sinistra' },
      { valore: 'tabularRight', label: 'tabellare a destra' },
    ],
  },
  {
    key: 'logicalOperatorNewline',
    label: 'AND/OR',
    tipo: 'scelta',
    scelte: [
      { valore: 'before', label: 'a inizio riga' },
      { valore: 'after', label: 'a fine riga' },
    ],
  },
  {
    key: 'expressionWidth',
    label: 'Larghezza espressioni',
    tipo: 'numero',
    min: 10,
    max: 500,
    aiuto: 'sopra questa soglia la lista si spezza su più righe (valori bassi = più righe)',
  },
  { key: 'denseOperators', label: 'Operatori attaccati (a+b)', tipo: 'scelta', scelte: [
    { valore: 'false', label: 'no (a + b)' },
    { valore: 'true', label: 'sì (a+b)' },
  ] },
  { key: 'newlineBeforeSemicolon', label: 'Punto e virgola su riga propria', tipo: 'scelta', scelte: [
    { valore: 'false', label: 'no' },
    { valore: 'true', label: 'sì' },
  ] },
  { key: 'linesBetweenQueries', label: 'Righe fra due query', tipo: 'numero', min: 0, max: 5 },
]

/** True se l'opzione è un booleano (l'interfaccia usa "false"/"true"). */
export function opzioneBooleana(key: keyof OpzioniSqlFormatter): boolean {
  return key === 'denseOperators' || key === 'newlineBeforeSemicolon'
}

/** Traduce le opzioni dell'app in quelle della libreria (dialetto T-SQL). */
export function opzioniPerLibreria(
  o: OpzioniSqlFormatter,
  profile: FormatProfile,
): Parameters<typeof formatLibreria>[1] {
  return {
    language: 'tsql',
    tabWidth: o.tabWidth || profile.tabSize || 2,
    keywordCase: o.keywordCase,
    dataTypeCase: o.dataTypeCase,
    functionCase: o.functionCase,
    indentStyle: o.indentStyle,
    logicalOperatorNewline: o.logicalOperatorNewline,
    expressionWidth: o.expressionWidth,
    denseOperators: o.denseOperators,
    newlineBeforeSemicolon: o.newlineBeforeSemicolon,
    linesBetweenQueries: o.linesBetweenQueries,
  }
}

/**
 * Formatta `testo` con il motore scelto.
 * - `nostro`: profilo T-SQL dell'app (formattatore interno);
 * - `sql-formatter`: libreria esterna in dialetto T-SQL con le opzioni scelte nel pannello.
 */
export function formattaConMotore(
  testo: string,
  motore: MotoreFormattazione,
  profile: FormatProfile,
  opzioniSqlFormatter: Partial<OpzioniSqlFormatter> = {},
): string {
  if (motore === 'sql-formatter') {
    try {
      return formatLibreria(testo, opzioniPerLibreria(normalizzaOpzioniSqlFormatter(opzioniSqlFormatter), profile))
    } catch {
      // SQL che la libreria non sa leggere: si usa il motore nostro (nessuna formattazione persa)
      return formatSqlWithProfile(testo, profile)
    }
  }
  return formatSqlWithProfile(testo, profile)
}
