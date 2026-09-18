// Impaginazione degli INSERT: campi e valori uno per riga, allineati sotto il primo.
//
// Segnalato dall'utente sull'output della store dbo.ws_L2_HAVO_IEDUGI_AESIPE: l'INSERT con
// 17 campi usciva su una riga sola (colonne e valori), con i CASE dentro i VALUES che
// rompevano il layout a metà. Le stesse regole valgono dentro e fuori le store.
import { describe, expect, it } from 'vitest'
import { formatRoutineWithProfile, formatSqlWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { buildFormatProfile, loadFormatProfileXml } from '../formatProfile'
import avvisi from './fixtures/routine_ws_L2_HAVO_IEDUGI_AESIPE.sql?raw'

const profile = buildFormatProfile(loadFormatProfileXml())

/** Firma dei token (tipo + testo, senza differenze di maiuscole): niente token persi/inventati. */
function firmaToken(sql: string): string[] {
  return tokenizeSqlText(sql)
    .map(t => `${t.type}:${t.text.toLowerCase().replace(/\s+/g, ' ').trim()}`)
    .sort()
}

const inStore = (sql: string) => `CREATE PROCEDURE p AS\nBEGIN\n  ${sql}\nEND`

describe('INSERT: campi e valori uno per riga', () => {
  it('due campi: uno per riga, allineati sotto il primo', () => {
    const out = formatSqlWithProfile('insert into ordini (id, cliente_id) values (1, 2)', profile)
    expect(out).toBe('INSERT INTO ordini (id\n                    ,cliente_id)\nVALUES (1\n        ,2)\n')
  })

  it('dentro una store lo stesso INSERT ha la stessa forma', () => {
    const sql = 'insert into ordini (id, cliente_id) values (1, 2)'
    const fuori = formatSqlWithProfile(sql, profile)
    const dentro = formatRoutineWithProfile(inStore(sql), profile)
    // ogni riga dell'INSERT "da solo" si ritrova identica (a meno dell'indentazione del blocco)
    for (const riga of fuori.trimEnd().split('\n')) expect(dentro).toContain(riga.trim())
  })

  it('un solo campo e un solo valore restano su una riga', () => {
    expect(formatSqlWithProfile('insert into t (a) values (1)', profile)).toBe('INSERT INTO t (a) VALUES (1)')
    expect(formatRoutineWithProfile(inStore('insert into t (a) values (1)'), profile)).toContain(
      'INSERT INTO t (a) VALUES (1)',
    )
  })

  it('i valori con CASE si espandono mantenendo l allineamento', () => {
    const sql =
      "insert into t (a, b) values (1, CASE WHEN @x > '' THEN dbo.fn_f (@x, 'yyyy-MM-dd') ELSE '' END)"
    const out = formatSqlWithProfile(sql, profile)
    expect(out).toMatch(/^VALUES \(1$/m)
    expect(out).toMatch(/^        ,CASE$/m)
    expect(out).toMatch(/^            WHEN @x > ''$/m)
    expect(out).toMatch(/^              THEN dbo\.fn_f \(@x, 'yyyy-MM-dd'\)$/m)
    expect(out).toMatch(/^            ELSE ''$/m)
    expect(out).toMatch(/^          END\)$/m)
    expect(firmaToken(out)).toEqual(firmaToken(sql))
  })

  it('INSERT … SELECT: campi e VALORI uno per riga (dentro e fuori)', () => {
    const sql = 'insert into t (a, b, c) select x, y, z from dbo.U where x > 0'
    const fuori = formatSqlWithProfile(sql, profile)
    const dentro = formatRoutineWithProfile(inStore(sql), profile)
    // i VALORI di un INSERT … SELECT sono i valori dell'insert: uno per riga e allineati sotto
    // il primo, come i campi (segnalazione utente: prima restavano tutti su una riga)
    expect(fuori).toBe(
      'INSERT INTO t (a\n               ,b\n               ,c)\nSELECT x\n   ,y\n   ,z\nFROM dbo.U\nWHERE x > 0\n',
    )
    // dentro la store compaiono le stesse righe (con l'indentazione del blocco)
    for (const riga of fuori.trimEnd().split('\n')) expect(dentro).toContain(riga.trim())
  })

  it('non perde né inventa token (dentro e fuori)', () => {
    const sql =
      "insert into dbo.T (a, b, c) values (1, isnull (@p, ''), CASE WHEN @p > '' THEN dbo.f (@p) ELSE '' END)"
    expect(firmaToken(formatSqlWithProfile(sql, profile))).toEqual(firmaToken(sql))
    expect(firmaToken(formatRoutineWithProfile(inStore(sql), profile))).toEqual(firmaToken(inStore(sql)))
  })
})

describe('store reale: dbo.ws_L2_HAVO_IEDUGI_AESIPE', () => {
  const formattata = formatRoutineWithProfile(avvisi, profile)

  it('l INSERT con 17 campi è impaginato uno per riga', () => {
    const righe = formattata.split('\n')
    const inizio = righe.findIndex(r => r.includes('INSERT INTO DAT_ORDINI_RIGHE'))
    expect(inizio).toBeGreaterThan(0)
    const blocco = righe.slice(inizio, inizio + 20).join('\n')
    expect(blocco).toMatch(/INSERT INTO DAT_ORDINI_RIGHE \(RIG_ORDINE\n\s+,RIG_ARTICOLO\n\s+,RIG_SUB1\n/)
    expect(blocco).toMatch(/\n\s*VALUES \(@ordine\n\s+,@pRIG_ARTICOLO\n/)
  })

  it('i valori con CASE (DPRO/DSCA) sono espansi e allineati', () => {
    expect(formattata).toMatch(/^          ,CASE$/m)
    expect(formattata).toMatch(/^              WHEN @pRIG_DPRO > ''$/m)
    expect(formattata).toMatch(/^              WHEN @pRIG_DSCA > ''$/m)
  })

  it('la lista di assegnazioni SELECT @var = … va una per riga, con i = allineati', () => {
    expect(formattata).toMatch(/^SELECT$/m)
    expect(formattata).toMatch(/^   @pRIG_ARTICOLO = rtrim \(@pRIG_ARTICOLO\)$/m)
    expect(formattata).toMatch(/^  ,@pRIG_SUB1     = rtrim \(@pRIG_SUB1\)$/m)
  })

  it('nessun token perso o inventato, e riformattare non cambia nulla', () => {
    expect(firmaToken(formattata)).toEqual(firmaToken(avvisi))
    expect(formatRoutineWithProfile(formattata, profile)).toBe(formattata)
  })
})
