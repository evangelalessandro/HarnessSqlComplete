// ALLINEAMENTO DEGLI ALIAS NELLA SELECT-LIST.
// Segnalazione utente: "non mette in colonna gli alias dei campi nella cte".
// L'allineamento c'era solo nel motore delle routine; ora è un passaggio finale valido per tutti i
// motori (corpo della CTE e query semplici compresi).
import { describe, expect, it } from 'vitest'
import { allineaAliasSelectList, allineaBlocco } from '../aliasAlign'

/** Colonne di inizio del TESTO dell'alias (con "AS" quando c'è, come fa il formattatore). */
const colonneAlias = (righe: string[], alias: string[]) =>
  righe
    .map(r => r.replace(/\s*--.*$/, '').trimEnd())
    .filter(t => alias.some(a => new RegExp(`(^|\\s)${a}$`).test(t)))
    .map(t => {
      const conAs = /(?:^|\s)(AS\s+[A-Za-z_]\w*)$/.exec(t)
      const nome = /(?:^|\s)([A-Za-z_]\w*)$/.exec(t)!
      return conAs ? t.length - conAs[1].length : t.length - nome[1].length
    })

describe('allineaAliasSelectList: alias in colonna', () => {
  it('allinea gli alias di una select-list impilata', () => {
    const sql = `SELECT TOP 1 UDC_SSCC X_SSCC
   ,UDC_ARTICOLO X_SKU
   ,ART_DES X_SKU_DESC
   ,GM_MODULO AS X_MODULO
   ,UDC_USER_TASK
   ,BCO_USOBAIA X_USO_BAIA
FROM RUN_MISSIONI`
    const out = allineaAliasSelectList(sql).split('\n')
    out.forEach(r => console.log(`  ${r.replace(/ /g, '·')}`))
    const colonne = colonneAlias(out, ['X_SSCC', 'X_SKU', 'X_SKU_DESC', 'X_MODULO', 'X_USO_BAIA'])
    expect(colonne).toHaveLength(5)
    expect(new Set(colonne).size).toBe(1)
    // il campo senza alias resta com'è
    expect(out[4].trim()).toBe(',UDC_USER_TASK')
  })

  it('è idempotente', () => {
    const sql = `SELECT a X_1
   ,bbbb X_2
FROM t`
    const una = allineaAliasSelectList(sql)
    expect(allineaAliasSelectList(una)).toBe(una)
  })

  it('con un solo campo con alias non tocca niente', () => {
    const sql = `SELECT a X_1
   ,bbbb
FROM t`
    expect(allineaAliasSelectList(sql)).toBe(sql)
  })

  it('NON tocca DECLARE, EXEC e le colonne di un INSERT', () => {
    const sql = `DECLARE @a INT
     ,@txtError NVARCHAR(max)
EXEC p @a = @a
     ,@b = @txtError
INSERT INTO #t (A
               ,BBBB)`
    expect(allineaAliasSelectList(sql)).toBe(sql)
  })

  it('il commento "--" resta dopo l alias allineato', () => {
    const sql = `SELECT TOP 1 SCO_SCOMPARTO X_SCO --sorgente
   ,IIF (A > '', A, B) X_SSCC --sorgente
FROM t`
    const out = allineaAliasSelectList(sql).split('\n')
    out.forEach(r => console.log(`  ${r.replace(/ /g, '·')}`))
    expect(out[0]).toMatch(/X_SCO --sorgente$/)
    expect(out[1]).toMatch(/X_SSCC --sorgente$/)
    const col0 = out[0].indexOf('X_SCO')
    const col1 = out[1].indexOf('X_SSCC')
    expect(col0).toBe(col1)
  })

  it('allineaBlocco: una lista con spazi già abbondanti non perde pezzi', () => {
    const righe = ['SELECT a    X_1', '   ,b X_2']
    const out = allineaBlocco(righe)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatch(/^SELECT a\s+X_1$/)
    expect(out[1]).toMatch(/^ {3},b\s+X_2$/)
    expect(out[0].indexOf('X_1')).toBe(out[1].indexOf('X_2'))
  })
})
