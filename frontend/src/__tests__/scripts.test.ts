import { describe, expect, it } from 'vitest'
import {
  scriptCreateTable,
  scriptDeleteTable,
  scriptDropObject,
  scriptExecProcedure,
  scriptInsertTable,
  scriptMergeTable,
  scriptSelectTable,
  scriptUpdateTable,
  searchMatches,
} from '../helpers'
import { mkCol, mkProc, mkTbl } from './schema'

describe('scriptCreateTable: genera CREATE TABLE dai metadati', () => {
  it('include colonne, tipi, IDENTITY e NOT NULL', () => {
    const t = mkTbl('dbo', 'Ordini', [
      mkCol('id', 'int', { isIdentity: true }),
      mkCol('nome', 'nvarchar', { isNullable: true, maxLength: 100 }),
      mkCol('importo', 'decimal'),
    ])
    const sql = scriptCreateTable(t)
    expect(sql).toContain('CREATE TABLE Ordini')
    expect(sql).toContain('id int IDENTITY(1,1) NOT NULL')
    expect(sql).toContain('nome nvarchar(50)')
    expect(sql).toContain('importo decimal NOT NULL')
    expect(sql.trim().endsWith(';')).toBe(true)
  })

  it('usa nvarchar(max) per maxLength -1 e la lunghezza corretta per varchar', () => {
    const t = mkTbl('dbo', 'T', [
      mkCol('big', 'nvarchar', { maxLength: -1 }),
      mkCol('v', 'varchar', { maxLength: 200 }),
    ])
    const sql = scriptCreateTable(t)
    expect(sql).toContain('big nvarchar(max)')
    expect(sql).toContain('v varchar(200)')
  })

  it('qualifica con lo schema quando non è dbo', () => {
    const t = mkTbl('usr', 'T', [mkCol('a', 'int')])
    expect(scriptCreateTable(t)).toContain('CREATE TABLE usr.T')
  })

  it('gestisce tabella senza colonne', () => {
    expect(scriptCreateTable(mkTbl('dbo', 'Vuota', []))).toBe('CREATE TABLE Vuota (\n\n);\n')
  })
})

describe('scriptMergeTable: genera MERGE upsert', () => {
  it('usa la colonna IDENTITY come chiave e genera UPDATE/INSERT', () => {
    const t = mkTbl('dbo', 'Ordini', [
      mkCol('id', 'int', { isIdentity: true }),
      mkCol('nome', 'nvarchar', { maxLength: 100 }),
      mkCol('importo', 'decimal'),
    ])
    const sql = scriptMergeTable(t)
    expect(sql).toContain('MERGE INTO Ordini AS tgt')
    expect(sql).toContain('USING (SELECT')
    expect(sql).toContain('ON tgt.id = src.id')
    expect(sql).toContain('WHEN MATCHED THEN UPDATE SET')
    expect(sql).toContain('nome = src.nome')
    expect(sql).toContain('WHEN NOT MATCHED THEN INSERT (id, nome, importo)')
    expect(sql).toContain('VALUES (src.id, src.nome, src.importo);')
    // la chiave non deve comparire nella SET
    expect(sql).not.toMatch(/SET\s+id = src\.id/)
  })

  it('senza IDENTITY usa la prima colonna come chiave', () => {
    const t = mkTbl('dbo', 'T', [mkCol('a'), mkCol('b')])
    const sql = scriptMergeTable(t)
    expect(sql).toContain('ON tgt.a = src.a')
  })
})

describe('scriptExecProcedure: genera EXEC con parametri', () => {
  it('emette EXEC con IN = e OUTPUT senza valore (sintassi reale)', () => {
    const p = mkProc('dbo', 'zzz_test_proc', [
      { name: 'id', dataType: 'int' },
      { name: 'flag', dataType: 'bit', mode: 'OUTPUT' },
    ])
    expect(scriptExecProcedure(p)).toBe('EXEC zzz_test_proc @id = , @flag OUTPUT;\n')
  })

  it('precompila i valori di default noti', () => {
    const p: Parameters<typeof scriptExecProcedure>[0] = {
      schema: 'dbo',
      name: 'P',
      createDate: null,
      parameters: [
        { name: 'id', dataType: 'int', mode: 'IN', defaultValue: '0' },
        { name: 'caus', dataType: 'nvarchar', mode: 'IN', defaultValue: "N'IN'" },
      ],
    }
    expect(scriptExecProcedure(p)).toBe("EXEC P @id = 0, @caus = N'IN';\n")
  })

  it('senza parametri emette solo EXEC nome', () => {
    expect(scriptExecProcedure(mkProc('dbo', 'P', []))).toBe('EXEC P ;\n')
  })
})

