/**
 * Label di salto (GOTO) definite nel testo: "lblExit:", "end_err:", ";fine:".
 *
 * Servono all'intellisense: dopo "GOTO " vanno proposte TUTTE le label del documento, comprese
 * quelle scritte più sotto (è il caso normale: si salta a una label definita in fondo).
 * Le label dentro i commenti (riga "--" o blocco "/* … *​/") vengono ignorate, così il codice
 * commentato non sporca i suggerimenti.
 *
 * Logica PURA e testabile: nessuna dipendenza da Monaco o dal backend.
 */

/**
 * Nomi delle label definite nel testo, nell'ordine in cui compaiono e senza duplicati
 * (confronto senza differenze fra maiuscole e minuscole: la prima grafia trovata vince).
 */
export function extractLabels(text: string): string[] {
  const out: string[] = []
  const visti = new Set<string>()
  let inBlockComment = false
  for (const riga of text.split(/\r?\n/)) {
    let linea = riga
    if (inBlockComment) {
      const fine = linea.indexOf('*/')
      if (fine === -1) continue
      linea = linea.slice(fine + 2)
      inBlockComment = false
    }
    // via i commenti di blocco sulla stessa riga e il commento di riga finale
    linea = linea.replace(/\/\*[\s\S]*?\*\//g, ' ')
    if (linea.includes('/*')) {
      inBlockComment = true
      linea = linea.slice(0, linea.indexOf('/*'))
    }
    const senzaCommento = linea.replace(/--.*$/, '')
    // una label è "identificatore :" a inizio riga o dopo un ';' (esclusi "::" e ":=")
    for (const m of senzaCommento.matchAll(/(?:^|;)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:(?![:=])/g)) {
      const nome = m[1]
      const chiave = nome.toLowerCase()
      if (visti.has(chiave)) continue
      visti.add(chiave)
      out.push(nome)
    }
  }
  return out
}
