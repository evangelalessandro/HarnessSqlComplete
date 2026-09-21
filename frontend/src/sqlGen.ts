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

/**
 * Colonne CHIAVE della tabella: quelle della PRIMARY KEY (anche composita), altrimenti le
 * identity, altrimenti nessuna. Serve alla MERGE (condizione ON, e quindi ai campi da NON
 * aggiornare) e al DELETE.
 */
export function chiaveTabella(
  columns: { name: string; isIdentity?: boolean }[],
  pkColumns?: string[] | null,
): string[] {
  const nomi = new Set(columns.map(c => c.name.toLowerCase()))
  const pk = (pkColumns ?? []).filter(c => nomi.has(c.toLowerCase()))
  if (pk.length > 0) return pk
  return columns.filter(c => c.isIdentity).map(c => c.name)
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

/** "schema.tabella" (o solo "tabella" → schema dbo) in { schema, table }. */
export function parseTargetTable(ref: string): { schema: string; table: string } {
  const t = ref.trim()
  const idx = t.indexOf('.')
  if (idx === -1) return { schema: 'dbo', table: t }
  return { schema: t.slice(0, idx).trim(), table: t.slice(idx + 1).trim() }
}

// ---------- Proposta automatica della tabella target (dal SQL eseguito) ----------
//
// "Data un recordset, non richiedere il nome della tabella: proponilo (modificabile)".
// Il generatore della griglia risultati propone la tabella sorgente/destinazione
// dello statement che ha prodotto il recordset (es. "select * from dbo.TIPI_EVENTI"
// → propone "dbo.TIPI_EVENTI"). La proposta è SEMPRE editabile dall'utente.

/** Keyword che, a inizio riga (fuori parentesi), aprono una nuova istruzione del batch. */
const BATCH_STARTERS = new Set([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'EXEC', 'EXECUTE', 'DECLARE', 'SET',
  'PRINT', 'IF', 'WHILE', 'BEGIN', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'USE', 'GO',
  'BACKUP', 'RESTORE', 'GRANT', 'REVOKE', 'DENY', 'WITH', 'COMMIT', 'ROLLBACK', 'SAVE',
  'RAISERROR', 'THROW', 'RETURN', 'WAITFOR', 'CHECKPOINT', 'DBCC', 'KILL',
])

/**
 * Copia del SQL senza stringhe e commenti (le righe restano): l'analisi dei target
 * non deve inciampare in parole chiave dentro letterali o commenti.
 */
export function stripSqlNoise(sql: string): string {
  let out = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const ch = sql[i]
    const next = sql[i + 1]
    if (ch === "'") {
      // stringa (es. 'from x', N'…'): le '' interne sono l'escape
      i += 1
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2
            continue
          }
          i += 1
          break
        }
        out += sql[i] === '\n' ? '\n' : ' '
        i += 1
      }
      continue
    }
    if (ch === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) {
        out += sql[i] === '\n' ? '\n' : ' '
        i += 1
      }
      i = Math.min(n, i + 2)
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/**
 * Divide il batch eseguito in istruzioni: a ';', a 'GO' e a inizio riga con una
 * keyword di statement (i batch reali sono spesso scritti senza ';').
 */
export function splitExecutedStatements(sql: string): string[] {
  const code = stripSqlNoise(sql)
  const chunks: string[] = []
  let start = 0
  let i = 0
  const n = code.length
  let depth = 0
  const push = (end: number) => {
    const c = code.slice(start, end).trim()
    if (c) chunks.push(c)
  }
  while (i < n) {
    const ch = code[i]
    if (ch === '(') {
      depth += 1
      i += 1
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1)
      i += 1
    } else if (ch === ';' && depth === 0) {
      push(i)
      i += 1
      while (i < n && (code[i] === ';' || code[i] === ' ' || code[i] === '\t' || code[i] === '\r' || code[i] === '\n')) i += 1
      start = i
    } else if ((ch === '\n' || ch === '\r') && depth === 0) {
      // la prossima riga inizia con una keyword di statement → nuova istruzione
      let j = i + 1
      while (j < n && (code[j] === ' ' || code[j] === '\t' || code[j] === '\r' || code[j] === '\n')) j += 1
      const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(code.slice(j))
      if (word && BATCH_STARTERS.has(word[0].toUpperCase())) {
        push(j)
        start = j
        i = j
        continue
      }
      i += 1
    } else {
      i += 1
    }
  }
  push(n)
  // "GO" separa i batch ma non è un'istruzione: non conta come statement
  return chunks.filter(c => c.toUpperCase() !== 'GO')
}

