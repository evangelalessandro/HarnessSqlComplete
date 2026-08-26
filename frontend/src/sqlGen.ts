// Generazione di statement INSERT/UPDATE/MERGE dai dati dell'anteprima tabella
// (finestra "Anteprima dati"): in base alle righe e colonne selezionate dall'utente.
// Logica PURA e testabile.

import type { CellValue } from './types'
import { qualified } from './helpers'

export interface GenColumn {
  name: string
  dataType?: string
  isIdentity?: boolean
}

/** Literal SQL da un valore cella: NULL, numeri nudi, booleani 1/0, stringhe con '' sfuggite. */
export function sqlLiteral(value: CellValue): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  // date e GUID arrivano come stringhe dal backend → vanno tra apici (corretto in T-SQL)
  return "'" + String(value).replace(/'/g, "''") + "'"
}

function tableRef(schema: string, table: string): string {
  return qualified(schema, table)
}

function colList(columns: GenColumn[]): string {
  return columns.map(c => `[${c.name}]`).join(', ')
}

function valueTuple(columns: GenColumn[], row: CellValue[]): string {
  return `(${columns.map((_, i) => sqlLiteral(row[i])).join(', ')})`
}

/**
 * INSERT INTO t (col…) VALUES (…), (…);
 * Colonne e righe sono quelle selezionate; i valori seguono l'ordine delle colonne.
 */
export function buildInsertSql(
  schema: string,
  table: string,
  columns: GenColumn[],
  rows: CellValue[][],
): string {
  if (columns.length === 0) throw new Error('Nessuna colonna selezionata')
  if (rows.length === 0) throw new Error('Nessuna riga selezionata')
  const tuples = rows.map(r => valueTuple(columns, r)).join(',\n  ')
  return `INSERT INTO ${tableRef(schema, table)}\n  (${colList(columns)})\nVALUES\n  ${tuples};`
}

/**
 * UPDATE t SET col = val, … WHERE <colonne NON aggiornate> = …;
 * La clausola WHERE identifica la riga con i valori delle colonne NON nel SET
 * (match completo); se il SET copre tutte le colonne, il WHERE usa tutte
 * (aggiornamento "no-op" — meglio lasciarne una fuori dal SET).
 */
export function buildUpdateSql(
  schema: string,
  table: string,
  allColumns: GenColumn[],
  selectedIndexes: number[],
  row: CellValue[],
): string {
  if (selectedIndexes.length === 0) throw new Error('Nessuna colonna selezionata')
  const sets = selectedIndexes.map(i => `  [${allColumns[i].name}] = ${sqlLiteral(row[i])}`).join(',\n')
  const setIdx = new Set(selectedIndexes)
  const whereIdx = Array.from({ length: allColumns.length }, (_, i) => i).filter(i => !setIdx.has(i))
  const idx = whereIdx.length > 0 ? whereIdx : Array.from({ length: allColumns.length }, (_, i) => i)
  const wheres = idx.map(i => `  [${allColumns[i].name}] = ${sqlLiteral(row[i])}`).join(' AND\n')
  return `UPDATE ${tableRef(schema, table)}\nSET\n${sets}\nWHERE\n${wheres};`
}

/**
 * MERGE INTO t AS tgt USING (VALUES …) AS src (col…) ON <chiave> WHEN MATCHED THEN
 * UPDATE SET … WHEN NOT MATCHED THEN INSERT (…) VALUES (src.col, …);
 * La chiave dell'ON sono le colonne isIdentity (o la prima colonna se non note).
 */
export function buildMergeSql(
  schema: string,
  table: string,
  columns: GenColumn[],
  rows: CellValue[][],
  keyColumns?: string[],
): string {
  if (columns.length === 0) throw new Error('Nessuna colonna selezionata')
  if (rows.length === 0) throw new Error('Nessuna riga selezionata')
  const keys = keyColumns && keyColumns.length > 0
    ? keyColumns
    : columns.filter(c => c.isIdentity).map(c => c.name)
  const onCols = keys.length > 0 ? keys : [columns[0].name]
  const on = onCols
    .map(c => `tgt.[${c}] = src.[${c}]`)
    .join(' AND\n    ')
  const values = rows.map(r => valueTuple(columns, r)).join(',\n    ')
  const sets = columns.map(c => `tgt.[${c.name}] = src.[${c.name}]`).join(',\n    ')
  const ins = columns.map(c => `src.[${c.name}]`).join(', ')
  return [
    `MERGE INTO ${tableRef(schema, table)} AS tgt`,
    `USING (VALUES\n    ${values}) AS src (${colList(columns)})`,
    `ON ${on}`,
    `WHEN MATCHED THEN UPDATE SET\n    ${sets}`,
    `WHEN NOT MATCHED THEN INSERT (${colList(columns)})\n    VALUES (${ins});`,
  ].join('\n')
}
