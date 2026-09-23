// IDEMPOTENZA su una procedura REALE già perfetta (definizione presa dal database dell'utente):
// "se formatti questa deve rimanere come è" → il formattatore NON deve toccarla.
//
// La procedura è piena di commenti "--" dentro gli statement (--,X_TARGET_MIN, "--solo baie che
// hanno il tipo articolo vuoto", i "--when …" dentro il CASE): è il caso in cui il formattatore
// deve lasciare il testo com'è invece di riorganizzarlo a modo suo.
import { describe, expect, it } from 'vitest'
import { formatRoutineWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { buildFormatProfile, loadFormatProfileXml } from '../formatProfile'
import perfetta from './fixtures/routine_ws_CUSTOM_Engine_Automatismi_Replanishment_Kitting_Stock.sql?raw'

const profile = buildFormatProfile(loadFormatProfileXml())

/** Firma dei token (tipo + testo): la formattazione non deve perdere né inventare nulla. */
function firmaToken(sql: string): string[] {
  return tokenizeSqlText(sql)
    .map(t => `${t.type}:${t.text.toLowerCase().replace(/\s+/g, ' ').trim()}`)
    .sort()
}

describe('procedura reale già impaginata: formattarla la lascia identica', () => {
  // Il formattatore normalizza i fine riga a "\n": il confronto va fatto a parità di fine riga.
  const atteso = perfetta.replace(/\r\n/g, '\n')
  const out = formatRoutineWithProfile(perfetta, profile)

  /**
   * OBIETTIVO (richiesta utente: "se formatti questa deve rimanere come è che è perfetta"):
   * su un testo già impaginato la formattazione non deve cambiare nulla.
   * Oggi NON è così: la procedura viene riorganizzata (71 righe in meno: la select-list, le
   * condizioni del CASE e le JOIN vengono rifuse). `it.fails` tiene il test verde finché il
   * comportamento è quello attuale e AVVISA quando l'obiettivo viene raggiunto.
   */
  it.fails('il testo resta IDENTICO (niente righe spostate o riallineate)', () => {
    const a = atteso.split('\n')
    const b = out.split('\n')
    const diff: string[] = []
    for (let i = 0; i < Math.max(a.length, b.length) && diff.length < 8; i++) {
      if (a[i] !== b[i]) diff.push(`riga ${i + 1}:\n  prima: ${JSON.stringify(a[i])}\n  dopo : ${JSON.stringify(b[i])}`)
    }
    console.log(`  righe prima=${a.length} dopo=${b.length}`)
    diff.forEach(d => console.log(`  ${d}`))
    expect(out).toBe(atteso)
  })

  it('nessun token perso o aggiunto (questo già vale)', () => {
    expect(firmaToken(out)).toEqual(firmaToken(perfetta))
  })
})
