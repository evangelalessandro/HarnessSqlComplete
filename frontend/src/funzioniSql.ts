// AIUTO PER LE FUNZIONI T-SQL: "primo parametro" e "costrutto intero".
//
// Due richieste dell'utente:
//  1) "un aiuto per le funzioni tipo DATEADD: proporre nel primo parametro i dati possibili";
//  2) "così come nelle funzioni window tipo RANK(): proponi tutto il costrutto in ghost e poi ti
//     adatti a quello che scrivo".
//
// Qui c'è solo la LOGICA (pura, testabile): il popup dei suggerimenti e il ghost text la usano.
// Le liste sono quelle di SQL Server (T-SQL), non inventate.

/** Parte di data per DATEADD/DATEDIFF/…: token canonico, abbreviazioni accettate da SQL Server, etichetta. */
export interface ParteData {
  token: string
  abbreviazioni: string[]
  label: string
}

export const PARTI_DATA: ParteData[] = [
  { token: 'year', abbreviazioni: ['yy', 'yyyy'], label: 'anno' },
  { token: 'quarter', abbreviazioni: ['qq', 'q'], label: 'trimestre' },
  { token: 'month', abbreviazioni: ['mm', 'm'], label: 'mese' },
  { token: 'dayofyear', abbreviazioni: ['dy', 'y'], label: "giorno dell'anno" },
  { token: 'day', abbreviazioni: ['dd', 'd'], label: 'giorno' },
  { token: 'week', abbreviazioni: ['wk', 'ww'], label: 'settimana' },
  { token: 'weekday', abbreviazioni: ['dw', 'w'], label: 'giorno della settimana' },
  { token: 'hour', abbreviazioni: ['hh'], label: 'ora' },
  { token: 'minute', abbreviazioni: ['mi', 'n'], label: 'minuto' },
  { token: 'second', abbreviazioni: ['ss', 's'], label: 'secondo' },
  { token: 'millisecond', abbreviazioni: ['ms'], label: 'millisecondo' },
  { token: 'microsecond', abbreviazioni: ['mcs'], label: 'microsecondo' },
  { token: 'nanosecond', abbreviazioni: ['ns'], label: 'nanosecondo' },
  { token: 'iso_week', abbreviazioni: ['isowk', 'isoww'], label: 'settimana ISO' },
]

/** Funzioni T-SQL il cui PRIMO argomento è una parte di data. */
export const FUNZIONI_PARTE_DATA = [
  'DATEADD',
  'DATEDIFF',
  'DATEDIFF_BIG',
  'DATEPART',
  'DATENAME',
  'DATETRUNC',
  'DATE_BUCKET',
]

/**
 * Il cursore è dentro il PRIMO argomento di una funzione che vuole una parte di data?
 * Restituisce la funzione e il testo già digitato di quell'argomento (`prefisso`), altrimenti null.
 *
 * Riconosce: `DATEADD(`, `DATEADD(d`, `DATEADD ( dd`, `DATEDIFF(`, … Attenzione: si ferma al primo
 * argomento, quindi `DATEADD(day, ` (dopo la virgola) NON è più un contesto di parte di data.
 */
