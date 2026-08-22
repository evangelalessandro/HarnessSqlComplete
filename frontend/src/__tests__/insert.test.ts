import { describe, expect, it } from 'vitest'
import { insertCorrespondingTarget, parseInsertContext } from '../helpers'

const SQL = `INSERT INTO dbo.Clienti (id, nome, prezzo) VALUES (1, 'Mario, Rossi', 10.50);`

describe('INSERT: parsing e corrispondenza colonna↔valore', () => {
  it('parse: tabella, schema, colonne e valori (virgola dentro stringa)', () => {
    const ctx = parseInsertContext(SQL)
    expect(ctx?.schema).toBe('dbo')
    expect(ctx?.table).toBe('Clienti')
    expect(ctx?.columnSlots.map(s => s.text)).toEqual(['id', 'nome', 'prezzo'])
    expect(ctx?.valueTuples.length).toBe(1)
    expect(ctx?.valueTuples[0].map(s => s.text)).toEqual(['1', "'Mario, Rossi'", '10.50'])
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
    expect(ctx?.valueTuples[0].map(s => s.text)).toEqual(['(SELECT MAX(x) FROM y WHERE z = 1)', "'v'"])
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
