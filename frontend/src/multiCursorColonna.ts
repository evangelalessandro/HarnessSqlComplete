// MULTI-CURSORE A COLONNA: quando si scrive con più cursori su righe diverse, le righe più CORTE
// vanno riempite di spazi fino alla colonna degli altri cursori, altrimenti il testo digitato finisce
// disallineato (tipico: una riga vuota in mezzo a due righe indentate).
//
// Richiesta utente: "se fai il multi cursore tra le 2 print comprese, dovresti aggiungere spazi nella
// riga vuota per restare allo stesso livello delle altre 2 righe che hanno il print: quando si attiva
// il multi cursore, questo lo fa SSMS e non Monaco di default".
//
//   BEGIN
//     print        ← cursore a fine riga (colonna 8)
//                  ← riga VUOTA: cursore a colonna 8 "virtuale" → va riempita con 7 spazi
//     print        ← cursore a fine riga (colonna 8)
//   end
//
// Qui c'è solo la parte pura (quali righe vanno riempite e di quanto): l'editor applica gli spazi.

/** Una posizione di cursore (1-based, come Monaco). */
export interface PosizioneCursore {
  lineNumber: number
  column: number
}

/** Spazi da aggiungere in fondo a una riga prima di scrivere. */
export interface Riempimento {
  /** Riga (1-based). */
  lineNumber: number
  /** Spazi da inserire in fondo alla riga. */
  spazi: string
  /** Colonna in cui si troverà il cursore dopo il riempimento (1-based). */
  colonna: number
}

/**
 * Righe da riempire per allineare la scrittura a più cursori.
 *
 * Regola (quella di SSMS): se ci sono almeno due cursori su righe diverse, si prende la colonna
 * MASSIMA fra i cursori e ogni riga interessata più corta di quella colonna viene riempita di spazi
 * fino a lì. Non si toglie mai niente: le righe già lunghe restano come sono.
 *
 * Restituisce [] quando non c'è niente da fare (un solo cursore, tutti sulla stessa riga, righe già
 * abbastanza lunghe): così l'editor non fa nessuna modifica.
 */
export function riempimentiPerColonna(righe: string[], posizioni: PosizioneCursore[]): Riempimento[] {
  if (posizioni.length < 2) return []
  const righeDistinte = new Set(posizioni.map(p => p.lineNumber))
  if (righeDistinte.size < 2) return []
  // colonna di riferimento: la più avanzata fra i cursori
  let colonnaMax = 0
  for (const p of posizioni) colonnaMax = Math.max(colonnaMax, p.column)
  if (colonnaMax <= 1) return []
  const out: Riempimento[] = []
  const gia = new Set<number>()
  for (const p of posizioni) {
    if (gia.has(p.lineNumber)) continue
    gia.add(p.lineNumber)
    const riga = righe[p.lineNumber - 1] ?? ''
    // si riempie solo se il cursore è IN FONDO alla riga (o la riga è vuota): se è in mezzo al testo
    // l'utente sta scrivendo lì e spostarlo in fondo sarebbe sbagliato.
    if (p.column !== riga.length + 1) continue
    if (riga.length >= colonnaMax - 1) continue
    const mancanti = colonnaMax - 1 - riga.length
    out.push({ lineNumber: p.lineNumber, spazi: ' '.repeat(mancanti), colonna: colonnaMax })
  }
  return out
}

/** Rientro iniziale (spazi/tab) di una riga. */
function rientroIniziale(riga: string): string {
  return /^[ \t]*/.exec(riga)?.[0] ?? ''
}

/**
 * Rientro "di blocco": quello più frequente fra le righe dei cursori CHE HANNO CONTENUTO.
 * Serve per le righe vuote in mezzo al blocco: non hanno un rientro proprio, quindi prendono quello
 * delle altre righe (in SSMS la riga nuova nasce già indentata).
 */
export function rientroDiBlocco(righe: string[], posizioni: PosizioneCursore[]): string {
  const conteggio = new Map<string, number>()
  for (const p of posizioni) {
    const riga = righe[p.lineNumber - 1] ?? ''
    if (riga.trim().length === 0) continue
    const rientro = rientroIniziale(riga)
    conteggio.set(rientro, (conteggio.get(rientro) ?? 0) + 1)
  }
  let migliore = ''
  let massimo = 0
  for (const [rientro, n] of conteggio) {
    if (n > massimo) {
      migliore = rientro
      massimo = n
    }
  }
  return migliore
}

/** Un Invio da inserire al posto di quello di Monaco: riga nuova con questo rientro. */
export interface InvioIndentato {
  lineNumber: number
  column: number
  /** Rientro della riga NUOVA (spazi/tab). */
  rientro: string
}

/**
 * INVIO CON PIÙ CURSORI (richiesta utente: "Enter con più cursori deve mantenere il rientro della
 * riga di partenza anche quando la riga è vuota; in SSMS la riga nuova nasce già indentata").
 *
 * Per ogni cursore il rientro della riga nuova è quello della SUA riga; se la sua riga è vuota (o
 * solo spazi) prende il rientro di blocco, cioè quello delle altre righe del blocco. Restituisce null
 * quando è meglio lasciar fare a Monaco: un solo cursore, oppure tutti sulla stessa riga.
 */
export function inviiIndentati(righe: string[], posizioni: PosizioneCursore[]): InvioIndentato[] | null {
  if (posizioni.length < 2) return null
  if (new Set(posizioni.map(p => p.lineNumber)).size < 2) return null
  const blocco = rientroDiBlocco(righe, posizioni)
  return posizioni.map(p => {
    const riga = righe[p.lineNumber - 1] ?? ''
    return {
      lineNumber: p.lineNumber,
      column: p.column,
      rientro: riga.trim().length === 0 ? blocco : rientroIniziale(riga),
    }
  })
}