export function contestoParteData(
  sql: string,
  offset: number,
): { funzione: string; prefisso: string } | null {
  if (offset < 0 || offset > sql.length) return null
  const prima = sql.slice(0, offset)
  const m = /([A-Za-z_][A-Za-z0-9_]*)[ \t]*\([ \t]*([A-Za-z_][A-Za-z0-9_]*)?$/.exec(prima)
  if (!m) return null
  const funzione = m[1].toUpperCase()
  if (!FUNZIONI_PARTE_DATA.includes(funzione)) return null
  return { funzione, prefisso: m[2] ?? '' }
}

/** Voci da proporre nel primo argomento: token canonico e abbreviazioni, con etichetta leggibile. */
export function suggerimentiParteData(
  sql: string,
  offset: number,
): { valore: string; label: string; detail: string }[] {
  const ctx = contestoParteData(sql, offset)
  if (!ctx) return []
  const voci: { valore: string; label: string; detail: string }[] = []
  for (const p of PARTI_DATA) {
    voci.push({
      valore: p.token,
      label: p.token,
      detail: `parte di data · ${p.label} (${p.abbreviazioni.join(', ')})`,
    })
    // le abbreviazioni si propongono accanto al nome canonico: SQL Server le accetta tutte
    for (const a of p.abbreviazioni) {
      voci.push({ valore: a, label: a, detail: `${p.token} · abbreviazione di ${p.label}` })
    }
  }
  return voci
}

// ---------------------------------------------------------------------------------------------
// FUNZIONI WINDOW: il costrutto intero
// ---------------------------------------------------------------------------------------------

/** Funzione window (o analitica) con la forma del suo costrutto. */
export interface FunzioneFinestra {
  nome: string
  /** Argomenti della funzione, senza parentesi ('' = nessun argomento). */
  argomenti: string
  /** L'OVER richiede ORDER BY per avere senso (ranking, LAG/LEAD, …). */
  ordinaPer: boolean
  /** Il costrutto proposto include anche PARTITION BY. */
  partiziona: boolean
  descrizione: string
}

export const FUNZIONI_FINESTRA: FunzioneFinestra[] = [
  {
    nome: 'ROW_NUMBER',
    argomenti: '',
    ordinaPer: true,
    partiziona: true,
    descrizione: 'numero di riga (1, 2, 3…) secondo ORDER BY',
  },
  {
    nome: 'RANK',
    argomenti: '',
    ordinaPer: true,
    partiziona: true,
    descrizione: 'posizione nella classifica, con salti per i pari merito',
  },
  {
    nome: 'DENSE_RANK',
    argomenti: '',
    ordinaPer: true,
    partiziona: true,
    descrizione: 'posizione nella classifica, senza salti per i pari merito',
  },
  {
    nome: 'NTILE',
    argomenti: '4',
    ordinaPer: true,
    partiziona: true,
    descrizione: 'divide le righe in N gruppi (quartili, decili…)',
  },
  {
    nome: 'PERCENT_RANK',
    argomenti: '',
    ordinaPer: true,
    partiziona: true,
    descrizione: 'posizione percentuale (0-1) nella classifica',
  },
  {
    nome: 'CUME_DIST',
    argomenti: '',
    ordinaPer: true,
    partiziona: true,
    descrizione: 'distribuzione cumulata (0-1)',
  },
  {
    nome: 'LAG',
    argomenti: 'col, 1',
    ordinaPer: true,
    partiziona: true,
    descrizione: 'valore della riga precedente',
  },
  {
    nome: 'LEAD',
    argomenti: 'col, 1',
    ordinaPer: true,
    partiziona: true,
    descrizione: 'valore della riga successiva',
  },
  {
    nome: 'FIRST_VALUE',
    argomenti: 'col',
    ordinaPer: true,
    partiziona: true,
    descrizione: 'primo valore della finestra',
  },
  {
    nome: 'LAST_VALUE',
    argomenti: 'col',
    ordinaPer: true,
    partiziona: true,
    descrizione: 'ultimo valore della finestra',
  },
]

/** La funzione `nome` è una funzione window nota? (case-insensitive) */
export function funzioneFinestra(nome: string): FunzioneFinestra | null {
  const n = nome.toUpperCase()
  return FUNZIONI_FINESTRA.find(f => f.nome === n) ?? null
}

/** Nome dell'eventuale funzione window che si sta scrivendo (anche parziale, es. "RA"). */
export function finestraDigitata(parola: string): FunzioneFinestra | null {
  const n = parola.toUpperCase()
  if (!n) return null
  // prima una corrispondenza esatta, poi i prefissi (il più lungo vince)
  const esatta = FUNZIONI_FINESTRA.find(f => f.nome === n)
  if (esatta) return esatta
  const prefissi = FUNZIONI_FINESTRA.filter(f => f.nome.startsWith(n))
  return prefissi.sort((a, b) => a.nome.length - b.nome.length)[0] ?? null
}

/**
 * Il costrutto COMPLETO da proporre (popup): es. `RANK() OVER (PARTITION BY categoria ORDER BY
 * punteggio DESC)`. `colonne` sono le colonne delle tabelle dello statement (per un esempio
 * concreto al posto di `col`); se vuote si usa `colonna`.
 */
export function costruisciFinestra(f: FunzioneFinestra, colonne: string[]): string {
  const partizione = colonne[0] ?? 'colonna'
  const ordine = colonne[1] ?? colonne[0] ?? 'colonna'
  const base = `${f.nome}(${f.argomenti})`
  if (!f.ordinaPer) return `${base} OVER ()`
  const dentro = f.partiziona
    ? `PARTITION BY ${partizione} ORDER BY ${ordine}`
    : `ORDER BY ${ordine}`
  return `${base} OVER (${dentro})`
}

/**
 * GHOST TEXT: il testo che MANCA, alla posizione del cursore, per completare il costrutto window.
 * "poi ti adatti a quello che scrivo": la funzione guarda il testo reale, quindi il fantasma si
 * accorcia man mano che si digita (e sparisce quando il costrutto è completo).
 *
 *   RANK(                        →  ) OVER (PARTITION BY c1 ORDER BY c2)
 *   RANK()                       →   OVER (PARTITION BY c1 ORDER BY c2)
 *   RANK() OVER (                →  PARTITION BY c1 ORDER BY c2)
 *   RANK() OVER (PARTITION BY )  →  c1 ORDER BY c2)      (il cursore è subito dopo "BY ")
 *   RANK() OVER (ORDER BY )      →  c2)
 *   RANK() OVER (ORDER BY c2)    →  null                 (già completo)
 */
export function restoFinestra(sql: string, offset: number, colonne: string[]): string | null {
  if (offset <= 0 || offset > sql.length) return null
  const prima = sql.slice(0, offset)

  for (const f of FUNZIONI_FINESTRA) {
    const re = new RegExp(`\\b${f.nome}\\s*\\(`, 'gi')
    let ultima: RegExpExecArray | null = null
    for (const m of prima.matchAll(re)) ultima = m
    if (!ultima) continue

    const inizio = ultima.index
    const apri = inizio + ultima[0].length - 1 // indice della "(" della FUNZIONE
    const partizione = sqlIdentGhost(colonne[0] ?? 'colonna')
    const ordine = sqlIdentGhost(colonne[1] ?? colonne[0] ?? 'colonna')
    const dentro = f.partiziona ? `PARTITION BY ${partizione} ORDER BY ${ordine}` : `ORDER BY ${ordine}`

    // a) la parentesi della funzione non è ancora chiusa → il cursore è negli ARGOMENTI
    const chiusaFunzione = chiusuraParentesi(prima, apri)
    if (chiusaFunzione < 0) return `${f.argomenti}) OVER (${dentro})`

    // b) funzione chiusa: c'è già l OVER?
    const dopoFunzione = prima.slice(chiusaFunzione + 1)
    if (!/\bOVER\s*\(/i.test(dopoFunzione)) {
      // se il testo DOPO il cursore comincia già con "OVER" non si aggiunge niente
      if (/^\s*OVER\b/i.test(sql.slice(offset))) return null
      return ` OVER (${dentro})`
    }

    // c) dentro l OVER: manca PARTITION BY / ORDER BY / la chiusura
    const mOver = /\bOVER\s*\(([\s\S]*)$/i.exec(dopoFunzione)
    if (!mOver) return null
    // se la parentesi dell'OVER è già stata CHIUSA prima del cursore, il costrutto è completo
    const apriOver = chiusaFunzione + 1 + mOver[0].indexOf('(')
    if (chiusuraParentesi(prima, apriOver) >= 0) return null
    const dentroOver = mOver[1]
    // se la parentesi dell OVER è già chiusa dopo il cursore, il costrutto è completo
    if (/^\s*\)/.test(sql.slice(offset))) return null
    const haOrder = /\bORDER\s+BY\b/i.test(dentroOver)
    const haPartition = /\bPARTITION\s+BY\b/i.test(dentroOver)
    // lo spazio iniziale serve solo se il cursore NON è già dopo uno spazio o una parentesi
    const spazio = /[\s(]$/.test(dentroOver) ? '' : ' '
    if (haOrder) {
      const m = /\bORDER\s+BY\s+([\s\S]*)$/i.exec(dentroOver)
      if (m && m[1].trim().length > 0) return ')' // colonna già scelta: manca solo la chiusura
      return `${ordine})`
    }
    if (haPartition) {
      const m = /\bPARTITION\s+BY\s+([\s\S]*)$/i.exec(dentroOver)
      if (m && m[1].trim().length > 0) return `${spazio ? ' ' : ''}ORDER BY ${ordine})`
      return `${partizione} ORDER BY ${ordine})`
    }
    return `${dentro})`
  }
  return null
}

/**
 * Indice della ")" che chiude la parentesi aperta in `apri` (o -1 se non è ancora chiusa).
 * Salta stringhe '…' e commenti -- …
 */
function chiusuraParentesi(testo: string, apri: number): number {
  let p = 0
  let i = apri
  let inStringa = false
  while (i < testo.length) {
    const c = testo[i]
    if (inStringa) {
      if (c === "'") {
        if (testo[i + 1] === "'") i++
        else inStringa = false
      }
      i++
      continue
    }
    if (c === "'") {
      inStringa = true
      i++
      continue
    }
    if (c === '-' && testo[i + 1] === '-') {
      const fine = testo.indexOf('\n', i)
      if (fine === -1) return -1
      i = fine + 1
      continue
    }
    if (c === '(') p++
    else if (c === ')') {
      p--
      if (p === 0) return i
    }
    i++
  }
  return -1
}

/** Identificatore per un suggerimento: senza quadre se non servono. */
function sqlIdentGhost(nome: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(nome) ? nome : `[${nome.replace(/]/g, ']]')}]`
}
