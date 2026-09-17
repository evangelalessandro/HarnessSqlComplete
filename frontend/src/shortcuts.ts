/**
 * Scorciatoie da tastiera "di applicazione" (non legate all'editor).
 *
 * Sono pure: ricevono l'evento e dicono se la combinazione è quella attesa, così si possono
 * testare senza browser. L'evento va poi "annullato" (preventDefault) dal chiamante: alcune
 * combinazioni altrimenti farebbero qualcosa nel browser (Ctrl+R ricarica la pagina,
 * Ctrl+Shift+R la ricarica ignorando la cache).
 */

/** Tasti premuti che ci interessano (sottoinsieme di KeyboardEvent, comodo nei test). */
export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Ctrl+Shift+R (Cmd+Shift+R su Mac): aggiorna lo schema, come "Refresh Local Cache" di SSMS.
 * Si vuole il Ctrl "puro": con Alt premuto la combinazione è un'altra cosa.
 */
export function isRefreshSchemaShortcut(e: KeyLike): boolean {
  const cmd = e.ctrlKey || e.metaKey
  return cmd && e.shiftKey && !e.altKey && (e.key === 'r' || e.key === 'R')
}

/**
 * Ctrl+R (Cmd+R): mostra/nasconde il pannello dei risultati. Deve restare distinta da
 * Ctrl+Shift+R, quindi qui lo Shift NON deve essere premuto.
 */
export function isToggleResultsShortcut(e: KeyLike): boolean {
  const cmd = e.ctrlKey || e.metaKey
  return cmd && !e.shiftKey && !e.altKey && (e.key === 'r' || e.key === 'R')
}
