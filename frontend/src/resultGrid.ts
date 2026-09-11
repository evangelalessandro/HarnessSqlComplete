// GRIGLIA RISULTATI: funzioni pure per il foglio dati.
// Stanno qui (e non dentro al componente) per poter essere testate: riordino delle colonne
// con il trascinamento e righe alternate a gruppi di tre.

/**
 * Classi di sfondo delle righe alternate: TRE colori che si ripetono (riga 1, 2, 3, 1, 2, 3…).
 * Sono volutamente OPACHE: le prime celle della riga (numero e casella di selezione)
 * restano fisse mentre si scorre in orizzontale, quindi devono coprire ciò che passa sotto.
 */
export const ZEBRA_CLASSES = ['bg-zinc-950', 'bg-[#151519]', 'bg-[#1e1e23]'] as const

/** Sfondo della riga selezionata (opaco, come le fasce alternate). */
export const SELECTED_ROW_CLASS = 'bg-sky-950'

/** Sfondo della riga: la selezione ha la precedenza, altrimenti fascia alternata a 3. */
export function rowBackgroundClass(rowIndex: number, selected: boolean): string {
  if (selected) return SELECTED_ROW_CLASS
  const i = rowIndex % ZEBRA_CLASSES.length
  return ZEBRA_CLASSES[i < 0 ? i + ZEBRA_CLASSES.length : i]
}

/**
 * Sposta una colonna nell'ordine di visualizzazione.
 * `order` contiene gli INDICI ORIGINALI delle colonne nell'ordine in cui sono mostrate;
 * `from`/`to` sono indici originali. La colonna trascinata prende il posto di quella su cui
 * viene rilasciata: trascinandola verso destra finisce dopo, verso sinistra finisce prima
 * (è il comportamento che ci si aspetta dal trascinamento).
 * Indici non presenti o uguali → ordine invariato (copia).
 */
export function reorderColumns(order: readonly number[], from: number, to: number): number[] {
  const i = order.indexOf(from)
  const j = order.indexOf(to)
  if (i === -1 || j === -1 || i === j) return [...order]
  const next = [...order]
  next.splice(i, 1)
  next.splice(j, 0, from)
  return next
}

/** Ordine iniziale (identità): 0,1,2,… per il numero di colonne indicate. */
export function identityOrder(columnCount: number): number[] {
  return Array.from({ length: Math.max(0, columnCount) }, (_, i) => i)
}
