import type { DatabaseSummary, TableInfo } from './types'

/** Diagnostica SQL in tempo reale: un problema rilevato nel testo dell'editor. */
export interface SqlDiagnostic {
  /** Offset di inizio (inclusivo). */
  start: number
  /** Offset di fine (esclusivo). */
  end: number
  message: string
  severity: 'error' | 'warning'
}

interface DiagnosticCtx {
  summary: DatabaseSummary | null
}

/**
 * Analizza il testo SQL e restituisce i problemi rilevabili senza eseguire la query:
 * - parentesi non bilanciate;
 * - apici non chiusi;
 * - riferimenti qualificati (alias.colonna) verso colonne inesistenti;
 * - parole chiave "SELECT ... FROM" senza FROM prima del ';' (segnalazione leggera).
 */
export function runSqlDiagnostics(text: string, ctx: DiagnosticCtx): SqlDiagnostic[] {
  const diags: SqlDiagnostic[] = []

  // 1) parentesi e apici
  let depth = 0
  let inString = false
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    if (ch === "'") {
      if (inString && i + 1 < n && text[i + 1] === "'") {
        i += 2 // '' è l'escape dell'apice dentro la stringa
        continue
      }
      inString = !inString
    } else if (!inString) {
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth < 0) {
          diags.push({ start: i, end: i + 1, message: 'Parentesi chiusa senza apertura.', severity: 'error' })
          depth = 0
        }
      }
    }
    i++
  }
  if (depth > 0) {
    // trova l'ultima '(' non chiusa
    const lastOpen = text.lastIndexOf('(')
    diags.push({
      start: lastOpen,
      end: lastOpen + 1,
      message: `Parentesi non chiusa (${depth} aperta).`,
      severity: 'error',
    })
  }
  if (inString) {
    const lastQuote = text.lastIndexOf("'")
    diags.push({ start: lastQuote, end: lastQuote + 1, message: 'Stringa non chiusa (apice).', severity: 'error' })
  }

  // 2) colonne qualificate inesistenti: alias.col dove alias è noto ma colonna no
  if (ctx.summary) {
    const tableByName = new Map<string, TableInfo>()
    for (const t of ctx.summary.tables) tableByName.set(t.name.toLowerCase(), t)
    const re = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\b/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const qual = m[1].toLowerCase()
      const col = m[2]
      const table = tableByName.get(qual)
      if (!table?.columns) continue
      const exists = table.columns.some(c => c.name.toLowerCase() === col.toLowerCase())
      if (!exists) {
        diags.push({
          start: m.index,
          end: m.index + m[0].length,
          message: `Colonna '${col}' non esiste in ${table.schema}.${table.name}.`,
          severity: 'warning',
        })
      }
    }
  }

  // 3) SELECT senza FROM (prima del primo ';' dello statement)
  const semi = text.indexOf(';')
  const firstStmt = semi === -1 ? text : text.slice(0, semi)
  const hasSelect = /\bSELECT\b/i.test(firstStmt)
  const hasFrom = /\bFROM\b/i.test(firstStmt)
  const hasInto = /\bINSERT\b/i.test(firstStmt) || /\bUPDATE\b/i.test(firstStmt) || /\bDECLARE\b/i.test(firstStmt)
  if (hasSelect && !hasFrom && !hasInto && firstStmt.trim().length > 6) {
    const selIdx = firstStmt.search(/\bSELECT\b/i)
    diags.push({
      start: selIdx,
      end: selIdx + 6,
      message: 'SELECT senza FROM: manca la clausola FROM.',
      severity: 'warning',
    })
  }

  return diags
}

/** Converte un offset in posizione (linea, colonna) per Monaco. */
export function positionAt(text: string, offset: number): { lineNumber: number; column: number } {
  const before = text.slice(0, offset)
  const lineNumber = (before.match(/\n/g)?.length ?? 0) + 1
  const lastNl = before.lastIndexOf('\n')
  return { lineNumber, column: offset - lastNl }
}
