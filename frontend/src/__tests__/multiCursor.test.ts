// MAIUSC+ALT+SU/GIÙ = aggiungi cursore sopra/sotto (mai copiare la riga).
// Richiesta utente: "deve funzionare con il maius + alt e non CTRL + Alt" (su Windows Ctrl+Alt è
// AltGr, che produce caratteri accentati e in Monaco è già la combinazione predefinita).
// La combinazione viene riconosciuta dall'evento e gestita direttamente dall'app.
import { describe, expect, it } from 'vitest'
import source from '../components/SqlEditor.tsx?raw'
import { azioneCursore, cursoreDaAggiungere, cursoreDaNeutralizzare, selezioneVerticale } from '../multiCursor'

describe('cursoreDaAggiungere: Maiusc+Alt+Su/Giù', () => {
  it('Giù → cursore sotto, Su → cursore sopra', () => {
    expect(cursoreDaAggiungere({ code: 'ArrowDown', shiftKey: true, altKey: true })).toBe('sotto')
    expect(cursoreDaAggiungere({ code: 'ArrowUp', shiftKey: true, altKey: true })).toBe('sopra')
  })

  it('accetta anche "Down"/"Up" e la forma senza code (key)', () => {
    expect(cursoreDaAggiungere({ code: 'Down', shiftKey: true, altKey: true })).toBe('sotto')
    expect(cursoreDaAggiungere({ key: 'ArrowDown', shiftKey: true, altKey: true })).toBe('sotto')
    expect(cursoreDaAggiungere({ key: 'Up', shiftKey: true, altKey: true })).toBe('sopra')
  })

  it('senza Maiusc (o senza Alt) NON è la nostra combinazione', () => {
    // Alt+Giù = sposta riga, Alt+clic = cursore col mouse, Shift+Giù = selezione: restano a Monaco
    expect(cursoreDaAggiungere({ code: 'ArrowDown', altKey: true })).toBeNull()
    expect(cursoreDaAggiungere({ code: 'ArrowDown', shiftKey: true })).toBeNull()
    expect(cursoreDaAggiungere({ code: 'ArrowDown', ctrlKey: true, shiftKey: true })).toBeNull()
  })

  it('Ctrl+Alt (e AltGr, che su Windows è Ctrl+Alt) NON aggiunge più cursori', () => {
    expect(cursoreDaAggiungere({ code: 'ArrowDown', ctrlKey: true, altKey: true })).toBeNull()
    expect(cursoreDaAggiungere({ code: 'ArrowUp', ctrlKey: true, altKey: true })).toBeNull()
    // Ctrl+Alt+Shift non conta: il Ctrl è quello che rifiutiamo
    expect(cursoreDaAggiungere({ code: 'ArrowDown', ctrlKey: true, altKey: true, shiftKey: true })).toBeNull()
    // AltGr riportato SOLO come altGraph (senza altKey) o insieme a ctrl/alt
    expect(cursoreDaAggiungere({ code: 'ArrowDown', shiftKey: true, altGraph: true })).toBeNull()
    expect(cursoreDaAggiungere({ code: 'ArrowDown', shiftKey: true, altKey: true, altGraph: true })).toBeNull()
  })

  it('cursoreDaNeutralizzare: la vecchia combinazione va spenta, non solo ignorata', () => {
    // Ctrl+Alt+freccia (anche con Shift, anche con AltGr): in Monaco è la combinazione predefinita
    // dei cursori, quindi l'evento va annullato o continuerebbe ad aggiungerli.
    expect(cursoreDaNeutralizzare({ code: 'ArrowDown', ctrlKey: true, altKey: true })).toBe(true)
    expect(cursoreDaNeutralizzare({ code: 'ArrowUp', ctrlKey: true, altKey: true })).toBe(true)
    expect(cursoreDaNeutralizzare({ code: 'ArrowDown', ctrlKey: true, altKey: true, shiftKey: true })).toBe(true)
    expect(cursoreDaNeutralizzare({ keyCode: 40, ctrlKey: true, altKey: true, altGraph: true })).toBe(true)
    expect(cursoreDaNeutralizzare({ code: 'ArrowDown', metaKey: true, altKey: true })).toBe(true)
    // la nostra combinazione NON va neutralizzata
    expect(cursoreDaNeutralizzare({ code: 'ArrowDown', shiftKey: true, altKey: true })).toBe(false)
    // e nemmeno tasti che non sono frecce o combinazioni diverse
    expect(cursoreDaNeutralizzare({ code: 'ArrowLeft', ctrlKey: true, altKey: true })).toBe(false)
    expect(cursoreDaNeutralizzare({ code: 'ArrowDown', altKey: true })).toBe(false)
    expect(cursoreDaNeutralizzare({ code: 'ArrowDown', ctrlKey: true })).toBe(false)
  })

  it('su Mac vale anche col Cmd (meta) in più', () => {
    expect(cursoreDaAggiungere({ code: 'ArrowDown', metaKey: true, shiftKey: true, altKey: true })).toBe('sotto')
  })

  it('con altre frecce o altri tasti non fa nulla', () => {
    expect(cursoreDaAggiungere({ code: 'ArrowLeft', shiftKey: true, altKey: true })).toBeNull()
    expect(cursoreDaAggiungere({ code: 'KeyC', shiftKey: true, altKey: true })).toBeNull()
    expect(cursoreDaAggiungere({})).toBeNull()
  })

  // Con alcune tastiere il browser non riporta key/code: la combinazione va riconosciuta dal codice
  // del tasto, altrimenti sembrerebbe non premuta.
  it('riconosce la combinazione anche con il solo keyCode (senza key/code)', () => {
    expect(cursoreDaAggiungere({ keyCode: 40, shiftKey: true, altKey: true })).toBe('sotto')
    expect(cursoreDaAggiungere({ which: 38, shiftKey: true, altKey: true })).toBe('sopra')
    expect(cursoreDaAggiungere({ keyCode: 34, shiftKey: true, altKey: true })).toBe('sotto') // PageDown
    expect(cursoreDaAggiungere({ keyCode: 33, shiftKey: true, altKey: true })).toBe('sopra') // PageUp
  })

  it('PageUp/PageDown senza modificatori non contano, e senza modificatori nemmeno le frecce', () => {
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
    expect(source).toContain('cursoreDaAggiungere(tasto)')
    expect(source).toContain('azioneCursore(direzione)')
    // la copia riga NON deve essere assegnata alla combinazione dei cursori
    expect(source).not.toContain('copyLinesDownAction')
  })

  it('il comando dell\'editor è legato a Maiusc+Alt e Ctrl+Alt è neutralizzato', () => {
    expect(source).toContain('monaco.KeyMod.Shift | monaco.KeyMod.Alt | freccia')
    // Ctrl+Alt+Su/Giù viene annullato in fase di cattura e registrato con un comando vuoto
    expect(source).toContain('cursoreDaNeutralizzare(tasto)')
    expect(source).toContain('monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | freccia')
    expect(source).toContain('sqlIntelliMultiCursor')
  })

  it('c\'è anche la voce nel tasto destro, con i tasti giusti', () => {
    expect(source).toContain("'sql-intelli-cursore-sotto'")
    expect(source).toContain("'sql-intelli-cursore-sopra'")
    expect(source).toContain('Aggiungi cursore sotto (Maiusc+Alt+Giù)')
    expect(source).toContain('Aggiungi cursore sopra (Maiusc+Alt+Su)')
    expect(source).toContain('editor.getAction(id)')
  })
})

