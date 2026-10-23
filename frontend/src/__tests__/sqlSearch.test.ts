// Ricerca testuale generale (stile Redgate SQL Search): helper puri del pannello.
import { describe, expect, it } from 'vitest'
import {
  MAX_RICERCHE_RICORDATE,
  canEdit,
  canPreviewColumns,
  canPreviewDefinition,
  countByKind,
  editableKind,
  editTabTitle,
  hitKey,
  hitTitle,
  kindLabel,
  kindTone,
  matchLabel,
  parseSearchHistory,
  pushSearchHistory,
  removeFromSearchHistory,
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

describe('cronologia delle ricerche (ultime 10 parole cercate)', () => {
  it('la ricerca nuova va in testa e la cronologia non supera 10 voci', () => {
    let c: string[] = []
    for (let i = 1; i <= 12; i++) c = pushSearchHistory(c, `termine${i}`)
    expect(c).toHaveLength(MAX_RICERCHE_RICORDATE)
    expect(c[0]).toBe('termine12')
    expect(c).not.toContain('termine1') // le più vecchie escono
    expect(c).not.toContain('termine2')
  })

  it('niente duplicati, anche con maiuscole diverse: la voce risale in testa', () => {
    let c = pushSearchHistory([], 'UDC_UDC')
    c = pushSearchHistory(c, 'baia')
    c = pushSearchHistory(c, 'udc_udc')
    expect(c).toEqual(['udc_udc', 'baia'])
  })

  it('ignora testi vuoti o troppo corti (sotto i 2 caratteri)', () => {
    expect(pushSearchHistory(['x'], '')).toEqual(['x'])
    expect(pushSearchHistory(['x'], '   ')).toEqual(['x'])
    expect(pushSearchHistory(['x'], 'a')).toEqual(['x'])
  })

  it('toglie una voce (senza maiuscole)', () => {
    expect(removeFromSearchHistory(['baia', 'udc'], 'BAIA')).toEqual(['udc'])
  })

  it('legge solo dati validi dal salvataggio', () => {
    expect(parseSearchHistory(null)).toEqual([])
    expect(parseSearchHistory('non json')).toEqual([])
    expect(parseSearchHistory('{"a":1}')).toEqual([])
    expect(parseSearchHistory('["baia", 5, "x", " udc ", ""]')).toEqual(['baia', 'udc'])
    expect(parseSearchHistory(JSON.stringify(Array.from({ length: 20 }, (_, i) => `t${i}`)))).toHaveLength(
      MAX_RICERCHE_RICORDATE,
    )
  })
})

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

  // Bug visto dall'utente ("la ricerca ritorna 2 elementi" / righe che restavano nell'elenco):
  // due COLONNE omonime in tabelle diverse avevano la STESSA chiave React → React non riconciliava
  // l'elenco e le righe vecchie restavano. La chiave deve contenere la TABELLA proprietaria.
  it('due colonne omonime in tabelle diverse hanno chiavi DIVERSE', () => {
    const a = hit({ kind: 'column', name: 'UDC_UDC', detail: 'colonna di dbo.BCKUP_UDC', matchIn: 'column' })
    const b = hit({ kind: 'column', name: 'UDC_UDC', detail: 'colonna di dbo.DAT_UDC', matchIn: 'column' })
    expect(hitKey(a)).not.toBe(hitKey(b))
    expect(hitKey(a)).toContain('BCKUP_UDC')
    // vincoli e colonne calcolate: stessa cosa
    const k1 = hit({ kind: 'constraint', name: 'CK_X', detail: 'vincolo CHECK di dbo.T1', matchIn: 'definition' })
    const k2 = hit({ kind: 'constraint', name: 'CK_X', detail: 'vincolo CHECK di dbo.T2', matchIn: 'definition' })
    expect(hitKey(k1)).not.toBe(hitKey(k2))
  })

  it('due hit sui DATI con lo stesso valore in righe diverse hanno chiavi diverse', () => {
    const riga = (valore: string) =>
      hit({
        kind: 'data',
        name: 'dbo.T · COL',
        detail: 'dbo.T · COL = x',
        matchIn: 'data',
        row: { columns: ['COL'], values: [valore] },
      })
    expect(hitKey(riga('x'))).not.toBe(hitKey(riga('y')))
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

  it('si possono MODIFICARE (CREATE OR ALTER) solo routine, viste e trigger', () => {
    expect(canEdit('procedure')).toBe(true)
    expect(canEdit('function')).toBe(true)
    expect(canEdit('view')).toBe(true)
    expect(canEdit('trigger')).toBe(true)
    expect(canEdit('table')).toBe(false)
    expect(canEdit('column')).toBe(false)
    expect(canEdit('constraint')).toBe(false)
    expect(canEdit('data')).toBe(false)
  })

  it('editableKind traduce il tipo per "Modifica" (null se non è modificabile)', () => {
    expect(editableKind('procedure')).toBe('procedure')
    expect(editableKind('function')).toBe('function')
    expect(editableKind('view')).toBe('view')
    expect(editableKind('trigger')).toBe('trigger')
    expect(editableKind('data')).toBeNull()
    expect(editableKind('column')).toBeNull()
  })

  it('titolo della tab aperta in modifica', () => {
    expect(editTabTitle(hit({ name: 'ws_X' }), 'alter')).toBe('CREATE OR ALTER ws_X')
    expect(editTabTitle(hit({ schema: 'AD', name: 'ws_X' }), 'open')).toBe('AD.ws_X')
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
