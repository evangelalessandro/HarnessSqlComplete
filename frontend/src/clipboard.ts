// COPIA NEGLI APPUNTI con ripiego: l'API navigator.clipboard non è disponibile ovunque (contesti non
// sicuri, permessi negati, browser vecchi). Qui si prova prima l'API moderna e poi il vecchio
// "textarea + execCommand", così il tasto destro → Copia funziona sempre.
//
// Serve alla griglia dei risultati: una cella con tanto testo è troncata a video, e copiarla era
// impossibile (richiesta utente: "non riesco a copiarlo dalla griglia dei risultati, perché è
// tagliato. Mi dai un modo per copiarlo? qualcosa come tasto destro sulla cella e copia?").

/** Copia un testo negli appunti. Restituisce true se ci è riuscito. */
export async function copiaTesto(testo: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(testo)
      return true
    }
  } catch {
    /* si prova col ripiego */
  }
  try {
    if (typeof document === 'undefined') return false
    const area = document.createElement('textarea')
    area.value = testo
    area.setAttribute('readonly', '')
    // fuori dallo schermo ma ancora "visibile" per il browser (display:none non funziona)
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/** Valore di una cella come testo (null/undefined → stringa vuota per la copia). */
export function testoPerCopia(valore: unknown): string {
  if (valore === null || valore === undefined) return ''
  if (typeof valore === 'boolean') return valore ? '1' : '0'
  if (typeof valore === 'object') return JSON.stringify(valore)
  return String(valore)
}

/** Riga come testo separato da TAB (si incolla in Excel così), con NULL come stringa vuota. */
export function rigaPerCopia(valori: unknown[]): string {
  return valori.map(testoPerCopia).join('\t')
}
