import { describe, expect, it } from 'vitest'
import { buildExecParamSnippet, filterUnusedParams, findExecContext, toCreateOrAlterStatement } from '../helpers'
import { demoStoreLikeSummary } from './schema'

const summary = demoStoreLikeSummary()
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

  it('snippet "tutti i parametri": IN con tab-stop e default, OUTPUT senza valore', () => {
    expect(buildExecParamSnippet(proc.parameters!)).toBe('@id=${1}, @nome=${2}, @flag OUTPUT')
  })

  it('snippet precompila i default noti', () => {
    const withDef = [
      { name: 'id', dataType: 'int', mode: 'IN', defaultValue: '0' },
      { name: 'caus', dataType: 'nvarchar', mode: 'IN', defaultValue: "N'IN'" },
      { name: 'flag', dataType: 'bit', mode: 'OUTPUT' },
    ]
    expect(buildExecParamSnippet(withDef)).toBe("@id=${1:0}, @caus=${2:N'IN'}, @flag OUTPUT")
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

describe('toCreateOrAlterStatement: CREATE → CREATE OR ALTER', () => {
  it('CREATE PROCEDURE → CREATE OR ALTER PROCEDURE', () => {
    const def = 'CREATE PROCEDURE dbo.X\nAS\nBEGIN\n  SELECT 1\nEND'
    expect(toCreateOrAlterStatement(def)).toBe('CREATE OR ALTER PROCEDURE dbo.X\nAS\nBEGIN\n  SELECT 1\nEND')
  })

  it('CREATE OR ALTER PROCEDURE → invariato (senza doppione)', () => {
    const def = 'CREATE OR ALTER PROCEDURE dbo.X AS SELECT 1'
    expect(toCreateOrAlterStatement(def)).toBe(def)
  })

  it('CREATE FUNCTION → CREATE OR ALTER FUNCTION', () => {
    expect(toCreateOrAlterStatement('CREATE FUNCTION dbo.F(@a INT) RETURNS INT')).toBe(
      'CREATE OR ALTER FUNCTION dbo.F(@a INT) RETURNS INT',
    )
  })

  it('CREATE TRIGGER → CREATE OR ALTER TRIGGER (forma reale OBJECT_DEFINITION)', () => {
    const def =
      'CREATE TRIGGER [dbo].[tr_CFG_BARCODE] ON [dbo].[CFG_BARCODE]\n' +
      'FOR UPDATE, INSERT, DELETE\nAS\nSET NOCOUNT ON\n\nBEGIN\n  SELECT 1\nEND'
    expect(toCreateOrAlterStatement(def)).toBe(
      'CREATE OR ALTER TRIGGER [dbo].[tr_CFG_BARCODE] ON [dbo].[CFG_BARCODE]\n' +
        'FOR UPDATE, INSERT, DELETE\nAS\nSET NOCOUNT ON\n\nBEGIN\n  SELECT 1\nEND',
    )
  })

  it('CREATE VIEW → CREATE OR ALTER VIEW', () => {
    expect(toCreateOrAlterStatement('CREATE VIEW dbo.V AS SELECT 1 AS x')).toBe(
      'CREATE OR ALTER VIEW dbo.V AS SELECT 1 AS x',
    )
  })

  it('con indentazione iniziale', () => {
    expect(toCreateOrAlterStatement('\n  CREATE PROCEDURE dbo.X AS SELECT 1')).toBe(
      'CREATE OR ALTER PROCEDURE dbo.X AS SELECT 1',
    )
  })

  it('ALTER PROCEDURE (definizione modificata in passato) → CREATE OR ALTER PROCEDURE', () => {
    expect(toCreateOrAlterStatement('ALTER PROCEDURE dbo.X AS SELECT 1')).toBe(
      'CREATE OR ALTER PROCEDURE dbo.X AS SELECT 1',
    )
  })

  it('commento iniziale prima di CREATE → CREATE OR ALTER (commento conservato)', () => {
    const def = '-- =============================================\n-- Author: pippo\n-- =============================================\nCREATE PROCEDURE dbo.X AS SELECT 1'
    const out = toCreateOrAlterStatement(def)
    expect(out).toContain('-- Author: pippo')
    expect(out).toMatch(/CREATE OR ALTER PROCEDURE dbo\.X/)
  })

  it('commento a blocco iniziale → CREATE OR ALTER su una RIGA NUOVA', () => {
    const def = '/* script ri-creato con header */\nALTER PROCEDURE dbo.X AS SELECT 1'
    const out = toCreateOrAlterStatement(def)
    expect(out).toContain('/* script ri-creato con header */')
    expect(out).toContain('CREATE OR ALTER PROCEDURE dbo.X')
    // il commento NON deve restare attaccato all'istruzione
    expect(out).not.toMatch(/\*\/CREATE OR ALTER/)
    expect(out).toMatch(/\*\/\nCREATE OR ALTER PROCEDURE/)
  })

  it('header reale del DB (commento a blocco + CRLF) → istruzione a capo, header intatto', () => {
    // inizio reale di dbo.ws_CIDEDO_L2_AAMAGEGUPIVODIBOP
    const def =
      '/* Able/Disable Hydraroll Bay also for CarWash */\r\n' +
      'CREATE PROCEDURE [dbo].[ws_CIDEDO_L2_AAMAGEGUPIVODIBOP] (\r\n  @pAbleDisable bit\r\n)\r\nAS\r\nSELECT 1'
    const out = toCreateOrAlterStatement(def)
    expect(out.startsWith('/* Able/Disable Hydraroll Bay also for CarWash */\r\n')).toBe(true)
    expect(out).not.toMatch(/\*\/CREATE OR ALTER/)
    expect(out).toContain('CREATE OR ALTER PROCEDURE [dbo].[ws_CIDEDO_L2_AAMAGEGUPIVODIBOP]')
  })

  it('header reale con più commenti a blocco: righe vuote e commenti conservati identici', () => {
    // forma reale di dbo.ws_AABADASUBADUBUBI_PEMAGED_SESAMI
    const def =
      '/* Algoritmo navette per impianti picking */\r\n\r\n\r\n/*\r\n Ritorna : -1 - Errore\r\n*/\r\nALTER PROCEDURE dbo.X AS SELECT 1'
    const out = toCreateOrAlterStatement(def)
    expect(out.startsWith('/* Algoritmo navette per impianti picking */\r\n\r\n\r\n/*\r\n Ritorna : -1 - Errore\r\n*/\r\n')).toBe(true)
    expect(out).toContain('CREATE OR ALTER PROCEDURE dbo.X')
    expect(out).not.toMatch(/\*\/CREATE OR ALTER/)
  })

  it('commento già attaccato al CREATE nel testo originale: viene comunque mandato a capo', () => {
    const def = '/* note */CREATE PROCEDURE dbo.X AS SELECT 1'
    expect(toCreateOrAlterStatement(def)).toBe('/* note */\nCREATE OR ALTER PROCEDURE dbo.X AS SELECT 1')
  })

  it('commento di riga + commento a blocco: prefisso conservato e istruzione a capo', () => {
    const def = '-- nota 1\r\n/* nota 2 */\r\nALTER PROCEDURE dbo.X AS SELECT 1'
    const out = toCreateOrAlterStatement(def)
    expect(out.startsWith('-- nota 1\r\n/* nota 2 */\r\n')).toBe(true)
    expect(out).toContain('CREATE OR ALTER PROCEDURE dbo.X')
  })

  it('trattini e asterischi dentro il commento non fanno perdere il prefisso', () => {
    const def = '/***\r\n * header con * e -- dentro\r\n ***/\r\nCREATE PROCEDURE dbo.X AS SELECT 1'
    const out = toCreateOrAlterStatement(def)
    expect(out.startsWith('/***\r\n * header con * e -- dentro\r\n ***/\r\n')).toBe(true)
    expect(out).toContain('CREATE OR ALTER PROCEDURE dbo.X')
  })

  it('BOM iniziale → CREATE OR ALTER', () => {
    const def = '\uFEFFCREATE PROCEDURE dbo.X AS SELECT 1'
    expect(toCreateOrAlterStatement(def)).toBe('CREATE OR ALTER PROCEDURE dbo.X AS SELECT 1')
  })

  it('solo commenti senza CREATE/ALTER → invariato', () => {
    const def = '-- niente header qui\nSELECT 1'
    expect(toCreateOrAlterStatement(def)).toBe(def)
  })

  it('ALTER FUNCTION → CREATE OR ALTER FUNCTION', () => {
    expect(toCreateOrAlterStatement('ALTER FUNCTION dbo.F(@a INT) RETURNS INT AS BEGIN RETURN 1 END')).toBe(
      'CREATE OR ALTER FUNCTION dbo.F(@a INT) RETURNS INT AS BEGIN RETURN 1 END',
    )
  })

  it('testo che non inizia con CREATE: invariato', () => {
    const def = 'SELECT 1'
    expect(toCreateOrAlterStatement(def)).toBe(def)
  })
})
