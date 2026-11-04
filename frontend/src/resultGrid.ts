// GRIGLIA RISULTATI: funzioni pure per il foglio dati.
// Stanno qui (e non dentro al componente) per poter essere testate: riordino delle colonne
// con il trascinamento e righe alternate a gruppi di tre.

/**
 * Classi di sfondo delle righe alternate: TRE colori che si ripetono (riga 1, 2, 3, 1, 2, 3…).
 * Sono volutamente OPACHE: le prime celle della riga (numero e casella di selezione)
 * restano fisse mentre si scorre in orizzontale, quindi devono coprire ciò che passa sotto.
 * La differenza fra i tre toni deve RESTARE VISIBILE: con due soli toni molto vicini
 * (zinc-950 e zinc-900 al 50%) le fasce non si distinguevano.
 *
 * I COLORI stanno in index.css (`.sql-zebra-*`) e non qui: così seguono il TEMA chiaro/scuro.
 * Prima erano valori espliciti (`bg-[#17171b]`) e cambiando tema le righe restavano scure.
 */
export const ZEBRA_CLASSES = ['sql-zebra-0', 'sql-zebra-1', 'sql-zebra-2'] as const

/** Sfondo della riga selezionata (opaco, come le fasce alternate e come loro legato al tema). */
export const SELECTED_ROW_CLASS = 'sql-row-selected'

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

/**
 * SELEZIONE DELLE RIGHE DELLA GRIGLIA (richiesta utente: "posso selezionare una o più righe della
 * griglia e avere un colore in evidenza per capire che l'ho selezionata").
 *
 * Tre modi, come nei fogli di calcolo:
 *  - 'sostituisci' (clic semplice): resta selezionata solo quella riga; se era GIÀ l'unica selezionata
 *    si deseleziona (così un secondo clic la toglie, senza dover cercare il pulsante);
 *  - 'aggiungi' (Ctrl/Cmd+clic): aggiunge o toglie la riga;
 *  - 'intervallo' (Maiusc+clic): dalla riga dell'ultimo clic (`ancora`) fino a quella cliccata.
 * Restituisce la nuova selezione e la nuova ancora, senza mutare quella in ingresso.
 */
export type ModoSelezioneRighe = 'sostituisci' | 'aggiungi' | 'intervallo'

export interface SelezioneRighe {
  righe: Set<number>
  ancora: number | null
}

/** Crea una selezione vuota. */
export function selezioneVuota(): SelezioneRighe {
  return { righe: new Set<number>(), ancora: null }
}

export function aggiornaSelezioneRighe(
  corrente: SelezioneRighe,
  indice: number,
  modo: ModoSelezioneRighe,
): SelezioneRighe {
  const righe = new Set(corrente.righe)
  if (modo === 'aggiungi') {
    if (righe.has(indice)) {
      righe.delete(indice)
      return { righe, ancora: indice }
    }
    righe.add(indice)
    return { righe, ancora: indice }
  }
  if (modo === 'intervallo') {
    const da = corrente.ancora ?? indice
    const inizio = Math.min(da, indice)
    const fine = Math.max(da, indice)
    for (let i = inizio; i <= fine; i++) righe.add(i)
    return { righe, ancora: corrente.ancora ?? indice }
  }
  // 'sostituisci'
  const soloQuesta = righe.size === 1 && righe.has(indice)
  return soloQuesta ? { righe: new Set<number>(), ancora: null } : { righe: new Set([indice]), ancora: indice }
}

/** True se il clic va trattato come "aggiungi" (Ctrl o Cmd) o "intervallo" (Maiusc). */
export function modoSelezioneDaEvento(e: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): ModoSelezioneRighe {
  if (e.shiftKey) return 'intervallo'
  if (e.ctrlKey || e.metaKey) return 'aggiungi'
  return 'sostituisci'
}
