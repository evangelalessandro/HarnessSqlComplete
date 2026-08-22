import { describe, expect, it } from 'vitest'
import { colorClassFor, colorizeSqlTokens, tokenizeSql } from '../helpers'
import { wsbritvicLikeSummary } from './schema'

const summary = wsbritvicLikeSummary()

function colorOf(text: string, needle: string): { key?: string; isTableName?: boolean } {
  const tokens = tokenizeSql(text)
  const colors = colorizeSqlTokens(text, summary)
  const idx = text.indexOf(needle)
  if (idx === -1) return {}
  // il token che CONTIENE la posizione (i bracket spostano lo start del token)
  const tokenIdx = tokens.findIndex(t => t.start <= idx && idx < t.end)
  if (tokenIdx === -1) return {}
  const c = colors.find(x => x.index === tokenIdx)
  return c ? { key: c.tableKey, isTableName: c.isTableName } : {}
}

describe('colori tabelle e colonne', () => {
  // La query esatta riportata dall'utente (MIS_ELEV non esiste nel DB)
  const SQL = `SELECT [MIS_ELEV],[UDC_UDCPRED] FROM [dbo].[RUN_MISSIONI] inner join [DAT_UDC] ON mis_udc=[UDC_UDC] ORDER BY 1 DESC;`

  it('i nomi delle tabelle ricevono il colore (come tabella, enfatizzati)', () => {
    expect(colorOf(SQL, 'RUN_MISSIONI').isTableName).toBe(true)
    expect(colorOf(SQL, 'DAT_UDC').isTableName).toBe(true)
    expect(colorOf(SQL, 'RUN_MISSIONI').key).toBe('dbo.RUN_MISSIONI')
    expect(colorOf(SQL, 'DAT_UDC').key).toBe('dbo.DAT_UDC')
  })

  it('le colonne prendono il colore della loro tabella', () => {
    expect(colorOf(SQL, 'UDC_UDCPRED').key).toBe('dbo.DAT_UDC')
    expect(colorOf(SQL, 'UDC_UDC').key).toBe('dbo.DAT_UDC')
    expect(colorOf(SQL, 'mis_udc').key).toBe('dbo.RUN_MISSIONI')
  })

  it('una colonna inesistente (MIS_ELEV) non riceve colore', () => {
    expect(colorOf(SQL, 'MIS_ELEV').key).toBeUndefined()
  })

  it('nome tabella maiuscolo nel testo: lookup case-insensitive', () => {
    expect(colorOf('SELECT * FROM DAT_UDC', 'DAT_UDC').key).toBe('dbo.DAT_UDC')
  })

  it('riferimento qualificato con alias: o.customer_id → Ordini', () => {
    const sql = 'SELECT o.customer_id FROM dbo.Ordini o'
    expect(colorOf(sql, 'customer_id').key).toBe('dbo.Ordini')
  })

  it('colonna condivisa in scope multiplo: nessun colore (ambiguo)', () => {
    const sql = 'SELECT id FROM dbo.Ordini o JOIN dbo.Clienti c ON o.customer_id = c.id'
    // 'id' non qualificato è in entrambe le tabelle dello scope → nessun colore
    const tokens = tokenizeSql(sql)
    const colors = colorizeSqlTokens(sql, summary)
    const idToken = tokens.findIndex(t => t.lower === 'id' && !t.qualified)
    expect(colors.find(c => c.index === idToken)).toBeUndefined()
  })

  it('colonna condivisa qualificata: colorata con la tabella risolta', () => {
    const sql = 'SELECT o.id FROM dbo.Ordini o JOIN dbo.Clienti c ON o.customer_id = c.id'
    const tokens = tokenizeSql(sql)
    const colors = colorizeSqlTokens(sql, summary)
    const idToken = tokens.findIndex(t => t.lower === 'id' && t.qualified && t.qualifier === 'o')
    expect(colors.find(c => c.index === idToken)?.tableKey).toBe('dbo.Ordini')
  })

  it('il colorizer ignora stringhe e commenti', () => {
    const sql = `-- FROM dbo.Clienti\nSELECT 'RUN_MISSIONI' FROM dbo.DAT_UDC`
    const tokens = tokenizeSql(sql)
    const colors = colorizeSqlTokens(sql, summary)
    // nessun colore su 'RUN_MISSIONI' dentro la stringa né su 'dbo' nel commento
    const strIdx = sql.indexOf("'RUN_MISSIONI'")
    const strTokens = tokens.filter(t => t.start >= strIdx && t.start < strIdx + 13)
    for (const t of strTokens) {
      expect(colors.find(c => c.index === tokens.indexOf(t))).toBeUndefined()
    }
  })

  it('JOIN con due tabelle e alias: colori separati per appartenenza', () => {
    const sql = 'SELECT o.id, o.customer_id, c.id, c.nome FROM dbo.Ordini o JOIN dbo.Clienti c ON o.customer_id = c.id'
    const tokens = tokenizeSql(sql)
    const colors = colorizeSqlTokens(sql, summary)
    const colorAt = (offset: number) => {
      const tokenIdx = tokens.findIndex(t => t.start <= offset && offset < t.end)
      return colors.find(c => c.index === tokenIdx)
    }

    // tabelle: ciascuna col proprio colore (enfatizzate)
    const ordiniTable = colorAt(sql.indexOf('Ordini'))
    const clientiTable = colorAt(sql.indexOf('Clienti'))
    expect(ordiniTable?.tableKey).toBe('dbo.Ordini')
    expect(ordiniTable?.isTableName).toBe(true)
    expect(clientiTable?.tableKey).toBe('dbo.Clienti')
    expect(clientiTable?.isTableName).toBe(true)

    // colori DIVERSI tra le due tabelle
    expect(colorClassFor('dbo.Ordini')).not.toBe(colorClassFor('dbo.Clienti'))

    // colonne qualificate con alias → colore della tabella risolta
    expect(colorAt(sql.indexOf('o.id') + 2)?.tableKey).toBe('dbo.Ordini')
    expect(colorAt(sql.indexOf('o.customer_id') + 2)?.tableKey).toBe('dbo.Ordini')
    expect(colorAt(sql.indexOf('c.id') + 2)?.tableKey).toBe('dbo.Clienti')
    expect(colorAt(sql.indexOf('c.nome') + 2)?.tableKey).toBe('dbo.Clienti')

    // colonne di tabelle diverse → classi colore diverse
    const ordiniCol = colors.find(c => c.index === tokens.findIndex(t => t.lower === 'customer_id' && t.qualified))
    const clientiCol = colors.find(c => c.index === tokens.findIndex(t => t.lower === 'nome' && t.qualified))
    expect(ordiniCol?.tableKey).not.toBe(clientiCol?.tableKey)
  })
})
