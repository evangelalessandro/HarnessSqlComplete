// IL DRAGO DELL'APP (la mascotte: 🐉, la stessa del drago di sfondo e dei badge XP).
//
// Serve a segnare i suggerimenti di JOIN dell'intellisense: le voci che inseriscono davvero la
// clausola ON hanno il drago davanti all'etichetta, così si distinguono a colpo d'occhio dalle
// tabelle "semplici".
//
// Un'emoji, dentro un'etichetta di testo, non si può animare da sola: le animazioni stanno in
// index.css e colpiscono le righe della lista che contengono il drago (`.suggest-widget
// .monaco-list-row[aria-label*="🐉"]`), pulsando con i colori del fuoco.
export const DRAGO = '🐉'

/** Etichetta di un suggerimento con il drago davanti (l'emoji è FUORI dal filtro: si cerca
 *  ancora per nome tabella, vedi `filterText` in sqlCompletions). */
export function etichettaDrago(testo: string): string {
  return `${DRAGO} ${testo}`
}
