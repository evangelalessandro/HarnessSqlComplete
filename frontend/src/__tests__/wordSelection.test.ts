// @vitest-environment jsdom
// Doppio click su una variabile: deve selezionare anche '@' e '#' iniziali.
//
// Il test usa il VERO codice di Monaco che gestisce la selezione della parola
// (WordOperations.getWordAtPosition: la stessa funzione usata dal doppio click e da
// Ctrl+freccia) con i separatori di parola configurati nell'editor. Si controlla anche
// l'INTERVALLO selezionato, così si vede che punteggiatura e operatori restano fuori.
import { describe, expect, it } from 'vitest'
import * as monaco from 'monaco-editor'
import { WordOperations } from 'monaco-editor/editor/common/cursor/cursorWordOperations.js'
import { SQL_WORD_SEPARATORS } from '../editorOptions'

/** Separatori predefiniti di Monaco: '@' e '#' sono separatori (era il problema). */
const MONACO_DEFAULT_SEPARATORS = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?'

/** Parola selezionata (testo + colonne) alla colonna indicata, con i separatori dati. */
function spanWith(sql: string, column: number, separators: string) {
  const model = monaco.editor.createModel(sql, 'sql')
  try {
    const r = WordOperations.getWordAtPosition(model, separators, [], new monaco.Position(1, column))
    return r ? { word: r.word, start: r.startColumn, end: r.endColumn } : null
  } finally {
    model.dispose()
  }
}

/** Selezione con i separatori configurati nell'app. */
const span = (sql: string, column: number) => spanWith(sql, column, SQL_WORD_SEPARATORS)

describe('separatori di parola configurati', () => {
  it('non contiene più @ e #, tutti gli altri separatori restano', () => {
    expect(SQL_WORD_SEPARATORS).not.toContain('@')
    expect(SQL_WORD_SEPARATORS).not.toContain('#')
    for (const ch of MONACO_DEFAULT_SEPARATORS.replace('@', '').replace('#', '')) {
      expect(SQL_WORD_SEPARATORS, `separatore perso: ${ch}`).toContain(ch)
    }
  })
})

describe('doppio click: variabili, parametri e temporanee', () => {
  it('@variabile: seleziona il nome COMPLETO con la chiocciola', () => {
    // colonne: @=8 s=9 … u=14
    const sql = 'SELECT @ssccLu FROM x'
    expect(span(sql, 9)).toEqual({ word: '@ssccLu', start: 8, end: 15 })
    expect(span(sql, 8)).toEqual({ word: '@ssccLu', start: 8, end: 15 })
  })

  it('@@funzione di sistema: seleziona anche le due chiocciole', () => {
    // colonne: I=1 F=2 spazio=3 @=4 @=5 R=6 …
    const sql = 'IF @@ROWCOUNT > 1'
    expect(span(sql, 4)).toEqual({ word: '@@ROWCOUNT', start: 4, end: 14 })
    expect(span(sql, 5)).toEqual({ word: '@@ROWCOUNT', start: 4, end: 14 })
    expect(span(sql, 8)).toEqual({ word: '@@ROWCOUNT', start: 4, end: 14 })
  })

  it('parametro di stored procedure: @pAbleDisable', () => {
    const sql = 'EXEC dbo.ws_X @pAbleDisable = 1'
    expect(span(sql, 17)).toEqual({ word: '@pAbleDisable', start: 15, end: 28 })
  })

  it('tabella temporanea locale e globale: #tmp e ##globale', () => {
    // colonne: '#'=15, nome di 25 caratteri → ultima colonna 39
    expect(span('SELECT * FROM #tbl_InventoryKitting_St1 WHERE 1=1', 18)).toEqual({
      word: '#tbl_InventoryKitting_St1',
      start: 15,
      end: 40,
    })
    expect(span('SELECT * FROM ##globale', 17)).toEqual({ word: '##globale', start: 15, end: 24 })
  })

  it('con i separatori PREDEFINITI la chiocciola veniva persa (bug segnalato)', () => {
    expect(spanWith('SELECT @ssccLu FROM x', 9, MONACO_DEFAULT_SEPARATORS)).toEqual({
      word: 'ssccLu',
      start: 9,
      end: 15,
    })
    expect(spanWith('SELECT * FROM #tmp', 16, MONACO_DEFAULT_SEPARATORS)).toEqual({ word: 'tmp', start: 16, end: 19 })
  })
})

describe('doppio click: il resto non cambia', () => {
  it('nomi normali: la selezione è il solo nome', () => {
    const sql = 'SELECT cliente, totale FROM ordini'
    expect(span(sql, 9)).toEqual({ word: 'cliente', start: 8, end: 15 })
    expect(span(sql, 18)).toEqual({ word: 'totale', start: 17, end: 23 })
  })

  it('la virgola resta fuori dalla selezione', () => {
    const sql = 'SELECT cliente, totale FROM ordini'
    // la virgola è in colonna 15: la selezione finisce alla 14 (end esclusa)
    expect(span(sql, 15)?.end).toBe(15)
    expect(span(sql, 15)?.word).toBe('cliente')
  })

  it('le parentesi restano separatori ma la chiocciola è nel nome', () => {
    const sql = 'EXEC dbo.Proc(@id)'
    // la parentesi aperta è in colonna 14: la selezione non la include
    expect(span(sql, 14)).toEqual({ word: 'Proc', start: 10, end: 14 })
    expect(span(sql, 17)).toEqual({ word: '@id', start: 15, end: 18 })
  })

  it('variabili adiacenti a operatori non inglobano il simbolo', () => {
    // colonne di "SET @a=1": @=5 a=6 ==7 1=8
    expect(span('SET @a=1', 6)?.word).toBe('@a')
    // colonne di "SET @a, @b": @=5 a=6 ,=7 sp=8 @=9 b=10
    expect(span('SET @a, @b', 6)?.word).toBe('@a')
    expect(span('SET @a, @b', 10)?.word).toBe('@b')
  })

  it('sugli spazi non c è nessuna parola da selezionare', () => {
    expect(span('SELECT cliente, totale FROM ordini', 16)).toBeNull()
    expect(span('IF @@ROWCOUNT > 1', 15)).toBeNull()
  })
})
