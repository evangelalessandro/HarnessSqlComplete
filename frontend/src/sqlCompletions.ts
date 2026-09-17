// Provider di completamento SQL, ESTRATTO da SqlEditor per poter essere eseguito dai test.
// Se questo codice lancia un'eccezione l'intellisense si "spacca" (popup vuoto):
// il test src/__tests__/completionSmoke.test.ts esegue il provider su molti contesti
// reali e fallisce se lancia un errore o se non propone nulla nel codice.
import * as monaco from 'monaco-editor'
import type { ColumnInfo, DatabaseSummary, TableInfo } from './types'
import { isTextOffsetInComment } from './helpers'
import { buildColumnContextSuggestions, buildExecParamSnippet, buildInsertValues, buildJoinConditionSuggestions, buildJoinSuggestions, buildQualifiedColumnSuggestions, buildSelectListSuggestions, buildSelfJoinSuggestions, buildStatementSnippets, columnForInsertSlot, columnInfoMarkdown, completionFilterText, completionSortText, extractStatementTableRefs, filterUnusedParams, findExecContext, findTableRefs, insertSlotIndexAt, insertTupleAt, insertTupleInnerRange, isInsideValuesTuple, parseInsertContext, qualified, rankSelectListForTyped, rankTablesForPosition, splitUserFunctions, sqlDefaultForType, sqlIdent, starFilterText, statementRangeAt, usageDetail } from './helpers'
import { shouldSuggestSystemObjects, systemObjectsFor } from './systemObjects'
import { TSQL_ALTER_SNIPPETS, TSQL_OPTION_HINTS, TSQL_OVER_CONTINUE, TSQL_OVER_FRAMES, TSQL_OVER_STARTS, TSQL_SET_OPTIONS, TSQL_SYSTEM_VARIABLES, TSQL_TABLE_HINTS, TSQL_TYPES, detectAlterTableContext, detectCreateIndexContext, detectCreateTableColumnContext, detectDeclareTypeContext, detectObjectNameContext, detectOptionHintsContext, detectOverContext, detectSetContext, detectSystemVariableContext, detectTableHintsContext, detectVariableContext, extractDeclaredVariables, extractRoutineParameters, systemVariablePrefixLen, variablePrefixLen } from './tsqlSnippets'
import { extractCteTables, extractDerivedTables, extractLocalTables } from './localTables'
import { extractLabels } from './labels'
import { ORDER_DIRECTIONS } from './intellisenseContext'
import { classifyContext, filterKeywordsForContext, isAfterOrderKeyword, isOrderWordTyped, shouldSuggestJoinConditions } from './intellisenseContext'

export interface CompletionProviderState {
  connectionId: string
  summary: DatabaseSummary | null
  aiEnabled: boolean
  onExecute: (sql: string) => void
}

export interface CompletionProviderOptions {
  model: monaco.editor.ITextModel
  position: monaco.Position
  state: CompletionProviderState
  historyTableBoost?: (tableName: string) => number
  historyColumnBoost?: (columnName: string) => number
}

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'ON', 'GROUP', 'BY',
  'ORDER', 'HAVING', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'ALTER', 'DROP',
  'TABLE', 'VIEW', 'PROCEDURE', 'EXEC', 'EXECUTE', 'BEGIN', 'END', 'DECLARE', 'PRINT', 'TOP', 'DISTINCT',
  'AS', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN', 'IS', 'NULL', 'CASE', 'WHEN', 'THEN', 'ELSE',
  'UNION', 'ALL', 'WITH', 'GO', 'USE', 'TRUNCATE', 'MERGE', 'RETURN', 'TRY', 'CATCH', 'THROW', 'CAST',
  'CONVERT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'ISNULL', 'GETDATE', 'NEWID', 'NVARCHAR',
  'VARCHAR', 'INT', 'BIGINT', 'DECIMAL', 'DATETIME', 'BIT', 'GUID', 'IDENTITY', 'PRIMARY', 'FOREIGN',
  'REFERENCES', 'CONSTRAINT', 'INDEX', 'UNIQUE', 'CHECK', 'DEFAULT', 'OVER', 'PARTITION', 'ROW_NUMBER',
  'RANK', 'DENSE_RANK', 'OUTPUT', 'MERGE', 'OPTION', 'RECOMPILE', 'NOCOUNT', 'TRANSACTION', 'COMMIT',
  'ROLLBACK', 'SAVE', 'WAITFOR', 'RAISERROR',
  // Statement e language elements ufficiali (riferimento Microsoft T-SQL)
  'BACKUP', 'RESTORE', 'GRANT', 'REVOKE', 'DENY', 'BULK', 'DBCC', 'CHECKPOINT', 'KILL',
  'RECONFIGURE', 'SHUTDOWN', 'IF', 'WHILE', 'BREAK', 'CONTINUE', 'GOTO', 'OPEN', 'CLOSE', 'FETCH',
  'DEALLOCATE', 'CURSOR', 'EXCEPT', 'INTERSECT', 'EXISTS', 'FULL', 'APPLY', 'PIVOT', 'UNPIVOT', 'FOR',
  'COLLATE', 'TABLESAMPLE', 'HOLDLOCK', 'NOCHECK', 'CASCADE', 'ANY', 'SOME', 'OF', 'OFF', 'TO', 'ADD',
  'ASC', 'DESC', 'DATABASE', 'SCHEMA', 'COLUMN', 'CLUSTERED', 'NONCLUSTERED', 'PROC', 'NULLIF',
  'ROWCOUNT', 'STATISTICS', 'USER', 'CURRENT_USER', 'SESSION_USER', 'SYSTEM_USER', 'CURRENT_TIMESTAMP',
  'CURRENT_DATE', 'CURRENT_TIME', 'WITHIN', 'COMPUTE',
  // OFFSET-FETCH (paginazione, dopo ORDER BY)
  'OFFSET', 'NEXT', 'ROWS', 'ONLY',
]

