import { describe, expect, it } from 'vitest'
import {
  TSQL_ALTER_SNIPPETS,
  TSQL_OPTION_HINTS,
  TSQL_OVER_FRAMES,
  TSQL_OVER_STARTS,
  TSQL_SET_OPTIONS,
  TSQL_SYSTEM_VARIABLES,
  TSQL_TABLE_HINTS,
  TSQL_TYPES,
  detectAlterTableContext,
  detectCreateIndexContext,
  detectCreateTableColumnContext,
  detectDeclareTypeContext,
  detectObjectNameContext,
  detectOptionHintsContext,
  detectOverContext,
  detectSetContext,
  detectSystemVariableContext,
  detectTableHintsContext,
  detectVariableContext,
  extractDeclaredVariables,
  systemVariablePrefixLen,
  variablePrefixLen,
} from '../tsqlSnippets'

describe('tsqlSnippets: DECLARE @var → tipi di dato', () => {
  it('dopo "DECLARE @t" propone i tipi (non le tabelle)', () => {
    expect(detectDeclareTypeContext('declare @t')).toBe(true)
    expect(detectDeclareTypeContext('DECLARE @t ')).toBe(true)
    expect(detectDeclareTypeContext('declare @t i')).toBe(true) // parola parziale
    expect(detectDeclareTypeContext('declare @t as ')).toBe(true)
  })

  it('anche con più variabili separate da virgola', () => {
    expect(detectDeclareTypeContext('declare @a int, @b ')).toBe(true)
    expect(detectDeclareTypeContext('DECLARE @x INT, @y NVARCHAR(50), @z ')).toBe(true)
  })

  it('fuori da DECLARE → false', () => {
    expect(detectDeclareTypeContext('select @t ')).toBe(false)
    expect(detectDeclareTypeContext('declare @t int\nselect ')).toBe(false)
  })

  it('i tipi principali ci sono (int, nvarchar, decimal, bit, date…)', () => {
    const names = TSQL_TYPES.map(t => t.name)
    for (const n of ['INT', 'BIGINT', 'BIT', 'DECIMAL', 'NUMERIC', 'MONEY', 'FLOAT', 'DATE', 'DATETIME', 'DATETIME2', 'TIME', 'CHAR', 'VARCHAR', 'NCHAR', 'NVARCHAR', 'UNIQUEIDENTIFIER', 'XML', 'VARBINARY']) {
      expect(names).toContain(n)
    }
  })
})

describe('tsqlSnippets: SET <opzione> → ON/OFF e opzioni', () => {
  it('dopo "SET " (vuoto) → nomi delle opzioni', () => {
    expect(detectSetContext('set ')).toEqual({ kind: 'options' })
    expect(detectSetContext('\n    set ')).toEqual({ kind: 'options' })
  })

  it('dopo "SET NOCOUNT " → valori (ON/OFF)', () => {
    expect(detectSetContext('set nocount ')).toEqual({ kind: 'values', option: 'NOCOUNT' })
    expect(detectSetContext('set xact_abort ')).toEqual({ kind: 'values', option: 'XACT_ABORT' })
  })

  it('SET dentro UPDATE non è un\'opzione', () => {
    expect(detectSetContext('update t set a = 1 ')).toBeNull()
  })

  it('opzioni principali presenti con ON/OFF', () => {
    for (const n of ['NOCOUNT', 'XACT_ABORT', 'ANSI_NULLS', 'QUOTED_IDENTIFIER', 'ARITHABORT', 'IMPLICIT_TRANSACTIONS']) {
      const opt = TSQL_SET_OPTIONS.find(o => o.name === n)
      expect(opt).toBeDefined()
      expect(opt!.values).toEqual(['ON', 'OFF'])
    }
  })

  it('DATEFORMAT ha i formati e LOCK_TIMEOUT i millisecondi', () => {
    const df = TSQL_SET_OPTIONS.find(o => o.name === 'DATEFORMAT')!
    expect(df.values).toContain('dmy')
    const lt = TSQL_SET_OPTIONS.find(o => o.name === 'LOCK_TIMEOUT')!
    expect(lt.values).toContain('-1')
  })
})

