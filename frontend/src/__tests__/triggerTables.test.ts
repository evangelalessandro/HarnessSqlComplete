// TRIGGER: `inserted` e `deleted` devono dare i campi nell'intellisense (segnalazione utente: "nei
// trigger devi vedere i campi per l'intellisense dall'oggetto inserted e updated, adesso non sembra
// vederli").
import { describe, expect, it } from 'vitest'
import {
  TABELLE_LOGICHE,
  colonneTabelleLogiche,
  contestoTabellaLogica,
  eTabellaLogica,
  eUnTrigger,
  tabellaDelTrigger,
  tabellaTriggerDalSommario,
} from '../triggerTables'
import type { DatabaseSummary, TableInfo } from '../types'

const colonneHeader = [
  'SalesOrderID',
  'OrderDate',
  'TotalDue',
  'CustomerID',
  'ModifiedDate',
]

function tabella(): TableInfo {
  return {
    schema: 'Sales',
    name: 'SalesOrderHeader',
    columnCount: colonneHeader.length,
    columns: colonneHeader.map((n, i) => ({
      name: n,
      dataType: i === 1 || i === 4 ? 'datetime' : i === 2 ? 'money' : 'int',
      isNullable: false,
      isIdentity: i === 0,
      isComputed: false,
      maxLength: 4,
    })),
    usage: null,
    extendedProperties: null,
    createDate: null,
  } as unknown as TableInfo
}

function summary(): DatabaseSummary {
  return {
    tables: [tabella()],
    views: [],
    procedures: [],
    functions: [],
    triggers: [
      { schema: 'Sales', name: 'uSalesOrderHeader', tableName: 'SalesOrderHeader', definition: null },
    ],
    foreignKeys: [],
    databases: [],
    checkConstraints: [],
    cooccurrences: [],
  } as unknown as DatabaseSummary
}

const TRIGGER = `CREATE TRIGGER Sales.uSalesOrderHeader ON Sales.SalesOrderHeader
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON
  INSERT INTO [Sales].[SalesOrderHeader] (SalesOrderID, OrderDate)
  SELECT i.SalesOrderID, i.OrderDate
  FROM inserted AS i
  INNER JOIN deleted AS d ON d.SalesOrderID = i.SalesOrderID
END`

describe('trigger: la tabella su cui è definito il trigger', () => {
  it('legge il nome dopo ON (con schema)', () => {
    expect(tabellaDelTrigger(TRIGGER)).toEqual({ schema: 'Sales', tabella: 'SalesOrderHeader' })
  })

  it('legge anche la forma con le quadre e senza schema', () => {
    const sql = 'CREATE TRIGGER [dbo].[trg_Test] ON [dbo].[Person] AFTER INSERT AS SELECT 1'
    expect(tabellaDelTrigger(sql)).toEqual({ schema: 'dbo', tabella: 'Person' })
    const senzaSchema = 'CREATE TRIGGER trg_Test ON Person AFTER INSERT AS SELECT 1'
    expect(tabellaDelTrigger(senzaSchema)).toEqual({ schema: 'dbo', tabella: 'Person' })
  })

  it('ripiega sul sommario se la ON non c è (aggancia almeno una colonna)', () => {
    const parziale = 'CREATE TRIGGER Sales.uSalesOrderHeader ON'
    expect(tabellaDelTrigger(parziale, summary())).toEqual({ schema: 'Sales', tabella: 'SalesOrderHeader' })
    const trovata = tabellaTriggerDalSommario(TRIGGER, summary())
    expect(trovata?.name).toBe('SalesOrderHeader')
  })

  it('riconosce un trigger e i nomi delle tabelle logiche', () => {
    expect(eUnTrigger(TRIGGER)).toBe(true)
    expect(eUnTrigger('SELECT * FROM Person.Person')).toBe(false)
    for (const nome of TABELLE_LOGICHE) expect(eTabellaLogica(nome)).toBe(true)
    expect(eTabellaLogica('insertedd')).toBe(false)
  })
})

describe('trigger: contesto "inserted." / "deleted." / "updated."', () => {
  it('riconosce il prefisso anche mentre si digita il campo', () => {
    expect(contestoTabellaLogica('SELECT inserted.')).toEqual({ logica: 'inserted', prefisso: '' })
    expect(contestoTabellaLogica('SELECT inserted.Sales')).toEqual({ logica: 'inserted', prefisso: 'Sales' })
    // il cursore è DOPO il punto: si passa il testo fino al cursore
    expect(contestoTabellaLogica('WHERE deleted.Total')).toEqual({ logica: 'deleted', prefisso: 'Total' })
    expect(contestoTabellaLogica('AND  updated.Ord')).toEqual({ logica: 'updated', prefisso: 'Ord' })
  })

  it('NON confonde un campo chiamato "inserted" con la tabella logica', () => {
    expect(contestoTabellaLogica('SELECT x.inserted')).toBeNull()
    expect(contestoTabellaLogica('SELECT insertedCount.')).toBeNull()
  })

  it('senza punto non è un contesto di tabella logica', () => {
    expect(contestoTabellaLogica('SELECT inserted')).toBeNull()
    expect(contestoTabellaLogica('FROM inserted')).toBeNull()
  })
})

describe('trigger: le colonne proposte dopo il punto', () => {
  it('sono quelle della tabella del trigger, per inserted e deleted', () => {
    const prima = 'SELECT i.SalesOrderID\nFROM inserted AS i\nWHERE inserted.'
    const esito = colonneTabelleLogiche(prima, TRIGGER, summary())!
    expect(esito.logica).toBe('inserted')
    expect(esito.tabella.name).toBe('SalesOrderHeader')
    expect(esito.colonne.map(c => c.name)).toEqual(colonneHeader)
    console.log(`  inserted · ${esito.tabella.schema}.${esito.tabella.name}: ${esito.colonne.length} colonne`)
  })

  it('con "deleted." propone le stesse colonne (cambia solo la tabella logica)', () => {
    const esito = colonneTabelleLogiche('SELECT deleted.', TRIGGER, summary())!
    expect(esito.logica).toBe('deleted')
    expect(esito.colonne.map(c => c.name)).toEqual(colonneHeader)
  })

  it('anche con "updated." (sinonimo che l utente si aspetta)', () => {
    const esito = colonneTabelleLogiche('SELECT updated.', TRIGGER, summary())!
    expect(esito.logica).toBe('updated')
    expect(esito.colonne.length).toBe(colonneHeader.length)
  })

  it('fuori da un trigger non propone niente', () => {
    expect(colonneTabelleLogiche('SELECT inserted.', 'SELECT * FROM Person.Person', summary())).toBeNull()
  })

  it('se la tabella non è nel sommario non inventa colonne', () => {
    const triggerSconosciuto = 'CREATE TRIGGER trg ON Sconosciuta.Tabella AFTER INSERT AS SELECT inserted.'
    expect(colonneTabelleLogiche('SELECT inserted.', triggerSconosciuto, summary())).toBeNull()
  })
})