/** Funzioni T-SQL (manuale Microsoft): aggregati, finestra/window, stringhe, matematiche, data/ora, conversione, sistema. */
const SQL_FUNCTIONS = [
  // aggregati
  'SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'COUNT_BIG', 'STRING_AGG', 'STDEV', 'STDEVP', 'VAR', 'VARP',
  'CHECKSUM_AGG', 'GROUPING', 'GROUPING_ID',
  // finestra (window)
  'RANK', 'DENSE_RANK', 'ROW_NUMBER', 'NTILE', 'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE',
  'CUME_DIST', 'PERCENT_RANK', 'PERCENTILE_CONT', 'PERCENTILE_DISC',
  // stringhe
  'ASCII', 'CHAR', 'CHARINDEX', 'CONCAT', 'CONCAT_WS', 'DIFFERENCE', 'FORMAT', 'LEFT', 'LEN',
  'LOWER', 'LTRIM', 'NCHAR', 'PATINDEX', 'QUOTENAME', 'REPLACE', 'REPLICATE', 'REVERSE', 'RIGHT',
  'RTRIM', 'SOUNDEX', 'SPACE', 'STR', 'STRING_ESCAPE', 'STRING_SPLIT', 'STUFF', 'SUBSTRING',
  'TRANSLATE', 'TRIM', 'UNICODE', 'UPPER',
  // matematiche
  'ABS', 'CEILING', 'FLOOR', 'ROUND', 'SIGN', 'SQRT', 'SQUARE', 'POWER', 'EXP', 'LOG', 'LOG10',
  'PI', 'RAND', 'ACOS', 'ASIN', 'ATAN', 'ATN2', 'COS', 'COT', 'DEGREES', 'RADIANS', 'SIN', 'TAN',
  // data/ora
  'GETDATE', 'GETUTCDATE', 'SYSDATETIME', 'SYSUTCDATETIME', 'CURRENT_TIMESTAMP', 'DATEADD',
  'DATEDIFF', 'DATEDIFF_BIG', 'DATENAME', 'DATEPART', 'DATEFROMPARTS', 'DATETIMEFROMPARTS',
  'YEAR', 'MONTH', 'DAY', 'EOMONTH', 'ISDATE', 'SWITCHOFFSET', 'TODATETIMEOFFSET',
  // conversione
  'CAST', 'CONVERT', 'TRY_CAST', 'TRY_CONVERT', 'PARSE', 'TRY_PARSE',
  // data/ora moderne
  'DATETRUNC', 'DATE_BUCKET', 'GENERATE_SERIES',
  // JSON
  'OPENJSON', 'JSON_ARRAY', 'JSON_OBJECT',
  // statistiche approssimate e confronto (SQL 2022)
  'APPROX_COUNT_DISTINCT', 'APPROX_PERCENTILE_CONT', 'APPROX_PERCENTILE_DISC', 'GREATEST', 'LEAST',
  'RANDOM',
  // sistema / logico
  'COALESCE', 'ISNULL', 'NULLIF', 'IIF', 'CHOOSE', 'CASE', 'NULL', 'ISNUMERIC', 'NEWID',
  'NEWSEQUENTIALID', 'HOST_NAME', 'USER_NAME', 'SCOPE_IDENTITY', 'IDENT_CURRENT', 'ERROR_MESSAGE',
  'ERROR_NUMBER', 'ERROR_SEVERITY', 'ERROR_STATE', 'JSON_VALUE', 'JSON_QUERY', 'ISJSON', 'JSON_MODIFY',
]

function columnTypeText(dataType: string, isNullable: boolean, isIdentity = false): string {
  return [dataType, isNullable ? 'NULL' : '', isIdentity ? 'IDENTITY' : ''].filter(Boolean).join(' ')
}
/**
 * Suggerimenti per l'editor SQL. Funzione PURA rispetto a React: la usa il provider di
 * Monaco dentro SqlEditor e la eseguono i test (con un modello Monaco reale).
 */
