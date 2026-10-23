// Guide di indentazione verticali per i blocchi T-SQL (BEGIN/END).
// Analizza il testo e restituisce le "guide": linee verticali che collegano visivamente l'apertura del
// blocco alla sua chiusura, come in Visual Studio.
//
// SEGNALAZIONE UTENTE: "aprendo questa SP gestisce malissimo la visualizzazione delle righe verticali".
// Cause trovate su una SP reale (ws_L2_Engine_Automatismi):
//  1) la guida era disegnata alla colonna della KEYWORD "begin", che in "if @fn_name = 'X' begin" sta a
//     metà riga (colonna 40): una linea verticale che tagliava il testo a caso;
//  2) l'IF agganciato al BEGIN produceva una SECONDA guida sulla stessa riga, e gli IF senza BEGIN
//     venivano accoppiati con un END qualsiasi (es. riga 68 → 202: un blocco lunghissimo inesistente);
//  3) anche i CASE aperti e chiusi sulla stessa riga facevano una guida (riga 24 → 24).
// Ora: guida alla colonna di INDENTAZIONE della riga di apertura (dove comincia il blocco), solo per i
// BEGIN…END veri, niente guide per IF e CASE, niente guide per i blocchi su una riga sola.

export interface BlockGuide {
  /** Riga (1-based) della keyword di apertura (BEGIN/CASE/IF). */
  openLine: number
  /** Riga (1-based) della keyword di chiusura (END) o della fine del corpo. */
  closeLine: number
  /** Colonna (1-based) della keyword di apertura (serve all'evidenziazione della keyword). */
  column: number
  /**
   * Colonna (1-based) su cui disegnare la LINEA verticale: l'indentazione della riga di apertura. Per
   * "if @fn = 1 begin" è la colonna dell'IF (dove comincia il blocco), non quella di "begin".
   */
  indentColumn: number
  /** Profondità di annidamento (0 = primo livello). */
  depth: number
  kind: 'begin' | 'case' | 'if'
}

interface TokenInfo {
  word: string
  line: number
  column: number
}

/** Estrae le parole chiave a livello top (profondità parentesi 0), fuori da stringhe/commenti. */
function topLevelKeywords(text: string): TokenInfo[] {
  const out: TokenInfo[] = []
  let depth = 0
  let inString = false
  let inLineComment = false
  let inBlockComment = false
  let line = 1
  let col = 1
  const n = text.length
  let i = 0
  while (i < n) {
    const ch = text[i]
    const next = text[i + 1]
    // aggiorna riga/colonna
    if (ch === '\n') {
      line++
      col = 1
      i++
      inLineComment = false
      continue
    }
    if (inLineComment) {
      i++
      col++
      continue
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i += 2
        col += 2
      } else {
        i++
        col++
      }
      continue
    }
    if (ch === "'") {
      inString = !inString
      i++
      col++
      continue
    }
    if (inString) {
      i++
      col++
      continue
    }
    if (ch === '-' && next === '-') {
      inLineComment = true
      i += 2
      col += 2
      continue
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true
      i += 2
      col += 2
      continue
    }
    if (ch === '(') {
      depth++
      i++
      col++
      continue
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1)
      i++
      col++
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i))
      if (m) {
        const word = m[0]
        if (depth === 0) out.push({ word: word.toUpperCase(), line, column: col })
        i += word.length
        col += word.length
        continue
      }
    }
    i++
    col++
  }
  return out
}

interface Frame {
  kind: 'begin' | 'case' | 'if'
  line: number
  column: number
  /** Colonna di INDENTAZIONE della riga di apertura: è lì che si disegna la linea verticale. */
  indentColumn: number
  depth: number
}

function pushGuide(
  guides: BlockGuide[],
  openLine: number,
  closeLine: number,
  column: number,
  indentColumn: number,
  depth: number,
  kind: BlockGuide['kind'],
) {
  guides.push({ openLine, closeLine, column, indentColumn, depth, kind })
}

/**
 * Calcola le guide dei blocchi. Un blocco si apre con BEGIN e si chiude con il relativo END (CASE
 * viene solo contato per bilanciare gli END, senza disegnare guide). La colonna della guida è
 * l'INDENTAZIONE della riga di apertura: in "if … begin" la linea parte dall'IF, non da "begin".
 */
export function computeBlockGuides(text: string): BlockGuide[] {
  const words = topLevelKeywords(text)
  const righe = text.split('\n')
  /** Colonna (1-based) del primo carattere non bianco della riga. */
  const colonnaIndentazione = (line: number): number => {
    const riga = righe[line - 1] ?? ''
    return (/^[ \t]*/.exec(riga)?.[0].length ?? 0) + 1
  }
  const guides: BlockGuide[] = []
  const stack: Frame[] = []

  for (let idx = 0; idx < words.length; idx++) {
    const w = words[idx]
    const next = words[idx + 1]?.word
    switch (w.word) {
      case 'BEGIN': {
        // BEGIN TRAN / BEGIN TRANSACTION / BEGIN DISTRIBUTED TRAN non sono blocchi:
        // si chiudono con COMMIT/ROLLBACK, non con END → nessuna guida
        const isTransaction =
          next === 'TRAN' ||
          next === 'TRANSACTION' ||
          (next === 'DISTRIBUTED' &&
            (words[idx + 2]?.word === 'TRAN' || words[idx + 2]?.word === 'TRANSACTION'))
        if (isTransaction) break
        stack.push({
          kind: 'begin',
          line: w.line,
          column: w.column,
          indentColumn: colonnaIndentazione(w.line),
          depth: stack.filter(f => f.kind === 'begin').length,
        })
        break
      }
      case 'CASE': {
        // si tiene solo per bilanciare l'END corrispondente: nessuna guida
        stack.push({ kind: 'case', line: w.line, column: w.column, indentColumn: w.column, depth: 0 })
        break
      }
      case 'END': {
        const top = stack.pop()
        // guide solo se il blocco occupa più di una riga: quelle su una riga sola non servono (né per
        // l'evidenziazione né per il folding) e su codice reale facevano solo rumore.
        if (top && w.line > top.line) {
          pushGuide(guides, top.line, w.line, top.column, top.indentColumn, top.depth, top.kind)
        }
        break
      }
      default:
        break
    }
  }

  // blocchi rimasti aperti (END mancante): guida fino all'ultima riga del testo
  const lastLine = righe.length
  for (const open of stack) {
    if (open.kind !== 'begin' || lastLine <= open.line) continue
    pushGuide(guides, open.line, lastLine, open.column, open.indentColumn, open.depth, 'begin')
  }
  return guides
}

/** Verifica se una parola è una keyword di blocco (per evidenziarle). */
export function isBlockKeyword(word: string): boolean {
  const w = word.toUpperCase()
  return w === 'BEGIN' || w === 'END' || w === 'CASE' || w === 'WHEN' || w === 'THEN' || w === 'ELSE'
}
