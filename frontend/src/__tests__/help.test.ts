import { describe, expect, it } from 'vitest'
import { HELP_SEARCHABLE, HELP_SECTIONS } from '../helpContent'
/**
 * La guida deve documentare TUTTE le funzioni dell'app.
 * Questo test verifica che il contenuto copra le sezioni e i termini chiave,
 * così ogni nuova funzione va aggiunta anche alla guida.
 */
describe('HelpPage: la guida copre tutte le funzioni', () => {
  const allText = HELP_SEARCHABLE.join(' ')

  const required = [
    // Funzioni principali
    'Login',
    'Cambio database',
    'Colori per database',
    'Multi-tab',
    'Esegui query',
    'GO',
    'PRINT',
    'File SQL',
    'Zoom e tema',
    'Formatta',
    'formatprofile.xml',
    'Struttura stile SSMS',
    'Tasto destro',
    'Seleziona le prime 1000 righe',
    'Script CREATE',
    'Script MERGE',
    'Cerca',
    'Contesti intelligenti',
    'Affinità mentre digiti',
    'mis_corr',
    'JOIN intelligenti',
    'Controparti',
    'cel_cella',
    'Snippet statement',
    'EXEC',
    'INSERT',
    'Cronologia',
    'Diagnostica in tempo reale',
    'Autocompletamento IA',
    'Griglia risultati',
    'Stampa',
    'Anteprima tabelle',
    'F5',
    'Ctrl+Invio',
    'Ctrl+S',
    'Ctrl+Shift+S',
    'Ctrl+Shift+F',
    'Ctrl+rotella',
    'Ctrl+Spazio',
  ]

  for (const term of required) {
    it(`documenta "${term}"`, () => {
      expect(allText).toContain(term)
    })
  }

  it('ha 6 sezioni con contenuti', () => {
    expect(HELP_SECTIONS.map(s => s.title)).toEqual([
      'Connessione al database',
      'Editor SQL',
      'Sidebar (albero oggetti)',
      'Intellisense e autocompletamento',
      'Risultati e anteprime',
      'Scorciatoie da tastiera',
    ])
    for (const s of HELP_SECTIONS) expect(s.items.length).toBeGreaterThan(0)
  })

  it('ogni sezione ha id univoco e titolo', () => {
    const ids = HELP_SECTIONS.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('la ricerca copre tutte le voci', () => {
    const total = HELP_SECTIONS.reduce((acc, s) => acc + s.items.length, 0)
    expect(HELP_SEARCHABLE.length).toBe(total)
  })
})
