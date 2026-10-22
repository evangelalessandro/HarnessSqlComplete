// @vitest-environment jsdom
// RICERCA: ordine delle parole libero (ricerca laterale) e sottolineatura di TUTTE le righe con il
// match (anteprima della ricerca).
// Richieste utente:
//  1) "nella ricerca laterale permetti anche di invertire l'ordine delle parole per trovare comunque
//     il risultato tra i nomi degli oggetti";
//  2) "quando faccio la ricerca sottolinea bene, nell'oggetto in cui trovi quello che cerco, tutte le
//     righe in cui si trova".
import { describe, expect, it } from 'vitest'
import { searchMatches, searchTokens } from '../helpers'
import { splitHighlight } from '../sqlSearch'
import { classiRiga } from '../components/SearchPanel'

describe('searchTokens', () => {
  it('separa sulle spazi e scarta il vuoto', () => {
    expect(searchTokens('  automatismi   engine ')).toEqual(['automatismi', 'engine'])
    expect(searchTokens('   ')).toEqual([])
  })
})

describe('searchMatches: parole in qualsiasi ordine', () => {
  it('il caso segnalato: nome con le parole invertite', () => {
    expect(searchMatches('automatismi engine', 'ws_L2_Engine_Automatismi')).toBe(true)
    expect(searchMatches('engine automatismi', 'ws_L2_Engine_Automatismi')).toBe(true)
  })

  it('funziona anche cercando su schema e nome insieme', () => {
    expect(searchMatches('dbo missioni run', 'RUN_MISSIONI', 'dbo')).toBe(true)
    expect(searchMatches('missioni dbo run', 'RUN_MISSIONI', 'dbo')).toBe(true)
  })

  it('una parola assente esclude il risultato', () => {
    expect(searchMatches('automatismi zzz', 'ws_L2_Engine_Automatismi')).toBe(false)
  })
})

describe('splitHighlight: evidenzia ogni PAROLA della query', () => {
  it('due parole in ordine invertito: entrambe evidenziate', () => {
    const parti = splitHighlight('ws_L2_Engine_Automatismi', 'automatismi engine')
    const hits = parti.filter(p => p.hit).map(p => p.text)
    console.log(`  evidenziati: ${JSON.stringify(hits)}`)
    expect(hits).toContain('Automatismi')
    expect(hits).toContain('Engine')
  })

  it('più occorrenze della stessa parola: tutte evidenziate', () => {
    const parti = splitHighlight('ABC abc AbC', 'abc')
    expect(parti.filter(p => p.hit)).toHaveLength(3)
  })

  it('parole che si sovrappongono: si evidenzia la più lunga, senza doppioni', () => {
    const parti = splitHighlight('MIS_CORRIDOIO', 'corr corridoio')
    const hits = parti.filter(p => p.hit).map(p => p.text)
    console.log(`  evidenziati: ${JSON.stringify(hits)}`)
    expect(hits).toEqual(['CORRIDOIO'])
  })

  it('query vuota non evidenzia nulla', () => {
    expect(splitHighlight('ABC', '  ').every(p => !p.hit)).toBe(true)
  })
})

describe('classiRiga: tutte le righe con il match sono sottolineate', () => {
  it('la riga del match è più marcata, le altre trovate hanno lo sfondo', () => {
    const trovate = new Set([2, 5, 7])
    const riga2 = classiRiga(5, 2, trovate)
    const riga5 = classiRiga(5, 5, trovate)
    const riga3 = classiRiga(5, 3, trovate)
    console.log(`  riga 2: ${JSON.stringify(riga2)}\n  riga 5: ${JSON.stringify(riga5)}\n  riga 3: ${JSON.stringify(riga3)}`)
    expect(riga2).toContain('bg-amber-500/10')
    expect(riga5).toContain('bg-amber-500/20')
    expect(riga3).toBeUndefined()
  })

  it('senza riga del match (null) restano comunque evidenziate le righe trovate', () => {
    expect(classiRiga(null, 4, new Set([4]))).toContain('bg-amber-500/10')
    expect(classiRiga(null, 9, new Set([4]))).toBeUndefined()
  })
})