describe('tsqlSnippets: ALTER TABLE → snippet', () => {
  it('dopo "ALTER TABLE dbo.T " → true; altri ALTER → false', () => {
    expect(detectAlterTableContext('alter table dbo.T ')).toBe(true)
    expect(detectAlterTableContext('ALTER TABLE [T] ')).toBe(true)
    expect(detectAlterTableContext('alter procedure [x] as ')).toBe(false)
    expect(detectAlterTableContext('alter table dbo.T ADD x int ')).toBe(false)
  })

  it('gli snippet coprono constraint, colonne e trigger', () => {
    const labels = TSQL_ALTER_SNIPPETS.map(s => s.label)
    expect(labels).toContain('ADD CONSTRAINT PRIMARY KEY')
    expect(labels).toContain('ADD CONSTRAINT FOREIGN KEY')
    expect(labels).toContain('ADD CONSTRAINT CHECK')
    expect(labels).toContain('ADD CONSTRAINT DEFAULT')
    expect(labels).toContain('ADD colonna')
    expect(labels).toContain('ALTER COLUMN')
    expect(labels).toContain('DROP COLUMN')
    expect(labels).toContain('ENABLE TRIGGER')
    expect(labels).toContain('DISABLE TRIGGER')
    expect(labels).toContain('ENABLE TRIGGER ALL')
    expect(labels).toContain('DISABLE TRIGGER ALL')
    // gli snippet con segnaposto hanno le tab-stop; i "TRIGGER ALL" sono completi senza
    expect(TSQL_ALTER_SNIPPETS.filter(s => s.insertText.includes('${')).length).toBeGreaterThanOrEqual(10)
    const all = TSQL_ALTER_SNIPPETS.filter(s => s.label.endsWith('ALL'))
    expect(all.map(s => s.insertText)).toEqual(['ENABLE TRIGGER ALL', 'DISABLE TRIGGER ALL'])
  })
})

describe('tsqlSnippets: variabili di sistema @@', () => {
  it('dopo "IF @@" o "if @@E" si propongono le @@ (non le tabelle)', () => {
    expect(detectSystemVariableContext('if @@')).toBe(true)
    expect(detectSystemVariableContext('IF @@ERRO')).toBe(true)
    expect(detectSystemVariableContext('select @@ROW')).toBe(true)
  })

  it('una sola @ (variabile utente) non attiva il contesto @@', () => {
    expect(detectSystemVariableContext('declare @t')).toBe(false)
    expect(detectSystemVariableContext('select @var ')).toBe(false)
  })

  it('systemVariablePrefixLen: il range sostituisce "@@" + prefisso parziale (niente @@@@ROWCOUNT)', () => {
    expect(systemVariablePrefixLen('if @@')).toBe(2)
    expect(systemVariablePrefixLen('IF @@ERRO')).toBe(6) // sostituisce "@@ERRO"
    expect(systemVariablePrefixLen('select @@ROW ')).toBe(6) // "@@ROW" + spazio finale
    expect(systemVariablePrefixLen('select @var ')).toBe(0)
  })

  it('le variabili principali ci sono', () => {
    const names = TSQL_SYSTEM_VARIABLES.map(v => v.name)
    for (const n of ['@@ROWCOUNT', '@@TRANCOUNT', '@@ERROR', '@@IDENTITY', '@@FETCH_STATUS', '@@SPID', '@@SERVERNAME', '@@VERSION', '@@NESTLEVEL', '@@LOCK_TIMEOUT']) {
      expect(names).toContain(n)
    }
    expect(names.every(n => n.startsWith('@@'))).toBe(true)
  })
})

describe('tsqlSnippets: oggetti dopo DROP/TRUNCATE/ALTER/USE', () => {
  it('DROP/TRUNCATE + tipo → il tipo giusto di oggetto', () => {
    expect(detectObjectNameContext('drop table ')).toBe('table')
    expect(detectObjectNameContext('TRUNCATE TABLE ')).toBe('table')
    expect(detectObjectNameContext('drop view ')).toBe('view')
    expect(detectObjectNameContext('DROP PROCEDURE ')).toBe('procedure')
    expect(detectObjectNameContext('drop proc ')).toBe('procedure')
    expect(detectObjectNameContext('drop function ')).toBe('function')
    expect(detectObjectNameContext('drop trigger ')).toBe('trigger')
  })

  it('ALTER di una routine e USE → tipo giusto', () => {
    expect(detectObjectNameContext('alter procedure ')).toBe('procedure')
    expect(detectObjectNameContext('ALTER VIEW ')).toBe('view')
    expect(detectObjectNameContext('alter function ')).toBe('function')
    expect(detectObjectNameContext('alter trigger ')).toBe('trigger')
    expect(detectObjectNameContext('use ')).toBe('database')
  })

  it('fuori contesto → null', () => {
    expect(detectObjectNameContext('select * from ')).toBeNull()
    expect(detectObjectNameContext('drop index ')).toBeNull()
    expect(detectObjectNameContext('alter table dbo.T ')).toBeNull()
  })
})

