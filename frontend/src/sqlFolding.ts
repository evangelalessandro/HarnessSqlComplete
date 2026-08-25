// Folding per l'editor T-SQL: permette di "chiudere" porzioni di codice.
// Combina tre sorgenti di range:
//   1. blocchi BEGIN/END e CASE/END (riusando computeBlockGuides);
//   2. regioni in stile SSMS: --#region ... --#endregion (annidabili);
//   3. commenti /* ... */ su più righe.
// I range sono 1-based e inclusivi, come richiesto dall'API di Monaco.

import { computeBlockGuides } from './sqlBlockGuides'

export interface FoldRange {
  /** Riga di inizio (1-based, inclusiva). */
  start: number
  /** Riga di fine (1-based, inclusiva). */
  end: number
  kind: 'block' | 'region' | 'comment'
}

/** Region SSMS: righe che iniziano (dopo spazi) con --#region / --#endregion. */
function regionRanges(text: string): FoldRange[] {
  const out: FoldRange[] = []
  const lines = text.split('\n')
  const stack: number[] = []
  for (let idx = 0; idx < lines.length; idx++) {
    const trimmed = lines[idx].trimStart()
    if (/^--#region\b/i.test(trimmed)) {
      stack.push(idx + 1)
    } else if (/^--#endregion\b/i.test(trimmed)) {
      const start = stack.pop()
      if (start !== undefined) {
        out.push({ start, end: idx + 1, kind: 'region' })
      }
    }
  }
  // regioni non chiuse: non emesse (evita sorprese)
  return out
}

/** Commenti a blocco su più righe (fuori da stringhe e commenti di riga). */
function commentRanges(text: string): FoldRange[] {
  const out: FoldRange[] = []
  const n = text.length
  let line = 1
  let inString = false
  let i = 0
  while (i < n) {
    const ch = text[i]
    const next = text[i + 1]
    if (ch === '\n') {
      line++
      i++
      continue
    }
    if (ch === "'") {
      inString = !inString
      i++
      continue
    }
    if (inString) {
      i++
      continue
    }
    if (ch === '-' && next === '-') {
      // commento di riga: salta fino al newline
      while (i < n && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      const startLine = line
      i += 2
      let endLine = line
      while (i < n) {
        if (text[i] === '\n') {
          line++
          endLine = line
          i++
          continue
        }
        if (text[i] === '*' && text[i + 1] === '/') {
          i += 2
          break
        }
        i++
      }
      if (endLine > startLine) {
        out.push({ start: startLine, end: endLine, kind: 'comment' })
      }
      continue
    }
    i++
  }
  return out
}

/**
 * Ordina, deduplica e scarta i range che si sovrappongono parzialmente
 * (restano solo quelli correttamente annidati o fratelli).
 */
function normalizeRanges(ranges: FoldRange[]): FoldRange[] {
  const unique = new Map<string, FoldRange>()
  for (const r of ranges) unique.set(`${r.start}:${r.end}:${r.kind}`, r)
  const list = [...unique.values()].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: FoldRange[] = []
  const stack: { end: number }[] = []
  for (const r of list) {
    while (stack.length && stack[stack.length - 1].end < r.start) stack.pop()
    const top = stack[stack.length - 1]
    if (top && r.end > top.end) continue // sovrapposizione parziale: scarta
    out.push(r)
    stack.push({ end: r.end })
  }
  return out
}

/** Calcola i range di folding per il testo T-SQL dato. */
export function computeFoldingRanges(text: string): FoldRange[] {
  const ranges: FoldRange[] = []
  // 1. blocchi BEGIN/END e CASE/END (gli IF si piegano sul loro BEGIN)
  for (const g of computeBlockGuides(text)) {
    if ((g.kind === 'begin' || g.kind === 'case') && g.closeLine > g.openLine) {
      ranges.push({ start: g.openLine, end: g.closeLine, kind: 'block' })
    }
  }
  // 2. regioni SSMS
  ranges.push(...regionRanges(text))
  // 3. commenti su più righe
  ranges.push(...commentRanges(text))
  return normalizeRanges(ranges)
}
