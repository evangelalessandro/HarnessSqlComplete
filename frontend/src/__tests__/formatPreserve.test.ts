// Batteria di test sulla ROBUSTEZZA della formattazione: la formattazione non deve
// perdere token, non deve rompere i commenti (mai codice dopo un "--") e non deve
// staccare "#'/'##' dal nome delle tabelle temporanee.
import { describe, expect, it } from 'vitest'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'
import { formatSqlWithProfile, tokenizeSqlText } from '../tsqlFormatter'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)
const fmt = (sql: string) => formatSqlWithProfile(sql, profile)

/** Firma dei token (senza commenti e senza virgole): parole in minuscolo, stringhe invariate.
 *  Le virgole sono escluse: impilando le colonne il formattatore può sostituirle con un a-capo. */
function signature(sql: string): string[] {
  return tokenizeSqlText(sql)
    .filter(t => t.type !== 'comment' && !(t.type === 'punct' && t.text === ','))
    .map(t => (t.type === 'word' ? t.text.toLowerCase() : t.text))
    .sort()
}

/** Testi dei commenti presenti (spazi normalizzati), per verificarne la presenza. */
function comments(sql: string): string[] {
  return tokenizeSqlText(sql)
    .filter(t => t.type === 'comment')
    .map(t => t.text.replace(/\s+/g, ' ').trim())
}

const CASES: { name: string; sql: string }[] = [
  { name: 'CREATE TABLE temporanea', sql: 'CREATE TABLE #tbl_InventoryKitting_St1(tt int, b nvarchar(50))' },
  { name: 'CREATE TABLE con commenti', sql: 'CREATE TABLE #t (a int, /* blocco */ b int) -- nota\n-- altra nota' },
  { name: 'SELECT con JOIN di temporanee', sql: 'select * from #tmp a join ##glob b on a.x = b.x' },
  { name: 'INSERT INTO #temporanea', sql: 'insert into #tmp (a, b) values (1, 2)' },
  { name: 'EXEC con parametri', sql: 'EXEC ws_p @user = @user, @udc = @pUDC, @flag = 1 OUTPUT' },
  {
    name: 'SELECT con commenti nella lista e in coda',
    sql: 'select a, -- c1\n b /* mezzo */ , c from #t -- coda\nwhere x = 1 -- fine',
  },
  { name: 'commento su riga propria', sql: '-- intestazione\nselect 1\n-- separatore\nselect 2' },
  { name: 'UPDATE con SET e commenti', sql: "update dbo.T -- quale tabella\nset a = 1, -- primo campo\n b = 'x' where id = 3" },
  { name: 'SELECT con CASE', sql: "select @e = case when a = 1 then 'x' else 'y' end, @m = B from dbo.T t -- fine" },
  { name: 'routine con commenti', sql: 'alter procedure [dbo].[p]\nas\nbegin\n  -- sezione\n  select 1 -- uno\n  /* blocco */ select 2\nend' },
  { name: 'DECLARE multiplo', sql: 'declare @a int = 0, @b nvarchar(50) = null\nselect @a, @b' },
  { name: 'commento a blocco su più righe', sql: '/* prima\n   seconda */\nselect 1' },
  { name: 'CREATE TABLE e SELECT successiva', sql: 'create table #t (a int)\n-- nota\nselect * from #t' },
]

describe('formattazione: nessun token perso o aggiunto', () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(signature(fmt(c.sql))).toEqual(signature(c.sql))
    })
  }
})

describe('formattazione: i commenti non si perdono e non "mangiano" il codice', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const out = fmt(c.sql)
      for (const comment of comments(c.sql)) {
        // ogni commento dell'input è presente nell'output (spazi normalizzati)
        expect(out.replace(/\s+/g, ' ')).toContain(comment)
      }
      // in NESSUNA riga di output c'è codice dopo un commento "--"
      for (const line of out.split('\n')) {
        const idx = line.indexOf('--')
        if (idx === -1) continue
        const after = line.slice(idx + 2)
        // l'unica cosa ammessa dopo "--" è testo di commento: mai fine-riga con codice
        // riconoscibile (parole chiave SQL) → verifichiamo che non compaia un'altra
        // istruzione sulla stessa riga
        expect(after).not.toMatch(/\b(SELECT|FROM|WHERE|UPDATE|INSERT|DELETE|EXEC)\b\s*[^']*$/)
      }
    })
  }

  it('commento in coda a CREATE TABLE: la SELECT successiva resta codice', () => {
    const out = fmt('create table #t (a int) -- nota\nselect * from #t')
    expect(out).toMatch(/\)\s*-- nota\n/)
    // la SELECT successiva è codice su riga propria (FROM a capo per il profilo)
    expect(out).toMatch(/\nSELECT \*\nFROM #t/)
  })

  it('commento nella select-list: il campo successivo NON finisce nel commento', () => {
    const out = fmt('select a, -- c1\n b from #t')
    expect(out).toMatch(/-- c1\n/)
    expect(out).toMatch(/\bb\b/)
    // 'b' è su una riga sua (non dopo il commento)
    expect(out.split('\n').some(l => l.includes('-- c1'))).toBe(true)
    expect(out.split('\n').find(l => l.includes('-- c1'))).not.toMatch(/\bb\b/)
  })
})

describe("formattazione: '#' e '##' restano attaccati al nome della temporanea", () => {
  const sqls = [
    'CREATE TABLE #tbl_InventoryKitting_St1(tt int)',
    'CREATE TABLE ##globale (a int)',
    'select * from #tmp a join ##glob b on a.x = b.x',
    'insert into #tmp (a) values (1)',
    'exec #proc @a = 1',
    'select #tmp.a from #tmp',
  ]
  for (const sql of sqls) {
    it(sql, () => {
      const out = fmt(sql)
      expect(out).not.toMatch(/#\s/)
      expect(out).not.toMatch(/#\s#/)
      for (const t of tokenizeSqlText(sql).filter(t => t.type === 'word' && t.text.startsWith('#'))) {
        expect(out).toContain(t.text)
      }
    })
  }
})
