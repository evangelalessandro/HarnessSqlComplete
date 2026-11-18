// "SELECT … INTO #t" con ASSEGNAZIONI nel select-list: le colonne della temporanea devono esserci.
//
// SEGNALAZIONE UTENTE: "in questa query sotto l'intellisense non mi suggerisce i nomi colonna dalla tabella
// #TMP_ACTIONS" — il select-list usava la forma "X_PROCESSED = 0", "X_MSGKO = CASE … END" e quei campi
// non venivano riconosciuti: la temporanea risultava senza quelle colonne.
import { describe, expect, it } from 'vitest'
import { extractLocalTables } from '../localTables'
import { buildColumnContextSuggestions } from '../helpers'
import type { DatabaseSummary } from '../types'

const PROC = `CREATE OR ALTER PROCEDURE dbo.p
AS
SELECT DISTINCT ROW_NUMBER () OVER (ORDER BY UDC_UDC) AS X_ID
   ,X_PROCESSED = 0
   ,X_TYPE = 'CC_KIT'
   ,X_ARTICLE = SCO_ARTICOLO
   ,X_MSGKO =
   CASE
     WHEN UDC_STADISPUDC <> 'D' OR NOT UDC_UBIUDC IN ('M', 'I')
       THEN '#10.' + dbo.fn_td ('LU not available')
     WHEN UDC_CELLA = 0
       THEN '#12.' + dbo.fn_td ('LU not available')
     ELSE '' /* Scomparto ancora candidato */
   END
  ,X_NOTE = 'cc'
  ,X_DEST_CELL = dest.CEL_CELLA
  ,X_DEST_CORR = dest.CEL_CORRIDOIO
INTO #TMP_ACTIONS
FROM DAT_UDC
WHERE UDC_UDC > 0

SELECT * FROM #TMP_ACTIONS WHERE X_`

const summaryVuoto = {
  tables: [],
  views: [],
  procedures: [],
  triggers: [],
  checkConstraints: [],
  functions: [],
  foreignKeys: [],
  databases: [],
  cooccurrences: [],
} as unknown as DatabaseSummary

describe('SELECT … INTO con assegnazioni: colonne della temporanea', () => {
  it('riconosce tutti i campi, anche quelli con "nome = valore"', () => {
    const tmp = extractLocalTables(PROC, []).find(t => t.name === '#TMP_ACTIONS')
    expect(tmp).toBeDefined()
    const nomi = (tmp!.columns ?? []).map(c => c.name)
    expect(nomi).toEqual([
      'X_ID',
      'X_PROCESSED',
      'X_TYPE',
      'X_ARTICLE',
      'X_MSGKO',
      'X_NOTE',
      'X_DEST_CELL',
      'X_DEST_CORR',
    ])
  })

  it('il CASE dell\'assegnazione non sporca la lista', () => {
    const nomi = (extractLocalTables(PROC, []).find(t => t.name === '#TMP_ACTIONS')!.columns ?? []).map(c => c.name)
    // nessun nome può essere una parola chiave del CASE
    expect(nomi.some(n => /^(WHEN|THEN|CASE|END|ELSE)$/i.test(n))).toBe(false)
    // e le colonne sono esattamente quelle attese
    expect(nomi.length).toBe(8)
  })

  it('nella WHERE della temporanea le colonne sono proposte', () => {
    const tabelle = extractLocalTables(PROC, [])
    const s = { ...summaryVuoto, tables: tabelle } as DatabaseSummary
    const stmt = 'SELECT * FROM #TMP_ACTIONS WHERE X_'
    const out = buildColumnContextSuggestions(stmt, stmt, 'X_', s)
    const nomi = out.map(o => o.name)
    expect(nomi).toContain('X_MSGKO')
    expect(nomi).toContain('X_PROCESSED')
    expect(nomi.every(n => n.toLowerCase().startsWith('x_'))).toBe(true)
  })

  it('vale anche per un INTO senza FROM', () => {
    const tmp = extractLocalTables(`SELECT A = 1, B = 2, C = 'x' INTO #t`, []).find(t => t.name === '#t')
    expect((tmp?.columns ?? []).map(c => c.name)).toEqual(['A', 'B', 'C'])
  })

  it('la forma "espressione AS nome" continua a funzionare', () => {
    const tmp = extractLocalTables(`SELECT COUNT (*) AS TOT, SUM (Q) AS SOMMA INTO #agg FROM T`, []).find(
      t => t.name === '#agg',
    )
    expect((tmp?.columns ?? []).map(c => c.name)).toEqual(['TOT', 'SOMMA'])
  })
})
