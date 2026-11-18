// SELECT con CASE "lungo" (più WHEN sulla stessa riga) e commenti prima dell'INTO.
//
// SEGNALAZIONE UTENTE: "perché il format non riesce a mettere i when a capo di questa query?" — con i
// commenti "--,X_TARGET_MIN / --,X_TARGET" subito prima di INTO la SELECT veniva spezzata in due: il CASE
// restava a metà (un solo WHEN a capo) e FROM/JOIN finivano su una riga sola.
import { describe, expect, it } from 'vitest'
import { formatSqlWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)
const fmt = (sql: string) => formatSqlWithProfile(sql, profile).replace(/\r\n/g, '\n')

const SQL = `SELECT DISTINCT ROW_NUMBER () OVER (ORDER BY UDC_UDC) AS X_ID
   ,X_UDC = UDC_UDC
   ,X_MSGKO =
   CASE
     WHEN BCO_ABI = 0
       THEN 'Bay disabled'
   WHEN UDC_STADISPUDC <> 'D' OR NOT UDC_UBIUDC IN ('M', 'I')
   THEN '#10.' + dbo.fn_td ('LU not available')
    WHEN UDC_CELLA = 0 THEN '#12.' + dbo.fn_td ('LU not available') WHEN NOT (UDC_UBIUDC = 'I' OR (CEL_CELLA > 0 AND CEL_STACELLA IN ('O', 'L', 'IP', 'IV'))) OR COR_GEST_LGV_USER = 1 THEN '#23.' + dbo.fn_td ('Stato cella o ubicazione non valida per l''operazione') WHEN UDC_NESE > 0 OR UDC_CAUSMISS > '' THEN '#25.' + dbo.fn_td ('LU occupy')
   ELSE '' /* Scomparto ancora candidato */ END
   ,X_NOTE = 'refilling'
--,X_TARGET_MIN
--,X_TARGET
INTO #TMP_ACTIONS FROM MAG_BAIE INNER JOIN DAT_UDC ON BCO_USOBAIA LIKE '%,VNABS,%' --solo baie
  INNER JOIN DAT_SCOMPART ON SCO_UDC = UDC_UDC /*and SCO_STAMATE='U'*/ INNER JOIN DAT_ARTICOLI ON ART_ARTICOLO = SCO_ARTICOLO
WHERE UDC_UDC > 0 AND UDC_CELLA > 0`

describe('CASE lungo spezzato su ogni WHEN', () => {
  it('ogni WHEN va su una riga propria, allo stesso rientro', () => {
    const out = fmt(SQL)
    console.log(out)
    const righe = out.split('\n')
    const when = righe.filter(r => /^\s*WHEN /.test(r))
    expect(when.length).toBe(5)
    const rientri = new Set(when.map(r => r.length - r.trimStart().length))
    expect(rientri.size).toBe(1)
    // nessuna riga con due WHEN
    expect(righe.some(r => (r.match(/\bWHEN\b/g) ?? []).length > 1)).toBe(false)
  })

  it('INTO va su riga propria e le clausole sono spezzate', () => {
    const righe = fmt(SQL).split('\n')
    expect(righe.some(r => /^INTO #TMP_ACTIONS$/.test(r.trim()))).toBe(true)
    expect(righe.some(r => /^FROM MAG_BAIE$/.test(r.trim()))).toBe(true)
    expect(righe.some(r => /^WHERE UDC_UDC > 0$/.test(r.trim()))).toBe(true)
  })

  it('i commenti restano e il CASE non perde token', () => {
    const out = fmt(SQL)
    expect(out).toContain('--,X_TARGET_MIN')
    expect(out).toContain('--,X_TARGET')
    expect(out).toContain("/* Scomparto ancora candidato */")
    const firma = (s: string) =>
      tokenizeSqlText(s)
        .filter(t => t.type !== 'comment')
        .map(t => t.type + ':' + t.text.toUpperCase())
        .sort()
        .join('|')
    expect(firma(out)).toBe(firma(SQL))
  })

  it('è idempotente', () => {
    const una = fmt(SQL)
    expect(fmt(una)).toBe(una)
  })
})
