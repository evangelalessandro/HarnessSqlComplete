// MOTORE SQLFLUFF (richiesta utente: togliere sql-formatter e provare SQLFluff).
// SQLFluff è una CLI Python: si esegue sul backend, quindi qui si provano le parti pure (default,
// validazione, corpo della richiesta) e il comportamento in caso di errore (ripiego sul nostro).
import { describe, expect, it } from 'vitest'
import {
  corpoRichiestaSqlFluff,
  etichettaMotore,
  formattaConMotore,
  formattaConSqlFluff,
  MOTORI_FORMATTAZIONE,
  normalizzaOpzioniSqlFluff,
  OPZIONI_SQLFLUFF_DEFAULT,
  OPZIONI_SQLFLUFF_UI,
} from '../formatEngine'
import { buildFormatProfile, loadFormatProfileXml } from '../formatProfile'

const profile = buildFormatProfile(loadFormatProfileXml())
const SQL = 'select a, b, c from dbo.T where a = 1 and b > 2 order by c'

describe('opzioni di SQLFluff', () => {
  it('i motori sono due e le etichette sono parlanti', () => {
    expect(MOTORI_FORMATTAZIONE).toEqual(['nostro', 'sqlfluff'])
    expect(etichettaMotore('nostro')).toContain('Nostro')
    expect(etichettaMotore('sqlfluff')).toContain('SQLFluff')
  })

  it('i default NON stravolgono il codice: identificatori e funzioni preservati', () => {
    const d = normalizzaOpzioniSqlFluff(undefined)
    expect(d.identifierCasing).toBe('preserve')
    expect(d.functionCasing).toBe('preserve')
    expect(d.keywordCasing).toBe('upper')
    expect(d.tabSpaceSize).toBe(2)
    expect(d.commaStyle).toBe('trailing')
  })

  it('valori inventati o fuori range tornano ai default', () => {
    const d = normalizzaOpzioniSqlFluff({
      tabSpaceSize: 99,
      keywordCasing: 'boh' as never,
      commaStyle: 'storta' as never,
      maxLineLength: -3,
      whereNewline: 'si' as never,
    })
    expect(d.tabSpaceSize).toBe(2)
    expect(d.keywordCasing).toBe('upper')
    expect(d.commaStyle).toBe('trailing')
    expect(d.maxLineLength).toBe(120)
    expect(d.whereNewline).toBe(true)
  })

  it('tutte le opzioni mostrate nell interfaccia', () => {
    const chiavi = OPZIONI_SQLFLUFF_UI.map(o => o.key)
    expect(chiavi).toContain('tabSpaceSize')
    expect(chiavi).toContain('keywordCasing')
    expect(chiavi).toContain('identifierCasing')
    expect(chiavi).toContain('commaStyle')
    expect(chiavi).toContain('whereNewline')
    expect(chiavi).toContain('maxLineLength')
  })

  it('il corpo della richiesta porta testo e opzioni (dialetto T-SQL)', () => {
    const corpo = JSON.parse(corpoRichiestaSqlFluff(SQL, OPZIONI_SQLFLUFF_DEFAULT))
    expect(corpo.sql).toBe(SQL)
    expect(corpo.options.dialect).toBe('tsql')
    expect(corpo.options.identifierCasing).toBe('preserve')
    expect(corpo.options.tabSpaceSize).toBe(2)
  })
})

describe('chiamata a SQLFluff (backend)', () => {
  it('usa il testo formattato quando il backend risponde', async () => {
    const finta = (async () =>
      new Response(JSON.stringify({ formatted: 'SELECT\n    a\nFROM T', error: null }), { status: 200 })) as typeof fetch
    const esito = await formattaConSqlFluff(SQL, OPZIONI_SQLFLUFF_DEFAULT, finta)
    expect(esito.formattato).toContain('SELECT')
    expect(esito.errore).toBeNull()
  })

  it('se il backend non risponde si RIPIEGA sul motore nostro e si vede il messaggio', async () => {
    const rotta = (async () => {
      throw new Error('backend giu')
    }) as unknown as typeof fetch
    const esito = await formattaConSqlFluff(SQL, OPZIONI_SQLFLUFF_DEFAULT, rotta)
    expect(esito.formattato).toBeNull()
    expect(esito.errore).toContain('backend giu')
  })

  it('col motore nostro non si chiama nulla e si usa il profilo dell app', async () => {
    const esito = await formattaConMotore(SQL, 'nostro', profile, OPZIONI_SQLFLUFF_DEFAULT)
    expect(esito.errore).toBeNull()
    expect(esito.testo).toMatch(/^SELECT/)
  })
})
