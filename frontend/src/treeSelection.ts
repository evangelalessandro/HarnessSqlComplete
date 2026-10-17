// SELEZIONE DELLE VOCI DELL'ALBERO LATERALE.
//
// Richiesta utente: "rendi le voci della treeview selezionabili, adesso non si capisce cosa è
// selezionato". Ogni riga dell'albero (database, schema, tabella, colonna, indice, vincolo,
// trigger, vista, procedura, funzione, sezione) dichiara una CHIAVE stabile in `data-nodo`; il
// contenitore del pannello registra il clic (e il tasto destro) e tiene la riga evidenziata con la
// classe `.nodo-attivo` (vedi index.css), così la selezione resta visibile anche quando il
// puntatore va altrove o si lavora nell'editor.

export type TipoNodo =
  | 'db'
  | 'sezione'
  | 'schema'
  | 'gruppo'
  | 'tabella'
  | 'colonna'
  | 'indice'
  | 'vincolo'
  | 'check'
  | 'trigger'
  | 'vista'
  | 'procedura'
  | 'funzione'

/**
 * Chiave stabile di una voce dell'albero: `tipo:parte:parte…` (le parti vuote si saltano).
 * Esempi: `tabella:dbo.DAT_UDC`, `colonna:dbo.DAT_UDC:UDC_UDC`, `indice:dbo.DAT_UDC:IX_UDC`.
 * Non cambia con l'ordinamento né con la ricerca: la selezione sopravvive a espansioni e filtri.
 */
export function chiaveNodo(tipo: TipoNodo, ...parti: (string | undefined | null)[]): string {
  const pulite = parti.filter((p): p is string => typeof p === 'string' && p.trim() !== '').map(p => p.trim())
  return [tipo, ...pulite].join(':')
}

/** La classe che evidenzia la riga selezionata (definita in index.css). */
export const CLASSE_NODO_ATTIVO = 'nodo-attivo'

/**
 * Attributi da mettere su una riga dell'albero: `data-nodo` (per la selezione delegata) e, quando
 * la riga È quella selezionata, la classe dell'evidenziazione. Serve dove la classe va calcolata in
 * fase di render; quando le righe sono tante si usa la sincronizzazione nel DOM (vedi Sidebar).
 */
export function attributiNodo(chiave: string, selezionata: boolean, classeBase = ''): {
  'data-nodo': string
  className: string
} {
  return {
    'data-nodo': chiave,
    className: [classeBase, selezionata ? CLASSE_NODO_ATTIVO : ''].filter(Boolean).join(' '),
  }
}
