// SCRITTURA SU PIÙ RIGHE: modalità "selezione a BLOCCHI" (come Alt+C di SSMS).
// Accesa, il trascinamento del mouse seleziona un rettangolo di testo e tutto ciò che si scrive
// finisce su TUTTE le righe selezionate (stessa colonna); spenta, il mouse seleziona come sempre.
// Qui c'è solo la parte pura (lettura/scrittura della preferenza), così si può testare.

/** Dove si ricorda la scelta (accesa/spenta) fra un avvio e l'altro. */
export const BLOCCHI_KEY = 'sqlIntelli.blocchi.v1'

/** Preferenza salvata: true solo se salvata esplicitamente a "accesa". */
export function parseBlocchi(raw: string | null): boolean {
  return raw === 'on' || raw === 'true' || raw === '1'
}

/** Valore da salvare per la preferenza. */
export function serializzaBlocchi(accesa: boolean): string {
  return accesa ? 'on' : 'off'
}

/**
 * Opzioni Monaco da applicare quando la modalità a blocchi è accesa/spenta.
 * `columnSelection` è la voce che rende il trascinamento "a rettangolo".
 * `multiCursorModifier: 'alt'` tiene Alt+clic per aggiungere cursori (Maiusc+Alt+Giù per più righe).
 */
export function opzioniMonaco(accesa: boolean): { columnSelection: boolean; multiCursorModifier: 'alt' } {
  return { columnSelection: accesa, multiCursorModifier: 'alt' }
}
