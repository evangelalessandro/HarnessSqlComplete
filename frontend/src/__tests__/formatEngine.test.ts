// SCELTA DEL MOTORE DI FORMATTAZIONE (richiesta utente: "puoi integrare anche sql-formatter e mi
// dai una opzione per formattare alla maniera come abbiamo fatto fino ad oggi e con la nuova?").
// Due motori: il nostro (profilo T-SQL dell'app) e la libreria esterna sql-formatter (dialetto tsql).
import { describe, expect, it } from 'vitest'
import { etichettaMotore, formattaConMotore, MOTORI_FORMATTAZIONE } from '../formatEngine'
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
})
