// CTRL+U = MAIUSCOLO della selezione (richiesta utente: "mi fai anche il comando ctrl+U per rendere
// maiuscolo la selezione?").
//
// Il comando usa l'azione NATIVA di Monaco `editor.action.transformToUppercase`, che gestisce sia
// le selezioni (anche multiple, con più cursori) sia il caso "niente selezione" (parola sotto il
// cursore). Qui si blinda il COLLEGAMENTO della scorciatoia nel sorgente dell'editor: se qualcuno
// toglie o cambia i tasti, il test lo dice. La prova "vera" (tasti premuti nell'editor) è nel
// browser, con `--verify-maiuscolo`.
import { describe, expect, it } from 'vitest'
import source from '../components/SqlEditor.tsx?raw'
import { HELP_SEARCHABLE } from '../helpContent'

/** Il blocco di codice che collega le scorciatoie di maiuscolo/minuscolo. */
const blocco = (() => {
  const i = source.indexOf('editor.action.transformToUppercase')
  return i < 0 ? '' : source.slice(Math.max(0, i - 900), i + 1200)
})()

describe('Ctrl+U (maiuscolo) nell editor', () => {
  it('usa le azioni native di Monaco per maiuscolo e minuscolo', () => {
    expect(source).toContain('editor.action.transformToUppercase')
    expect(source).toContain('editor.action.transformToLowercase')
  })

  it('Ctrl+U è collegato al maiuscolo', () => {
    expect(blocco).toMatch(/KeyMod\.CtrlCmd \| monaco\.KeyCode\.KeyU,\s*maiuscolo/)
  })

  it('ci sono anche le scorciatoie di SSMS: Ctrl+Shift+U (maiuscolo) e Ctrl+Shift+L (minuscolo)', () => {
    expect(blocco).toMatch(/KeyMod\.CtrlCmd \| monaco\.KeyMod\.Shift \| monaco\.KeyCode\.KeyU,\s*maiuscolo/)
    expect(blocco).toMatch(/KeyMod\.CtrlCmd \| monaco\.KeyMod\.Shift \| monaco\.KeyCode\.KeyL,\s*minuscolo/)
  })

  it('la scorciatoia è scritta nella guida (Scorciatoie da tastiera)', () => {
    expect(HELP_SEARCHABLE.some(t => /Ctrl\+U/.test(t))).toBe(true)
  })
})
