import { describe, expect, it } from 'vitest'
import {
  buildInsertValues,
  columnForInsertSlot,
  insertCorrespondingTarget,
  insertSlotIndexAt,
  insertTupleAt,
  insertTupleInnerRange,
  parseInsertContext,
  sqlDefaultForType,
} from '../helpers'
import { mkCol, mkTbl, demoStoreLikeSummary } from './schema'

const SQL = `INSERT INTO dbo.Clienti (id, nome, prezzo) VALUES (1, 'Mario, Rossi', 10.50);`

describe('INSERT: parsing e corrispondenza colonna↔valore', () => {
  it('parse: tabella, schema, colonne e valori (virgola dentro stringa)', () => {
    const ctx = parseInsertContext(SQL)
    expect(ctx?.schema).toBe('dbo')
    expect(ctx?.table).toBe('Clienti')
    expect(ctx?.columnSlots.map(s => s.text)).toEqual(['id', 'nome', 'prezzo'])
    expect(ctx?.valueTuples.length).toBe(1)
    expect(ctx?.valueTuples[0].slots.map(s => s.text)).toEqual(['1', "'Mario, Rossi'", '10.50'])
  })

  it('cursore su colonna → evidenzia il valore corrispondente', () => {
    const t = insertCorrespondingTarget(SQL, SQL.indexOf('nome') + 1)
    expect(t).not.toBeNull()
    expect(SQL.slice(t!.start, t!.end)).toBe("'Mario, Rossi'")
  })

  it('cursore su valore → evidenzia la colonna corrispondente', () => {
    const t = insertCorrespondingTarget(SQL, SQL.indexOf("'Mario, Rossi'") + 3)
    expect(t).not.toBeNull()
    expect(SQL.slice(t!.start, t!.end)).toBe('nome')
  })

  it('funzioni nidificate nei valori (GETDATE())', () => {
    const sql = "INSERT INTO t (d, s) VALUES (GETDATE(), 'test');"
    const t = insertCorrespondingTarget(sql, sql.indexOf('GETDATE') + 2)
    expect(sql.slice(t!.start, t!.end)).toBe('d')
  })

  it('più tuple VALUES: la seconda tupla mappa sulle stesse colonne', () => {
    const sql = "INSERT INTO t (a, b) VALUES (1, 'x'), (2, 'y');"
    const t1 = insertCorrespondingTarget(sql, sql.indexOf("'y'") + 1)
    expect(sql.slice(t1!.start, t1!.end)).toBe('b')
  })

  it('senza lista colonne: nessun target', () => {
    const sql = 'INSERT INTO t VALUES (1, 2);'
    expect(insertCorrespondingTarget(sql, sql.indexOf('2'))).toBeNull()
  })

  it('cursore fuori dall INSERT: nessun target', () => {
    const sql = 'SELECT * FROM t; INSERT INTO t (a) VALUES (1);'
    expect(insertCorrespondingTarget(sql, sql.indexOf('SELECT') + 2)).toBeNull()
  })

  it('lista colonne non ancora chiusa (per il completamento)', () => {
    const ctx = parseInsertContext('INSERT INTO dbo.Clienti (id, nom')
    expect(ctx?.colClose).toBeNull()
    expect(ctx?.columnSlots.map(s => s.text)).toEqual(['id', 'nom'])
  })

  it('batch con INSERT precedente: il suo VALUES non nasconde la lista colonne del secondo INSERT', () => {
    // scenario utente: un batch ("BEGIN TRAN … INSERT INTO LOG (… ) VALUES (…)"
    // seguito da "INSERT INTO TIPI_EVENTI (TI…") — il VALUES del primo INSERT non
    // deve far scambiare la '(' del secondo per una subquery (niente colonne).
    const sql =
      "BEGIN TRAN\nDECLARE @caus INT\nINSERT INTO LOG (causa) VALUES (@caus)\nINSERT INTO TIPI_EVENTI (TI"
    const ctx = parseInsertContext(sql)
    expect(ctx?.table).toBe('TIPI_EVENTI')
    expect(ctx?.schema).toBeNull()
    expect(ctx?.colOpen).not.toBe(-1)
    expect(ctx?.columnSlots.map(s => s.text)).toEqual(['TI'])
  })

  it('slot vuoto tra virgole: mappa sulla colonna successiva', () => {
    const sql = 'INSERT INTO t (a, b) VALUES (1, , 3);'
    const t = insertCorrespondingTarget(sql, sql.indexOf(', ,') + 1)
    expect(sql.slice(t!.start, t!.end)).toBe('b')
  })

  it('INSERT ... SELECT: il valore del SELECT evidenzia la colonna corrispondente', () => {
    const sql = "INSERT INTO\n  TIPI_BAIE_USo(TUB_USOBAIA, TUB_DES)\n  select 'ale','ale2'"
    // cursore sul secondo valore della select-list → evidenzia TUB_DES
    const t2 = insertCorrespondingTarget(sql, sql.indexOf("'ale2'") + 1)
    expect(sql.slice(t2!.start, t2!.end)).toBe('TUB_DES')
    // cursore sul primo valore → evidenzia TUB_USOBAIA
    const t1 = insertCorrespondingTarget(sql, sql.indexOf("'ale'") + 1)
    expect(sql.slice(t1!.start, t1!.end)).toBe('TUB_USOBAIA')
  })

  it('INSERT ... SELECT con subquery: la subquery è un unico slot', () => {
    const sql = "INSERT INTO t (a, b) SELECT (SELECT MAX(x) FROM y WHERE z = 1), 'v'"
    const ctx = parseInsertContext(sql)
    expect(ctx?.columnSlots.map(s => s.text)).toEqual(['a', 'b'])
    expect(ctx?.valueTuples[0].slots.map(s => s.text)).toEqual(['(SELECT MAX(x) FROM y WHERE z = 1)', "'v'"])
    // cursore dentro la subquery → colonna a
    const t = insertCorrespondingTarget(sql, sql.indexOf('MAX(x)') + 2)
    expect(sql.slice(t!.start, t!.end)).toBe('a')
    // cursore su 'v' → colonna b
    const t2 = insertCorrespondingTarget(sql, sql.indexOf("'v'") + 1)
    expect(sql.slice(t2!.start, t2!.end)).toBe('b')
  })

  it('INSERT ... SELECT senza lista colonne: nessun target', () => {
    const sql = 'INSERT INTO t SELECT 1, 2 FROM x'
    expect(insertCorrespondingTarget(sql, sql.indexOf('2') + 1)).toBeNull()
  })

  it('la parentesi di una subquery dopo il nome tabella non è la lista colonne', () => {
    const sql = 'INSERT INTO t SELECT (SELECT 1)'
    const ctx = parseInsertContext(sql)
    expect(ctx?.colOpen).toBe(-1)
  })
})

