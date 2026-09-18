// @vitest-environment node
// Guardia sul tasto destro nell'editor, sulle routine (nome di una stored procedure o
// funzione sotto il cursore).
//
// Storia: l'utente aveva segnalato DUE voci che facevano quasi la stessa cosa, con due
// layout diversi (una incollava "CREATE OR ALTER" subito dopo il commento). Ora le voci
// sono due ma con compiti DIVERSI: "Modifica" (CREATE OR ALTER) e "Diagramma chiamate".
// Questo test blocca il ritorno della voce duplicata (la definizione grezza) e controlla
// che entrambe restino limitate alle routine.
import { describe, expect, it } from 'vitest'
import source from '../components/SqlEditor.tsx?raw'
import appSource from '../App.tsx?raw'

describe('menu contestuale editor: voci sulle routine', () => {
  it('le azioni sono esattamente due: modifica e diagramma chiamate', () => {
    const ids = [...source.matchAll(/id: '(sql-intelli-callable-[a-z-]+)'/g)].map(m => m[1])
    expect(ids).toEqual(['sql-intelli-callable-modify', 'sql-intelli-callable-callgraph'])
    // la vecchia voce duplicata ("Apri definizione") non deve tornare
    expect(source).not.toContain('sql-intelli-callable-open-definition')
  })

  it('la voce di modifica apre la routine in CREATE OR ALTER, non la definizione grezza', () => {
    // la chiamata deve passare 'alter': 'open' resterebbe con il CREATE originale
    expect(source).toMatch(/onOpenObject\?\.\(ref\.kind, ref\.schema, ref\.name, 'alter'\)/)
    expect(source).not.toMatch(/onOpenObject\?\.\(ref\.kind, ref\.schema, ref\.name, 'open'\)/)
    // l'helper non deve più accettare la modalità: apre solo in modifica
    expect(source).not.toMatch(/openCallableUnderCursor\(\s*['"]open['"]/)
  })

  it('la voce del diagramma passa la routine al gestore del diagramma', () => {
    expect(source).toMatch(/onShowCallGraph\?\.\(ref\.kind, ref\.schema, ref\.name\)/)
    expect(source).toContain("label: 'Diagramma chiamate (chi la chiama)'")
  })

  it('ENTRAMBE le voci compaiono solo su stored procedure e funzioni (mai su tabelle o campi)', () => {
    // ogni azione sulle routine ha la stessa condizione di visibilità
    const preconditions = [...source.matchAll(/precondition: '([^']+)'/g)].map(m => m[1])
    expect(preconditions).toEqual(['editorTextFocus && sqlIntelliOnCallable', 'editorTextFocus && sqlIntelliOnCallable'])
    // la visibilità è legata alla context key, non solo al controllo dentro run()
    expect(source).toContain("createContextKey<boolean>('sqlIntelliOnCallable'")
    // la chiave si aggiorna spostando il cursore, digitando e quando arriva lo schema
    expect(source).toContain('editor.onDidChangeCursorPosition(syncCallableContext)')
    expect(source).toContain('editor.onDidChangeModelContent(syncCallableContext)')
    expect(source).toContain('syncCallableContextRef.current()')
    // e la decisione passa dalla funzione che esclude tabelle e campi
    expect(source).toContain('isCallableAt(')
  })

  it('il collegamento è completo: editor → App → TAB del diagramma', () => {
    // l'editor riceve il gestore e lo chiama con la routine riconosciuta
    expect(source).toContain('onShowCallGraph?.(ref.kind, ref.schema, ref.name)')
    // App lo collega al caricamento del grafo (adattando l'ordine degli argomenti)
    expect(appSource).toContain('onShowCallGraph={(kind, schema, name) => openCallGraph(schema, name, kind)}')
    // il diagramma vive in una TAB (una per routine), non in una finestra modale
    expect(appSource).toContain("kind: 'graph'")
    expect(appSource).toMatch(/<CallGraphPanel/)
    expect(appSource).not.toContain('CallGraphModal')
  })
})
