// MOTORE DI FORMATTAZIONE: "nostro" (profilo T-SQL dell'app, quello usato fino ad oggi) oppure
// "sqlfluff" (https://sqlfluff.com), che è una CLI Python: si esegue sul BACKEND, non nel browser.
// Qui stanno le opzioni di SQLFluff, i default allineati al nostro stile e la chiamata all'API.
import { formatSqlWithProfile } from './tsqlFormatter'
import type { FormatProfile } from './formatProfile'

export type MotoreFormattazione = 'nostro' | 'sqlfluff'

export const MOTORI_FORMATTAZIONE: MotoreFormattazione[] = ['nostro', 'sqlfluff']

/** Opzioni di SQLFluff esposte nell'interfaccia (i nomi sono quelli del backend). */
export interface OpzioniSqlFluff {
  tabSpaceSize: number
  useTabs: boolean
  keywordCasing: 'upper' | 'lower' | 'capitalise' | 'preserve'
  identifierCasing: 'upper' | 'lower' | 'capitalise' | 'preserve'
  dataTypeCasing: 'upper' | 'lower' | 'capitalise' | 'preserve'
  functionCasing: 'upper' | 'lower' | 'capitalise' | 'preserve'
  commaStyle: 'trailing' | 'leading'
  whereNewline: boolean
  maxLineLength: number
}

/**
 * Default pensati per NON stravolgere il codice esistente: identificatori e funzioni PRESERVATI
 * (così `dbo.T` non diventa `dbo.t`), parole chiave e tipi in maiuscolo, rientro 2 spazi.
 */
export const OPZIONI_SQLFLUFF_DEFAULT: OpzioniSqlFluff = {
  tabSpaceSize: 2,
  useTabs: false,
  keywordCasing: 'upper',
  identifierCasing: 'preserve',
  dataTypeCasing: 'upper',
  functionCasing: 'preserve',
  commaStyle: 'trailing',
  whereNewline: true,
  maxLineLength: 120,
}

const CASING = ['upper', 'lower', 'capitalise', 'preserve'] as const

