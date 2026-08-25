// Guide di indentazione verticali per i blocchi T-SQL (BEGIN/END, CASE/END, IF senza BEGIN).
// Analizza il testo e restituisce le "guide": linee verticali che collegano visivamente
// l'apertura del blocco alla sua chiusura, come in Visual Studio.

export interface BlockGuide {
  /** Riga (1-based) della keyword di apertura (BEGIN/CASE/IF). */
  openLine: number
  /** Riga (1-based) della keyword di chiusura (END) o della fine del corpo. */
  closeLine: number
  /** Colonna (1-based) in cui disegnare la guida verticale. */
  column: number
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
  depth: number
  /** IF ... BEGIN: l'IF che precede questo BEGIN; la sua guida finisce sull'END del BEGIN. */
  attachedIf?: TokenInfo
}

function pushGuide(
  guides: BlockGuide[],
  openLine: number,
  closeLine: number,
  column: number,
  depth: number,
  kind: BlockGuide['kind'],
) {
  guides.push({ openLine, closeLine, column, depth, kind })
}

/**
 * Calcola le guide dei blocchi. Un blocco si apre con BEGIN (o CASE) e si chiude con il
 * relativo END. Un IF seguito da BEGIN viene "agganciato" al BEGIN: la sua guida parte
 * dall'IF e arriva all'END del blocco (come in Visual Studio). Un IF senza BEGIN non ha
 * una chiusura propria e non genera guide. La colonna della guida è quella della keyword
 * di apertura; la profondità conta solo i blocchi BEGIN/CASE.
 */
export function computeBlockGuides(text: string): BlockGuide[] {
  const words = topLevelKeywords(text)
  const guides: BlockGuide[] = []
  const stack: Frame[] = []
  // Ultimo IF incontrato non ancora seguito da BEGIN/CASE/ELSE/END.
  let pendingIf: TokenInfo | null = null

  const dropPendingIf = () => {
    pendingIf = null
  }

  for (let idx = 0; idx < words.length; idx++) {
    const w = words[idx]
    const next = words[idx + 1]?.word
    switch (w.word) {
      case 'IF': {
        // un IF precedente non seguito da BEGIN non ha chiusura: nessuna guida
        dropPendingIf()
        pendingIf = w
        break
      }
      case 'BEGIN': {
        // BEGIN TRAN / BEGIN TRANSACTION / BEGIN DISTRIBUTED TRAN non sono blocchi:
        // si chiudono con COMMIT/ROLLBACK, non con END → nessuna guida
        const isTransaction =
          next === 'TRAN' ||
          next === 'TRANSACTION' ||
          (next === 'DISTRIBUTED' &&
            (words[idx + 2]?.word === 'TRAN' || words[idx + 2]?.word === 'TRANSACTION'))
        if (isTransaction) {
          dropPendingIf()
          break
        }
        const frame: Frame = {
          kind: 'begin',
          line: w.line,
          column: w.column,
          depth: stack.length,
        }
        if (pendingIf) {
          frame.attachedIf = pendingIf
          pendingIf = null
        }
        stack.push(frame)
        break
      }
      case 'CASE': {
        dropPendingIf()
        stack.push({ kind: 'case', line: w.line, column: w.column, depth: stack.length })
        break
      }
      case 'ELSE': {
        dropPendingIf()
        break
      }
      case 'END': {
        dropPendingIf()
        const top = stack.pop()
        if (top) {
          pushGuide(guides, top.line, w.line, top.column, top.depth, top.kind)
          if (top.attachedIf) {
            pushGuide(guides, top.attachedIf.line, w.line, top.attachedIf.column, top.depth, 'if')
          }
        }
        break
      }
      default:
        break
    }
  }

  // blocchi rimasti aperti (END mancante): guida fino all'ultima riga del testo
  const lastLine = text.split('\n').length
  for (const open of stack) {
    pushGuide(guides, open.line, lastLine, open.column, open.depth, open.kind)
    if (open.attachedIf) {
      pushGuide(guides, open.attachedIf.line, lastLine, open.attachedIf.column, open.depth, 'if')
    }
  }
  return guides
}

/** Verifica se una parola è una keyword di blocco (per evidenziarle). */
export function isBlockKeyword(word: string): boolean {
  const w = word.toUpperCase()
  return w === 'BEGIN' || w === 'END' || w === 'CASE' || w === 'WHEN' || w === 'THEN' || w === 'ELSE'
}
