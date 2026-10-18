// ANTEPRIMA DELLE MODIFICHE: da un UPDATE/DELETE alla SELECT che mostra le righe che verrebbero
// toccate, senza modificare niente.
//
// Richiesta utente: "fai anteprima delle modifiche". Serve a scoprire gli errori di WHERE prima di
// eseguire (il modo più veloce per perdere tempo — e dati — è un UPDATE con il filtro sbagliato).
//
// La trasformazione è TESTUALE e conservativa: si tiene la stessa FROM/JOIN/WHERE/ORDER BY scritta
// dall'utente, si sostituisce solo la testata con un SELECT TOP (200) delle colonne della tabella
// bersaglio. Nessuna riscrittura dell'SQL: quello che vedi nell'anteprima è esattamente il filtro
// che verrà applicato.
//
//   UPDATE dbo.MAG_CELLE SET CEL_DESCR = 'x' FROM MAG_CELLE c JOIN MAG_BAIE b ON …
//   → SELECT TOP (200) c.[CEL_CORRIDOIO], c.[CEL_CELLA], … FROM MAG_CELLE c JOIN MAG_BAIE b ON …
//
//   DELETE FROM #tmpMission WHERE X_QTY = 0
//   → SELECT TOP (200) * FROM #tmpMission WHERE X_QTY = 0
//
// Non è un parser T-SQL: gestisce le forme normali di UPDATE/DELETE (con o senza FROM, con alias,
// DELETE con o senza FROM) e in tutti gli altri casi restituisce null (l'app lo dice all'utente).

import type { DatabaseSummary, TableInfo } from './types'

/** Quante righe mostra l'anteprima (come l'hover: oltre non si legge più). */
export const MAX_RIGHE_ANTEPRIMA = 200

export interface AnteprimaDml {
  /** SELECT da eseguire per vedere le righe coinvolte (non modifica nulla). */
  sql: string
  /** Tipo di statement originale. */
  tipo: 'update' | 'delete'
  /** Nome della tabella bersaglio come scritto (per i messaggi). */
  tabella: string
}

/** Toglie commenti e spazi iniziali, e un eventuale ';' iniziale. */
function inizioUtile(testo: string): number {
  let i = 0
  for (;;) {
    while (i < testo.length && /\s/.test(testo[i])) i++
    if (testo.startsWith('--', i)) {
      const fine = testo.indexOf('\n', i)
      if (fine < 0) return testo.length
      i = fine + 1
      continue
    }
    if (testo.startsWith('/*', i)) {
      const fine = testo.indexOf('*/', i + 2)
      if (fine < 0) return testo.length
      i = fine + 2
      continue
    }
    if (testo[i] === ';') {
      i++
      continue
    }
    return i
  }
}

/**
 * Posizione della parola chiave `parola` a livello di parentesi 0, fuori da stringhe e commenti.
 * Restituisce -1 se non c'è.
 */
export function trovaParolaChiave(testo: string, parola: string, da = 0): number {
  const re = new RegExp(`^${parola}\\b`, 'i')
  let prof = 0
  let inStringa = false
  let inCommentoLinea = false
  let inCommentoBlocco = false
  for (let i = da; i < testo.length; i++) {
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
    if (!inStringa) {
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
    }
    if (c === "'") {
      inStringa = !inStringa
      continue
    }
    if (inStringa) continue
    if (c === '(') {
      prof++
      continue
    }
    if (c === ')') {
      prof = Math.max(0, prof - 1)
      continue
    }
    if (prof === 0 && /\s/.test(testo[i - 1] ?? ' ')) {
      if (re.test(testo.slice(i, i + parola.length + 1))) return i
    }
  }
  return -1
}

/** Riferimento a una tabella: nome come scritto (con schema) + eventuale alias. */
interface Ref {
  nome: string
  alias: string | null
  fine: number
}