describe('selezioneVerticale: Maiusc+Su/Giù (selezione di testo, anche in modalità a blocchi)', () => {
  it('riconosce Maiusc+Giù e Maiusc+Su', () => {
    expect(selezioneVerticale({ code: 'ArrowDown', key: 'ArrowDown', shiftKey: true })).toBe(1)
    expect(selezioneVerticale({ code: 'ArrowUp', key: 'ArrowUp', shiftKey: true })).toBe(-1)
  })

  it('funziona anche quando la tastiera manda solo keyCode (niente code/key)', () => {
    expect(selezioneVerticale({ keyCode: 40, shiftKey: true })).toBe(1)
    expect(selezioneVerticale({ which: 38, shiftKey: true })).toBe(-1)
  })

  it('NON è la combinazione con Alt (cursore), Ctrl o senza Shift', () => {
    expect(selezioneVerticale({ code: 'ArrowDown', shiftKey: true, altKey: true })).toBe(0)
    expect(selezioneVerticale({ code: 'ArrowDown', shiftKey: true, ctrlKey: true })).toBe(0)
    expect(selezioneVerticale({ code: 'ArrowDown' })).toBe(0)
    expect(selezioneVerticale({ code: 'ArrowDown', shiftKey: true, altGraph: true })).toBe(0)
  })

  it('le frecce orizzontali non c entrano', () => {
    expect(selezioneVerticale({ code: 'ArrowLeft', shiftKey: true })).toBe(0)
    expect(selezioneVerticale({ code: 'ArrowRight', shiftKey: true })).toBe(0)
  })
})

describe('modalità a blocchi: Maiusc+Su/Giù non deve fare una selezione a rettangolo vuota', () => {
  it('l editor intercetta la selezione verticale quando la modalità a blocchi è accesa', () => {
    // controllo sul sorgente: il ramo esiste ed è dentro il blocco "if (blocchiRef.current)"
    expect(source).toContain('selezioneVerticale(tasto)')
    expect(source).toContain('estendiSelezioneVerticale')
    expect(source).toMatch(/if \(blocchiRef\.current\) \{/)
  })
})