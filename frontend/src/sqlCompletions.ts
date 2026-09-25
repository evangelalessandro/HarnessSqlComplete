// Provider di completamento SQL, ESTRATTO da SqlEditor per poter essere eseguito dai test.
// Se questo codice lancia un'eccezione l'intellisense si "spacca" (popup vuoto):
// il test src/__tests__/completionSmoke.test.ts esegue il provider su molti contesti
// reali e fallisce se lancia un errore o se non propone nulla nel codice.
import * as monaco from 'monaco-editor'
import type { ColumnInfo, DatabaseSummary, TableInfo } from './types'
import { isTextOffsetInComment } from './helpers'
import { buildColumnContextSuggestions, buildExecParamSnippet, buildInsertValues, buildJoinConditionSuggestions, buildJoinSuggestions, buildQualifiedColumnSuggestions, buildSelectListSuggestions, buildSelfJoinSuggestions, buildStatementSnippets, columnForInsertSlot, columnInfoMarkdown, columnsByFragment, completionFilterText, completionSortText, extractStatementTableRefs, filterUnusedParams, findExecContext, findTableRefs, insertSlotIndexAt, insertTupleAt, insertTupleInnerRange, isInsideValuesTuple, parseInsertContext, qualified, rankSelectListForTyped, rankTablesForPosition, splitUserFunctions, sqlDefaultForType, sqlIdent, starFilterText, statementRangeAt, usageDetail } from './helpers'
import { shouldSuggestSystemObjects, systemObjectsFor } from './systemObjects'
import { TSQL_ALTER_SNIPPETS, TSQL_OPTION_HINTS, TSQL_OVER_CONTINUE, TSQL_OVER_FRAMES, TSQL_OVER_STARTS, TSQL_SET_OPTIONS, TSQL_SYSTEM_VARIABLES, TSQL_TABLE_HINTS, TSQL_TYPES, detectAlterTableContext, detectAlterTableDropContext, detectAlterTableTrigger, detectCreateIndexContext, detectCreateTableColumnContext, detectDeclareTypeContext, detectEnableDisableTriggerName, detectEnableDisableTriggerOn, detectObjectNameContext, detectOptionHintsContext, detectOverContext, detectSetContext, detectSystemVariableContext, detectTableHintsContext, detectVariableContext, dropColumnSnippet, extractDeclaredVariables, extractRoutineParameters, nomiTriggerDigitati, setOptionInsertText, setOptionLabel, systemVariablePrefixLen, tabellaDelTrigger, variablePrefixLen, vincoliCollegati } from './tsqlSnippets'
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
  // Trigger: servono per scrivere "DISABLE TRIGGER <nome> ON <tabella>" (il nome del trigger e
  // "ON" li propone l'intellisense degli oggetti, ma le PAROLE vanno proposte anche qui)
  'ENABLE', 'DISABLE', 'TRIGGER', 'INSTEAD',
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
                // si propongono le opzioni che iniziano con quanto già digitato ("SET NO" →
                // NOCOUNT); l'etichetta è la direttiva intera ("SET NOCOUNT ON") e accettandola si
                // scrive la direttiva COMPLETA: il "SET" è già nel documento, quindi si inserisce
                // il resto ("NOCOUNT ON"). Per le opzioni che vogliono un valore si inserisce solo
                // il nome e i valori arrivano subito dopo, come prima.
                const filtro = setCtx.prefisso.toUpperCase()
                const opzioni = filtro ? TSQL_SET_OPTIONS.filter(o => o.name.toUpperCase().startsWith(filtro)) : TSQL_SET_OPTIONS
                if (opzioni.length > 0) {
                  // le opzioni di più parole ("STATISTICS IO") si sostituiscono da capo: il
                  // suggerimento riporta tutta la direttiva, non solo l'ultima parola
                  const rangeSet =
                    setCtx.sostituisci > 0
                      ? new monaco.Range(
                          position.lineNumber,
                          Math.max(1, position.column - setCtx.sostituisci),
                          position.lineNumber,
                          position.column,
                        )
                      : range
                  for (const opt of opzioni) {
                    push({
                      label: setOptionLabel(opt),
                      detail: opt.detail,
                      kind: monaco.languages.CompletionItemKind.Keyword,
                      insertText: setOptionInsertText(opt),
                      range: rangeSet,
                      filterText: opt.name,
                    })
                  }
                  return { suggestions }
                }
                // nessuna opzione SET con questo inizio: si prosegue con gli altri suggerimenti
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
                return { suggestions }
              }
            }

            // ALTER TABLE <tabella> DROP [COLUMN|CONSTRAINT] → colonne e vincoli della tabella
            // (come SSMS: dopo DROP COLUMN si propongono i campi, dopo DROP CONSTRAINT i vincoli)
            const dropCtx = detectAlterTableDropContext(textBefore)
            if (dropCtx) {
              // Se manca la parola TABLE ("ALTER DAT_SPEDIZIONI DROP …", come capita di
              // scrivere) la si aggiunge accettando il suggerimento: il testo diventa valido.
              const correzioneTable =
                dropCtx.senzaTable && dropCtx.tableAt !== undefined
                  ? [
                      {
                        range: (() => {
                          const p = model.getPositionAt(dropCtx.tableAt!)
                          return new monaco.Range(p.lineNumber, p.column, p.lineNumber, p.column)
                        })(),
                        text: 'TABLE ',
                      },
                    ]
                  : undefined
              const notaTable = correzioneTable ? 'manca TABLE: lo aggiungo io · ' : ''
              if (dropCtx.kind === 'keywords') {
                push({
                  label: 'COLUMN',
                  detail: `${notaTable}Rimuove una colonna della tabella`,
                  kind: monaco.languages.CompletionItemKind.Keyword,
                  insertText: 'COLUMN ',
                  range,
                  additionalTextEdits: correzioneTable,
                  filterText: 'COLUMN',
                })
                push({
                  label: 'CONSTRAINT',
                  detail: `${notaTable}Rimuove un vincolo (CHECK, FOREIGN KEY, PRIMARY KEY, UNIQUE…)`,
                  kind: monaco.languages.CompletionItemKind.Keyword,
                  insertText: 'CONSTRAINT ',
                  range,
                  additionalTextEdits: correzioneTable,
                  filterText: 'CONSTRAINT',
                })
                return { suggestions }
              }
              const tabella = st.summary?.tables.find(
                t =>
                  t.name.toLowerCase() === dropCtx.table.toLowerCase() &&
                  (!dropCtx.schema || t.schema.toLowerCase() === dropCtx.schema.toLowerCase()),
              )
              if (dropCtx.kind === 'column') {
                // SNIPPET: elimina la colonna togliendo prima i vincoli collegati, con il
                // controllo che la colonna esista ancora. Sostituisce tutto lo statement
                // (range largo), così non resta "ALTER TABLE … DROP COLUMN" davanti al blocco.
                const nomeTabella = dropCtx.schema ? `${dropCtx.schema}.${dropCtx.table}` : dropCtx.table
                // Lo snippet sostituisce TUTTO lo statement: il testo prima del cursore
                // ("ALTER TABLE … DROP COLUMN ") si cancella con additionalTextEdits (il range
                // resta quello della parola, così Monaco non scarta la voce dal popup).
                const inizioStmt = model.getPositionAt(stmtRange.start)
                const inizioParola = model.getPositionAt(Math.max(stmtRange.start, cursorOffset - (word.word?.length ?? 0)))
                push({
                  label: 'DROP COLUMN sicuro (vincoli + controllo esistenza)',
                  detail: `${notaTable}Toglie prima i vincoli collegati e controlla che la colonna esista: IF EXISTS + DROP COLUMN`,
                  documentation: {
                    value: [
                      '**DROP COLUMN sicuro** — sostituisce lo statement con uno script che:',
                      '',
                      '1. dichiara **una volta** la colonna in `@colonna` (il segnaposto si scrive lì) e controlla che esista ancora (`IF EXISTS` su `sys.columns`);',
                      '2. toglie i vincoli collegati: **DEFAULT** sulla colonna, **CHECK** che la citano, **chiavi esterne uscenti**, **PK/UNIQUE** fatte sulla sola colonna;',
                      '3. elimina la colonna (anche il `DROP COLUMN` entra nello script dinamico, perché non accetta variabili);',
                      '4. se la colonna non c’è, lo dice con una `PRINT` invece di dare errore.',
                      '',
                      'Scrivi il nome della colonna senza parentesi quadre: ci pensa `QUOTENAME`.',
                    ].join('\n'),
                  },
                  kind: monaco.languages.CompletionItemKind.Snippet,
                  insertText: dropColumnSnippet(nomeTabella),
                  insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range,
                  additionalTextEdits: [
                    {
                      range: new monaco.Range(
                        inizioStmt.lineNumber,
                        inizioStmt.column,
                        inizioParola.lineNumber,
                        inizioParola.column,
                      ),
                      text: '',
                    },
                    ...(correzioneTable ?? []),
                  ],
                  filterText: 'DROP COLUMN sicuro vincoli controllo esistenza if exists snippet',
                })
                for (const c of tabella?.columns ?? []) {
                  // se la colonna fa parte della chiave primaria va tolta prima: lo diciamo
                  const inPk = (tabella?.indexes ?? []).some(
                    ix => ix.isPrimaryKey && (ix.columns ?? []).some(x => x.toLowerCase() === c.name.toLowerCase()),
                  )
                  // vincoli collegati (CHECK che la citano, FK, PK/UNIQUE): vanno tolti prima
                  const collegati = st.summary
                    ? vincoliCollegati(st.summary, dropCtx.schema, dropCtx.table, c.name, tabella?.indexes)
                    : []
                  push({
                    label: c.name,
                    detail: [
                      notaTable + columnTypeText(c.dataType, c.isNullable).trim(),
                      inPk ? 'chiave primaria: va tolta prima' : null,
                      collegati.length ? `vincoli collegati: ${collegati.map(v => v.name).join(', ')}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                    documentation: tabella ? columnInfoMarkdown(tabella, c) : undefined,
                    kind: monaco.languages.CompletionItemKind.Field,
                    insertText: sqlIdent(c.name),
                    range,
                    additionalTextEdits: correzioneTable,
                    filterText: c.name,
                  })
                }
                if (suggestions.length > 0) return { suggestions }
              } else {
                for (const cc of st.summary?.checkConstraints ?? []) {
                  if (cc.tableName.toLowerCase() !== dropCtx.table.toLowerCase()) continue
                  if (dropCtx.schema && cc.schema.toLowerCase() !== dropCtx.schema.toLowerCase()) continue
                  push({
                    label: cc.name,
                    detail: `${notaTable}CHECK ${cc.definition}${cc.isDisabled ? ' · disabilitato' : ''}`,
                    kind: monaco.languages.CompletionItemKind.Constant,
                    insertText: sqlIdent(cc.name),
                    range,
                    additionalTextEdits: correzioneTable,
                    filterText: cc.name,
                  })
                }
                for (const fk of st.summary?.foreignKeys ?? []) {
                  if (fk.table.toLowerCase() !== dropCtx.table.toLowerCase()) continue
                  if (dropCtx.schema && fk.schema.toLowerCase() !== dropCtx.schema.toLowerCase()) continue
                  push({
                    label: fk.name,
                    detail: `${notaTable}FOREIGN KEY ${fk.column} → ${fk.refSchema}.${fk.refTable}.${fk.refColumn}`,
                    kind: monaco.languages.CompletionItemKind.Constant,
                    insertText: sqlIdent(fk.name),
                    range,
                    additionalTextEdits: correzioneTable,
                    filterText: fk.name,
                  })
                }
                for (const ix of tabella?.indexes ?? []) {
                  if (!ix.isPrimaryKey && !ix.isUnique) continue
                  push({
                    label: ix.name,
                    detail: `${notaTable}${ix.isPrimaryKey ? 'PRIMARY KEY' : 'UNIQUE'}${ix.columns?.length ? ` (${ix.columns.join(', ')})` : ''}`,
                    kind: monaco.languages.CompletionItemKind.Constant,
                    insertText: sqlIdent(ix.name),
                    range,
                    additionalTextEdits: correzioneTable,
                    filterText: ix.name,
                  })
                }
                // i vincoli possono non essere nello schema letto (o la tabella non ne ha):
                // in quel caso NON si resta vuoti, si prosegue con i suggerimenti normali
                if (suggestions.length > 0) return { suggestions }
              }
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

            // ALTER TABLE <t> ENABLE|DISABLE TRIGGER → i trigger di QUELLA tabella (+ ALL)
            const alterTrigger = detectAlterTableTrigger(textBefore)
            if (alterTrigger) {
              const tab = alterTrigger.table.toLowerCase()
              for (const tr of st.summary.triggers.filter(x => x.tableName.toLowerCase() === tab)) {
                push({
                  label: qualified(tr.schema, tr.name),
                  detail: `trigger di ${tr.tableName}`,
                  kind: monaco.languages.CompletionItemKind.Event,
                  insertText: sqlIdent(tr.name),
                  range,
                  filterText: tr.name,
                })
              }
              push({
                label: 'ALL',
                detail: `tutti i trigger di ${alterTrigger.table}`,
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: 'ALL',
                range,
                filterText: 'ALL',
              })
              return { suggestions }
            }

            /**
             * ENABLE/DISABLE TRIGGER ha DUE pezzi: il nome (o ALL) e poi "ON <tabella>".
             * Dopo il nome si propone "ON <tabella>" — la tabella SU CUI è definito il trigger —
             * perché è l'errore tipico dimenticarlo, e dopo "ON" si propongono SOLO le tabelle di
             * quei trigger: proponendo altre tabelle si scriverebbe un'istruzione che SQL Server
             * rifiuta (il trigger non è definito lì).
             */
            const nomiTrigger = nomiTriggerDigitati(textBefore)
            const elencoTrigger = st.summary.triggers
            if (detectEnableDisableTriggerOn(textBefore)) {
              const tabelleTrigger = [
                ...new Set(nomiTrigger?.map(n => tabellaDelTrigger(elencoTrigger, n)).filter(Boolean) ?? []),
              ]
              // se il trigger scritto non si conosce, si ripiega su tutte le tabelle con trigger
              const tabelle =
                tabelleTrigger.length > 0
                  ? tabelleTrigger
                  : [...new Set(elencoTrigger.map(x => x.tableName))].sort((a, b) => a.localeCompare(b, 'it'))
              for (const tab of tabelle) {
                push({
                  label: sqlIdent(tab),
                  detail:
                    tabelleTrigger.length > 0
                      ? 'tabella su cui è definito il trigger'
                      : `tabella con trigger (${elencoTrigger.filter(x => x.tableName === tab).length})`,
                  kind: monaco.languages.CompletionItemKind.Struct,
                  insertText: sqlIdent(tab),
                  range,
                  filterText: tab,
                })
              }
              for (const kw of ['DATABASE', 'ALL SERVER', 'ALL']) {
                push({
                  label: kw,
                  detail: 'ambito del trigger (database intero, tutto il server, tutte le tabelle)',
                  kind: monaco.languages.CompletionItemKind.Keyword,
                  insertText: kw,
                  range,
                  filterText: kw,
                })
              }
              if (suggestions.length > 0) return { suggestions }
            } else if (nomiTrigger && nomiTrigger.length > 0) {
              // nome (o nomi) scritti ma manca "ON": si completa la direttiva
              for (const nome of nomiTrigger) {
                const tab = tabellaDelTrigger(elencoTrigger, nome)
                if (!tab) continue
                push({
                  label: `ON ${sqlIdent(tab)}`,
                  detail: 'tabella su cui è definito il trigger',
                  kind: monaco.languages.CompletionItemKind.Struct,
                  insertText: `ON ${sqlIdent(tab)}`,
                  range,
                  filterText: `ON ${tab}`,
                })
              }
              push({
                label: 'ON',
                detail: 'manca "ON <tabella>": la tabella su cui il trigger è definito',
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: 'ON',
                range,
                filterText: 'ON',
              })
              return { suggestions }
            }

            // "ENABLE " / "DISABLE " a inizio statement → l'unica continuazione è TRIGGER:
            // si propone quella, invece di lasciarla in fondo a un elenco di tabelle
            if (/(?:^|;|\bGO\b|\n)[ \t]*(?:ENABLE|DISABLE)\s+$/i.test(textBefore)) {
              push({
                label: 'TRIGGER',
                detail: 'ENABLE/DISABLE TRIGGER <nome> ON <tabella>',
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: 'TRIGGER',
                range,
                filterText: 'TRIGGER',
              })
              return { suggestions }
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
                for (const tr of st.summary.triggers) pushObj(qualified(tr.schema, tr.name), `tabella ${tr.tableName}`, qualified(tr.schema, tr.name), monaco.languages.CompletionItemKind.Event)
                // "DISABLE TRIGGER ALL ON t": la sintassi accetta anche ALL (scrivendo "ALL"
                // l'elenco si filtra da solo, quindi può stare in coda ai trigger)
                if (detectEnableDisableTriggerName(textBefore)) {
                  push({
                    label: 'ALL',
                    detail: 'tutti i trigger della tabella',
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: 'ALL',
                    range,
                    filterText: 'ALL',
                  })
                }
              } else if (objKind === 'database') {
                for (const d of st.summary.databases) pushObj(d.name, 'database', d.name, monaco.languages.CompletionItemKind.Folder)
              }
              return { suggestions }
            }

            // "ENABLE/DISABLE TRIGGER nome ON " → la tabella del trigger (o ALL/DATABASE/ALL SERVER)
            if (detectEnableDisableTriggerOn(textBefore)) {
              const tr = st.summary.triggers
              const tabelle = [...new Set(tr.map(x => x.tableName))].sort((a, b) => a.localeCompare(b, 'it'))
              for (const tab of tabelle) {
                push({
                  label: tab,
                  detail: `tabella con trigger (${tr.filter(x => x.tableName === tab).length})`,
                  kind: monaco.languages.CompletionItemKind.Struct,
                  insertText: sqlIdent(tab),
                  range,
                  filterText: tab,
                })
              }
              for (const kw of ['DATABASE', 'ALL SERVER']) {
                push({
                  label: kw,
                  detail: 'ambito del trigger (a livello di database o di server)',
                  kind: monaco.languages.CompletionItemKind.Keyword,
                  insertText: kw,
                  range,
                  filterText: kw,
                })
              }
              if (suggestions.length > 0) return { suggestions }
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
                    // le direttive sui trigger si presentano come PAROLE CHIAVE (icona blu come
                    // EXEC), pur inserendo il testo con i segnaposto
                    kind: sn.keyword
                      ? monaco.languages.CompletionItemKind.Keyword
                      : monaco.languages.CompletionItemKind.Snippet,
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
              // Parola appena finita (spazio dopo): "SELECT fefo " → "fefo". Serve per non
              // perdere i campi mentre si sta per scrivere la FROM (segnalazione utente).
              const parolaPrima = (/([A-Za-z_#@][\w#@]*)\s+$/.exec(textBefore) ?? [])[1] ?? ''
              const frammento = word.word.length > 0 ? word.word : parolaPrima
              /** Ripiego "cerca fra le colonne di tutto lo schema" (vedi columnsByFragment). */
              const pushColonneDaFrammento = (gia: Set<string>) => {
                if (frammento.length < 2 || !st.summary) return
                for (const c of columnsByFragment(st.summary, frammento, 25)) {
                  if (gia.has(c.name.toLowerCase())) continue
                  push({
                    label: c.name,
                    detail: [columnTypeText(c.dataType, c.isNullable), `colonna di ${c.tableLabel}`]
                      .filter(Boolean)
                      .join(' · '),
                    kind: monaco.languages.CompletionItemKind.Field,
                    insertText: sqlIdent(c.name),
                    range,
                    filterText: completionFilterText(c.name),
                  })
                }
              }
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
                // RIPIEGO (richiesta utente: "mi dovrebbe cercare almeno tra le colonne"): se
                // non c'è (ancora) una tabella da cui prendere i campi — la FROM non è scritta —
                // si cercano le colonne di TUTTO lo schema che contengono la parola digitata.
                pushColonneDaFrammento(new Set(rankedCols.map(r => r.col.name.toLowerCase())))
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
              // Senza parola in corso (es. "SELECT fefo " appena scritto): oltre ai campi dello
              // statement si ripescano le colonne che contengono la parola appena finita, così
              // il popup non si svuota mentre si sta per scrivere la FROM.
              pushColonneDaFrammento(new Set(sel.columns.map(c => c.name.toLowerCase())))
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
            /**
             * A INIZIO STATEMENT (foglio vuoto, dopo ';' o GO) si comincia con le PAROLE CHIAVE —
             * SELECT, INSERT, UPDATE, DELETE, MERGE, CREATE, ALTER, DROP, EXEC… — non con le
             * tabelle: prima le keyword finivano in fondo all'elenco e il popup era pieno di
             * tabelle e procedure (segnalazione utente: "a foglio vuoto mi propone le tabelle e non
             * le chiavi per cominciare una query").
             */
            const inizioStatement = (ctx.kind === 'statementStart' || ctx.statementStart) && !isTablePosition
            let keywordsProposte = false
            if (inizioStatement) {
              // Solo le PAROLE CHIAVE di statement: a inizio statement non può cominciare
              // nient'altro (tabelle, funzioni e procedure si propongono dopo FROM/EXEC…).
              // Se però il testo digitato non è una keyword (es. una tabella scritta a mano) si
              // prosegue con i suggerimenti normali, così il popup non resta mai vuoto.
              const keywordStatement = filterKeywordsForContext(ctx, SQL_KEYWORDS)
              const digitato = word.word.toUpperCase()
              const filtrate = digitato ? keywordStatement.filter(k => k.toUpperCase().startsWith(digitato)) : keywordStatement
              if (filtrate.length > 0) {
                for (const k of filtrate) {
                  push({
                    label: k,
                    detail: 'inizio di uno statement',
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: k,
                    range,
                    filterText: k,
                  })
                }
                return { suggestions }
              }
            }
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

              // Keyword filtrate per contesto (dopo "FROM t " solo clausole, all'inizio solo
              // statement). A inizio statement sono già state proposte PRIMA delle tabelle.
              if (ctx.allowed.includes('keywords') && !keywordsProposte) {
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
                kind: sn.keyword
                  ? monaco.languages.CompletionItemKind.Keyword
                  : monaco.languages.CompletionItemKind.Snippet,
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
