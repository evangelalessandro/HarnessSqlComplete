// @vitest-environment node
// Guardia sulla voce "tasto destro su una stored procedure/funzione" dell'editor.
//
// L'utente ha segnalato DUE voci nel menu contestuale che facevano quasi la stessa cosa,
// con due layout diversi (una incollava "CREATE OR ALTER" subito dopo il commento).
// Questo test impedisce che la voce doppia venga reintrodotta: nel sorgente dell'editor
// deve esistere UNA SOLA azione per le routine, ed è quella di modifica (CREATE OR ALTER).
import { describe, expect, it } from 'vitest'
import source from '../components/SqlEditor.tsx?raw'

describe('menu contestuale editor: una sola voce per le routine', () => {
  it('c è una sola azione "callable" registrata', () => {
    const ids = [...source.matchAll(/id: '(sql-intelli-callable-[a-z-]+)'/g)].map(m => m[1])
    expect(ids).toEqual(['sql-intelli-callable-modify'])
  })

  it('la voce apre la routine in modalità modifica (CREATE OR ALTER), non la definizione grezza', () => {
    // la chiamata deve passare 'alter': 'open' resterebbe con il CREATE originale
    expect(source).toMatch(/onOpenObject\?\.\(ref\.kind, ref\.schema, ref\.name, 'alter'\)/)
    expect(source).not.toMatch(/onOpenObject\?\.\(ref\.kind, ref\.schema, ref\.name, 'open'\)/)
    // l'helper non deve più accettare la modalità: apre solo in modifica
    expect(source).not.toMatch(/openCallableUnderCursor\(\s*['"]open['"]/)
  })

  it('la voce compare SOLO su stored procedure e funzioni (mai su tabelle o campi)', () => {
    // la visibilità è legata alla context key, non solo al controllo dentro run()
    expect(source).toContain("precondition: 'editorTextFocus && sqlIntelliOnCallable'")
    expect(source).toContain("createContextKey<boolean>('sqlIntelliOnCallable'")
    // la chiave si aggiorna spostando il cursore, digitando e quando arriva lo schema
    expect(source).toContain('editor.onDidChangeCursorPosition(syncCallableContext)')
    expect(source).toContain('editor.onDidChangeModelContent(syncCallableContext)')
    expect(source).toContain('syncCallableContextRef.current()')
    // e la decisione passa dalla funzione che esclude tabelle e campi
    expect(source).toContain('isCallableAt(')
  })
})
