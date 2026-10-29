// AIUTO MIRATO PER LA GROUP BY (richiesta utente: "puoi anche mettere un aiuto per autocompletamento o
// altro, quando si fa la group by che sia più mirato").
// In T-SQL la GROUP BY deve contenere TUTTE le espressioni della select-list che non sono aggregate:
// quindi i suggerimenti devono arrivare in quest'ordine:
//  1) una voce "aiuto" che riempie la clausola con le espressioni non aggregate mancanti;
//  2) le espressioni non aggregate della select-list (nell'ordine della select-list);
//  3) solo dopo, le altre colonne delle tabelle dello statement.
import { describe, expect, it } from 'vitest'
import { buildGroupBySuggestions, groupByAllText } from '../helpers'
import { classifyContext } from '../intellisenseContext'

describe('classifyContext: GROUP BY riconosciuta', () => {
  it('dopo "GROUP BY " il contesto è groupBy', () => {
    const ctx = classifyContext({ prefix: 'GROUP BY ', stmtBefore: 'SELECT A FROM T GROUP BY ' })
    expect(ctx.inGroupBy).toBe(true)
    expect(ctx.inOrderBy).toBe(false)
    expect(ctx.kind).toBe('groupBy')
  })

  it('dopo la virgola dentro la GROUP BY resta groupBy', () => {
    const ctx = classifyContext({ prefix: 'GROUP BY a, ', stmtBefore: 'SELECT a, b FROM T GROUP BY a, ' })
    expect(ctx.inGroupBy).toBe(true)
  })

  it('nella ORDER BY non è groupBy', () => {
    const ctx = classifyContext({ prefix: 'ORDER BY ', stmtBefore: 'SELECT a FROM T ORDER BY ' })
    expect(ctx.inGroupBy).toBe(false)
    expect(ctx.inOrderBy).toBe(true)
  })
})

describe('buildGroupBySuggestions: colonne non aggregate della select-list', () => {
  const stmt = `SELECT A.ART_CODICE,
       A.ART_DES,
       SUM(G.GIA_QTA) AS TOT,
       COUNT(*) AS RIGHE,
       COALESCE(A.ART_CLASSE, 'X') AS CLASSE
FROM dbo.ARTICOLI AS A
  INNER JOIN dbo.GIACENZE AS G ON G.GIA_ARTICOLO = A.ART_ID
GROUP BY `

  it('propone SOLO le espressioni non aggregate, senza alias', () => {
    const voci = buildGroupBySuggestions(stmt, stmt)
    const testi = voci.map(v => v.insertText)
    console.log(`  voci: ${JSON.stringify(testi)}`)
    expect(testi).toEqual(['A.ART_CODICE', 'A.ART_DES', "COALESCE(A.ART_CLASSE, 'X')"])
    // gli aggregati e gli alias NON entrano nella GROUP BY
    expect(testi.some(t => /SUM|COUNT/.test(t))).toBe(false)
    expect(testi.some(t => /\bAS\b/i.test(t))).toBe(false)
  })

  it('ogni voce ha il dettaglio che spiega perché', () => {
    const voci = buildGroupBySuggestions(stmt, stmt)
    expect(voci.every(v => v.detail.includes('non aggregata'))).toBe(true)
    expect(voci.every(v => v.origine === 'select')).toBe(true)
  })

  it('le colonne già scritte nella GROUP BY non vengono riproposte', () => {
    const conUna = `${stmt}A.ART_CODICE, `
    const voci = buildGroupBySuggestions(conUna, conUna)
    expect(voci.map(v => v.insertText)).toEqual(['A.ART_DES', "COALESCE(A.ART_CLASSE, 'X')"])
  })

  it('il testo per riempire tutta la clausola è la lista delle voci', () => {
    const voci = buildGroupBySuggestions(stmt, stmt)
    expect(groupByAllText(voci)).toBe("A.ART_CODICE, A.ART_DES, COALESCE(A.ART_CLASSE, 'X')")
  })

  it('senza aggregati propone tutta la select-list; con solo aggregati non propone nulla', () => {
    const senza = `SELECT A.X, A.Y FROM T A GROUP BY `
    expect(buildGroupBySuggestions(senza, senza).map(v => v.insertText)).toEqual(['A.X', 'A.Y'])
    const soloAgg = `SELECT SUM(A.X) AS T FROM T A GROUP BY `
    expect(buildGroupBySuggestions(soloAgg, soloAgg)).toEqual([])
  })

  it('TOP e DISTINCT davanti alla colonna non restano nel suggerimento', () => {
    const sql = `SELECT TOP 10 DISTINCT A.X FROM T A GROUP BY `
    expect(buildGroupBySuggestions(sql, sql).map(v => v.insertText)).toEqual(['A.X'])
  })
})
