// GHOST TEXT: il suggerimento "in linea" (testo in grigio da accettare con Tab), come Copilot ma
// con le informazioni che l'app ha già sul TUO database: le chiavi esterne, le colonne, gli alias.
//
// Rispetto al popup dei suggerimenti, il vantaggio è che non c'è niente da leggere né da filtrare:
// il testo compare già pronto e Tab lo accetta. Per non rubare Tab mentre si indenta, i casi in
// cui si propone qualcosa sono POCHI e mirati:
//
// 1. JOIN senza ON → propone l'ON preso dalla chiave esterna:
//        FROM RUN_ESEGUI e
//        LEFT JOIN DAT_UDC                      →  ON (UDC_UDC = ESE_UDC_DEST)
// 2. select-list dopo la virgola → propone la colonna successiva della tabella:
//        SELECT UDC_UDC,                        →  UDC_DESCR
//
// Tutto il resto non viene toccato (niente suggerimenti nei commenti, nelle stringhe, su tabelle
// temporanee o quando il testo c'è già).

import { buildJoinText, findTableRefs, qualified, sqlIdent } from './helpers'
import { restoFinestra } from './funzioniSql'
import type { JoinHint } from './helpers'
import type { DatabaseSummary, TableInfo } from './types'

/** Un suggerimento in linea: il testo da inserire e il motivo (per i test e il tooltip). */
export interface SuggerimentoInline {
  testo: string
  motivo: 'join-on' | 'colonna-successiva' | 'finestra'
}

/** Lunghezza massima di un suggerimento (oltre è più fastidio che aiuto). */
const MAX_SUGGERIMENTO = 200

/** True se l'offset cade dentro un commento (di riga o di blocco) o dentro una stringa '…'. */
export function dentroCommentoOStringa(testo: string, offset: number): boolean {
  let inStringa = false
  let inCommentoLinea = false
  let inCommentoBlocco = false
  for (let i = 0; i < offset && i < testo.length; i++) {
    const c = testo[i]
    const next = testo[i + 1]
    if (inCommentoLinea) {
      if (c === '\n') inCommentoLinea = false
      continue
    }
    if (inCommentoBlocco) {
      if (c === '*' && next === '/') {
        inCommentoBlocco = false
        i++
      }
      continue
    }
    if (inStringa) {
      if (c === "'") inStringa = false
      continue
    }
    if (c === '-' && next === '-') {
      inCommentoLinea = true
      i++
      continue
    }
    if (c === '/' && next === '*') {
      inCommentoBlocco = true
      i++
      continue
    }
    if (c === "'") inStringa = true
  }
  return inStringa || inCommentoLinea || inCommentoBlocco
}

/** Intervallo dello statement che contiene l'offset (delimitato da ';' fuori dalle stringhe o da GO). */
export function statementAttorno(sql: string, offset: number): { inizio: number; fine: number } {
  const isGo = (i: number) => {
    // "GO" da solo su una riga (con eventuale numero di ripetizioni)
    const primaRiga = sql.lastIndexOf('\n', i - 1) + 1
    const dopoRiga = sql.indexOf('\n', i)
    const riga = sql.slice(primaRiga, dopoRiga < 0 ? sql.length : dopoRiga)
    return /^\s*GO\s*\d*\s*$/i.test(riga)
  }
  let inizio = 0
  let fine = sql.length
  for (let i = offset - 1; i >= 0; i--) {
    if (sql[i] === ';' && !dentroCommentoOStringa(sql, i)) {
      inizio = i + 1
      break
    }
    if (/[OG]{2}/i.test((sql[i] ?? '') + (sql[i - 1] ?? '')) && isGo(i - 1)) {
      inizio = i + 1
      break
    }
  }
  for (let i = offset; i < sql.length; i++) {
    if (sql[i] === ';' && !dentroCommentoOStringa(sql, i)) {
      fine = i
      break
    }
    if (/^g/i.test(sql[i] ?? '') && isGo(i)) {
      fine = i
      break
    }
  }
  return { inizio, fine }
}

/** La tabella del sommario con quel nome (anche con schema), o null. */
function trovaTabella(summary: DatabaseSummary, nome: string): TableInfo | null {
  const pulito = nome.replace(/[[\]]/g, '').trim().toLowerCase()
  if (!pulito) return null
  const parti = pulito.split('.')
  const soloNome = parti[parti.length - 1]
  const schema = parti.length > 1 ? parti[parti.length - 2] : null
  const candidate = summary.tables.filter(t => t.name.toLowerCase() === soloNome)
  if (candidate.length === 0) return null
  if (schema) return candidate.find(t => t.schema.toLowerCase() === schema) ?? candidate[0]
  return candidate[0]
}

/** Le tabelle del sommario citate in uno statement (per l'ON e per le colonne). */
function tabelleDelloStatement(summary: DatabaseSummary, stmt: string): TableInfo[] {
  const out: TableInfo[] = []
  for (const nome of findTableRefs(stmt)) {
    const t = trovaTabella(summary, nome)
    if (t && !out.some(x => x.schema === t.schema && x.name === t.name)) out.push(t)
  }
  return out
}

/**
 * CASO 1: si è appena scritto "… JOIN tabella [alias]" e manca l'ON. Si propone l'ON preso dalla
 * chiave esterna fra quella tabella e una delle tabelle già nello statement.
 */
