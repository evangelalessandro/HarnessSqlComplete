// MOTORE DI FORMATTAZIONE: si può formattare con il motore "nostro" (quello usato fino ad oggi,
// con il profilo T-SQL dell'app) oppure con la libreria di terze parti `sql-formatter`
// (https://github.com/sql-formatter-org/sql-formatter, dialetto `tsql`).
//
// Qui c'è solo la scelta e la chiamata: entrambi i motori ricevono lo stesso testo e restituiscono
// testo. Se la libreria non riesce (SQL che non sa leggere) si torna al motore nostro, così la
// formattazione non "sparisce" mai.
import { format as formatLibreria } from 'sql-formatter'
import type { FormatProfile } from './formatProfile'
import { formatSqlWithProfile } from './tsqlFormatter'

export type MotoreFormattazione = 'nostro' | 'sql-formatter'

export const MOTORI_FORMATTAZIONE: MotoreFormattazione[] = ['nostro', 'sql-formatter']

/** Etichetta mostrata nell'interfaccia. */
export function etichettaMotore(m: MotoreFormattazione): string {
  return m === 'nostro' ? 'Nostro (profilo T-SQL dell\u2019app)' : 'sql-formatter (libreria esterna)'
}

/**
 * Formatta `testo` con il motore scelto.
 * - `nostro`: profilo T-SQL dell'app (formattatore interno);
 * - `sql-formatter`: libreria esterna in dialetto T-SQL, con maiuscole delle parole chiave e
 *   larghezza di tab allineate al profilo dell'app.
 */
export function formattaConMotore(testo: string, motore: MotoreFormattazione, profile: FormatProfile): string {
  if (motore === 'sql-formatter') {
    try {
      return formatLibreria(testo, {
        language: 'tsql',
        keywordCase: profile.keywordUpper ? 'upper' : 'preserve',
        tabWidth: profile.tabSize || 2,
        linesBetweenQueries: 1,
      })
    } catch {
      // SQL che la libreria non sa leggere: si usa il motore nostro (nessuna formattazione persa)
      return formatSqlWithProfile(testo, profile)
    }
  }
  return formatSqlWithProfile(testo, profile)
}