/** Token del nome tabella (con schema/alias) subito dopo `da`. */
function leggiRiferimento(testo: string, da: number): Ref | null {
  const m = /^(\s*)(\[[^\]]+\]|[@#A-Za-z_][\w#@]*(?:\s*\.\s*(?:\[[^\]]+\]|[\w#@]+))?)(?:\s+(?:AS\s+)?(\[[^\]]+\]|[A-Za-z_]\w*))?/i.exec(
    testo.slice(da),
  )
  if (!m) return null
  const nome = m[2].replace(/\s+/g, '')
  // il terzo gruppo è l'alias, MA può aver catturato la parola chiave successiva
  // ("SET", "WHERE", "FROM"…): in quel caso il riferimento finisce col nome.
  const dopoNome = da + m[1].length + m[2].length
  const parolaChiave = m[3] && /^(SET|FROM|WHERE|OUTPUT|OPTION|JOIN|INNER|LEFT|RIGHT|FULL|CROSS|ON|AND|OR|GO)$/i.test(m[3])
  const alias = m[3] && !parolaChiave ? m[3] : null
  return { nome, alias, fine: alias ? da + m[0].length : dopoNome }
}

/** La tabella del sommario (per le colonne), anche con schema; null se non c'è (es. #tmp). */
function tabellaDelSommario(summary: DatabaseSummary | null, nome: string): TableInfo | null {
  if (!summary) return null
  const pulito = nome.replace(/[[\]]/g, '')
  const parti = pulito.split('.')
  const soloNome = parti[parti.length - 1].toLowerCase()
  const schema = parti.length > 1 ? parti[parti.length - 2].toLowerCase() : null
  const candidate = summary.tables.filter(t => t.name.toLowerCase() === soloNome)
  if (candidate.length === 0) return null
  return (schema ? candidate.find(t => t.schema.toLowerCase() === schema) : null) ?? candidate[0]
}

/** Elenco colonne per il SELECT: `<qualificatore>.[col], …` oppure `*`. */
function elencoColonne(t: TableInfo | null, qualificatore: string | null): string {
  const colonne = t?.columns ?? []
  if (colonne.length === 0) return '*'
  const q = qualificatore ? `${qualificatore}.` : ''
  return colonne.map(c => `${q}[${c.name}]`).join(', ')
}

/** Tutte le posizioni di una parola chiave di primo livello (in ordine). */
export function tutteParoleChiave(testo: string, parola: string, da = 0): number[] {
  const out: number[] = []
  let i = da
  for (;;) {
    const pos = trovaParolaChiave(testo, parola, i)
    if (pos < 0) return out
    out.push(pos)
    i = pos + parola.length
  }
}

/**
 * Qualificatore da usare per le colonne: quello che la FROM/JOIN dà davvero alla tabella bersaglio.
 * Serve perché scrivere "MAG_CELLE.[col]" è SBAGLIATO se nella FROM la tabella ha un alias
 * (`FROM MAG_CELLE c` → l'unico nome valido è `c`): SQL Server risponde "Impossibile associare
 * l'identificatore in più parti".
 */
function qualificatoreDaCoda(coda: string, target: Ref): string | null {
  const nomeTarget = target.nome.replace(/[[\]]/g, '').split('.').pop()!.trim().toLowerCase()
  const posizioni = [
    ...tutteParoleChiave(coda, 'FROM').map(p => p + 'FROM'.length),
    ...tutteParoleChiave(coda, 'JOIN').map(p => p + 'JOIN'.length),
  ].sort((a, b) => a - b)
  for (const p of posizioni) {
    const rif = leggiRiferimento(coda, p)
    if (!rif) continue
    const nome = rif.nome.replace(/[[\]]/g, '').split('.').pop()!.trim().toLowerCase()
    if (nome !== nomeTarget) continue
    // con l'alias si usa quello; senza alias va bene il nome (anche "dbo.Tabella")
    return rif.alias ?? rif.nome
  }
  return null
}

/**
 * Costruisce l'anteprima delle modifiche per lo statement dato. null se non è un UPDATE/DELETE
 * riconoscibile.
 */