function suggerisciOnDelJoin(
  prima: string,
  dopo: string,
  stmt: string,
  summary: DatabaseSummary,
): SuggerimentoInline | null {
  const coda = /(?:\b(?:INNER|LEFT|RIGHT|FULL|CROSS|OUTER)\s+)?\bJOIN\s+((?:\[[^\]]+\]|[@#A-Za-z_][\w.\[\]]*))(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?\s*$/i.exec(
    prima,
  )
  if (!coda) return null
  // se l'ON c'è già (anche sotto, sulla riga dopo) non si propone niente
  if (/^\s*ON\b/i.test(dopo)) return null
  if (/\bON\s*\(?\s*$/i.test(prima)) return null
  const nomeTabella = coda[1]
  if (/^[@#]/.test(nomeTabella)) return null // variabili tabella / temporanee: nessuna FK
  const candidata = trovaTabella(summary, nomeTabella)
  if (!candidata) return null

  const contesto = tabelleDelloStatement(summary, stmt).filter(
    t => !(t.schema === candidata.schema && t.name === candidata.name),
  )
  if (contesto.length === 0) return null
  const chiaviContesto = new Set(contesto.map(t => `${t.schema}.${t.name}`.toLowerCase()))

  // relazioni fra la tabella appena unita e quelle già nello statement
  const hint: JoinHint | null = (() => {
    for (const fk of summary.foreignKeys) {
      const latoCand = `${fk.schema}.${fk.table}`.toLowerCase()
      const latoCtx = `${fk.refSchema}.${fk.refTable}`.toLowerCase()
      const candNome = `${candidata.schema}.${candidata.name}`.toLowerCase()
      if (latoCand === candNome && chiaviContesto.has(latoCtx)) return { fk, direction: 'out' }
      if (latoCtx === candNome && chiaviContesto.has(latoCand)) return { fk, direction: 'in' }
    }
    return null
  })()
  if (!hint) return null

  // buildJoinText restituisce "tabella ON (…)" con le convenzioni dell'app (parentesi e
  // qualificazione solo se il nome della colonna è ambiguo): qui serve solo la parte "ON (…)".
  const completo = buildJoinText(candidata, hint, [...contesto, candidata])
  const prefisso = qualified(candidata.schema, candidata.name)
  const on = completo.startsWith(prefisso) ? completo.slice(prefisso.length).trim() : completo
  if (!on || on.length > MAX_SUGGERIMENTO) return null
  return { testo: ` ${on}`, motivo: 'join-on' }
}

/**
 * CASO 2: si è nella select-list (dopo "SELECT " o dopo una virgola) e c'è UNA sola tabella nello
 * statement: si propone la colonna successiva non ancora elencata.
 */
function suggerisciColonnaSuccessiva(
  prima: string,
  dopo: string,
  stmt: string,
  summary: DatabaseSummary,
): SuggerimentoInline | null {
  // solo a inizio select-list o subito dopo la virgola
  if (!/(?:\bSELECT\s+(?:DISTINCT\s+|TOP\s*\(?\s*\d+\s*\)?\s*)?|,)\s*$/i.test(prima)) return null
  // deve esserci un FROM dopo (o già scritto): altrimenti non si sa di che tabella parlare
  if (!/\bFROM\b/i.test(dopo) && !/\bFROM\b/i.test(prima)) return null
  const tabelle = tabelleDelloStatement(summary, stmt)
  if (tabelle.length !== 1) return null
  const tabella = tabelle[0]
  const colonne = tabella.columns ?? []
  if (colonne.length === 0) return null

  // colonne già usate nella select-list (dal SELECT fino alla virgola del cursore)
  const inizioSelect = /\bSELECT\b/i.exec(stmt)
  const daSelectA = inizioSelect ? stmt.slice(inizioSelect.index) : stmt
  const usate = new Set<string>()
  for (const m of daSelectA.matchAll(/\b([A-Za-z_]\w*)\b/g)) usate.add(m[1].toLowerCase())

  const prossima = colonne.find(c => !usate.has(c.name.toLowerCase()))
  if (!prossima) return null
  const testo = sqlIdent(prossima.name)
  if (testo.length > MAX_SUGGERIMENTO) return null
  return { testo, motivo: 'colonna-successiva' }
}

/**
 * Il suggerimento in linea per la posizione del cursore (null = niente da proporre).
 * `sql` è l'intero contenuto dell'editor, `offset` la posizione del cursore.
 */
export function suggerisciInLinea(sql: string, offset: number, summary: DatabaseSummary | null): SuggerimentoInline | null {
  if (!summary || summary.tables.length === 0) return null
  if (offset <= 0 || offset > sql.length) return null
  if (dentroCommentoOStringa(sql, offset)) return null
  const { inizio, fine } = statementAttorno(sql, offset)
  const stmt = sql.slice(inizio, fine)
  const prima = sql.slice(inizio, offset)
  const dopo = sql.slice(offset, fine)

  /**
   * FUNZIONI WINDOW (richiesta utente: "proponi tutto il costrutto in ghost e poi ti adatti a quello
   * che scrivo"). Dopo "RANK(" il fantasma mostra il resto del costrutto con una colonna vera dello
   * statement; appena si scrive, il fantasma si accorcia e sparisce quando il costrutto è completo.
   */
  const colonne = tabelleDelloStatement(summary, stmt).flatMap(t => (t.columns ?? []).map(c => c.name))
  const resto = restoFinestra(sql, offset, colonne)
  if (resto && resto.length > 0 && resto.length <= MAX_SUGGERIMENTO) {
    return { testo: resto, motivo: 'finestra' }
  }

  return suggerisciOnDelJoin(prima, dopo, stmt, summary) ?? suggerisciColonnaSuccessiva(prima, dopo, stmt, summary)
}
