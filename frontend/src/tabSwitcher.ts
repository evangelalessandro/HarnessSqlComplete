// Logica dello switcher delle tab (stile Alt+Tab di Windows): ordine MRU e avanzamento della selezione.
//
// Separata da App.tsx per essere testabile: la navigazione fra tab è una cosa che si rompe facilmente e
// vogliamo i test (richiesta utente: "al primo mi apre la penultima toccata, e se lo rifaccio mi apre
// quella che da qui provenivo").

/** Tab in ordine di ULTIMO USO: prima quelle della cronologia, poi le altre (mai usate) nell'ordine dato. */
export function ordineMru(tabIds: string[], mru: string[]): string[] {
  const vive = new Set(tabIds)
  const ordine = mru.filter(id => vive.has(id))
  for (const id of tabIds) if (!ordine.includes(id)) ordine.push(id)
  return ordine
}

/**
 * Indice da selezionare nella lista.
 * Con la lista CHIUSA (sel === null) si parte dalla PENULTIMA tab toccata (indice 1): è quello che fa
 * Alt+Tab. Se si va indietro si parte dall'ultima. Con la lista aperta si scorre di uno (in modo circolare).
 */
export function prossimaSelezione(numeroTab: number, sel: number | null, indietro: boolean): number {
  if (numeroTab <= 0) return 0
  if (sel === null) {
    if (numeroTab === 1) return 0
    return indietro ? numeroTab - 1 : 1
  }
  const passo = indietro ? -1 : 1
  return (sel + passo + numeroTab) % numeroTab
}
