// MOSTRA SPAZI E TAB (come "Mostra spazi" di SSMS o "Render Whitespace" di VS Code):
// accesa, l'editor disegna i caratteri invisibili — lo spazio come '·' e il tab come '→' —
// così si vedono a colpo d'occhio rientri sbagliati e tab mescolati agli spazi.
// Qui c'è solo la parte pura (preferenza salvata + opzioni Monaco), così si può testare.

/** Dove si ricorda la scelta (accesa/spenta) fra un avvio e l'altro. */
export const SPAZI_KEY = 'sqlIntelli.spazi.v1'

/** Preferenza salvata: true solo se salvata esplicitamente a "accesa". */
export function parseSpazi(raw: string | null): boolean {
  return raw === 'on' || raw === 'true' || raw === '1'
}

/** Valore da salvare per la preferenza. */
export function serializzaSpazi(accesa: boolean): string {
  return accesa ? 'on' : 'off'
}

/**
 * Opzioni Monaco da applicare quando "mostra spazi" è accesa/spenta.
 * `renderWhitespace: 'all'` disegna spazio e tab anche a metà riga (non solo in coda);
 * `renderControlCharacters` evidenzia gli eventuali caratteri di controllo.
 */
export function opzioniSpazi(accesa: boolean): {
  renderWhitespace: 'all' | 'none'
  renderControlCharacters: boolean
} {
  return { renderWhitespace: accesa ? 'all' : 'none', renderControlCharacters: accesa }
}
