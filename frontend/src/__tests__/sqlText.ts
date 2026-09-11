// Utility condivise dai test sull'intellisense.
// Nota: il file NON termina con .test.ts, quindi vitest non lo tratta come suite.

/**
 * True se l'offset cade dentro un commento (`--`, `/* *\/`) o una stringa.
 * Serve a escludere le posizioni in cui il provider NON deve proporre nulla:
 * senza questo filtro uno smoke test su ogni offset fallirebbe per falso positivo.
 */
export function inCommentOrString(sql: string, offset: number): boolean {
  let i = 0
  let block = false
  let quote: string | null = null
  let line = false
  while (i < offset) {
    const c = sql[i]
    const nx = sql[i + 1] ?? ''
    if (block) {
      if (c === '*' && nx === '/') {
        block = false
        i += 2
        continue
      }
      i++
      continue
    }
    if (quote) {
      if (c === quote) {
        if (nx === quote) {
          i += 2
          continue
        }
        quote = null
      }
      i++
      continue
    }
    if (line) {
      if (c === '\n') line = false
      i++
      continue
    }
    if (c === '[') {
      const end = sql.indexOf(']', i + 1)
      i = end === -1 ? i + 1 : end + 1
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      i++
      continue
    }
    if (c === '-' && nx === '-') {
      line = true
      i += 2
      continue
    }
    if (c === '/' && nx === '*') {
      block = true
      i += 2
      continue
    }
    i++
  }
  return block || quote !== null || line
}
