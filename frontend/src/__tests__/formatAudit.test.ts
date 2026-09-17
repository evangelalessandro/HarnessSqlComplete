// AUDIT del formattatore: su una batteria di costrutti T-SQL verifica che
//  1) nessun token venga perso o aggiunto (a parte le virgole, che possono diventare a-capo),
//  2) la formattazione sia IDEMPOTENTE (formattare due volte dà lo stesso testo),
//  3) sia deterministica e non produca mai un risultato vuoto,
//  4) i commenti restino e nessun codice finisca dentro un commento "--",
//  5) le clausole principali vadano a capo come da profilo (FROM/WHERE/JOIN/SET/ORDER/VALUES).
import { describe, expect, it } from 'vitest'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'
import { formatSqlWithProfile, tokenizeSqlText } from '../tsqlFormatter'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)
const fmt = (sql: string) => formatSqlWithProfile(sql, profile)

/** Firma dei token senza commenti e senza virgole (parole in minuscolo). */
function signature(sql: string): string[] {
  return tokenizeSqlText(sql)
    .filter(t => t.type !== 'comment' && !(t.type === 'punct' && t.text === ','))
    .map(t => (t.type === 'word' ? t.text.toLowerCase() : t.text))
    .sort()
}

function comments(sql: string): string[] {
  return tokenizeSqlText(sql)
    .filter(t => t.type === 'comment')
    .map(t => t.text.replace(/\s+/g, ' ').trim())
}

const BATTERY: { name: string; sql: string }[] = [
  { name: 'SELECT semplice', sql: 'select a, b from dbo.T where x = 1 and y = 2 order by a desc' },
  { name: 'SELECT con JOIN multipli', sql: 'select a.x, b.y from dbo.A a inner join dbo.B b on a.id = b.id left outer join dbo.C c on c.id = a.id where a.z > 0' },
  { name: 'GROUP BY / HAVING', sql: 'select a, count(*) as n from dbo.T group by a having count(*) > 1 order by n desc, a' },
  { name: 'UNION ALL', sql: 'select a from dbo.T union all select b from dbo.U' },
  { name: 'subquery e EXISTS', sql: 'select * from dbo.T where exists (select 1 from dbo.U where u.id = t.id)' },
  { name: 'window function', sql: 'select row_number() over (partition by a order by b) as rn, sum(x) over (order by b rows between unbounded preceding and current row) from dbo.T' },
  { name: 'CASE con alias', sql: "select case when a = 1 then 'uno' when a = 2 then 'due' else 'altro' end as nome from dbo.T" },
  { name: 'CTE', sql: 'with c as (select a from dbo.T) select * from c' },
  { name: 'INSERT VALUES', sql: "insert into dbo.T (a, b) values (1, 'x'), (2, 'y')" },
  { name: 'INSERT SELECT', sql: 'insert into dbo.T (a, b) select x, y from dbo.U where x > 0' },
  { name: 'UPDATE SET + FROM', sql: 'update t set a = 1, b = 2 from dbo.T t inner join dbo.U u on u.id = t.id where t.z = 3' },
  { name: 'DELETE', sql: 'delete from dbo.T where a = 1' },
  { name: 'MERGE', sql: 'merge into dbo.T as tgt using dbo.S as src on tgt.id = src.id when matched then update set v = src.v when not matched then insert (id, v) values (src.id, src.v);' },
  { name: 'EXEC con parametri', sql: "exec dbo.p @a = 1, @b = 'x', @c output" },
  { name: 'CREATE TABLE', sql: 'create table #t (a int not null, b nvarchar(50) null, c decimal(10,2))' },
  { name: 'DECLARE multiplo', sql: 'declare @a int = 0, @b nvarchar(50), @c decimal(11,3) = 1.5' },
  { name: 'IF/BEGIN/END', sql: 'if @a > 0 begin select 1 end else begin select 2 end' },
  { name: 'BLOCCO TRY/CATCH', sql: 'begin try select 1 end try begin catch select error_message() end catch' },
  { name: 'WHILE', sql: 'while @i < 10 begin set @i = @i + 1 end' },
  { name: 'temporanee (# e ##)', sql: 'select a from #tmp x join ##glob g on x.id = g.id' },
  { name: 'SET options', sql: 'set nocount on' },
  { name: 'commenti ovunque', sql: "select a, -- campo a\n b /* mezzo */ from dbo.T -- tabella\nwhere x = 1 -- fine" },
  { name: 'stringhe con parole chiave', sql: "select 'from where select -- /*' as s, N'it''s' as t from dbo.T" },
  { name: 'parentesi annidate', sql: 'select ((a + b) * (c - d)) / nullif(e, 0) from dbo.T' },
  { name: 'OFFSET/FETCH', sql: 'select a from dbo.T order by a offset 10 rows fetch next 5 rows only' },
  { name: 'routine completa', sql: 'create or alter procedure dbo.p @a int as begin set nocount on declare @x int = 0 select @x = a from dbo.T where a = @a if @x > 0 begin update dbo.T set b = 1 where a = @x end return @x end' },
]