export function provideSqlCompletions({
  model,
  position,
  state: baseSt,
  historyTableBoost = () => 0,
  historyColumnBoost = () => 0,
}: CompletionProviderOptions): monaco.languages.CompletionList {

          // la preview dati ha il SUO provider filtrato sulla tabella
          if (model.uri.toString().startsWith('sql-intelli://preview')) return { suggestions: [] }
          try {
          const word = model.getWordUntilPosition(position)
          const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
          const textBefore = model.getValueInRange(
            new monaco.Range(1, 1, position.lineNumber, position.column),
          )
          // Testo prima della parola in corso (per capire se siamo in posizione FROM/JOIN)
          const prefix = textBefore.slice(0, Math.max(0, textBefore.length - word.word.length))
          // Contesto dello statement corrente (per la classificazione e i rami successivi)
          const fullText = model.getValue()
          const cursorOffset = model.getOffsetAt(position)
          // dentro un commento non si propone alcun suggerimento
          if (isTextOffsetInComment(fullText, cursorOffset)) return { suggestions: [] }
          // Tabelle TEMPORANEE (#t) e CTE definite nel testo: senza aggiungerle al sommario
          // le loro colonne non sarebbero proponibili ("... LEFT JOIN #t ON 1 = 1 WHERE ",
          // "from c pippo where pippo."). Le CTE stanno PRIMA delle tabelle dello schema:
          // se una CTE ha il nome di una tabella, vince la CTE (come fa SQL Server).
          // (qualsiasi errore del parser locale non deve mai svuotare il popup)
          let localTables: TableInfo[] = []
          let cteTables: TableInfo[] = []
          let derivedTables: TableInfo[] = []
          try {
            const note = baseSt.summary?.tables ?? []
            localTables = extractLocalTables(fullText, note)
            cteTables = extractCteTables(fullText, note)
            // tabelle derivate "(select …) t": lo "*" dentro la sottoquery si risolve anche
            // con le temporanee e le CTE del testo, non solo con lo schema
            derivedTables = extractDerivedTables(fullText, [...cteTables, ...note, ...localTables])
          } catch {
            localTables = []
            cteTables = []
            derivedTables = []
          }
          const st =
            baseSt.summary && localTables.length + cteTables.length + derivedTables.length > 0
              ? {
                  ...baseSt,
                  summary: {
                    ...baseSt.summary,
                    tables: [...cteTables, ...baseSt.summary.tables, ...localTables, ...derivedTables],
                  },
                }
              : baseSt
          const stmtRange = statementRangeAt(fullText, cursorOffset)
          const stmtText = fullText.slice(stmtRange.start, stmtRange.end)
          const stmtBefore = stmtText.slice(0, cursorOffset - stmtRange.start)
          const ctx = classifyContext({ prefix, stmtBefore })
          const { isTablePosition, isJoinPosition, isExecPosition, isColumnContext, inSelectList, inOrderBy } = ctx

          const suggestions: monaco.languages.CompletionItem[] = []
          let rank = 0
          const push = (item: monaco.languages.CompletionItem) => {
            suggestions.push({ ...item, sortText: completionSortText(rank) })
            rank++
          }

          // GOTO: si propongono TUTTE le label definite nel documento, anche quelle scritte
          // più sotto (è il caso normale: "goto lblExit" e la label in fondo alla procedura).
          // Se il documento non ha label si prosegue con i suggerimenti normali: il popup non
          // deve mai restare vuoto.
          if (ctx.allowed.includes('labels')) {
            const nomiLabel = extractLabels(fullText)
            if (nomiLabel.length > 0) {
              for (const nome of nomiLabel) {
                push({
                  label: nome,
                  detail: 'label',
                  kind: monaco.languages.CompletionItemKind.Reference,
                  insertText: nome,
                  range,
                  filterText: nome,
                })
              }
              return { suggestions }
            }
          }

          // Funzioni T-SQL (aggregati, window, stringhe…) + funzioni utente SCALARI del database.
          // Le funzioni tabellari (IF/TF) si propongono solo come sorgente (vedi loop dopo le viste).
          // filterText = nome, così Monaco le filtra con la parola digitata.
          const pushSqlFunctions = () => {
            for (const f of SQL_FUNCTIONS) {
              push({
                label: f,
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: f,
                range,
                filterText: f,
              })
            }
            for (const fn of splitUserFunctions(st.summary?.functions ?? []).scalars) {
              push({
                label: `${fn.schema}.${fn.name}`,
                detail: 'funzione scalare',
                kind: monaco.languages.CompletionItemKind.Function,
                insertText: qualified(fn.schema, fn.name),
                range,
                filterText: fn.name,
              })
            }
          }

          if (st.summary) {
            if (detectDeclareTypeContext(textBefore)) {
              for (const t of TSQL_TYPES) {
                push({
                  label: t.name,
                  detail: t.detail,
                  kind: monaco.languages.CompletionItemKind.TypeParameter,
                  insertText: t.insertText,
                  range,
                  filterText: t.name,
                })
              }
              return { suggestions }
            }

            // SET <opzione> → valori possibili (ON/OFF…); dopo "SET " → nomi delle opzioni
            const setCtx = detectSetContext(textBefore)
            if (setCtx) {
              if (setCtx.kind === 'options') {
                for (const opt of TSQL_SET_OPTIONS) {
                  push({
                    label: opt.name,
                    detail: opt.detail,
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: opt.name,
                    range,
                    filterText: opt.name,
                  })
                }
              } else {
                const opt = TSQL_SET_OPTIONS.find(o => o.name.toUpperCase() === setCtx.option) ?? {
                  name: setCtx.option,
                  detail: 'valore per l\'opzione SET',
                  values: ['ON', 'OFF'],
                }
                for (const v of opt.values) {
                  push({
                    label: v,
                    detail: `valore per SET ${setCtx.option}`,
                    kind: monaco.languages.CompletionItemKind.Constant,
                    insertText: v,
                    range,
                    filterText: v,
                  })
                }
              }
              return { suggestions }
            }

            // ALTER TABLE <tabella> → snippet (constraint, colonne, abilita/disabilita trigger)
            if (detectAlterTableContext(textBefore)) {
              for (const sn of TSQL_ALTER_SNIPPETS) {
                push({
                  label: sn.label,
                  detail: sn.detail,
                  kind: monaco.languages.CompletionItemKind.Snippet,
                  insertText: sn.insertText,
                  insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range,
                  filterText: sn.label,
                })
              }
              return { suggestions }
            }

            // "@@..." → variabili di sistema T-SQL (es. "IF @@ERROR", "SELECT @@ROWCOUNT").
            // Monaco non considera '@@' una parola (l'@ è separatore): il range deve
            // coprire il "@@" (e l'eventuale prefisso parziale) già digitato, altrimenti
            // il nome si aggiunge dopo → "IF @@@@ROWCOUNT".
            if (detectSystemVariableContext(textBefore)) {
              const prefixLen = systemVariablePrefixLen(textBefore)
              if (prefixLen > 0) {
                const startOffset = cursorOffset - prefixLen
                const startPos = model.getPositionAt(startOffset)
                const endPos = model.getPositionAt(cursorOffset)
                const sysRange = new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column)
                for (const v of TSQL_SYSTEM_VARIABLES) {
                  push({
                    label: v.name,
                    detail: v.detail,
                    kind: monaco.languages.CompletionItemKind.Constant,
                    insertText: v.name,
                    range: sysRange,
                    filterText: v.name,
                  })
                }
                return { suggestions }
              }
            }

            // Oggetti dopo DROP/TRUNCATE/ALTER/USE (niente tabelle generiche)
            const objKind = detectObjectNameContext(textBefore)
            if (objKind) {
              const pushObj = (
                label: string,
                detail: string,
                insertText: string,
                kind: monaco.languages.CompletionItemKind,
              ) =>
                push({
                  label,
                  detail,
                  kind,
                  insertText,
                  range,
                  filterText: label.split('.').pop() ?? label,
                })
              if (objKind === 'table') {
                for (const t of st.summary.tables) pushObj(qualified(t.schema, t.name), `${t.columnCount} col.`, qualified(t.schema, t.name), monaco.languages.CompletionItemKind.Struct)
              } else if (objKind === 'view') {
                for (const v of st.summary.views) pushObj(qualified(v.schema, v.name), 'vista', qualified(v.schema, v.name), monaco.languages.CompletionItemKind.Interface)
              } else if (objKind === 'procedure') {
                for (const p of st.summary.procedures) pushObj(qualified(p.schema, p.name), `proc · ${p.parameters?.length ?? 0} param.`, qualified(p.schema, p.name), monaco.languages.CompletionItemKind.Function)
              } else if (objKind === 'function') {
                for (const f of st.summary.functions) pushObj(qualified(f.schema, f.name), f.type, qualified(f.schema, f.name), monaco.languages.CompletionItemKind.Method)
              } else if (objKind === 'trigger') {
                for (const tr of st.summary.triggers) pushObj(qualified(tr.schema, tr.name), tr.tableName, qualified(tr.schema, tr.name), monaco.languages.CompletionItemKind.Event)
              } else if (objKind === 'database') {
                for (const d of st.summary.databases) pushObj(d.name, 'database', d.name, monaco.languages.CompletionItemKind.Folder)
              }
              return { suggestions }
            }

            // CREATE TABLE t (id → tipi di dato
            if (detectCreateTableColumnContext(textBefore)) {
              for (const t of TSQL_TYPES) {
                push({
                  label: t.name,
                  detail: t.detail,
                  kind: monaco.languages.CompletionItemKind.TypeParameter,
                  insertText: t.insertText,
                  range,
                  filterText: t.name,
                })
              }
              return { suggestions }
            }

            // OPTION ( → hint di query
            if (detectOptionHintsContext(textBefore)) {
              for (const h of TSQL_OPTION_HINTS) {
                push({
                  label: h.name,
                  detail: h.detail,
                  kind: monaco.languages.CompletionItemKind.Keyword,
                  insertText: h.insertText,
                  insertTextRules: h.insertText.includes('${')
                    ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                    : undefined,
                  range,
                  filterText: h.name,
                })
              }
              return { suggestions }
            }

            // CREATE INDEX → snippet del nome; dopo "ON " → tabelle
            const idxCtx = detectCreateIndexContext(textBefore)
            if (idxCtx === 'name') {
              push({
                label: 'CREATE INDEX',
                detail: 'snippet indice: nome, tabella e colonna',
                kind: monaco.languages.CompletionItemKind.Snippet,
                insertText: '[${1:nome}] ON [${2:tabella}] (${3:colonna})',
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
              })
              return { suggestions }
            }
            if (idxCtx === 'table') {
              for (const t of st.summary.tables) {
                push({
                  label: qualified(t.schema, t.name),
                  detail: `${t.columnCount} col.`,
                  kind: monaco.languages.CompletionItemKind.Struct,
                  insertText: qualified(t.schema, t.name),
                  range,
                  filterText: t.name,
                })
              }
              return { suggestions }
            }

            // FROM t WITH ( → hint di tabella (NOLOCK…)
            if (detectTableHintsContext(textBefore)) {
              for (const h of TSQL_TABLE_HINTS) {
                push({
                  label: h.name,
                  detail: h.detail,
                  kind: monaco.languages.CompletionItemKind.Constant,
                  insertText: h.name,
                  range,
                  filterText: h.name,
                })
              }
              return { suggestions }
            }

            // Funzioni finestra: dentro OVER( ... ) → PARTITION BY / ORDER BY / ROWS / RANGE
            const overCtx = detectOverContext(textBefore)
            if (overCtx) {
              const list =
                overCtx === 'empty'
                  ? TSQL_OVER_STARTS
                  : overCtx === 'continue'
                    ? TSQL_OVER_CONTINUE
                    : TSQL_OVER_FRAMES
              for (const o of list) {
                push({
                  label: o.name,
                  detail: o.detail,
                  kind: monaco.languages.CompletionItemKind.Snippet,
                  insertText: o.insertText,
                  insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range,
                  filterText: o.name,
                })
              }
              return { suggestions }
            }

            // Variabili (@var): "select @p" in una routine → i PARAMETRI della firma
            // (modifica di una store: @pRiga, @pOrdine…) PIÙ le variabili dichiarate
            if (detectVariableContext(textBefore)) {
              const locals = extractDeclaredVariables(textBefore)
              const params = extractRoutineParameters(textBefore)
              const all = new Map<string, { dataType: string; isParam: boolean }>()
              for (const p of params)
                if (!all.has(p.name)) all.set(p.name, { dataType: p.dataType, isParam: true })
              for (const v of locals)
                if (!all.has(v.name)) all.set(v.name, { dataType: v.dataType, isParam: false })
              if (all.size > 0) {
                const prefixLen = variablePrefixLen(textBefore)
                const startOffset = cursorOffset - prefixLen
                const startPos = model.getPositionAt(startOffset)
                const endPos = model.getPositionAt(cursorOffset)
                const varRange = new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column)
                for (const [name, v] of all) {
                  push({
                    label: name,
                    detail: v.isParam ? `${v.dataType} · parametro della routine` : `${v.dataType} · variabile dichiarata`,
                    kind: monaco.languages.CompletionItemKind.Variable,
                    insertText: name,
                    range: varRange,
                    filterText: name,
                  })
                }
                return { suggestions }
              }
            }

            // Snippet statement completi: a inizio statement (dopo ';', GO o vuoto),
            // digitando "ins"/"sel"/"upd"/"del"/"mer" propone il template con tab-stop
            {
              const atStatementStart =
                /(?:^|;|\bGO\b|\n\s*\n)\s*$/i.test(prefix) && word.word.length >= 2
              if (atStatementStart) {
                for (const sn of buildStatementSnippets(word.word)) {
                  push({
                    label: sn.label,
                    detail: sn.detail,
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    insertText: sn.insertText,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                    // filterText stabile = label ("INSERT INTO"…): con la parola digitata
                    // il popup si svuoterebbe digitando un carattere in più (es. "ins" → "inse").
                    filterText: sn.label,
                  })
                }
              }
            }
            // Aiuto INSERT: dentro la lista colonne di "INSERT INTO tab (" →
            // suggerisce le colonne della tabella, con opzione "tutte le colonne";
            // dentro i VALUES → suggerisce i valori di default per la colonna corrente
            const insertCtx = parseInsertContext(textBefore)
            const insTable = insertCtx
              ? st.summary.tables.find(
                  t =>
                    t.name.toLowerCase() === insertCtx.table.toLowerCase() &&
                    (!insertCtx.schema || t.schema.toLowerCase() === insertCtx.schema.toLowerCase()),
                )
              : undefined
            if (insertCtx && insertCtx.colOpen !== -1) {
              const cursorOffset = model.getOffsetAt(position)
              const inInsertColumns =
                insertCtx.colClose === null || cursorOffset <= insertCtx.colClose
              if (inInsertColumns) {
                if (insTable?.columns && insTable.columns.length > 0) {
                  if (word.word.length === 0) {
                    push({
                      label: '— tutte le colonne —',
                      detail: `inserisce le ${insTable.columns.length} colonne di ${insTable.name}`,
                      kind: monaco.languages.CompletionItemKind.Snippet,
                      insertText: insTable.columns.map(c => sqlIdent(c.name)).join(', '),
                      range,
                    })
                  }
                  for (const c of insTable.columns) {
                    push({
                      label: c.name,
                      detail: `colonna di ${insTable.schema}.${insTable.name} · ${c.dataType}${c.isNullable ? ' NULL' : ''}${c.isIdentity ? ' IDENTITY' : ''}`,
                      documentation: columnInfoMarkdown(insTable, c),
                      kind: monaco.languages.CompletionItemKind.Field,
                      insertText: sqlIdent(c.name),
                      range,
                      filterText: c.name,
                    })
                  }
                  return { suggestions }
                }
              }
            }

            // Aiuto VALUES: SOLO dentro una tupla "VALUES (…)" → valori di default per la
            // colonna corrente. NON per INSERT … SELECT: lì il SELECT deve seguire i rami
            // normali (colonne/tabelle), altrimenti il popup resta vuoto quando la tabella
            // target è una variabile tabella o una temporanea non note allo schema.
            if (insertCtx && isInsideValuesTuple(insertCtx, model.getOffsetAt(position))) {
              const cursorOffset = model.getOffsetAt(position)
              const tuple = insertTupleAt(insertCtx, cursorOffset)
              if (tuple) {
                const slotIdx = Math.max(0, insertSlotIndexAt(tuple.slots, cursorOffset))
                const column = columnForInsertSlot(insertCtx, insTable ?? null, slotIdx)
                // true se abbiamo davvero qualcosa da proporre: altrimenti si prosegue
                // con i rami normali invece di restituire un popup vuoto
                let pushed = false

                // snippet "tutti i valori" (un default per colonna, in ordine)
                let valueColumns: ColumnInfo[] = []
                if (insertCtx.columnSlots.length > 0 && insTable) {
                  valueColumns = insertCtx.columnSlots
                    .map((_, i) => columnForInsertSlot(insertCtx, insTable, i))
                    .filter((c): c is ColumnInfo => c !== null)
                } else if (insTable?.columns) {
                  valueColumns = insTable.columns
                }
                if (valueColumns.length > 0) {
                  const inner = insertTupleInnerRange(tuple)
                  if (inner.start >= 0) {
                    const startPos = model.getPositionAt(inner.start)
                    const endPos = model.getPositionAt(inner.end)
                    const tupleRange = new monaco.Range(
                      startPos.lineNumber,
                      startPos.column,
                      endPos.lineNumber,
                      endPos.column,
                    )
                    push({
                      label: `— tutti i valori (${valueColumns.length}) —`,
                      detail: 'inserisce un valore di default per ogni colonna',
                      kind: monaco.languages.CompletionItemKind.Snippet,
                      insertText: buildInsertValues(valueColumns),
                      range: tupleRange,
                    })
                    pushed = true
                  }
                }

                // valori suggeriti per la colonna corrente
                if (column) {
                  const def = sqlDefaultForType(column.dataType, column.isNullable)
                  const candidates = new Set<string>([def])
                  if (def !== 'NULL') candidates.add('NULL')
                  const t = column.dataType.toLowerCase()
                  if (t.includes('char') || t.includes('text')) candidates.add("N''")
                  const slot = tuple.slots[slotIdx]
                  const slotRange = slot
                    ? new monaco.Range(
                        model.getPositionAt(slot.start).lineNumber,
                        model.getPositionAt(slot.start).column,
                        model.getPositionAt(Math.max(slot.start, slot.end - 1)).lineNumber,
                        model.getPositionAt(Math.max(slot.start, slot.end - 1)).column + 1,
                      )
                    : range
                  for (const v of candidates) {
                    push({
                      label: v,
                      detail: `valore per ${column.name} · ${column.dataType}`,
                      kind: monaco.languages.CompletionItemKind.Constant,
                      insertText: v,
                      range: slotRange,
                      filterText: v,
                    })
                  }
                  pushed = true
                }
                // solo se c'era qualcosa di utile: altrimenti i rami normali (colonne/tabelle)
                if (pushed) return { suggestions }
              }
            }

            // Aiuto EXEC: dentro "EXEC [schema].[proc] ..." suggerisce i parametri della procedura
            const execCtx = findExecContext(textBefore)
            if (execCtx) {
              const afterProc = textBefore.slice(execCtx.nameEnd)
              const notInStatement = /;|\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|JOIN|GO)\b/i.test(afterProc)
              if (!notInStatement && afterProc.length < 300) {
                const execProc = st.summary.procedures.find(
                  p =>
                    p.name.toLowerCase() === execCtx.name.toLowerCase() &&
                    (!execCtx.schema || p.schema.toLowerCase() === execCtx.schema.toLowerCase()),
                )
                if (execProc?.parameters && execProc.parameters.length > 0) {
                  const available = filterUnusedParams(execProc.parameters, afterProc)
                  if (available.length > 0) {
                    const atSign = prefix.endsWith('@')
                    if (word.word.length === 0 && available.length === execProc.parameters.length) {
                      push({
                        label: '— tutti i parametri —',
                        detail: `inserisce i ${execProc.parameters.length} parametri di ${execProc.name}`,
                        kind: monaco.languages.CompletionItemKind.Snippet,
                        insertText: buildExecParamSnippet(execProc.parameters),
                        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        range,
                      })
                    }
                    for (const par of available) {
                      const isOut = par.mode === 'OUTPUT'
                      const defText = par.defaultValue ? ` · default ${par.defaultValue}` : ''
                      push({
                        label: `@${par.name}`,
                        detail: `${par.dataType}${isOut ? ' · OUTPUT' : ''}${defText} · ${execProc.schema}.${execProc.name}`,
                        kind: monaco.languages.CompletionItemKind.Variable,
                        insertText: atSign ? `${par.name}${isOut ? ' OUTPUT' : ''}` : `@${par.name}${isOut ? ' OUTPUT' : ''}`,
                        range,
                        filterText: `@${par.name}`,
                      })
                    }
                    return { suggestions }
                  }
                }
              }
            }

            // Contesto = SOLO lo statement corrente (prima del cursore): le query
            // precedenti non devono filtrare le tabelle/colonne dello statement in
            // corso (es. DAT_UDC già usata prima NON va nascosta a un nuovo JOIN).
            const contextTables = findTableRefs(stmtBefore)
            const summaryTables = st.summary.tables

            // ORDER BY: SOLO colonne delle tabelle dello statement + ASC/DESC.
            // Niente tabelle, viste, procedure o funzioni: nella ORDER BY non si possono usare.
            if (inOrderBy) {
              // dopo "ORDER " serve "BY" per completare la clausola
              if (isAfterOrderKeyword(prefix)) {
                push({
                  label: 'BY',
                  detail: 'completa ORDER BY',
                  kind: monaco.languages.CompletionItemKind.Keyword,
                  insertText: 'BY',
                  range,
                  filterText: 'by',
                })
              }
              // ASC/DESC solo quando la voce corrente ha già un campo ("ORDER BY col ▮"):
              // subito dopo "ORDER BY " (o dopo una virgola) si sceglie prima il campo.
              // Se però non c'è nessun campo da proporre (tabella non risolta) si mostrano
              // comunque le direzioni: il popup non deve mai restare vuoto.
              const directions = () => {
                for (const dir of ORDER_DIRECTIONS) {
                  push({
                    label: dir,
                    detail: 'direzione di ordinamento',
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: dir,
                    range,
                    filterText: dir.toLowerCase(),
                  })
                }
              }
              const mostraSubito = ctx.allowed.includes('orderDirections')
              if (mostraSubito) directions()
              const orderCols = buildColumnContextSuggestions(
                stmtText,
                stmtBefore,
                word.word,
                st.summary,
                historyColumnBoost,
              )
              for (const col of orderCols) {
                push({
                  label: col.name,
                  detail: [columnTypeText(col.dataType, col.isNullable), col.ownerLabel].filter(Boolean).join(' · '),
                  documentation: col.documentation,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: col.insertText,
                  range,
                  filterText: completionFilterText(col.name),
                })
              }
              // ripiego: nessun campo da proporre → almeno le direzioni (mai popup vuoto)
              if (!mostraSubito && suggestions.length === 0) directions()
              return { suggestions }
            }

            // Colonne qualificate con alias/tabella: dopo "r." o "RUN_MISSIONI." suggerisce
            // le colonne di quella tabella (es. "FROM RUN_MISSIONI r WHERE r."). Sta PRIMA dei
            // rami per contesto perché vale ovunque: nella select-list il ramo dedicato ritorna
            // subito e l'alias non veniva mai considerato (segnalato dall'utente: "nella select
            // non torna per primi i campi della tabella" dopo "from #tmpMission dd").
            {
              const qualified = buildQualifiedColumnSuggestions(stmtText, textBefore, st.summary)
              if (qualified.length > 0) {
                for (const col of qualified) {
                  push({
                    label: col.name,
                    detail: [columnTypeText(col.dataType, col.isNullable), 'colonna qualificata'].filter(Boolean).join(' · '),
                    documentation: col.documentation,
                    kind: monaco.languages.CompletionItemKind.Field,
                    insertText: col.insertText,
                    range,
                    filterText: col.name,
                  })
                }
                return { suggestions }
              }
            }

            // Aiuto SELECT: se il cursore è nella select-list (tra SELECT e FROM dello statement),
            // suggerisce le colonne delle tabelle referenziate in tutto lo statement (anche dopo il cursore)
            if (inSelectList) {
              const sel = buildSelectListSuggestions(stmtText, stmtBefore, st.summary)
              // Con una parola in corso: solo i campi con affinità, ordinati per punteggio.
              // filterText = NOME colonna (stabile): Monaco rifiltra le voci memorizzate
              // con la parola corrente, quindi con la parola digitata come filterText il
              // popup sparirebbe appena si digita un carattere in più (es. "MIS" → "MIS_":
              // "mis_" non fa più match con filterText "mis"). L'ordine resta il nostro (sortText).
              if (word.word.length > 0) {
                // solo i campi con affinità, ordinati per punteggio (il boost FK
                // si applica ai campi che matchano già, non a tutte le chiavi)
                const rankedCols = rankSelectListForTyped(sel.columns, word.word)
                for (const { col, score } of rankedCols) {
                  push({
                    label: col.name,
                    detail: [
                      columnTypeText(col.dataType, col.isNullable),
                      `${col.ownerLabel}${col.shared ? ' (condivisa)' : ''}`,
                      `affinità ${score}`,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                    documentation: col.documentation,
                    kind: monaco.languages.CompletionItemKind.Field,
                    insertText: col.insertText,
                    range,
                    filterText: completionFilterText(col.name),
                  })
                }
                // anche le funzioni (SUM/AVG/RANK/…) se matchano la parola digitata
                pushSqlFunctions()
                return { suggestions }
              }
              if (sel.starText) {
                // con '*' il range copre l'asterisco; senza '*' inserisce al cursore
                let itemRange = range
                let filterText: string | undefined
                if (sel.starOffset >= 0) {
                  const starPos = model.getPositionAt(stmtRange.start + sel.starOffset)
                  const starEndPos = model.getPositionAt(stmtRange.start + sel.starOffset + 1)
                  itemRange = new monaco.Range(
                    starPos.lineNumber,
                    starPos.column,
                    starEndPos.lineNumber,
                    starEndPos.column,
                  )
                  filterText = starFilterText(stmtText, sel.starOffset, cursorOffset - stmtRange.start)
                }
                push({
                  label: `— tutti i campi (${sel.starCount}) —`,
                  detail: sel.starOffset >= 0
                    ? 'espande * con le colonne delle tabelle dello statement'
                    : 'inserisce tutte le colonne delle tabelle dello statement',
                  kind: monaco.languages.CompletionItemKind.Snippet,
                  insertText: sel.starText,
                  filterText,
                  range: itemRange,
                })
              }
              for (const col of sel.columns) {
                push({
                  label: col.name,
                  detail: [
                    columnTypeText(col.dataType, col.isNullable, col.isIdentity),
                    `${col.ownerLabel}${col.shared ? ' (condivisa)' : ''}`,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                  documentation: col.documentation,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: col.insertText,
                  range,
                  filterText: col.name,
                })
              }
              // anche le funzioni T-SQL (SUM/AVG/RANK/…) e quelle utente del database
              pushSqlFunctions()
              // select-list: campi delle tabelle dello statement + funzioni (niente tabelle/proc/keyword)
              return { suggestions }
            }

            const contextTableInfos = contextTables
              .map(name => summaryTables.find(x => x.name.toLowerCase() === name))
              .filter((x): x is TableInfo => x !== undefined)
            // Posizione FROM/INTO/UPDATE/TABLE o inizio statement: clausola NUOVA →
            // si propongono TUTTE le tabelle per utilizzo reale (le query precedenti
            // non devono nascondere tabelle riscrivibili, es. RUN_MISSIONI).
            // Posizione JOIN (o contesti generici): solo le tabelle collegabili al contesto.
            const rankedTables = rankTablesForPosition(
              st.summary.tables,
              st.summary.foreignKeys,
              contextTables,
              isTablePosition || ctx.statementStart,
              st.summary.cooccurrences ?? undefined,
              historyTableBoost,
            )

            // Dopo EXEC: SOLO le stored procedure (chiamabili)
            if (isExecPosition) {
              for (const p of st.summary.procedures) {
                const params = p.parameters ?? []
                const suffix = params.length
                  ? ' ' + params.map((par, i) => (par.mode === 'OUTPUT' ? `@${par.name} OUTPUT` : `@${par.name}=${'$'}{${i + 1}:${par.name}}`)).join(', ')
                  : ''
                push({
                  label: `${p.schema}.${p.name}`,
                  detail: 'stored procedure',
                  documentation: `**${p.schema}.${p.name}**${params.length ? `\n\nParametri: ${params.map(x => `@${x.name} ${x.dataType}${x.mode === 'OUTPUT' ? ' OUTPUT' : ''}`).join(', ')}` : ''}`,
                  kind: monaco.languages.CompletionItemKind.Function,
                  insertText: qualified(p.schema, p.name) + suffix,
                  insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range,
                  filterText: p.name,
                })
              }
              return { suggestions }
            }

            // Contesti di colonne (WHERE/ON/HAVING/GROUP BY/SET/AND/OR/=):
            // SOLO colonne delle tabelle dello statement + funzioni SQL.
            // Con una parola in corso: solo le colonne con affinità, ordinate per punteggio,
            // più le controparti di JOIN (FK esatte o token condivisi) dopo "col = ".
            if (isColumnContext) {
              // Dopo "ORDER " serve "BY" (completa ORDER BY) → prima di tutto, anche
              // mentre si digita già "b"/"by" (il range copre la parola in corso).
              if (isAfterOrderKeyword(prefix)) {
                push({
                  label: 'BY',
                  detail: 'completa ORDER BY',
                  kind: monaco.languages.CompletionItemKind.Keyword,
                  insertText: 'BY',
                  range,
                  filterText: 'by',
                })
              }
              // Dentro una clausola ON con condizioni già scritte: propone anche le altre
              // coppie FK tra le stesse tabelle (es. dopo "MIS_D_CORRIDOIO = CEL_CORRIDOIO"
              // suggerisce "AND MIS_D_CELLA = CEL_CELLA") — solo se NON si sta digitando
              // una colonna, altrimenti gli "AND ..." coprirebbero i campi delle tabelle.
              if (shouldSuggestJoinConditions(word.word, stmtBefore)) {
                for (const jc of buildJoinConditionSuggestions(stmtText, stmtBefore, st.summary)) {
                  push({
                    label: jc.text,
                    detail: `condizione di JOIN · ${jc.left} = ${jc.right}`,
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    insertText: jc.text,
                    range,
                    filterText: jc.left,
                  })
                }
              }
              const ctxCols = buildColumnContextSuggestions(stmtText, stmtBefore, word.word, st.summary, historyColumnBoost)
              for (const col of ctxCols) {
                push({
                  label: col.name,
                  detail: [
                    columnTypeText(col.dataType, col.isNullable),
                    `${col.ownerLabel}${col.shared ? ' (condivisa)' : ''}${col.counterpart ? ' · ⇄' : ''}`,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                  documentation: col.documentation,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: col.insertText,
                  range,
                  // filterText stabile = nome colonna (vedi select-list: con la parola
                  // digitata il popup sparirebbe digitando un carattere in più, es. "MIS_").
                  filterText: completionFilterText(col.name),
                })
              }
              // funzioni T-SQL + funzioni utente del database
              pushSqlFunctions()
              return { suggestions }
            }

            // Tabelle: prima quelle collegabili via FK (con clausola ON), poi per utilizzo reale.
            // In posizione JOIN ogni relazione FK diventa una voce selezionabile (come Visual Studio).
            // NIENTE alias se non necessari: l'alias della tabella candidata si usa solo per i
            // self-join (stessa tabella già nello statement); le tabelle del contesto con un
            // alias già scritto nell'editor vengono riferite con il loro alias (altrimenti SQL invalido).
            const stmtRefs = extractStatementTableRefs(stmtText)
            const aliasedCtxTables = new Set(stmtRefs.filter(r => r.alias).map(r => r.tableName.toLowerCase()))
            for (const ranked of rankedTables) {
              const needsAlias = contextTables.includes(ranked.table.name.toLowerCase())
              for (const item of buildJoinSuggestions(ranked, contextTableInfos, isJoinPosition, needsAlias, aliasedCtxTables)) {
                const details = [usageDetail(ranked.table.usage)]
                if (ranked.hints.length > 0) details.push(`${ranked.hints.length} FK`)
                const detail = details.filter(Boolean).join(' · ') || `tabella · ${ranked.table.columnCount} colonne`
                push({
                  label: item.label,
                  detail: item.detail || detail,
                  documentation: columnInfoMarkdown(ranked.table, null),
                  kind: monaco.languages.CompletionItemKind.Struct,
                  insertText: item.insertText,
                  range,
                  filterText: item.filterText,
                })
              }
            }

            for (const v of st.summary.views) {
              push({
                label: `${v.schema}.${v.name}`,
                detail: 'vista',
                kind: monaco.languages.CompletionItemKind.Interface,
                insertText: qualified(v.schema, v.name),
                range,
              })
            }

            // Funzioni TABELLARI (IF/TF): sorgenti come le tabelle/viste (FROM/JOIN/APPLY),
            // NON nelle espressioni (SELECT/WHERE/GROUP BY/… dove vanno solo le scalari)
            for (const fn of splitUserFunctions(st.summary.functions).tableValued) {
              push({
                label: `${fn.schema}.${fn.name}`,
                detail: 'funzione tabellare',
                kind: monaco.languages.CompletionItemKind.Class,
                insertText: qualified(fn.schema, fn.name),
                range,
                filterText: fn.name,
              })
            }

            // Oggetti di catalogo di sistema (sys.tables, sys.columns, sys.dm_*…): compaiono
            // quando si digita "sys"/"dm" o dopo "sys." — sorgenti come le tabelle
            if (shouldSuggestSystemObjects(prefix, word.word)) {
              for (const obj of systemObjectsFor(prefix, word.word)) {
                push({
                  label: obj,
                  detail: 'oggetto di catalogo di sistema',
                  kind: monaco.languages.CompletionItemKind.Class,
                  insertText: obj,
                  range,
                  filterText: obj,
                })
              }
            }

            // Self-join: in posizione JOIN le tabelle già nello statement vengono riproposte
            // con un alias (es. "MAG_CORRIDOI AS mc2 ON (…)") — corso "Cross and Self Joins"
            if (isJoinPosition) {
              for (const sj of buildSelfJoinSuggestions(stmtText, st.summary)) {
                push({
                  label: sj.label,
                  detail: sj.detail,
                  kind: monaco.languages.CompletionItemKind.Struct,
                  insertText: sj.insertText,
                  range,
                  filterText: sj.filterText,
                })
              }
            }

            // Posizione FROM/JOIN/UPDATE/INTO: SOLO tabelle, viste e funzioni tabellari
            if (isTablePosition) return { suggestions }

            // Stored procedure: solo se il contesto le ammette (statementStart/generic, non dopo tabella)
            if (!isExecPosition && ctx.allowed.includes('procedures')) {
              for (const p of st.summary.procedures) {
                const params = p.parameters ?? []
                const suffix = params.length
                  ? ' ' + params.map((par, i) => (par.mode === 'OUTPUT' ? `@${par.name} OUTPUT` : `@${par.name}=${'$'}{${i + 1}:${par.name}}`)).join(', ')
                  : ''
                push({
                  label: `${p.schema}.${p.name}`,
                  detail: 'stored procedure',
                  kind: monaco.languages.CompletionItemKind.Function,
                  insertText: qualified(p.schema, p.name) + suffix,
                  insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range,
                })
              }
            }

            if (!isTablePosition) {
              // Colonne delle tabelle referenziate nel testo prima del cursore
              // (solo nei contesti che le ammettono: columnContext/selectList/generic)
              if (ctx.allowed.includes('columns')) {
                for (const ref of contextTables) {
                  const t = st.summary.tables.find(x => x.name.toLowerCase() === ref)
                  if (!t?.columns) continue
                  for (const c of t.columns) {
                    push({
                      label: c.name,
                      detail: `colonna di ${t.schema}.${t.name} · ${c.dataType}${c.isNullable ? ' NULL' : ''}`,
                      documentation: columnInfoMarkdown(t, c),
                      kind: monaco.languages.CompletionItemKind.Field,
                      insertText: sqlIdent(c.name),
                      range,
                    })
                  }
                }
              }

              // Keyword filtrate per contesto (dopo "FROM t " solo clausole, all'inizio solo statement)
              if (ctx.allowed.includes('keywords')) {
                // "order" (o prefisso) → "ORDER BY" come voce unica (non serve cercare BY a parte)
                if (isOrderWordTyped(word.word)) {
                  push({
                    label: 'ORDER BY',
                    detail: 'clausola ORDER BY',
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: 'ORDER BY',
                    range,
                    filterText: 'order',
                  })
                }
                for (const k of filterKeywordsForContext(ctx, SQL_KEYWORDS)) {
                  push({
                    label: k,
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: k,
                    range,
                  })
                }
              }
            }
          } else {
            // SOMMARIO NON DISPONIBILE (connessione scaduta, backend riavviato…): prima
            // il provider non proponeva NULLA (bug utente: "l'intellisense si è rotto in
            // FROM run"). In modalità ridotta proponiamo snippet, funzioni e keyword;
            // l'avviso "schema non caricato" lo mostra il banner dell'app (App.tsx),
            // che ricarica i metadati da solo.
            for (const sn of buildStatementSnippets(word.word)) {
              push({
                label: sn.label,
                detail: sn.detail,
                kind: monaco.languages.CompletionItemKind.Snippet,
                insertText: sn.insertText,
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
                filterText: sn.label,
              })
            }
            pushSqlFunctions()
            for (const k of SQL_KEYWORDS) {
              push({
                label: k,
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: k,
                range,
              })
            }
          }
          return { suggestions }
        } catch (e) {
          // Un errore interno non deve MAI lasciare l'editor muto ("No suggestions."):
          // si registra in console e si restituisce un fallback utile (funzioni + keyword).
          console.error('[intellisense] errore nel provider di completamento:', e)
          const w = model.getWordUntilPosition(position)
          const r = new monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn)
          const fallback: monaco.languages.CompletionItem[] = []
          for (const f of SQL_FUNCTIONS) {
            fallback.push({
              label: f,
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: f,
              range: r,
              filterText: f,
              sortText: completionSortText(fallback.length),
            })
          }
          for (const k of SQL_KEYWORDS) {
            fallback.push({
              label: k,
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: k,
              range: r,
              sortText: completionSortText(fallback.length),
            })
          }
          return { suggestions: fallback }
        }
}
