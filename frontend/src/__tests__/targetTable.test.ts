import { describe, expect, it } from 'vitest'
import {
  splitExecutedStatements,
  stripSqlNoise,
  suggestTargetTables,
  targetTableOfStatement,
} from '../sqlGen'

describe('PROPOSTA TABELLA TARGET dal SQL eseguito (generatore griglia)', () => {
  it('select semplice → propone "schema.tabella" della FROM', () => {
    expect(
      targetTableOfStatement('SELECT TOP 100 [MIS_UDC], [MIS_MISSIONE]\nFROM [dbo].[RUN_MISSIONI]'),
    ).toBe('dbo.RUN_MISSIONI')
    expect(targetTableOfStatement('select * from dbo.tipi_eventi')).toBe('dbo.tipi_eventi')
    expect(targetTableOfStatement('select * from RUN_MISSIONI')).toBe('RUN_MISSIONI')
  })

  it('INSERT … SELECT → propone la tabella INTO (la destinazione)', () => {
    expect(
      targetTableOfStatement("INSERT INTO dbo.LOG (causa) VALUES (1)\nSELECT 'x'"),
    ).toBe('dbo.LOG')
    expect(targetTableOfStatement('INSERT INTO dbo.LOG (c) SELECT x FROM dbo.SRC')).toBe('dbo.LOG')
  })

  it('UPDATE / DELETE / MERGE → propone la tabella dello statement', () => {
    expect(targetTableOfStatement('UPDATE dbo.TIPI_EVENTI SET DES = \'x\' WHERE ID = 1')).toBe('dbo.TIPI_EVENTI')
    expect(targetTableOfStatement('DELETE FROM dbo.TIPI_EVENTI WHERE ID = 1')).toBe('dbo.TIPI_EVENTI')
    expect(targetTableOfStatement('MERGE INTO dbo.T AS tgt USING (VALUES (1)) AS src (id) ON 1 = 1 WHEN MATCHED THEN UPDATE SET id = src.id;')).toBe('dbo.T')
  })

  it('tabelle temporanee / variabili tabella NON vengono proposte', () => {
    // selettivo INTO #tmp/variabile: si salta e si prende la FROM reale
    expect(targetTableOfStatement('SELECT * INTO #tmp FROM dbo.ORIGINE')).toBe('dbo.ORIGINE')
    expect(targetTableOfStatement('INSERT INTO @tbl (a) SELECT x FROM dbo.ORIGINE')).toBe('dbo.ORIGINE')
    expect(targetTableOfStatement('SELECT * FROM #tmp')).toBe('')
    // nessuna sorgente dati → niente proposta (l'utente digita, resta editabile)
    expect(targetTableOfStatement('PRINT \'ciao\'')).toBe('')
    expect(targetTableOfStatement('DECLARE @a INT')).toBe('')
  })

  it('keyword dentro stringhe e commenti ignorate', () => {
    expect(targetTableOfStatement("-- from x\nSELECT * FROM dbo.A -- from y\n")).toBe('dbo.A')
    expect(
      targetTableOfStatement("SELECT 'from pippo' AS testo /* join zeta */ FROM dbo.B"),
    ).toBe('dbo.B')
    // il FROM dentro una stringa NON viene preso
    expect(targetTableOfStatement("SELECT 'select * from dbo.FALSO' AS x")).toBe('')
  })

  it('CTE con la tabella fisica nel corpo → propone quella fisica', () => {
    const sql = ';WITH c AS (SELECT * FROM dbo.TIPI_EVENTI)\nSELECT * FROM c'
    expect(targetTableOfStatement(sql)).toBe('dbo.TIPI_EVENTI')
  })

  it('batch senza ";" (righe separate): ogni statement ha la sua proposta', () => {
    const sql = 'DECLARE @a INT\nSELECT @a = 1\nINSERT INTO dbo.LOG (a) VALUES (@a)\nSELECT * FROM dbo.TIPI_EVENTI'
    const targets = suggestTargetTables(sql)
    // statement in ordine: DECLARE, SELECT assegnazione, INSERT, SELECT finale
    expect(targets[targets.length - 1]).toBe('dbo.TIPI_EVENTI')
    expect(targets).toContain('dbo.LOG')
    // la proposta della SELECT finale è stabile anche con statement "vuoti" prima
    expect(targets.find(t => t !== '')).toBe('dbo.LOG')
  })

  it('split: ";" e GO separano le istruzioni, le continuazioni di riga no', () => {
    const parts = splitExecutedStatements(
      'SELECT a FROM dbo.T1\nGO\nINSERT INTO dbo.T2 (a) VALUES (1);\nUPDATE dbo.T3 SET a = 2',
    )
    expect(parts.length).toBe(3)
    expect(parts[0]).toContain('T1')
    expect(parts[1]).toContain('T2')
    expect(parts[2]).toContain('T3')
  })

  it('stripSqlNoise: stringhe e commenti rimossi, le righe restano', () => {
    const out = stripSqlNoise("-- c\nSELECT 'from' /* join */ , 'x' AS v")
    expect(out).not.toContain('from')
    expect(out).not.toContain('join')
    expect(out).toContain('SELECT')
    expect(out).toContain('\n')
  })
})