describe('audit formattatore: nessun token perso, idempotenza, determinismo', () => {
  for (const c of BATTERY) {
    it(c.name, () => {
      const out = fmt(c.sql)
      expect(out.trim().length, 'output vuoto').toBeGreaterThan(0)
      expect(signature(out), 'token persi/aggiunti').toEqual(signature(c.sql))
      // idempotente: formattare il risultato non cambia nulla
      expect(fmt(out), 'non idempotente').toBe(out)
      // deterministico
      expect(fmt(c.sql)).toBe(out)
      // nessun codice dopo un commento "--"
      for (const line of out.split('\n')) {
        const i = line.indexOf('--')
        if (i === -1) continue
        expect(line.slice(i + 2)).not.toMatch(/\b(SELECT|FROM|WHERE|UPDATE|INSERT|DELETE|EXEC|JOIN)\b/)
      }
      // commenti conservati
      const outNorm = out.replace(/\s+/g, ' ')
      for (const cm of comments(c.sql)) expect(outNorm).toContain(cm)
    })
  }
})

describe('audit formattatore: layout delle clausole secondo il profilo', () => {
  it('SELECT lungo: FROM/JOIN/WHERE/ORDER BY ognuno a capo', () => {
    const out = fmt(
      'select a.id, a.nome, b.totale from clienti a inner join ordini b on a.id = b.cliente_id where a.nome like \'%x%\' and b.totale > 100 order by a.id',
    )
    expect(out).toMatch(/\nFROM clienti a/)
    expect(out).toMatch(/\n\s+INNER JOIN ordini b/)
    expect(out).toMatch(/\nWHERE /)
    expect(out).toMatch(/\n\s+ORDER BY /)
  })

  it('UPDATE: SET e WHERE a capo e un campo per riga', () => {
    const out = fmt('update dbo.T set a = 1, b = 2 where id = 3')
    expect(out).toMatch(/^UPDATE dbo\.T\n {2}SET a = 1\n {6},b = 2\nWHERE id = 3\n$/)
  })

  it('INSERT lungo: campi e valori uno per riga', () => {
    const out = fmt(
      "insert into dbo.T (a, b, c, d, e) values (1, 2, 3, 'una descrizione lunga per superare la soglia impostata', 5)",
    )
    expect(out).toMatch(/INSERT INTO dbo\.T \(a\n\s+,b\n\s+,c\n\s+,d\n\s+,e\)\nVALUES \(1\n\s+,2\n\s+,3\n/)
  })

  it('CREATE TABLE: una colonna per riga, indentata', () => {
    const out = fmt('create table #t (a int, b nvarchar(50))')
    expect(out).toBe('CREATE TABLE #t (\n  a INT\n  ,b NVARCHAR(50)\n)\n')
  })

  it('EXEC: parametri incolonnati', () => {
    const out = fmt('exec dbo.p @user = @user, @udc = @pUDC')
    expect(out).toMatch(/^EXEC dbo\.p @user = @user\n\s+,@udc\s+= @pUDC\n$/)
  })
})
