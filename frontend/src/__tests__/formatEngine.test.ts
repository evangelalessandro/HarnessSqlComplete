// SCELTA DEL MOTORE DI FORMATTAZIONE (richiesta utente: "puoi integrare anche sql-formatter e mi
// dai una opzione per formattare alla maniera come abbiamo fatto fino ad oggi e con la nuova?").
// Due motori: il nostro (profilo T-SQL dell'app) e la libreria esterna sql-formatter (dialetto tsql).
import { describe, expect, it } from 'vitest'
import {
  etichettaMotore,
  formattaConMotore,
  MOTORI_FORMATTAZIONE,
  normalizzaOpzioniSqlFormatter,
  OPZIONI_SQLFORMATTER_UI,
} from '../formatEngine'
import { buildFormatProfile, loadFormatProfileXml } from '../formatProfile'
import { tokenizeSqlText } from '../tsqlFormatter'

const profile = buildFormatProfile(loadFormatProfileXml())

/** Firma dei token: nessun motore deve perdere o inventare nulla. */
const firma = (sql: string) =>
  tokenizeSqlText(sql)
    .map(t => `${t.type}:${t.text.toLowerCase().replace(/\s+/g, ' ').trim()}`)
    .sort()

const SQL = 'select a, b, c from dbo.T where a = 1 and b > 2 order by c'

describe('motore di formattazione: nostro o sql-formatter', () => {
  it('i due motori sono esattamente due', () => {
    expect(MOTORI_FORMATTAZIONE).toEqual(['nostro', 'sql-formatter'])
    expect(etichettaMotore('nostro')).toContain('Nostro')
    expect(etichettaMotore('sql-formatter')).toContain('sql-formatter')
  })

  it('il motore nostro usa il profilo dell\'app (parole chiave maiuscole, colonne impilate)', () => {
    const out = formattaConMotore(SQL, 'nostro', profile)
    expect(out).toMatch(/^SELECT/)
    expect(out).toContain('\nFROM dbo.T')
    expect(firma(out)).toEqual(firma(SQL))
  })

  it('sql-formatter formatta in dialetto T-SQL e non perde token', () => {
    const out = formattaConMotore(SQL, 'sql-formatter', profile)
    expect(out).toMatch(/SELECT/i)
    expect(out).toContain('FROM')
    expect(firma(out)).toEqual(firma(SQL))
  })

  it('i due motori danno risultati DIVERSI (è il senso dell\'opzione)', () => {
    const nostro = formattaConMotore(SQL, 'nostro', profile)
    const libreria = formattaConMotore(SQL, 'sql-formatter', profile)
    expect(libreria).not.toBe(nostro)
  })

  it('un testo già impaginato resta identico con il motore nostro', () => {
    const bello = ['SELECT a', '   ,b', 'FROM dbo.T', 'WHERE a = 1'].join('\n')
    expect(formattaConMotore(bello, 'nostro', profile)).toBe(bello + '\n')
  })

  it('se la libreria non sa leggere il testo si torna al motore nostro (mai nessun errore)', () => {
    const rotto = 'select ((('
    const out = formattaConMotore(rotto, 'sql-formatter', profile)
    expect(typeof out).toBe('string')
    expect(out.length).toBeGreaterThan(0)
  })

  // Le opzioni della libreria (richiesta utente: "ha delle opzioni da impostare, perché fa
  // diventare tutto super piatto"): devono essere esposte, salvate e incidere sull'output.
  it('le opzioni della libreria sono esposte e hanno i default', () => {
    const d = normalizzaOpzioniSqlFormatter(undefined)
    expect(d.tabWidth).toBe(2)
    expect(d.keywordCase).toBe('upper')
    expect(d.expressionWidth).toBe(50)
    expect(OPZIONI_SQLFORMATTER_UI.map(o => o.key)).toContain('expressionWidth')
    expect(OPZIONI_SQLFORMATTER_UI.map(o => o.key)).toContain('indentStyle')
  })

  it('valori non validi non rompono niente: si torna ai default', () => {
    const d = normalizzaOpzioniSqlFormatter({ tabWidth: 999, keywordCase: 'boh' as never, expressionWidth: -5 })
    expect(d.tabWidth).toBe(2)
    expect(d.keywordCase).toBe('upper')
    expect(d.expressionWidth).toBe(50)
  })

  it('cambiando le opzioni CAMBIA l\'output (rientro e maiuscole)', () => {
    const grande = formattaConMotore(SQL, 'sql-formatter', profile, { tabWidth: 8 })
    const piccolo = formattaConMotore(SQL, 'sql-formatter', profile, { tabWidth: 2 })
    const minuscolo = formattaConMotore(SQL, 'sql-formatter', profile, { keywordCase: 'lower' })
    const maiuscolo = formattaConMotore(SQL, 'sql-formatter', profile, { keywordCase: 'upper' })
    expect(grande).not.toBe(piccolo)
    expect(minuscolo).not.toBe(maiuscolo)
    expect(minuscolo).toContain('select')
  })

  it('anche lo stile del rientro e la larghezza delle espressioni sono opzioni vere', () => {
    const standard = formattaConMotore(SQL, 'sql-formatter', profile, { indentStyle: 'standard' })
    const tabellare = formattaConMotore(SQL, 'sql-formatter', profile, { indentStyle: 'tabularLeft' })
    expect(tabellare).not.toBe(standard)
    const lunga = Array.from({ length: 12 }, (_, i) => `COL_${i}`).join(', ')
    const sql = `SELECT ${lunga} FROM dbo.T`
    const stretto = formattaConMotore(sql, 'sql-formatter', profile, { expressionWidth: 20 })
    const largo = formattaConMotore(sql, 'sql-formatter', profile, { expressionWidth: 400 })
    // una soglia più stretta non può MAI produrre meno righe di una più larga
    expect(stretto.split('\n').length).toBeGreaterThanOrEqual(largo.split('\n').length)
  })
})