export function costruisciAnteprima(statement: string, summary: DatabaseSummary | null): AnteprimaDml | null {
  const inizio = inizioUtile(statement)
  const corpo = statement.slice(inizio).replace(/^\s+/, '').trim()
  if (!corpo) return null

  const isUpdate = /^UPDATE\b/i.test(corpo)
  const isDelete = /^DELETE\b/i.test(corpo)
  if (!isUpdate && !isDelete) return null

  let target: Ref | null = null
  let coda = ''

  if (isUpdate) {
    // UPDATE <target> SET … [FROM …] [WHERE …]
    const rif = leggiRiferimento(corpo, 'UPDATE'.length)
    if (!rif) return null
    target = rif
    const posSet = trovaParolaChiave(corpo, 'SET', rif.fine)
    if (posSet < 0) return null
    const daFrom = trovaParolaChiave(corpo, 'FROM', posSet)
    const daWhere = trovaParolaChiave(corpo, 'WHERE', posSet)
    if (daFrom >= 0 && (daWhere < 0 || daFrom < daWhere)) coda = corpo.slice(daFrom).trim()
    else if (daWhere >= 0) coda = `FROM ${rif.nome} ${corpo.slice(daWhere).trim()}`
    else coda = `FROM ${rif.nome}`
  } else {
    // DELETE [FROM] <target> [FROM <sorgente> …] [WHERE …]   (il target può stare prima o dopo FROM)
    const froms = tutteParoleChiave(corpo, 'FROM', 'DELETE'.length)
    const primoFrom = froms[0] >= 0 ? froms[0] : -1
    // "DELETE FROM t …": il target è subito dopo il primo FROM
    const dopoPrimoFrom = primoFrom >= 0 ? leggiRiferimento(corpo, primoFrom + 'FROM'.length) : null
    const targetDopoFrom = dopoPrimoFrom && afterOnlyWhitespace(corpo, 'DELETE'.length, primoFrom)
    if (targetDopoFrom && dopoPrimoFrom) {
      target = dopoPrimoFrom
      // la sorgente (se c'è) comincia dal SECONDO FROM; altrimenti dalla WHERE
      const sorgente = froms[1] ?? -1
      const daWhere = trovaParolaChiave(corpo, 'WHERE', dopoPrimoFrom.fine)
      if (sorgente >= 0) coda = corpo.slice(sorgente).trim()
      else if (daWhere >= 0) coda = `FROM ${dopoPrimoFrom.nome} ${corpo.slice(daWhere).trim()}`
      else coda = `FROM ${dopoPrimoFrom.nome}`
    } else {
      // "DELETE t FROM …" oppure "DELETE t WHERE …"
      const rif = leggiRiferimento(corpo, 'DELETE'.length)
      if (!rif) return null
      target = rif
      const daWhere = trovaParolaChiave(corpo, 'WHERE', rif.fine)
      if (primoFrom >= 0) coda = corpo.slice(primoFrom).trim()
      else if (daWhere >= 0) coda = `FROM ${rif.nome} ${corpo.slice(daWhere).trim()}`
      else coda = `FROM ${rif.nome}`
    }
  }
  if (!target) return null

  // un eventuale ';' chiude lo statement: il resto non fa parte dell'anteprima
  const puntoVirgola = coda.indexOf(';')
  if (puntoVirgola >= 0) coda = coda.slice(0, puntoVirgola).trim()

  const tabella = tabellaDelSommario(summary, target.nome)
  // il qualificatore deve essere quello che la FROM dà alla tabella (alias compreso)
  const qualificatore = qualificatoreDaCoda(coda, target) ?? target.alias ?? target.nome
  const colonne = elencoColonne(tabella, tabella ? qualificatore : null)
  return {
    sql: `SELECT TOP (${MAX_RIGHE_ANTEPRIMA}) ${colonne} ${coda}`.trim() + ';',
    tipo: isUpdate ? 'update' : 'delete',
    tabella: target.nome,
  }
}

/** True se fra `da` e `a` ci sono solo spazi (cioè il target segue subito "DELETE FROM"). */
function afterOnlyWhitespace(testo: string, da: number, a: number): boolean {
  return testo.slice(da, a).trim().length === 0
}