describe('tsqlSnippets: CREATE TABLE, OPTION, CREATE INDEX, hint di tabella', () => {
  it('CREATE TABLE t (id → tipi; parentesi vuota o constraint → no', () => {
    expect(detectCreateTableColumnContext('create table t (id ')).toBe(true)
    expect(detectCreateTableColumnContext('CREATE TABLE [dbo].[T] (codice ')).toBe(true)
    expect(detectCreateTableColumnContext('create table t (')).toBe(false)
    expect(detectCreateTableColumnContext('create table t (id int, nome ')).toBe(true)
    expect(detectCreateTableColumnContext('create table t (id int PRIMARY KEY ')).toBe(false)
  })

  it('OPTION ( → hint di query (RECOMPILE, MAXDOP…)', () => {
    expect(detectOptionHintsContext('select * from t option (')).toBe(true)
    expect(detectOptionHintsContext('select * from t OPTION ( ')).toBe(true)
    expect(detectOptionHintsContext('select * from t')).toBe(false)
    expect(TSQL_OPTION_HINTS.some(h => h.name === 'RECOMPILE')).toBe(true)
    expect(TSQL_OPTION_HINTS.some(h => h.name === 'MAXDOP')).toBe(true)
  })

  it('CREATE INDEX: dopo "INDEX " → snippet nome; dopo "ON " → tabelle', () => {
    expect(detectCreateIndexContext('create index ')).toBe('name')
    expect(detectCreateIndexContext('CREATE UNIQUE NONCLUSTERED INDEX ')).toBe('name')
    expect(detectCreateIndexContext('create index ix_uno ON ')).toBe('table')
    expect(detectCreateIndexContext('create index ix ON dbo.T (')).toBeNull()
  })

  it('FROM t WITH ( → hint di tabella (NOLOCK…)', () => {
    expect(detectTableHintsContext('from dbo.T with (')).toBe(true)
    expect(detectTableHintsContext('join T t WITH ( ')).toBe(true)
    expect(detectTableHintsContext('from dbo.T ')).toBe(false)
    expect(TSQL_TABLE_HINTS.some(h => h.name === 'NOLOCK')).toBe(true)
    expect(TSQL_TABLE_HINTS.some(h => h.name === 'READPAST')).toBe(true)
  })
})

describe('tsqlSnippets: OVER( ) delle funzioni finestra', () => {
  it('OVER() vuoto → prime clausole (PARTITION BY/ORDER BY/ROWS/RANGE)', () => {
    expect(detectOverContext('select RANK() over( ')).toBe('empty')
    expect(detectOverContext('select SUM(x) OVER ( ')).toBe('empty')
    expect(detectOverContext('select * from t')).toBeNull()
    expect(TSQL_OVER_STARTS.map(s => s.name)).toContain('PARTITION BY')
    expect(TSQL_OVER_STARTS.map(s => s.name)).toContain('ORDER BY')
  })

  it('dopo una colonna completa + spazio → continuazione', () => {
    expect(detectOverContext('over( partition by x ')).toBe('continue')
    expect(detectOverContext('over( order by data ')).toBe('continue')
  })

  it('dopo ROWS/RANGE → frame', () => {
    expect(detectOverContext('over( order by data ROWS ')).toBe('frame')
    expect(detectOverContext('over( partition by a order by b RANGE ')).toBe('frame')
    expect(TSQL_OVER_FRAMES.some(f => f.name.includes('UNBOUNDED PRECEDING'))).toBe(true)
    expect(TSQL_OVER_FRAMES.some(f => f.name.includes('CURRENT ROW'))).toBe(true)
  })

  it('posizione di colonna (PARTITION BY x / ORDER BY x) → null (la gestisce il columnContext)', () => {
    expect(detectOverContext('over( partition by ')).toBeNull()
    expect(detectOverContext('over( order by ')).toBeNull()
    expect(detectOverContext('over( partition by x')).toBeNull() // sta scrivendo la colonna
  })
})

describe('tsqlSnippets: variabili dichiarate (DECLARE @var)', () => {
  it('estrae le variabili DECLARE, incluse le continuazioni con virgola su più righe', () => {
    const text = `declare @t NVARCHAR(max)\n,@prova INT\n\nselect @p`
    const vars = extractDeclaredVariables(text)
    expect(vars).toEqual([
      { name: '@t', dataType: 'NVARCHAR' },
      { name: '@prova', dataType: 'INT' },
    ])
  })

  it('più DECLARE separati da ; e tipi con parentesi', () => {
    const vars = extractDeclaredVariables('declare @a int; declare @b nvarchar(50);')
    expect(vars.map(v => v.name)).toEqual(['@a', '@b'])
    expect(vars[1].dataType).toBe('nvarchar')
  })

  it('detectVariableContext: dopo "@nome" o "@" → true; "@@..." → false', () => {
    expect(detectVariableContext('select @p')).toBe(true)
    expect(detectVariableContext('set @x = @')).toBe(true)
    expect(detectVariableContext('if @@')).toBe(false)
    expect(detectVariableContext('select @p, ')).toBe(false)
  })

  it('variablePrefixLen: sostituisce "@nome" (o "@") senza doppi @', () => {
    expect(variablePrefixLen('select @p')).toBe(2)
    expect(variablePrefixLen('set @x = @')).toBe(1)
    expect(variablePrefixLen('if @@ERROR')).toBe(0)
  })
})
