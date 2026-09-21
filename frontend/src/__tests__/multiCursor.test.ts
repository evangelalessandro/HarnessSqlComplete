// CTRL+ALT+SU/GIÙ = aggiungi cursore sopra/sotto (mai copiare la riga).
// Segnalazione utente: "con ctrl+alt+giù si sta copiando la riga corrente, ma è sbagliato".
// La combinazione viene riconosciuta dall'evento e gestita direttamente dall'app.
import { describe, expect, it } from 'vitest'
import source from '../components/SqlEditor.tsx?raw'
import { azioneCursore, cursoreDaAggiungere } from '../multiCursor'

describe('cursoreDaAggiungere: Ctrl+Alt+Su/Giù', () => {
  it('Giù → cursore sotto, Su → cursore sopra', () => {
    expect(cursoreDaAggiungere({ code: 'ArrowDown', ctrlKey: true, altKey: true })).toBe('sotto')
    expect(cursoreDaAggiungere({ code: 'ArrowUp', ctrlKey: true, altKey: true })).toBe('sopra')
  })

  it('accetta anche "Down"/"Up" e la forma senza code (key)', () => {
    expect(cursoreDaAggiungere({ code: 'Down', ctrlKey: true, altKey: true })).toBe('sotto')
    expect(cursoreDaAggiungere({ key: 'ArrowDown', ctrlKey: true, altKey: true })).toBe('sotto')
    expect(cursoreDaAggiungere({ key: 'Up', ctrlKey: true, altKey: true })).toBe('sopra')
  })

  it('con Shift premuto (variante Linux) fa la stessa cosa', () => {
    expect(cursoreDaAggiungere({ code: 'ArrowDown', ctrlKey: true, altKey: true, shiftKey: true })).toBe('sotto')
  })

  it('su Mac vale anche con Cmd (meta)', () => {
    expect(cursoreDaAggiungere({ code: 'ArrowDown', metaKey: true, altKey: true })).toBe('sotto')
  })

  it('senza Ctrl (o senza Alt) NON è la nostra combinazione', () => {
    // Alt+Giù = sposta riga, Shift+Alt+Giù = copia riga: restano a Monaco
    expect(cursoreDaAggiungere({ code: 'ArrowDown', altKey: true })).toBeNull()
    expect(cursoreDaAggiungere({ code: 'ArrowDown', altKey: true, shiftKey: true })).toBeNull()
    expect(cursoreDaAggiungere({ code: 'ArrowDown', ctrlKey: true })).toBeNull()
  })

  it('con altre frecce o altri tasti non fa nulla', () => {
    expect(cursoreDaAggiungere({ code: 'ArrowLeft', ctrlKey: true, altKey: true })).toBeNull()
    expect(cursoreDaAggiungere({ code: 'KeyC', ctrlKey: true, altKey: true })).toBeNull()
    expect(cursoreDaAggiungere({})).toBeNull()
  })

  // Segnalazione utente: "ctrl+alt+giù non va in modalità multi cursore". Con AltGr il browser può
  // consegnare l'evento in modi diversi (senza key/code, oppure con il solo altGraph): vanno
  // riconosciuti tutti.
  it('AltGr: riconosciuto anche senza key/code (solo keyCode) e con il solo altGraph', () => {
    expect(cursoreDaAggiungere({ code: 'ArrowDown', keyCode: 229, ctrlKey: true, altKey: true, altGraph: true })).toBe('sotto')
    // key/code assenti (browser che li omette) → si usa il codice del tasto
    expect(cursoreDaAggiungere({ keyCode: 40, ctrlKey: true, altKey: true })).toBe('sotto')
    expect(cursoreDaAggiungere({ which: 38, ctrlKey: true, altKey: true })).toBe('sopra')
    // AltGr riportato SOLO come altGraph (senza altKey)
    expect(cursoreDaAggiungere({ code: 'ArrowDown', altGraph: true })).toBe('sotto')
    expect(cursoreDaAggiungere({ code: 'ArrowUp', altGraph: true })).toBe('sopra')
  })

  it('PageUp/PageDown non contano, e senza modificatori nemmeno le frecce', () => {
    expect(cursoreDaAggiungere({ code: 'ArrowDown' })).toBeNull()
    expect(cursoreDaAggiungere({ code: 'ArrowDown', keyCode: 40 })).toBeNull()
  })
})

describe('azioneCursore', () => {
  it('mappa le direzioni sulle azioni di Monaco', () => {
    expect(azioneCursore('sotto')).toBe('editor.action.insertCursorBelow')
    expect(azioneCursore('sopra')).toBe('editor.action.insertCursorAbove')
  })
})

describe('collegamento nell\'editor', () => {
  it('la combinazione è intercettata in fase di cattura, prima di Monaco', () => {
    expect(source).toContain("addEventListener('keydown', onTasti, true)")
    expect(source).toContain('cursoreDaAggiungere({')
    // AltGr si legge con getModifierState: non è una proprietà dell'evento
    expect(source).toContain("getModifierState?.('AltGraph')")
    expect(source).toContain('azioneCursore(direzione)')
    // e la copia riga NON deve essere assegnata a Ctrl+Alt+Giù
    expect(source).not.toContain('copyLinesDownAction')
  })

  it('c\'è anche il comando dell\'editor e la voce nel tasto destro (se la tastiera non arriva)', () => {
    expect(source).toContain('sqlIntelliMultiCursor')
    expect(source).toContain("'sql-intelli-cursore-sotto'")
    expect(source).toContain("'sql-intelli-cursore-sopra'")
    expect(source).toContain("editor.getAction(id)")
  })
})
