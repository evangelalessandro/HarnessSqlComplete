// Formattazione di una ROUTINE VERA: la select-list deve venire impilata come quando lo
// stesso statement è da solo.
//
// Segnalato dall'utente: lo stesso SELECT ... INTO formattato da solo produceva la lista a
// colonna (virgole in testa, INTO su riga propria), ma dentro una store lunga restava tutto
// su una riga. Causa: le routine usano un motore di layout diverso (formatRoutineWithProfile →
// detailedSelectRows) che non impilava la select-list.
//
// Il fixture è la definizione reale di dbo.ws_L2_SUSEVOMOPEPESESE_FIB (1125 righe) presa dal
// database: serve a garantire che il caso vero non si rompa più.
import { describe, expect, it } from 'vitest'
import { formatRoutineWithProfile, formatSqlWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { buildFormatProfile, loadFormatProfileXml } from '../formatProfile'
import procedura from './fixtures/routine_ws_L2_SUSEVOMOPEPESESE_FIB.sql?raw'

const profile = buildFormatProfile(loadFormatProfileXml())

/** Firma dei token di un testo (tipo + testo, senza differenze di maiuscole): serve a
 *  controllare che la formattazione non perda né inventi nulla. */
function firmaToken(sql: string): string[] {
  return tokenizeSqlText(sql)
    .map(t => `${t.type}:${t.text.toLowerCase().replace(/\s+/g, ' ').trim()}`)
    .sort()
}

describe('routine reale: select-list impilata come da sola', () => {
  const formattata = formatRoutineWithProfile(procedura, profile)

  it('la SELECT ... INTO dentro la store è impilata', () => {
    expect(formattata).toMatch(/^SELECT MIS_MISSIONE$/m)
    // un campo per riga (prima i campi corti venivano raggruppati a due per riga)
    expect(formattata).toMatch(/^   ,MIS_UDC$/m)
    expect(formattata).toMatch(/^   ,MIS_BEG_L1$/m)
    expect(formattata).toMatch(/^   ,MIS_S_BAIA$/m)
    expect(formattata).toMatch(/^   ,MIS_S_CORRIDOIO$/m)
    expect(formattata).toMatch(/^   ,MIS_D_CORRIDOIO$/m)
    expect(formattata).toMatch(/^   ,MIS_NOBACK$/m)
    // INTO su riga propria, allineato alla SELECT
    expect(formattata).toMatch(/^INTO #ws_L2_SUSEVOMOPEPESESE_FIB_MASIDAPU_fodopege$/m)
  })

  it('lo stesso statement da solo dà la stessa forma', () => {
    const solo = `SELECT MIS_MISSIONE, MIS_UDC, MIS_BEG_L1, MIS_S_BAIA, MIS_S_CORRIDOIO, MIS_D_CORRIDOIO, MIS_NOBACK INTO #ws_L2_SUSEVOMOPEPESESE_FIB_MASIDAPU_fodopege
FROM dbo.RUN_MISSIONI
WHERE MIS_MISSIONE <> @idMissione`
    const out = formatSqlWithProfile(solo, profile)
    expect(out).toMatch(/^SELECT MIS_MISSIONE$/m)
    expect(out).toMatch(/^   ,MIS_UDC$/m)
    expect(out).toMatch(/^   ,MIS_BEG_L1$/m)
    expect(out).toMatch(/^INTO #ws_L2_SUSEVOMOPEPESESE_FIB_MASIDAPU_fodopege$/m)
  })

  it('la formattazione è idempotente: riformattare non cambia nulla', () => {
    const seconda = formatRoutineWithProfile(formattata, profile)
    expect(seconda).toBe(formattata)
  })

  it('non perde né inventa token (commenti compresi)', () => {
    expect(firmaToken(formattata)).toEqual(firmaToken(procedura))
  })

  it('i commenti della store restano al loro posto', () => {
    expect(formattata).toContain('/* Get a filtered mission list to use in next queries */')
    expect(formattata).toContain('CREATE PROCEDURE [dbo].[ws_L2_SUSEVOMOPEPESESE_FIB]')
  })
})

describe('select-list impilata dentro blocchi e procedure (casi minimi)', () => {
  const casi: [string, string][] = [
    ['IF BEGIN', 'IF 1 = 1\nBEGIN\n  SELECT a, b, c FROM dbo.T\nEND'],
    ['BEGIN TRAN', 'BEGIN TRAN\nSELECT a, b, c FROM dbo.T\nCOMMIT'],
    ['store con SET NOCOUNT', 'CREATE PROCEDURE p AS\nSET NOCOUNT ON\nSELECT a, b, c FROM dbo.T'],
    ['store con BEGIN/END', 'CREATE PROCEDURE p AS\nBEGIN\n  SELECT a, b, c FROM dbo.T\nEND'],
    ['SELECT INTO dentro un blocco', 'BEGIN\n  SELECT a, b, c INTO #t FROM dbo.T\nEND'],
  ]
  for (const [nome, sql] of casi) {
    it(`${nome}: virgole in testa e nessuna lista su una riga sola`, () => {
      const out = formatRoutineWithProfile(sql, profile)
      expect(out, nome).toMatch(/,\s*[bc]\b/) // c'è un campo con la virgola in testa
      expect(out, nome).not.toMatch(/SELECT [^\n]*,\s*b\s*,/i) // la lista non resta su una riga
      // idempotente anche qui
      expect(formatRoutineWithProfile(out, profile), nome).toBe(out)
    })
  }

  it('SELECT ... INTO: INTO su riga propria', () => {
    const out = formatRoutineWithProfile('BEGIN\n  SELECT a, b, c INTO #t FROM dbo.T\nEND', profile)
    expect(out).toMatch(/^  INTO #t$/m)
  })

  it('virgole dentro le parentesi NON vengono spezzate', () => {
    const out = formatRoutineWithProfile('BEGIN\n  SELECT a, COALESCE(b, c, d) FROM dbo.T\nEND', profile)
    expect(out).toContain('COALESCE (b, c, d)')
  })
})

// Casi in cui la formattazione PERDEVA o RISCIVEVA il codice (bug trovati verificando la
// store reale: la firma veniva scambiata per parametri, le CTE dopo la prima sparivano, il
// commento in coda a una clausola veniva scartato, il testo dentro le stringhe riscritto).
describe('la formattazione non perde né riscrive il codice', () => {
  const casi: [string, string][] = [
    [
      'procedure senza parametri (la prima parentesi è nel corpo)',
      `create procedure p as
begin
  insert into @tabCorridors (TC_BLOCK, TC_CORRIDOR)
  select TC_BLOCK as TC_BLOCK, TC_CORRIDOR as TC_CORRIDOR
  from @tabCells
end`,
    ],
    [
      'CTE multiple',
      `CREATE PROCEDURE p AS
BEGIN
;with A as (select 1 as x)
, B as (select y from dbo.T)
, C as (select z from dbo.U)
insert into @t (c)
select y from B
END`,
    ],
    [
      'commento -- in coda a una clausola dentro le parentesi',
      `create procedure p as
begin
  select a, b
  from dbo.T
    inner join dbo.U on (U.id = T.id)
    --where a in ('', @b)
  where a = 1
end`,
    ],
    [
      'stringhe con spazi e punti (contenuto intoccabile)',
      `create procedure p as
begin
  select 'by  p. rate', 'a, b', 'x  y' as s from dbo.T
end`,
    ],
    [
      'ramo UNION',
      `create procedure p as
begin
  select a, b from dbo.T
  union
  select c, d from dbo.U
end`,
    ],
  ]

  for (const [nome, sql] of casi) {
    it(`${nome}: nessun token perso o inventato`, () => {
      expect(firmaToken(formatRoutineWithProfile(sql, profile)), nome).toEqual(firmaToken(sql))
    })
  }

  it('procedure senza parametri: firma su righe proprie come quelle con parametri', () => {
    const out = formatRoutineWithProfile('create procedure p as\nbegin\n  select a from dbo.T\nend', profile)
    expect(out).toMatch(/^CREATE PROCEDURE p$/m)
    expect(out).toMatch(/^AS$/m)
  })

  it('CTE multiple: tutte presenti, la seconda e la terza con la virgola in testa', () => {
    const out = formatRoutineWithProfile(casi[1][1], profile)
    expect(out).toMatch(/^    ;WITH A AS$/m)
    expect(out).toMatch(/^    , B AS$/m)
    expect(out).toMatch(/^    , C AS$/m)
  })

  it('CTE: anche il corpo ha la select-list impilata', () => {
    const sql = `CREATE PROCEDURE p AS
BEGIN
;with A as (
    select MFC_BLOCK as CWD_BLOCK, CEL_CORRIDOIO as CWD_CORRIDOI
    from TBL_CELLS
)
select CWD_BLOCK from A
END`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toMatch(/^      SELECT MFC_BLOCK AS CWD_BLOCK$/m)
    expect(out).toMatch(/^         ,CEL_CORRIDOIO AS CWD_CORRIDOI$/m)
  })

  it('ramo UNION: anche il secondo ramo ha la lista impilata', () => {
    const out = formatRoutineWithProfile(casi[4][1], profile)
    expect(out).toMatch(/^    SELECT a$/m)
    expect(out).toMatch(/^    SELECT c$/m)
    expect(out).toMatch(/^       ,d$/m)
  })

  it('stringhe: il contenuto resta esattamente quello scritto', () => {
    const out = formatRoutineWithProfile(casi[3][1], profile)
    expect(out).toContain("'by  p. rate'")
    expect(out).toContain("'x  y'")
    expect(out).toContain("'a, b'")
  })
})
