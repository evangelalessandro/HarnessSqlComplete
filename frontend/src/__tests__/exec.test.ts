import { describe, expect, it } from 'vitest'
import { buildExecParamSnippet, filterUnusedParams, findExecContext, toAlterStatement } from '../helpers'
import { wsbritvicLikeSummary } from './schema'

const summary = wsbritvicLikeSummary()
const proc = summary.procedures[0] // zzz_test_proc: @id, @nome, @flag (OUTPUT)

describe('EXEC: parametri delle stored procedure', () => {
  it('findExecContext: nome qualificato e EXECUTE', () => {
    const ctx = findExecContext('EXEC dbo.MyProc @a=1, @b')
    expect([ctx?.schema, ctx?.name]).toEqual(['dbo', 'MyProc'])
    const ctx2 = findExecContext('EXECUTE [MyProc] ')
    expect([ctx2?.schema, ctx2?.name]).toEqual([null, 'MyProc'])
  })

  it('ultima EXEC quando ce ne sono più', () => {
    const ctx = findExecContext('EXEC p1; EXEC p2 @x')
    expect(ctx?.name).toBe('p2')
  })

  it('nessuna EXEC → null', () => {
    expect(findExecContext('SELECT 1')).toBeNull()
  })

  it('i parametri già digitati vengono esclusi', () => {
    const params = proc.parameters!
    expect(filterUnusedParams(params, ' @id=1, @')).toEqual([
      { name: 'nome', dataType: 'nvarchar(100)', mode: 'IN' },
      { name: 'flag', dataType: 'bit', mode: 'OUTPUT' },
    ])
    expect(filterUnusedParams(params, ' @nome=').map(p => p.name)).toEqual(['id', 'flag'])
    expect(filterUnusedParams(params, ' ').length).toBe(3)
  })

  it('snippet "tutti i parametri": IN con tab-stop, OUTPUT senza valore', () => {
    expect(buildExecParamSnippet(proc.parameters!)).toBe('@id=${1}, @nome=${2}, @flag OUTPUT')
  })

  it('scenario end-to-end del provider: testo prima del cursore', () => {
    const textBefore = 'EXEC dbo.zzz_test_proc @id=1, @'
    const execCtx = findExecContext(textBefore)
    expect(execCtx?.name).toBe('zzz_test_proc')
    const afterProc = textBefore.slice(execCtx!.nameEnd)
    const available = filterUnusedParams(proc.parameters!, afterProc)
    expect(available.map(p => p.name)).toEqual(['nome', 'flag'])
  })
})

describe('toAlterStatement: CREATE → ALTER', () => {
  it('CREATE PROCEDURE → ALTER PROCEDURE', () => {
    const def = 'CREATE PROCEDURE dbo.X\nAS\nBEGIN\n  SELECT 1\nEND'
    expect(toAlterStatement(def)).toBe('ALTER PROCEDURE dbo.X\nAS\nBEGIN\n  SELECT 1\nEND')
  })

  it('CREATE OR ALTER PROCEDURE → ALTER PROCEDURE (senza doppione)', () => {
    const def = 'CREATE OR ALTER PROCEDURE dbo.X AS SELECT 1'
    expect(toAlterStatement(def)).toBe('ALTER PROCEDURE dbo.X AS SELECT 1')
  })

  it('CREATE FUNCTION → ALTER FUNCTION', () => {
    expect(toAlterStatement('CREATE FUNCTION dbo.F(@a INT) RETURNS INT')).toBe(
      'ALTER FUNCTION dbo.F(@a INT) RETURNS INT',
    )
  })

  it('con indentazione iniziale', () => {
    expect(toAlterStatement('\n  CREATE PROCEDURE dbo.X AS SELECT 1')).toBe(
      'ALTER PROCEDURE dbo.X AS SELECT 1',
    )
  })

  it('testo che non inizia con CREATE: invariato', () => {
    const def = 'SELECT 1'
    expect(toAlterStatement(def)).toBe(def)
  })
})
