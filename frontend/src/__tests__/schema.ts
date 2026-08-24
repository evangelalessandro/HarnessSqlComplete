// Schema mock condiviso per i test: replica le situazioni reali del DB
// (nomi maiuscoli, FK, colonne condivise, colonne inesistenti).
import type { ColumnInfo, DatabaseSummary, ProcedureInfo, TableInfo } from '../types'

export function mkCol(
  name: string,
  dataType = 'int',
  extra: Partial<ColumnInfo> = {},
): ColumnInfo {
  return {
    name,
    dataType,
    isNullable: false,
    isIdentity: false,
    isComputed: false,
    maxLength: null,
    description: null,
    extendedProperties: null,
    ...extra,
  }
}

/** Colonna con descrizione e proprietà estese (simula un DB documentato). */
export function mkDocCol(
  name: string,
  dataType: string,
  description: string,
  props: { name: string; value: string }[] = [],
): ColumnInfo {
  return mkCol(name, dataType, {
    description,
    extendedProperties: [{ name: 'MS_Description', value: description }, ...props],
  })
}

export function mkTbl(schema: string, name: string, cols: ColumnInfo[], extra: Partial<TableInfo> = {}): TableInfo {
  return {
    schema,
    name,
    columnCount: cols.length,
    createDate: null,
    columns: cols,
    usage: null,
    extendedProperties: null,
    ...extra,
  }
}

export function mkProc(schema: string, name: string, params: { name: string; dataType: string; mode?: string }[]): ProcedureInfo {
  return {
    schema,
    name,
    createDate: null,
    parameters: params.map(p => ({ name: p.name, dataType: p.dataType, mode: p.mode ?? 'IN' })),
  }
}

/**
 * Schema ispirato a WSBRITVIC (nomi reali): DAT_UDC e RUN_MISSIONI collegati da FK,
 * MIS_ELEV volutamente ASSENTE (come nel DB reale), tabelle con colonne condivise.
 */
export function wsbritvicLikeSummary(): DatabaseSummary {
  const tables: TableInfo[] = [
    mkTbl(
      'dbo',
      'DAT_UDC',
      [
        mkCol('UDC_UDC', 'nvarchar'),
        mkCol('UDC_UDCPRED', 'nvarchar'),
        mkCol('UDC_CORRIDOIO', 'nvarchar'),
        mkCol('UDC_CODICE', 'nvarchar'),
        mkCol('UDC_DESCR', 'nvarchar'),
      ],
      { extendedProperties: [{ name: 'MS_Description', value: 'Tabella degli UDC' }] },
    ),
    mkTbl('dbo', 'RUN_MISSIONI', [
      mkDocCol('MIS_UDC', 'nvarchar', 'Codice UDC di destinazione', [
        { name: 'BusinessKey', value: 'UDC' },
      ]),
      mkCol('MIS_MISSIONE', 'int'),
      mkCol('MIS_OPERATORE', 'nvarchar'),
    ]),
    mkTbl('dbo', 'Ordini', [mkCol('id'), mkCol('customer_id'), mkCol('totale', 'decimal')]),
    mkTbl('dbo', 'Clienti', [mkCol('id'), mkCol('nome', 'nvarchar')]),
    mkTbl('dbo', 'Articoli', [mkCol('art_id'), mkCol('descr', 'nvarchar')]),
  ]
  return {
    tables,
    views: [],
    procedures: [
      mkProc('dbo', 'zzz_test_proc', [
        { name: 'id', dataType: 'int' },
        { name: 'nome', dataType: 'nvarchar(100)' },
        { name: 'flag', dataType: 'bit', mode: 'OUTPUT' },
      ]),
    ],
    triggers: [],
    functions: [],
    foreignKeys: [
      {
        name: 'FK_RUN_MISSIONI_DAT_UDC',
        schema: 'dbo',
        table: 'RUN_MISSIONI',
        column: 'MIS_UDC',
        refSchema: 'dbo',
        refTable: 'DAT_UDC',
        refColumn: 'UDC_UDC',
      },
      {
        name: 'FK_ORDINI_CLIENTI',
        schema: 'dbo',
        table: 'Ordini',
        column: 'customer_id',
        refSchema: 'dbo',
        refTable: 'Clienti',
        refColumn: 'id',
      },
    ],
    databases: [],
  }
}
