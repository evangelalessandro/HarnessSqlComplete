// AIUTO SULLE FUNZIONI: primo parametro "parte di data" (DATEADD & co.) e costrutto intero delle
// funzioni window (RANK, ROW_NUMBER, …) proposto in ghost text e adattato mentre si scrive.
// Richieste utente: "un aiuto per le funzioni tipo dateadd e proponi nel primo parametro i dati
// possibili" e "così come nelle funzioni window tipo rank(): proponi tutto il costrutto in ghost e poi
// ti adatti a quello che scrivo".
import { describe, expect, it } from 'vitest'
import {
  PARTI_DATA,
  contestoParteData,
  costruisciFinestra,
  finestraDigitata,
  funzioneFinestra,
  restoFinestra,
  suggerimentiParteData,
} from '../funzioniSql'
import { suggerisciInLinea } from '../inlineSuggest'
import type { DatabaseSummary, TableInfo } from '../types'

const colonne = ['CustomerID', 'CustomerName', 'CreditLimit']

describe('DATEADD & co.: le parti di data nel primo argomento', () => {
  it('riconosce il contesto dopo "DATEADD("', () => {
    expect(contestoParteData('SELECT DATEADD(', 15)).toEqual({ funzione: 'DATEADD', prefisso: '' })
    expect(contestoParteData('SELECT DATEADD(d', 16)).toEqual({ funzione: 'DATEADD', prefisso: 'd' })
    const conSpazi = 'SELECT DATEADD ( dd'
    expect(contestoParteData(conSpazi, conSpazi.length)).toEqual({ funzione: 'DATEADD', prefisso: 'dd' })
    const dove = 'WHERE DATEDIFF('
    expect(contestoParteData(dove, dove.length)?.funzione).toBe('DATEDIFF')
    const ep = 'SELECT DATEPART('
    expect(contestoParteData(ep, ep.length)?.funzione).toBe('DATEPART')
    const tr = 'SELECT DATETRUNC('
    expect(contestoParteData(tr, tr.length)?.funzione).toBe('DATETRUNC')
  })

  it('fuori dal primo argomento non propone niente', () => {
    // dopo la virgola si è nel secondo argomento (il numero): niente parti di data
    expect(contestoParteData('SELECT DATEADD(day, ', 20)).toBeNull()
    // funzione sconosciuta
    expect(contestoParteData('SELECT SUM(', 11)).toBeNull()
    // non è una funzione (manca la parentesi)
    expect(contestoParteData('SELECT DATEADD ', 15)).toBeNull()
  })

  it('propone tutte le parti con le abbreviazioni e l etichetta italiana', () => {
    const voci = suggerimentiParteData('SELECT DATEADD(', 15)
    const valori = voci.map(v => v.valore)
    for (const p of PARTI_DATA) {
      expect(valori).toContain(p.token)
      for (const a of p.abbreviazioni) expect(valori).toContain(a)
    }
    const giorno = voci.find(v => v.label === 'day')!
    expect(giorno.detail).toContain('giorno')
    expect(giorno.detail).toContain('dd')
    console.log(`  voci proposte: ${voci.length} · esempio: ${giorno.label} → ${giorno.detail}`)
    // "iso_week" esiste in T-SQL (SQL Server 2008+) ed è proposto con le sue abbreviazioni
    expect(valori).toContain('iso_week')
  })
})

describe('funzioni window: nome e costrutto', () => {
  it('riconosce i nomi (anche parziali) e scarta il resto', () => {
    expect(funzioneFinestra('rank')?.nome).toBe('RANK')
    expect(finestraDigitata('RA')?.nome).toBe('RANK')
    expect(finestraDigitata('ROW_N')?.nome).toBe('ROW_NUMBER')
    expect(finestraDigitata('SUM')).toBeNull()
  })

  it('costruisce il costrutto completo con colonne vere', () => {
    const rank = funzioneFinestra('RANK')!
    const testo = costruisciFinestra(rank, colonne)
    console.log(`  costrutto: ${testo}`)
    expect(testo).toBe('RANK() OVER (PARTITION BY CustomerID ORDER BY CustomerName)')
    expect(costruisciFinestra(funzioneFinestra('NTILE')!, colonne)).toContain('NTILE(4) OVER (')
    expect(costruisciFinestra(funzioneFinestra('LAG')!, colonne)).toContain('LAG(col, 1) OVER (')
  })
})

describe('ghost text: il costrutto window che si adatta a quello che scrivo', () => {
  it('dopo "RANK(" propone il resto del costrutto', () => {
    const sql = 'SELECT RANK('
    const resto = restoFinestra(sql, sql.length, colonne)!
    console.log(`  "RANK(" → ${JSON.stringify(resto)}`)
    expect(resto).toBe(') OVER (PARTITION BY CustomerID ORDER BY CustomerName)')
  })

  it('dopo "RANK()" propone solo l OVER', () => {
    const sql = 'SELECT RANK()'
    expect(restoFinestra(sql, sql.length, colonne)).toBe(' OVER (PARTITION BY CustomerID ORDER BY CustomerName)')
  })

  it('dentro l OVER propone PARTITION BY … ORDER BY … e si accorcia', () => {
    const a = 'SELECT RANK() OVER ('
    expect(restoFinestra(a, a.length, colonne)).toBe('PARTITION BY CustomerID ORDER BY CustomerName)')
    const b = 'SELECT RANK() OVER (PARTITION BY CustomerID '
    expect(restoFinestra(b, b.length, colonne)).toBe('ORDER BY CustomerName)')
    const c = 'SELECT RANK() OVER (ORDER BY CreditLimit '
    expect(restoFinestra(c, c.length, colonne)).toBe(')')
  })

  it('a costrutto completo non propone più niente', () => {
    const sql = 'SELECT RANK() OVER (PARTITION BY CustomerID ORDER BY CustomerName)'
    expect(restoFinestra(sql, sql.length, colonne)).toBeNull()
  })

  it('funzioni window con argomenti (NTILE, LAG)', () => {
    const ntile = 'SELECT NTILE('
    expect(restoFinestra(ntile, ntile.length, colonne)).toBe('4) OVER (PARTITION BY CustomerID ORDER BY CustomerName)')
    const lag = 'SELECT LAG('
    expect(restoFinestra(lag, lag.length, colonne)).toBe(
      'col, 1) OVER (PARTITION BY CustomerID ORDER BY CustomerName)',
    )
  })

  it('il ghost arriva da suggerisciInLinea con il motivo "finestra"', () => {
    const tabella = {
      schema: 'Sales',
      name: 'Customers',
      columnCount: colonne.length,
      columns: colonne.map(n => ({ name: n, dataType: 'int', isNullable: true, isIdentity: false, isComputed: false, maxLength: 4 })),
      usage: null,
      extendedProperties: null,
      createDate: null,
    } as unknown as TableInfo
    const summary = { tables: [tabella], views: [], procedures: [], functions: [], triggers: [], foreignKeys: [], databases: [], checkConstraints: [], cooccurrences: [] } as unknown as DatabaseSummary
    const sql = 'SELECT RANK(\nFROM Sales.Customers'
    const offset = sql.indexOf('RANK(') + 'RANK('.length
    const s = suggerisciInLinea(sql, offset, summary)
    console.log(`  ghost: ${JSON.stringify(s)}`)
    expect(s?.motivo).toBe('finestra')
    expect(s?.testo).toContain('OVER (')
  })
})