describe('aiuto sui VALORI: default per tipo e snippet "tutti i valori"', () => {
  it('sqlDefaultForType: default per tipo (e NULL se nullable)', () => {
    expect(sqlDefaultForType('int', false)).toBe('0')
    expect(sqlDefaultForType('bigint', false)).toBe('0')
    expect(sqlDefaultForType('decimal(10,2)', false)).toBe('0')
    expect(sqlDefaultForType('bit', false)).toBe('0')
    expect(sqlDefaultForType('nvarchar(50)', false)).toBe("''")
    expect(sqlDefaultForType('datetime', false)).toBe('GETDATE()')
    expect(sqlDefaultForType('uniqueidentifier', false)).toBe('NEWID()')
    expect(sqlDefaultForType('varbinary(max)', false)).toBe('0x')
    expect(sqlDefaultForType('int', true)).toBe('NULL')
  })

  it('buildInsertValues: un default per colonna nell ordine', () => {
    const table = mkTbl('dbo', 'T', [
      mkCol('id', 'int'),
      mkCol('nome', 'nvarchar', { isNullable: true }),
      mkCol('creato', 'datetime'),
      mkCol('attivo', 'bit'),
    ])
    expect(buildInsertValues(table.columns!)).toBe('0, NULL, GETDATE(), 0')
  })

  it('columnForInsertSlot: risolve la colonna dallo slot (lista colonne o posizionale)', () => {
    const summary = demoStoreLikeSummary()
    const table = summary.tables.find(t => t.name === 'RUN_MISSIONI')!
    const sql = "INSERT INTO RUN_MISSIONI (MIS_UDC, MIS_MISSIONE) VALUES ('x', 1)"
    const ctx = parseInsertContext(sql)!
    expect(columnForInsertSlot(ctx, table, 0)?.name).toBe('MIS_UDC')
    expect(columnForInsertSlot(ctx, table, 1)?.name).toBe('MIS_MISSIONE')
    // senza lista colonne: posizionale
    const ctx2 = parseInsertContext("INSERT INTO RUN_MISSIONI VALUES ('x', 1)")!
    expect(columnForInsertSlot(ctx2, table, 0)?.name).toBe('MIS_UDC')
  })

  it('insertTupleAt / insertTupleInnerRange: tupla che contiene il cursore e range interno', () => {
    const sql = "INSERT INTO t (a, b) VALUES (1, 'x')"
    const ctx = parseInsertContext(sql)!
    const tuple = insertTupleAt(ctx, sql.indexOf("'x'") + 1)!
    expect(tuple.slots.length).toBe(2)
    expect(tuple.open).toBe(sql.indexOf('(1')) // '(' di VALUES
    const inner = insertTupleInnerRange(tuple)
    expect(sql.slice(inner.start, inner.end)).toBe("1, 'x'")
    // tupla non chiusa: range fino all'ultimo slot
    const sql2 = "INSERT INTO t (a, b) VALUES (1"
    const ctx2 = parseInsertContext(sql2)!
    const inner2 = insertTupleInnerRange(ctx2.valueTuples[0])
    expect(sql2.slice(inner2.start, inner2.end)).toBe('1')
  })

  it('insertSlotIndexAt: slot sotto il cursore (o successivo)', () => {
    const ctx = parseInsertContext(SQL)!
    const slots = ctx.valueTuples[0].slots
    expect(insertSlotIndexAt(slots, SQL.indexOf('10.50') + 1)).toBe(2)
  })
})
