// SCRITTURA SU PIÙ RIGHE: la combinazione Ctrl+Alt+Su/Giù deve SEMPRE aggiungere un cursore
// sopra/sotto (come in VS Code), mai copiare o spostare la riga.
//
// Perché serve un intervento esplicito: su Windows Ctrl+Alt e AltGr sono la stessa cosa e a
// seconda di come il browser/tastiera consegna l'evento la combinazione può finire su un'altra
// azione di Monaco (es. copia riga). Qui la combinazione viene riconosciuta dall'evento stesso
// (codice del tasto + modificatori, senza guardare keyCode/key che possono variare) e viene
// eseguita direttamente l'azione "aggiungi cursore". Logica pura e testabile.

export type DirezioneCursore = 'sopra' | 'sotto'

/** Evento tastiera ridotto all'essenziale (comodo nei test). */
export interface TastoPremuto {
  code?: string
  key?: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

/**
 * Direzione del cursore da aggiungere, oppure null se la combinazione non è quella.
 * Accetta Ctrl+Alt (o Cmd+Alt su Mac) con la freccia Su/Giù, con o senza Shift
 * (Ctrl+Shift+Alt+Giù è la variante usata su Linux).
 */
export function cursoreDaAggiungere(e: TastoPremuto): DirezioneCursore | null {
  const cmd = !!e.ctrlKey || !!e.metaKey
  if (!cmd || !e.altKey) return null
  const tasto = e.code || e.key || ''
  if (tasto === 'ArrowDown' || tasto === 'Down') return 'sotto'
  if (tasto === 'ArrowUp' || tasto === 'Up') return 'sopra'
  return null
}

/** Nome dell'azione di Monaco da eseguire. */
export function azioneCursore(direzione: DirezioneCursore): string {
  return direzione === 'sotto' ? 'editor.action.insertCursorBelow' : 'editor.action.insertCursorAbove'
}