describe('script stile SSMS (Select/Drop/Insert/Update/Delete)', () => {
  const t = mkTbl('dbo', 'Ordini', [
    mkCol('id', 'int', { isIdentity: true }),
    mkCol('nome', 'nvarchar', { maxLength: 100 }),
    mkCol('importo', 'decimal'),
  ])

  it('SELECT TOP (1000) *', () => {
    expect(scriptSelectTable(t)).toBe('SELECT TOP (1000) * FROM Ordini;\n')
    expect(scriptSelectTable(t, 100)).toBe('SELECT TOP (100) * FROM Ordini;\n')
  })

  it('DROP usa la parola chiave giusta per ogni tipo', () => {
    expect(scriptDropObject('table', 'dbo', 'T')).toBe('DROP TABLE T;\n')
    expect(scriptDropObject('view', 'dbo', 'V')).toBe('DROP VIEW V;\n')
    expect(scriptDropObject('procedure', 'dbo', 'P')).toBe('DROP PROCEDURE P;\n')
    expect(scriptDropObject('function', 'dbo', 'F')).toBe('DROP FUNCTION F;\n')
    expect(scriptDropObject('trigger', 'dbo', 'Trg')).toBe('DROP TRIGGER Trg;\n')
  })

  it('INSERT esclude la colonna identity', () => {
    const sql = scriptInsertTable(t)
    expect(sql).toContain('INSERT INTO Ordini (nome, importo)')
    expect(sql).toContain("VALUES ('', 0);")
    expect(sql).not.toContain('[id]')
    expect(sql).not.toContain('id,')
  })

  it('UPDATE esclude identity e chiave dalla SET', () => {
    const sql = scriptUpdateTable(t)
    expect(sql).toContain('UPDATE Ordini')
    expect(sql).toContain('SET')
    expect(sql).toContain("nome = ''")
    expect(sql).toContain('importo = 0')
    expect(sql).toContain('WHERE id = 0')
    expect(sql).not.toMatch(/SET\s+id =/)
  })

  it('DELETE filtra sulla chiave identity', () => {
    expect(scriptDeleteTable(t)).toBe('DELETE FROM Ordini WHERE id = 0;\n')
  })

  it('senza identity usa la prima colonna come chiave', () => {
    const noId = mkTbl('dbo', 'T', [mkCol('a'), mkCol('b')])
    expect(scriptDeleteTable(noId)).toBe('DELETE FROM T WHERE a = 0;\n')
  })
})

describe('searchMatches: gli spazi valgono come %', () => {
  it('una parola = sottostringa', () => {
    expect(searchMatches('udc', 'DAT_UDC')).toBe(true)
    expect(searchMatches('udc', 'RUN_MISSIONI')).toBe(false)
  })

  it('più parole = token in ordine con wildcard tra loro', () => {
    // "dat udc" → %dat%udc% : DAT_UDC corrisponde, UDC_DAT no
    expect(searchMatches('dat udc', 'DAT_UDC')).toBe(true)
    expect(searchMatches('dat udc', 'UDC_DAT')).toBe(false)
  })

  it('case-insensitive e match su schema o nome', () => {
    expect(searchMatches('run mis', 'RUN_MISSIONI')).toBe(true)
    expect(searchMatches('mis run', 'RUN_MISSIONI')).toBe(false)
  })

  it('spazi multipli equivalgono a uno', () => {
    expect(searchMatches('  dat   udc  ', 'DAT_UDC')).toBe(true)
  })

  it('query vuota non corrisponde a nulla', () => {
    expect(searchMatches('', 'DAT_UDC')).toBe(false)
    expect(searchMatches('   ', 'DAT_UDC')).toBe(false)
  })

  it('escape dei metacaratteri regex', () => {
    expect(searchMatches('a.b', 'aXb')).toBe(false)
    expect(searchMatches('a.b', 'a.b')).toBe(true)
  })
})
