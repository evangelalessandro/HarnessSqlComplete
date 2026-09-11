// @vitest-environment node
// GUARDIA SULLA CODIFICA DEI SORGENTI.
//
// Bug segnalato: nell'intellisense e nei commenti si leggeva la sequenza rotta (a-circumflex
// + euro + virgoletta tipografica) al posto del trattino lungo "—", e "Ã¨" al posto di "è".
// Causa: testo convertito due volte (byte UTF-8 riletti come Windows-1252). Era diffuso in
// 3 file (App.tsx, SqlEditor.tsx, sqlCompletions.ts): 148 punti.
//
// Questo test rilegge TUTTI i sorgenti e fallisce se ricompare una sequenza doppiamente
// codificata. I caratteri spia (Â Ã â ð) non sono mai legittimi in italiano, quindi il
// controllo non dà falsi allarmi; le lettere accentate vere (à è é ì ò ù) non sono toccate.
import { describe, expect, it } from 'vitest'

/** Sorgenti letti come testo grezzo (Vite li fornisce già decodificati in UTF-8). */
const sources = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Sequenze tipiche della doppia codifica: non esistono nell'italiano corretto. */
const MOJIBAKE = [
  { name: 'Â (byte C2 riletto)', re: /\u00C2/ },
  { name: 'Ã (byte C3 riletto)', re: /\u00C3/ },
  { name: 'â (byte E2 riletto)', re: /\u00E2/ },
  { name: 'ð (byte F0 riletto)', re: /\u00F0/ },
  { name: 'selettore di variante rotto', re: /\u00EF\u00B8/ },
  { name: 'trattino lungo rotto', re: /\u00E2\u20AC\u201D/ },
  { name: 'puntini di sospensione rotti', re: /\u00E2\u20AC\u00A6/ },
]

/** Le poche righe di questo file che devono nominare le sequenze rotte. */
const SELF = 'encoding.test.ts'

describe('codifica dei sorgenti: nessun carattere doppiamente codificato', () => {
  it('legge i sorgenti del progetto', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(30)
    expect(Object.keys(sources).some(p => p.includes('App.tsx'))).toBe(true)
  })

  it('nessun sorgente contiene sequenze rotte', () => {
    const problems: string[] = []
    for (const [path, text] of Object.entries(sources)) {
      if (path.includes(SELF)) continue
      for (const { name, re } of MOJIBAKE) {
        if (re.test(text)) problems.push(`${path.replace('../', 'src/')}: ${name}`)
      }
    }
    expect(problems, `sorgenti con caratteri rotti:\n${problems.join('\n')}`).toEqual([])
  })

  it('la sequenza rotta che si vedeva nell intellisense non c è più', () => {
    const completions = sources['../sqlCompletions.ts'] ?? ''
    expect(completions).not.toBe('')
    expect(completions).not.toMatch(/\u00E2\u20AC/)
    // le etichette delle voci "tutte le colonne / parametri / campi / valori" sono corrette
    expect(completions).toContain('— tutte le colonne —')
    expect(completions).toContain('— tutti i parametri —')
  })

  it('il modello di query iniziale ha i commenti leggibili', () => {
    const editor = sources['../components/SqlEditor.tsx'] ?? ''
    expect(editor).not.toBe('')
    expect(editor).toContain('-- Nuova query — modello transazione sicura')
  })

  it('le lettere accentate italiane sono scritte per intero (non spezzate)', () => {
    // controllo di sanità: i file contengono accenti veri, che NON vanno toccati
    const all = Object.entries(sources)
      .filter(([p]) => !p.includes(SELF))
      .map(([, t]) => t)
      .join('\n')
    expect(all).toMatch(/[àèéìòù]/)
  })
})