/** Unisce le opzioni salvate ai default, scartando i valori non validi. */
export function normalizzaOpzioniSqlFluff(p: Partial<OpzioniSqlFluff> | undefined): OpzioniSqlFluff {
  const d = OPZIONI_SQLFLUFF_DEFAULT
  const num = (v: unknown, def: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : def
  const casing = (v: unknown, def: OpzioniSqlFluff['keywordCasing']) =>
    CASING.includes(v as never) ? (v as OpzioniSqlFluff['keywordCasing']) : def
  return {
    tabSpaceSize: num(p?.tabSpaceSize, d.tabSpaceSize, 1, 8),
    useTabs: typeof p?.useTabs === 'boolean' ? p.useTabs : d.useTabs,
    keywordCasing: casing(p?.keywordCasing, d.keywordCasing),
    identifierCasing: casing(p?.identifierCasing, d.identifierCasing),
    dataTypeCasing: casing(p?.dataTypeCasing, d.dataTypeCasing),
    functionCasing: casing(p?.functionCasing, d.functionCasing),
    commaStyle: p?.commaStyle === 'leading' || p?.commaStyle === 'trailing' ? p.commaStyle : d.commaStyle,
    whereNewline: typeof p?.whereNewline === 'boolean' ? p.whereNewline : d.whereNewline,
    maxLineLength: num(p?.maxLineLength, d.maxLineLength, 20, 400),
  }
}

/** Etichetta del motore per l'interfaccia. */
export function etichettaMotore(m: MotoreFormattazione): string {
  return m === 'nostro' ? 'Nostro (profilo T-SQL dell\u2019app)' : 'SQLFluff (CLI Python, dialetto T-SQL)'
}

/** Opzioni mostrate nel pannello. */
export const OPZIONI_SQLFLUFF_UI: {
  key: keyof OpzioniSqlFluff
  label: string
  tipo: 'numero' | 'scelta' | 'bool'
  scelte?: { valore: string; label: string }[]
  min?: number
  max?: number
}[] = [
  { key: 'tabSpaceSize', label: 'Rientro (spazi)', tipo: 'numero', min: 1, max: 8 },
  { key: 'useTabs', label: 'Usa tab', tipo: 'bool' },
  {
    key: 'keywordCasing',
    label: 'Parole chiave',
    tipo: 'scelta',
    scelte: [
      { valore: 'upper', label: 'MAIUSCOLE' },
      { valore: 'lower', label: 'minuscole' },
      { valore: 'capitalise', label: 'Iniziali Maiuscole' },
      { valore: 'preserve', label: 'come scritte' },
    ],
  },
  {
    key: 'identifierCasing',
    label: 'Identificatori',
    tipo: 'scelta',
    scelte: [
      { valore: 'preserve', label: 'come scritti (consigliato)' },
      { valore: 'upper', label: 'MAIUSCOLI' },
      { valore: 'lower', label: 'minuscoli' },
    ],
  },
  {
    key: 'dataTypeCasing',
    label: 'Tipi di dato',
    tipo: 'scelta',
    scelte: [
      { valore: 'upper', label: 'MAIUSCOLI' },
      { valore: 'lower', label: 'minuscoli' },
      { valore: 'preserve', label: 'come scritti' },
    ],
  },
  {
    key: 'functionCasing',
    label: 'Funzioni',
    tipo: 'scelta',
    scelte: [
      { valore: 'preserve', label: 'come scritte (consigliato)' },
      { valore: 'upper', label: 'MAIUSCOLE' },
      { valore: 'lower', label: 'minuscole' },
    ],
  },
  {
    key: 'commaStyle',
    label: 'Virgola',
    tipo: 'scelta',
    scelte: [
      { valore: 'trailing', label: 'a fine riga' },
      { valore: 'leading', label: 'in testa alla riga' },
    ],
  },
  { key: 'whereNewline', label: 'WHERE a capo', tipo: 'bool' },
  { key: 'maxLineLength', label: 'Larghezza massima riga', tipo: 'numero', min: 20, max: 400 },
]

/** Corpo della richiesta per il backend (funzione pura: si può controllare nei test). */
export function corpoRichiestaSqlFluff(sql: string, opzioni: OpzioniSqlFluff): string {
  const o = normalizzaOpzioniSqlFluff(opzioni)
  return JSON.stringify({
    sql,
    options: {
      dialect: 'tsql',
      tabSpaceSize: o.tabSpaceSize,
      useTabs: o.useTabs,
      keywordCasing: o.keywordCasing,
      identifierCasing: o.identifierCasing,
      dataTypeCasing: o.dataTypeCasing,
      functionCasing: o.functionCasing,
      commaStyle: o.commaStyle,
      whereNewline: o.whereNewline,
      maxLineLength: o.maxLineLength,
    },
  })
}

export interface EsitoFormattazione {
  formattato: string | null
  errore: string | null
}

/** Formatta con SQLFluff chiamando il backend (la CLI non può girare nel browser). */
export async function formattaConSqlFluff(
  sql: string,
  opzioni: OpzioniSqlFluff,
  fetchFn: typeof fetch = fetch,
): Promise<EsitoFormattazione> {
  try {
    const risposta = await fetchFn('/api/format/sqlfluff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: corpoRichiestaSqlFluff(sql, opzioni),
    })
    if (!risposta.ok) return { formattato: null, errore: `SQLFluff: il server ha risposto ${risposta.status}.` }
    const dati = (await risposta.json()) as { formatted?: string | null; error?: string | null }
    return { formattato: dati.formatted ?? null, errore: dati.error ?? null }
  } catch (e) {
    return { formattato: null, errore: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Formatta con il motore scelto. Il motore "nostro" è sincrono; SQLFluff è asincrono (gira sul
 * backend): in caso di errore si torna al motore nostro, così il testo non resta mai senza
 * formattazione e l'utente vede il messaggio.
 */
export async function formattaConMotore(
  testo: string,
  motore: MotoreFormattazione,
  profile: FormatProfile,
  opzioni: OpzioniSqlFluff,
): Promise<{ testo: string; errore: string | null }> {
  if (motore === 'sqlfluff') {
    const esito = await formattaConSqlFluff(testo, opzioni)
    if (esito.formattato) return { testo: esito.formattato, errore: null }
    return { testo: formatSqlWithProfile(testo, profile), errore: esito.errore }
  }
  return { testo: formatSqlWithProfile(testo, profile), errore: null }
}
