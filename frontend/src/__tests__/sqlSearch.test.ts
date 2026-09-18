// Ricerca testuale generale (stile Redgate SQL Search): helper puri del pannello.
import { describe, expect, it } from 'vitest'
import {
  canPreviewColumns,
  canPreviewDefinition,
  countByKind,
  hitKey,
  hitTitle,
  kindLabel,
  kindTone,
  matchLabel,
  searchMeta,
  splitHighlight,
  tableOfHit,
} from '../sqlSearch'
import type { TextSearchHit, TextSearchResult } from '../types'

function hit(parziale: Partial<TextSearchHit>): TextSearchHit {
  return {
    kind: 'procedure',
    schema: 'dbo',
    name: 'ws_Esempio',
    detail: 'Stored procedure',
    matchIn: 'definition',
    line: 12,
    snippet: 'SELECT X FROM T',
    row: null,
    ...parziale,
  }
}

describe('splitHighlight: evidenziazione del testo trovato', () => {
  it('separa le occorrenze, senza distinguere maiuscole', () => {
    expect(splitHighlight('select UDC_UDC from DAT_UDC', 'udc_udc')).toEqual([
      { text: 'select ', hit: false },
      { text: 'UDC_UDC', hit: true },
      { text: ' from DAT_UDC', hit: false },
    ])
  })

  it('più occorrenze e testo iniziale/finale', () => {
    const parti = splitHighlight('abcabc', 'abc')
    expect(parti.filter(p => p.hit)).toHaveLength(2)
    expect(parti.map(p => p.text).join('')).toBe('abcabc')
  })

  it('senza testo cercato (o senza occorrenze) ritorna tutto normale', () => {
    expect(splitHighlight('qualcosa', '')).toEqual([{ text: 'qualcosa', hit: false }])
    expect(splitHighlight('qualcosa', 'zzz')).toEqual([{ text: 'qualcosa', hit: false }])
  })

  it('ricompone sempre il testo originale', () => {
    const testo = 'CREATE PROCEDURE dbo.ws_Prova AS SELECT 1 -- ws_Prova'
    expect(splitHighlight(testo, 'ws_prova').map(p => p.text).join('')).toBe(testo)
  })
})

describe('etichette e colori per tipo', () => {
  it('etichette italiane', () => {
    expect(kindLabel('procedure')).toBe('Stored procedure')
    expect(kindLabel('column')).toBe('Colonna')
    expect(kindLabel('data')).toBe('Dato')
    expect(kindLabel('computed')).toBe('Colonna calcolata')
  })

  it('toni distinti per famiglie diverse', () => {
    expect(kindTone('procedure')).toBe('emerald')
    expect(kindTone('table')).toBe('amber')
    expect(kindTone('data')).toBe('sky')
  })

  it('dove è stato trovato', () => {
    expect(matchLabel('definition')).toBe('nella definizione')
    expect(matchLabel('name')).toBe('nel nome')
    expect(matchLabel('data')).toBe('nei dati')
  })
})

describe('titolo, chiave e anteprima', () => {
  it('nome qualificato solo se lo schema non è dbo', () => {
    expect(hitTitle(hit({ name: 'ws_X' }))).toBe('ws_X')
    expect(hitTitle(hit({ schema: 'AD', name: 'ws_X' }))).toBe('AD.ws_X')
    // per i dati il titolo è la tabella, per le colonne la colonna
    expect(hitTitle(hit({ kind: 'data', name: 'MAG_BAIE' }))).toBe('MAG_BAIE')
    expect(hitTitle(hit({ kind: 'column', name: 'UDC_UDC' }))).toBe('UDC_UDC')
  })

  it('chiave stabile e diversa per righe diverse', () => {
    expect(hitKey(hit({ line: 3 }))).not.toBe(hitKey(hit({ line: 4 })))
    expect(hitKey(hit({ line: 3 }))).toBe(hitKey(hit({ line: 3 })))
  })

  it('la definizione si può mostrare per gli oggetti con script', () => {
    expect(canPreviewDefinition('procedure')).toBe(true)
    expect(canPreviewDefinition('view')).toBe(true)
    expect(canPreviewDefinition('constraint')).toBe(true)
    expect(canPreviewDefinition('column')).toBe(false)
    expect(canPreviewDefinition('computed')).toBe(false) // il nome è una colonna, non un oggetto
    expect(canPreviewDefinition('data')).toBe(false)
  })

  it('l anteprima a colonne vale per tabelle, colonne e colonne calcolate', () => {
    expect(canPreviewColumns('table')).toBe(true)
    expect(canPreviewColumns('column')).toBe(true)
    expect(canPreviewColumns('computed')).toBe(true)
    expect(canPreviewColumns('procedure')).toBe(false)
    expect(canPreviewColumns('data')).toBe(false)
  })

  it('riconosce la tabella di una colonna dal detail del backend', () => {
    expect(tableOfHit(hit({ kind: 'table', name: 'MAG_BAIE' }))).toBe('MAG_BAIE')
    expect(tableOfHit(hit({ kind: 'column', detail: 'colonna di dbo.MAG_BAIE' }))).toBe('MAG_BAIE')
    expect(tableOfHit(hit({ kind: 'computed', detail: 'colonna calcolata di dbo.TEST_RIGHE' }))).toBe('TEST_RIGHE')
    expect(tableOfHit(hit({ kind: 'procedure', detail: 'Stored procedure' }))).toBe('')
  })
})

describe('riepilogo della ricerca', () => {
  const esito: TextSearchResult = {
    hits: [hit({}), hit({ kind: 'column', matchIn: 'column' }), hit({ kind: 'data', matchIn: 'data' })],
    truncated: false,
    scannedTables: 25,
    totalTables: 210,
    elapsedMs: 340,
  }

  it('senza dati non parla di tabelle scandite', () => {
    expect(searchMeta(esito, false)).toBe('3 risultati · 340 ms')
  })

  it('con i dati mostra quante tabelle sono state scandite', () => {
    expect(searchMeta(esito, true)).toBe('3 risultati · 340 ms · 25 tabelle scandite su 210')
  })

  it('segnala quando il limite è stato raggiunto', () => {
    expect(searchMeta({ ...esito, truncated: true }, false)).toContain('limite raggiunto')
  })

  it('singolare/plurale corretto nel conteggio per tipo', () => {
    expect(countByKind([hit({})])).toBe('1 stored procedure')
    expect(countByKind([hit({}), hit({ line: 20 })])).toBe('2 stored procedure')
    expect(countByKind([hit({}), hit({ kind: 'column' }), hit({ kind: 'data' })])).toBe(
      '1 stored procedure · 1 colonna · 1 dato',
    )
  })
})
