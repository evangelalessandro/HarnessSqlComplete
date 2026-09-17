import { describe, expect, it } from 'vitest'
import { colorClassFor, colorClassMapForKeys, colorizeSqlTokens, isTableValuedFunctionType, splitUserFunctions, tokenizeSql } from '../helpers'
import type { DatabaseSummary } from '../types'
import { demoStoreLikeSummary } from './schema'

const summary = demoStoreLikeSummary()

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

describe('colori funzioni tabellari e tabelle temporanee', () => {
  // schema locale con funzioni tabellari (IF/TF) e una scalare (FN, NON colorata)
  const summaryTvf: DatabaseSummary = {
    ...summary,
    functions: [
      { schema: 'dbo', name: 'fn_GIPAVUDUBES', type: 'IF' },
      { schema: 'dbo', name: 'fn_GUGAMIPU', type: 'TF' },
      { schema: 'dbo', name: 'fn_SUDOMUS', type: 'FN' },
    ],
  }

  function colorOf(text: string, needle: string, sum: DatabaseSummary = summary): { key?: string; isTableName?: boolean } {
    const tokens = tokenizeSql(text)
    const colors = colorizeSqlTokens(text, sum)
    const idx = text.indexOf(needle)
    if (idx === -1) return {}
    const tokenIdx = tokens.findIndex(t => t.start <= idx && idx < t.end)
    if (tokenIdx === -1) return {}
    const c = colors.find(x => x.index === tokenIdx)
    return c ? { key: c.tableKey, isTableName: c.isTableName } : {}
  }

  it('funzione tabellare qualificata (dbo.fn_…) colorata come le tabelle', () => {
    const sql = 'SELECT * FROM dbo.fn_GIPAVUDUBES(1) f'
    expect(colorOf(sql, 'fn_GIPAVUDUBES', summaryTvf)).toEqual({ key: 'dbo.fn_GIPAVUDUBES', isTableName: true })
  })

  it('funzione tabellare senza schema colorata allo stesso modo', () => {
    const sql = 'SELECT * FROM fn_GUGAMIPU(2)'
    expect(colorOf(sql, 'fn_GUGAMIPU', summaryTvf)).toEqual({ key: 'dbo.fn_GUGAMIPU', isTableName: true })
  })

  it('funzione SCALARE (FN) non colorata', () => {
    const sql = 'SELECT dbo.fn_SUDOMUS(1)'
    expect(colorOf(sql, 'fn_SUDOMUS', summaryTvf).key).toBeUndefined()
  })

  it('#temp tokenizzata come UN token e colorata (enfatizzata)', () => {
    const sql = 'SELECT * FROM #temp'
    const tokens = tokenizeSql(sql)
    const tempTokens = tokens.filter(t => t.lower.includes('temp'))
    expect(tempTokens.length).toBe(1)
    expect(tempTokens[0].text).toBe('#temp')
    expect(colorOf(sql, '#temp').key).toBe('#temp')
    expect(colorOf(sql, '#temp').isTableName).toBe(true)
  })

  it('##global (temporanea globale) colorata', () => {
    const sql = 'SELECT * FROM ##global'
    expect(colorOf(sql, '##global').key).toBe('##global')
    expect(colorOf(sql, '##global').isTableName).toBe(true)
  })

  it('colonna qualificata di una #temp: col colore della temporanea', () => {
    const sql = 'SELECT #temp.id FROM #temp'
    expect(colorOf(sql, 'id').key).toBe('#temp')
    expect(colorOf(sql, 'id').isTableName).toBe(false)
  })

  it('tabelle temporanee diverse → colori diversi (chiavi diverse)', () => {
    expect(colorClassFor('#tmp1')).not.toBe(colorClassFor('#tmp2'))
  })

  it('in un documento ogni tabella DISTINTA ha un colore suo (niente collisioni di hash)', () => {
    // regressione utente: query con 4 tabelle dove ne comparivano solo 2 di colori
    const keys = [
      'dbo.RUN_ESEGUI',
      '#tbl_InventoryKitting_St1',
      'dbo.DAT_SCOMPART',
      'dbo.DAT_ORDINI_RIGHE',
    ]
    const map = colorClassMapForKeys(keys)
    expect(map.size).toBe(4)
    expect(new Set(map.values()).size).toBe(4) // tutti diversi
    for (const k of keys) expect(map.get(k)).toMatch(/^sql-tbl-\d+$/)
  })

  it('colorClassMapForKeys: il colore non collide finché la palette basta (12)', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `tbl_${String.fromCharCode(97 + i)}`)
    const map12 = colorClassMapForKeys(twelve)
    expect(new Set(map12.values()).size).toBe(12)
    // oltre la palette qualcosa si ripete (limite fisico di 12 colori)
    const thirteen = [...twelve, 'tbl_extra']
    const map13 = colorClassMapForKeys(thirteen)
    expect(new Set(map13.values()).size).toBe(12)
  })

  it('splitUserFunctions: FN → scalari (espressioni), IF/TF → tabellari (sorgenti)', () => {
    const { scalars, tableValued } = splitUserFunctions(summaryTvf.functions)
    expect(scalars.map(f => f.name)).toEqual(['fn_SUDOMUS'])
    expect(tableValued.map(f => f.name).sort()).toEqual(['fn_GIPAVUDUBES', 'fn_GUGAMIPU'].sort())
    // tipo sconosciuto → trattato come scalare (sicuro nelle espressioni)
    const unknown = splitUserFunctions([{ schema: 'dbo', name: 'fn_X', type: 'X' }])
    expect(unknown.scalars.map(f => f.name)).toEqual(['fn_X'])
    expect(unknown.tableValued.length).toBe(0)
  })

  it('splitUserFunctions: il backend manda i type_desc → riconosciuti come tabellari', () => {
    const reali = [
      { schema: 'dbo', name: 'fn_iebago', type: 'SQL_INLINE_TABLE_VALUED_FUNCTION' },
      { schema: 'dbo', name: 'fn_modod', type: 'SQL_TABLE_VALUED_FUNCTION' },
      { schema: 'dbo', name: 'fn_cum', type: 'CLR_TABLE_VALUED_FUNCTION' },
      { schema: 'dbo', name: 'fn_sudomus', type: 'SQL_SCALAR_FUNCTION' },
    ]
    const { scalars, tableValued } = splitUserFunctions(reali)
    expect(tableValued.map(f => f.name).sort()).toEqual(['fn_cum', 'fn_iebago', 'fn_modod'])
    expect(scalars.map(f => f.name)).toEqual(['fn_sudomus'])
  })

  it('isTableValuedFunctionType: codici brevi, type_desc e casi limite', () => {
    for (const t of ['IF', 'TF', 'if', 'tf', 'SQL_INLINE_TABLE_VALUED_FUNCTION', 'SQL_TABLE_VALUED_FUNCTION', 'CLR_TABLE_VALUED_FUNCTION']) {
      expect(isTableValuedFunctionType(t), t).toBe(true)
    }
    for (const t of ['FN', 'SQL_SCALAR_FUNCTION', 'CLR_SCALAR_FUNCTION', 'FS', 'X', '', null, undefined]) {
      expect(isTableValuedFunctionType(t as string), String(t)).toBe(false)
    }
  })
})
