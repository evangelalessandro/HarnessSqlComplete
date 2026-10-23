// VIRGOLA A CAPO AUTOMATICA: premendo Invio dopo una virgola, la virgola va IN TESTA alla riga
// nuova (lo stile di questo progetto: un campo per riga, virgola davanti) invece di restare in
// coda a quella vecchia.
//
// Richiesta utente: "che altro si può fare per velocizzare la scrittura?" → "Enter e virgola
// intelligenti". Il vantaggio è tutto in battitura: un campo in più = un Invio invece di
// "cancella virgola, Invio, spazi, virgola".
//
// Qui c'è solo la parte PURA (decidere se e come spezzare): l'editor la usa per fare la modifica.

/** Come spezzare la riga: dove sta la virgola e con che rientro va la riga nuova. */
export interface Spezzatura {
  /** Colonna (1-based) della virgola in coda alla riga. */
  colonnaVirgola: number
  /** Spazi di rientro per la riga nuova (la virgola ci va in testa). */
  rientro: number
}

/** Parole dopo cui il primo campo va incolonnato (come fa il formattatore). */
const CLAUSOLE = /^(\s*)(SELECT|FROM|WHERE|SET|VALUES|INTO|UPDATE|HAVING|ORDER\s+BY|GROUP\s+BY|ON|AND|OR)\s+/i

/**
 * Rientro della riga di continuazione: la virgola si allinea sotto il PRIMO CAMPO della riga
 * corrente (es. "SELECT a," → la virgola va sotto "a": 7 spazi), come fa il formattatore con
 * "SET x = 1 / ,y = 2". Se la riga non comincia con una clausola nota, si rientra di due spazi.
 */
export function rientroContinuazione(riga: string): number {
  const m = CLAUSOLE.exec(riga)
  if (m) return m[1].length + m[2].length + 1
  const indent = /^\s*/.exec(riga)?.[0].length ?? 0
  return indent + 2
}

/**
 * Decide se, premendo Invio alla colonna `colonnaCursore` (1-based), va spostata la virgola a capo.
 * Restituisce null quando non c'è niente da fare: la riga non finisce con la virgola, dopo la
 * virgola c'è del codice, oppure la virgola è dentro una stringa/commento (lo controlla il
 * chiamante, che ha il testo intero).
 */
export function spezzaDopoVirgola(riga: string, colonnaCursore: number): Spezzatura | null {
  if (colonnaCursore < 1) return null
  const prima = riga.slice(0, colonnaCursore - 1)
  // solo se prima del cursore (togliendo gli spazi) c'è una virgola
  if (!/,\s*$/.test(prima)) return null
  // e dopo il cursore non deve esserci codice: si spezza solo in fondo alla riga
  if (riga.slice(colonnaCursore - 1).trim().length > 0) return null
  const colonnaVirgola = prima.replace(/\s+$/, '').length // 1-based: indice 0-based + 1
  if (riga[colonnaVirgola - 1] !== ',') return null
  return { colonnaVirgola, rientro: rientroContinuazione(riga) }
}

/** Testo da mettere al posto di "virgola + spazi fino al cursore" (una sola modifica). */
export function testoSpezzato(s: Spezzatura): string {
  return `\n${' '.repeat(s.rientro)},`
}