/**
 * Tabella "schema.tabella" (o "tabella") che ha prodotto il recordset di uno statement:
 * il PRIMO riferimento a una sorgente/destinazione dati (INTO/FROM/UPDATE/JOIN),
 * saltando tabelle temporanee/variabili ('#'/'@'). Per "MERGE INTO t USING (VALUES…)"
 * vale t; per "INSERT INTO t … SELECT … FROM s" vale t (la destinazione).
 */
export function targetTableOfStatement(stmt: string): string {
  const code = stripSqlNoise(stmt)
  const re = /\b(?:INTO|FROM|UPDATE|JOIN)\s+((?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*))?)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    const raw = m[1].replace(/[\[\]\s]/g, '')
    if (raw.startsWith('#') || raw.startsWith('@')) continue
    const parts = raw.split('.')
    if (parts.length > 2) continue
    return parts.join('.')
  }
  return ''
}

/** Proposta di tabella target ('' se non ricavabile) per ogni statement del batch. */
export function suggestTargetTables(sql: string): string[] {
  return splitExecutedStatements(sql).map(targetTableOfStatement)
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
 * DELETE FROM t WHERE <chiave> = …;
 * La clausola WHERE usa la chiave identity (o la prima colonna se non nota);
 * con più righe selezionate si genera un DELETE per riga.
 */
export function buildDeleteSql(
  schema: string,
  table: string,
  allColumns: GenColumn[],
  keyColumns?: string[],
  row: CellValue[] = [],
): string {
  const keys = keyColumns && keyColumns.length > 0
    ? keyColumns
    : allColumns.filter(c => c.isIdentity).map(c => c.name)
  const onCols = keys.length > 0 ? keys : [allColumns[0]?.name]
  const wheres = onCols
    .map(c => {
      const i = allColumns.findIndex(x => x.name === c)
      return `  [${c}] = ${sqlLiteral(row[i])}`
    })
    .join(' AND\n')
  return `DELETE FROM ${tableRef(schema, table)}\nWHERE\n${wheres};`
}

/**
 * "INSERT INTO #tmp": crea e popola una tabella temporanea con i dati selezionati
 * in un'unica istruzione: SELECT * INTO [#tmp] FROM (VALUES …) AS v(col…).
 */
export function buildInsertIntoTempSql(
  tempName: string,
  columns: GenColumn[],
  rows: CellValue[][],
): string {
  if (columns.length === 0) throw new Error('Nessuna colonna selezionata')
  if (rows.length === 0) throw new Error('Nessuna riga selezionata')
  const tuples = rows.map(r => valueTuple(columns, r)).join(',\n    ')
  return [
    'SELECT *',
    `INTO [${tempName}]`,
    `FROM (VALUES\n    ${tuples}) AS v (${colList(columns)})`,
    ';',
  ].join('\n')
}

/**
 * MERGE INTO t AS tgt USING (VALUES …) AS src (col…) ON <chiave> WHEN MATCHED THEN
 * UPDATE SET … WHEN NOT MATCHED THEN INSERT (…) VALUES (src.col, …);
 * La chiave dell'ON sono le colonne indicate (`keyColumns`), altrimenti le identity, altrimenti la
 * prima colonna. I CAMPI CHIAVE non entrano MAI nell'UPDATE SET (richiesta utente): sono già uguali
 * per la condizione ON, quindi aggiornarli sarebbe un no-op — e in molte tabelle sono identity o
 * calcolati, che SQL Server non lascia aggiornare. Se la chiave copre tutte le colonne, la clausola
 * "WHEN MATCHED THEN UPDATE" non viene scritta affatto.
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
  const chiave = new Set(onCols.map(c => c.toLowerCase()))
  const on = onCols
    .map(c => `tgt.[${c}] = src.[${c}]`)
    .join(' AND\n    ')
  const values = rows.map(r => valueTuple(columns, r)).join(',\n    ')
  const aggiornabili = columns.filter(c => !chiave.has(c.name.toLowerCase()))
  const ins = columns.map(c => `src.[${c.name}]`).join(', ')
  const righe = [
    `MERGE INTO ${tableRef(schema, table)} AS tgt`,
    `USING (VALUES\n    ${values}) AS src (${colList(columns)})`,
    `ON ${on}`,
  ]
  if (aggiornabili.length > 0) {
    const sets = aggiornabili.map(c => `tgt.[${c.name}] = src.[${c.name}]`).join(',\n    ')
    righe.push(`WHEN MATCHED THEN UPDATE SET\n    ${sets}`)
  } else {
    // tutti i campi sono chiave: non c'è nulla da aggiornare (la riga esiste già identica)
    righe.push('-- chiave = tutte le colonne: nulla da aggiornare, si inserisce soltanto')
  }
  righe.push(`WHEN NOT MATCHED THEN INSERT (${colList(columns)})\n    VALUES (${ins});`)
  return righe.join('\n')
}
