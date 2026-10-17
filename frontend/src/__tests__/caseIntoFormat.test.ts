// CASE nella select-list con INTO su tabella temporanea.
//
// Segnalazione utente: "la formattazione per le query con delle select e into tabella temporanea
// non funzionano bene quando c'è un case" → "into #tmp deve stare sempre a capo".
//
// Causa: la select-list impilata spezzava prima di INTO solo se la testata INIZIAVA con SELECT.
// Quando c'è un CASE, la testata viene divisa (prima parte / CASE / coda) e la coda comincia con
// la virgola (", altro_campo INTO #t"): lì l'INTO non veniva mai spezzato e finiva attaccato a
// "END AS X…". Sistemati anche la virgola in coda alla testata (ora va in testa al CASE) e il
// rientro dei campi che seguono il CASE (allineati alla colonna del CASE).
import { describe, expect, it } from 'vitest'
import { formatRoutineWithProfile, formatSqlWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)
const fmtQ = (sql: string) => formatSqlWithProfile(sql, profile)
const fmtR = (sql: string) => formatRoutineWithProfile(sql, profile)

/** Firma dei token: la formattazione non deve perdere né inventare nulla. */
function firmaToken(sql: string): string[] {
  return tokenizeSqlText(sql)
    .map(t => `${t.type}:${t.text.toLowerCase().replace(/\s+/g, ' ').trim()}`)
    .sort()
}

/** Righe che contengono la clausola INTO verso quella tabella (per controllare che sia da sola). */
function righeConInto(out: string, tabella: string): string[] {
  const nome = tabella.replace(/^#/, '')
  return out.split('\n').filter(r => new RegExp(`INTO\\s+\\[?#?${nome}\\b`, 'i').test(r))
}

const casi: [string, string][] = [
  ['CASE unico con alias', `SELECT CASE WHEN UDC_CAUSMISS <> '' THEN 'LU used' ELSE '' END AS X_CAUSMISS INTO #tmpAcc FROM dbo.DAT_UDC WHERE UDC_UDC > 0`],
  ['campi + CASE + campi', `SELECT UDC_UDC X_UDC, CASE WHEN A = 1 THEN 'x' WHEN A = 2 THEN 'y' ELSE 'z' END AS X_FLAG, UDC_TAG X_TAG INTO #tmpAcc FROM dbo.DAT_UDC WHERE UDC_UDC > 0`],
  ['CASE senza alias', `SELECT UDC_UDC, CASE WHEN A = 1 THEN 1 ELSE 0 END, UDC_TAG INTO #tmpAcc FROM dbo.DAT_UDC WHERE UDC_UDC > 0`],
]

describe('SELECT … CASE … INTO #tmp', () => {
  for (const [nome, sql] of casi) {
    it(`${nome}: INTO su riga propria`, () => {
      const out = fmtQ(sql)
      console.log(`\n  ${nome}\n${out.split('\n').map(r => `    |${r}`).join('\n')}`)
      // INTO a MARGINE, da solo su quella riga (niente codice prima o dopo)
      expect(out).toMatch(/^INTO #tmpAcc$/m)
      const conInto = righeConInto(out, 'tmpAcc')
      expect(conInto.length).toBe(1)
      expect(conInto[0].trim()).toBe('INTO #tmpAcc')
    })

    it(`${nome}: nessun token perso e formattazione idempotente`, () => {
      const out = fmtQ(sql)
      expect(firmaToken(out)).toEqual(firmaToken(sql))
      expect(fmtQ(out)).toBe(out)
    })
  }

  it('la virgola prima del CASE va IN TESTA al CASE (niente virgola in coda alla testata)', () => {
    const out = fmtQ(casi[1][1])
    expect(out).toMatch(/^SELECT UDC_UDC X_UDC$/m)
    expect(out).toMatch(/^ {2},CASE$/m)
    expect(out).not.toMatch(/X_UDC,$/m)
  })

  it('i campi dopo il CASE si allineano alla colonna del CASE', () => {
    const out = fmtQ(casi[1][1])
    const righe = out.split('\n')
    const iCaso = righe.findIndex(r => r.trim() === ',CASE')
    const iTag = righe.findIndex(r => r.trim() === ',UDC_TAG X_TAG')
    expect(iCaso).toBeGreaterThan(-1)
    expect(iTag).toBeGreaterThan(iCaso)
    expect(righe[iCaso].search(/\S/)).toBe(righe[iTag].search(/\S/))
  })

  it('dentro una store il comportamento è lo stesso (INTO al rientro del blocco)', () => {
    const store = `CREATE PROCEDURE p
AS
BEGIN
  SELECT UDC_UDC X_UDC, CASE WHEN A = 1 THEN 'x' ELSE 'y' END AS X_FLAG INTO #tmpAcc FROM dbo.DAT_UDC WHERE UDC_UDC > 0
END`
    const out = fmtR(store)
    console.log(`\n  dentro la store\n${out.split('\n').map(r => `    |${r}`).join('\n')}`)
    expect(out).toMatch(/^ {4}INTO #tmpAcc$/m)
    const conInto = righeConInto(out, 'tmpAcc')
    expect(conInto.length).toBe(1)
    expect(conInto[0].trim()).toBe('INTO #tmpAcc')
    expect(firmaToken(out)).toEqual(firmaToken(store))
    expect(fmtR(out)).toBe(out)
  })

  it('INSERT … SELECT con CASE: INTO della tabella resta nella testata dell INSERT', () => {
    const sql = `CREATE PROCEDURE p AS
BEGIN
  INSERT INTO #tmpDest (A, B)
  SELECT X_UDC, CASE WHEN A = 1 THEN 'x' ELSE 'y' END AS X_FLAG
  FROM dbo.DAT_UDC
END`
    const out = fmtR(sql)
    console.log(`\n  INSERT … SELECT\n${out.split('\n').map(r => `    |${r}`).join('\n')}`)
    // l'INTO dell'INSERT NON deve andare a capo (è la testata dello statement) e i campi
    // restano incolonnati sotto il primo
    const righe = out.split('\n')
    const iA = righe.findIndex(r => r.includes('INSERT INTO #tmpDest (A'))
    const iB = righe.findIndex(r => r.trim() === ',B)')
    expect(iA).toBeGreaterThan(-1)
    expect(iB).toBe(iA + 1)
    expect(righe[iB].indexOf(',B)')).toBe(righe[iA].indexOf('(A') + 1)
    expect(firmaToken(out)).toEqual(firmaToken(sql))
  })
})
