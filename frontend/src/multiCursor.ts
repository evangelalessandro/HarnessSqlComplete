// SCRITTURA SU PIÙ RIGHE: la combinazione Maiusc+Alt+Su/Giù (Shift+Alt) aggiunge un cursore
// sopra/sotto, come in Visual Studio. Richiesta utente: "deve funzionare con il maius + alt e non
// CTRL + Alt": su Windows Ctrl+Alt è la stessa cosa di AltGr (produce caratteri accentati/€) e in
// Monaco Ctrl+Alt+Su/Giù è già la combinazione predefinita per i cursori, quindi qui si usa
// MAIUSC+ALT e Ctrl/AltGr vengono rifiutati.
//
// Perché serve un intervento esplicito: l'evento va riconosciuto dal codice del tasto e dai
// modificatori (senza guardare keyCode/key, che con alcune tastiere arrivano vuoti) e l'azione va
// eseguita direttamente, altrimenti Maiusc+Alt+Giù finirebbe su un'altra azione di Monaco
// ("copia riga sotto"). Logica pura e testabile.

export type DirezioneCursore = 'sopra' | 'sotto'

/** Evento tastiera ridotto all'essenziale (comodo nei test). */
export interface TastoPremuto {
  code?: string
  key?: string
  /** Codice "storico" del tasto (40 = freccia giù, 38 = freccia su): unico dato affidabile
   *  quando la tastiera consegna l'evento senza `key`/`code` (keyCode 229/0). */
  keyCode?: number
  which?: number
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  /** AltGr segnalato dal browser: su Windows è Ctrl+Alt e NON deve attivare il multi cursore. */
  altGraph?: boolean
}

/**
 * True se i modificatori sono quelli di "aggiungi cursore": MAIUSC+ALT, senza Ctrl (né AltGr,
 * che su Windows è Ctrl+Alt). Il tasto Cmd/Meta del Mac è ammesso.
 */
function modificatoriCursore(e: TastoPremuto): boolean {
  if (!e.altKey || !e.shiftKey) return false
  return !e.ctrlKey && !e.altGraph
}

/** Direzione della freccia premuta (Su/Giù, anche PageUp/PageDown), oppure null. */
function direzioneFreccia(e: TastoPremuto): DirezioneCursore | null {
  const tasto = e.code || e.key || ''
  if (tasto === 'ArrowDown' || tasto === 'Down') return 'sotto'
  if (tasto === 'ArrowUp' || tasto === 'Up') return 'sopra'
  const codice = e.keyCode ?? e.which ?? 0
  if (codice === 40 || codice === 34) return 'sotto'
  if (codice === 38 || codice === 33) return 'sopra'
  return null
}

/**
 * Direzione del cursore da aggiungere, oppure null se la combinazione non è quella.
 * La combinazione è Maiusc+Alt con la freccia Su/Giù (anche col Cmd in più su Mac, ma su Windows
 * Ctrl+Alt è AltGr e viene rifiutato). Il tasto si riconosce da `code`, da `key` OPPURE da
 * `keyCode`: con alcune tastiere il browser non riporta `key`/`code` e la combinazione sembrerebbe
 * non premuta.
 */
export function cursoreDaAggiungere(e: TastoPremuto): DirezioneCursore | null {
  if (!modificatoriCursore(e)) return null
  return direzioneFreccia(e)
}

/**
 * True se è la VECCHIA combinazione (Ctrl/Cmd+Alt + freccia, cioè anche AltGr su Windows): non
 * deve più aggiungere cursori e va neutralizzata, perché in Monaco Ctrl+Alt+Su/Giù è la
 * combinazione predefinita dei cursori e altrimenti continuerebbe a funzionare.
 */
export function cursoreDaNeutralizzare(e: TastoPremuto): boolean {
  if (!e.altKey) return false
  if (!(e.ctrlKey || e.metaKey || e.altGraph)) return false
  return direzioneFreccia(e) !== null
}

/** Nome dell'azione di Monaco da eseguire. */
export function azioneCursore(direzione: DirezioneCursore): string {
  return direzione === 'sotto' ? 'editor.action.insertCursorBelow' : 'editor.action.insertCursorAbove'
}

/**
 * SELEZIONE VERTICALE DI TESTO (Shift+Su / Shift+Giù senza Alt/Ctrl).
 *
 * Serve perché con la "selezione a blocchi" accesa (columnSelection, Alt+C di SSMS) Monaco trasforma
 * Shift+Su/Giù in una selezione a RETTANGOLO: partendo da fine riga il rettangolo ha larghezza zero e
 * la selezione risulta VUOTA (segnalazione utente: "ora sembra non funzionare la selezione di più
 * testo con il maiusc+su o maiusc+giù"). In SSMS la modalità a blocchi vale per il trascinamento del
 * mouse, mentre Maiusc+frecce seleziona sempre il testo: qui si riproduce quel comportamento.
 *
 * Restituisce -1 (su), +1 (giù) oppure 0 se non è questa combinazione.
 */
export function selezioneVerticale(e: TastoPremuto): -1 | 0 | 1 {
  if (!e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.altGraph) return 0
  const tasto = e.code || e.key || ''
  if (tasto === 'ArrowUp' || tasto === 'Up') return -1
  if (tasto === 'ArrowDown' || tasto === 'Down') return 1
  const codice = e.keyCode ?? e.which ?? 0
  if (codice === 38) return -1
  if (codice === 40) return 1
  return 0
}
