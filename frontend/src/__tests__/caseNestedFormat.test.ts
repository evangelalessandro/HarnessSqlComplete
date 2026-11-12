// CASE ANNIDATO dentro un THEN: il CASE interno deve stare un livello più dentro e il suo END non deve
// chiudere al livello del CASE esterno (segnalazione utente sulla formattazione di una SELECT con due
// CASE, uno dentro l'altro).
import { describe, expect, it } from 'vitest'
import { formatSqlWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)
const fmt = (sql: string) => formatSqlWithProfile(sql, profile).replace(/\r\n/g, '\n')

const SQL = `SELECT ESE_ID, RIG_RIGA,
     CASE
       WHEN NOT MIS_MISSIONE IS NULL
         THEN iif (BCO_USOBAIA LIKE '%,KITPK,%' AND MIS_L2STA IN ('WS'), 1, 0)
       ELSE 0
     END,
     CASE
       WHEN BCO_USOBAIA LIKE '%,KITPK,%'
         THEN CASE
       WHEN BCO_SKU = ''
         THEN 'IN TRANSIT BAY'
       ELSE 'IN MOVING'
     END
     WHEN UDC_CELLA > 0
         THEN 'RACK'
       ELSE 'NOT READY'
     END
  FROM DAT_ORDINI_RIGHE
  WHERE RIG_ORDINE = @ordine`

const rientro = (r: string) => r.length - r.trimStart().length

describe('CASE annidato dentro un THEN', () => {
  it('il CASE interno è più indentato del THEN che lo contiene', () => {
    const righe = fmt(SQL).split('\n')
    console.log(righe.join('\n'))
    const iThenCaso = righe.findIndex(r => r.trim().startsWith('THEN CASE'))
    expect(iThenCaso).toBeGreaterThan(-1)
    const iWhenInterno = iThenCaso + 1
    expect(righe[iWhenInterno].trim().startsWith('WHEN BCO_SKU')).toBe(true)
    expect(rientro(righe[iWhenInterno])).toBe(rientro(righe[iThenCaso]) + 2)
  })

  it("l'END interno sta un livello dentro l'END esterno", () => {
    const righe = fmt(SQL).split('\n')
    // tre CASE: il primo elemento e i due annidati del secondo
    const end = righe
      .map((r, i) => ({ i, t: r.trim() }))
      .filter(x => x.t === 'END')
    expect(end.length).toBe(3)
    // il CASE interno pende dal THEN (due passi in dentro rispetto al CASE esterno)
    expect(rientro(righe[end[1].i])).toBe(rientro(righe[end[2].i]) + 4)
    // l'END del primo elemento e quello esterno del secondo stanno allo stesso livello
    expect(rientro(righe[end[0].i])).toBe(rientro(righe[end[2].i]))
  })

  it('dopo l END interno, il WHEN del CASE esterno torna al suo livello', () => {
    const righe = fmt(SQL).split('\n')
    const iEndInterno = righe.findIndex(r => r.trim() === 'END')
    const iWhenEsterno = righe.findIndex((r, i) => i > iEndInterno && r.trim().startsWith('WHEN UDC_CELLA'))
    expect(iWhenEsterno).toBeGreaterThan(iEndInterno)
    const iWhenEsternoPrimo = righe.findIndex(r => r.trim().startsWith('WHEN BCO_USOBAIA'))
    expect(rientro(righe[iWhenEsterno])).toBe(rientro(righe[iWhenEsternoPrimo]))
  })

  it('è idempotente e non perde token', () => {
    const firma = (s: string) =>
      tokenizeSqlText(s)
        .filter(t => t.type !== 'comment')
        .map(t => t.type + ':' + t.text.toUpperCase())
        .sort()
        .join('|')
    const una = fmt(SQL)
    expect(fmt(una)).toBe(una)
    expect(firma(una)).toBe(firma(SQL))
  })
})
