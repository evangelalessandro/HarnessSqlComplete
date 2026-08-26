// Mapping della verifica di sintassi (checkSyntax) verso marker Monaco:
// i messaggi "Riga N: ..." di SQL Server (errori reali con riga assoluta) diventano
// segnalazioni sulla riga N. Logica PURA e testabile.

export interface SyntaxIssue {
  line: number
  message: string
  severity: 'error' | 'warning'
}

const RIGA_RE = /^Riga\s+(\d+):\s*(.+)$/i

/**
 * Estrae i problemi di sintassi dal risultato della verifica (QueryResult di checkSyntax).
 * - i messaggi "Riga N: …" (errori di sintassi arrivati via InfoMessage con
 *   FireInfoMessageEventOnUserErrors) diventano marker sulla riga assoluta N;
 * - i messaggi informativi (PRINT, "N righe interessate") NON sono errori;
 * - l'errore generale (timeout/severità alta) viene segnalato sulla riga 1 se non ha riga;
 * - testo valido → lista vuota.
 */
export function syntaxIssuesFromCheck(error: string | null, messages: string[]): SyntaxIssue[] {
  const issues: SyntaxIssue[] = []
  const pushRiga = (text: string) => {
    const m = RIGA_RE.exec(text.trim())
    if (m) issues.push({ line: Number(m[1]), message: m[2].trim(), severity: 'error' })
  }
  for (const m of messages ?? []) pushRiga(m)
  if (error && error.trim()) {
    const m = RIGA_RE.exec(error.trim())
    issues.push(
      m
        ? { line: Number(m[1]), message: m[2].trim(), severity: 'error' }
        : { line: 1, message: error.trim(), severity: 'error' },
    )
  }
  return issues
}
