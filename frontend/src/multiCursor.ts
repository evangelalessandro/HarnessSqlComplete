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
  /** Codice "storico" del tasto (40 = freccia giù, 38 = freccia su): unico dato affidabile
   *  quando la tastiera consegna l'evento come AltGr/IME e `key`/`code` sono vuoti o "Process". */
  keyCode?: number
  which?: number
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  /** AltGr segnalato dal browser: su Windows è Ctrl+Alt, ma alcuni browser lo riportano solo qui. */
  altGraph?: boolean
}

/** True se i modificatori sono quelli di "aggiungi cursore" (Ctrl+Alt, Cmd+Alt, AltGr…). */
function modificatoriCursore(e: TastoPremuto): boolean {
  const cmd = !!e.ctrlKey || !!e.metaKey || !!e.altGraph
  // AltGr da solo vale come Ctrl+Alt: alcuni browser lo riportano solo come altGraph (senza altKey)
  return cmd && (!!e.altKey || !!e.altGraph)
}

/**
 * Direzione del cursore da aggiungere, oppure null se la combinazione non è quella.
 * Accetta Ctrl+Alt (o Cmd+Alt su Mac, o AltGr su Windows) con la freccia Su/Giù, con o senza
 * Shift. Il tasto si riconosce da `code`, da `key` OPPURE da `keyCode`: quando la tastiera passa
 * per AltGr il browser può non riportare `key`/`code` (keyCode 229) e la combinazione sembrerebbe
 * non premuta — era il motivo per cui "ctrl+alt+giù" non aggiungeva il cursore.
 */
export function cursoreDaAggiungere(e: TastoPremuto): DirezioneCursore | null {
  if (!modificatoriCursore(e)) return null
  const tasto = e.code || e.key || ''
  if (tasto === 'ArrowDown' || tasto === 'Down') return 'sotto'
  if (tasto === 'ArrowUp' || tasto === 'Up') return 'sopra'
  const codice = e.keyCode ?? e.which ?? 0
  if (codice === 40 || codice === 34) return 'sotto'
  if (codice === 38 || codice === 33) return 'sopra'
  return null
}

/** Nome dell'azione di Monaco da eseguire. */
export function azioneCursore(direzione: DirezioneCursore): string {
  return direzione === 'sotto' ? 'editor.action.insertCursorBelow' : 'editor.action.insertCursorAbove'
}
