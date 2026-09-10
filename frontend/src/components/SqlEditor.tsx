import { useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import {
  Eraser,
  FolderOpen,
  IndentDecrease,
  IndentIncrease,
  MessageSquare,
  Moon,
  Play,
  Save,
  Settings2,
  Sun,
  Table2,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import monaco from '../monacoSetup'
import { api } from '../api'
import { syntaxIssuesFromCheck } from '../syntaxCheck'
import type { ColumnInfo, DatabaseSummary, TableInfo } from '../types'
import { isTextOffsetInComment } from '../helpers'
import { buildColumnContextSuggestions, buildExecParamSnippet, buildInsertValues, buildJoinConditionSuggestions, buildJoinSuggestions, buildQualifiedColumnSuggestions, buildSelectListSuggestions, buildSelfJoinSuggestions, buildStatementSnippets, columnForInsertSlot, columnInfoMarkdown, completionFilterText, completionSortText, extractStatementTableRefs, filterUnusedParams, findExecContext, findTableRefs, insertSlotIndexAt, insertTupleAt, insertTupleInnerRange, isInsideValuesTuple, parseInsertContext, qualified, rankSelectListForTyped, rankTablesForPosition, resolveTokenAt, splitUserFunctions, sqlDefaultForType, sqlIdent, starFilterText, statementRangeAt, usageDetail } from '../helpers'
import DataPreviewModal from './DataPreviewModal'
import { shouldSuggestSystemObjects, systemObjectsFor } from '../systemObjects'
import { registerInsertHighlight } from '../sqlInsertHighlight'
import { positionAt, runSqlDiagnostics } from '../sqlDiagnostics'
import { computeBlockGuides } from '../sqlBlockGuides'
import { computeFoldingRanges } from '../sqlFolding'
import { pickFormatTarget, pickSqlToExecute } from '../executeSelection'
import {
  TSQL_ALTER_SNIPPETS,
  TSQL_OPTION_HINTS,
  TSQL_OVER_CONTINUE,
  TSQL_OVER_FRAMES,
  TSQL_OVER_STARTS,
  TSQL_SET_OPTIONS,
  TSQL_SYSTEM_VARIABLES,
  TSQL_TABLE_HINTS,
  TSQL_TYPES,
  detectAlterTableContext,
  detectCreateIndexContext,
  detectCreateTableColumnContext,
  detectDeclareTypeContext,
  detectObjectNameContext,
  detectOptionHintsContext,
  detectOverContext,
  detectSetContext,
  detectSystemVariableContext,
  detectTableHintsContext,
  detectVariableContext,
  extractDeclaredVariables,
  extractRoutineParameters,
  systemVariablePrefixLen,
  variablePrefixLen,
} from '../tsqlSnippets'
import { registerTableColorizer } from '../sqlTableColors'
import { extractLocalTables } from '../localTables'
import { ORDER_DIRECTIONS } from '../intellisenseContext'
import { historyColumnBoost, historyTableBoost, recordTablesFromSql } from '../history'
import { registerSqlHover } from '../sqlHover'
import { classifyContext, filterKeywordsForContext, isAfterOrderKeyword, isOrderWordTyped, shouldSuggestJoinConditions } from '../intellisenseContext'
import { buildFormatProfile, loadFormatProfileXml } from '../formatProfile'
import { formatSqlWithProfile } from '../tsqlFormatter'
import FormatProfilePanel from './FormatProfilePanel'
import { Badge, Button, Spinner, Toggle } from './ui'

/** Testo del tipo per il dettaglio di una colonna ("INT NULL"), o '' se il tipo
 *  non è noto (colonne di temporanee dedotte da "SELECT … INTO", variabili tabella…). */
function columnTypeText(dataType: string, isNullable: boolean, isIdentity = false): string {
  return [dataType, isNullable ? 'NULL' : '', isIdentity ? 'IDENTITY' : ''].filter(Boolean).join(' ')
}

interface Props {
  connectionId: string
  summary: DatabaseSummary | null
  executing: boolean
  aiEnabled: boolean
  onAiEnabledChange: (v: boolean) => void
  aiConfigured: boolean
  aiStatusText: string
  onExecute: (sql: string) => void
  /** Notifica il contenuto dell'editor mentre si digita (per la persistenza). */
  onContentChange?: (sql: string) => void
  /** Salva la tab attiva (sovrascrive l'originale se aperta da file, altrimenti picker). */
  onSave?: () => void
  /** Salva sempre con picker (Salva con nome). */
  onSaveAs?: () => void
  /** Apre file .sql con il picker (handle per la sovrascrittura). */
  onOpenFile?: () => void
  /** Dimensione del testo (persistita). */
  fontSize?: number
  /** Tema Monaco: 'vs' (chiaro) o 'vs-dark'. */
  theme?: 'vs' | 'vs-dark'
  /** Zoom del testo (+1 / -1). */
  onZoomFont?: (delta: number) => void
  /** Alterna tema chiaro/scuro. */
  onToggleTheme?: () => void
  /** Livello del drago (0-100): il fuoco scaturito a ogni esecuzione cresce con esso. */
  dragonLevel?: number
  /** Contatore incrementato a ogni query eseguita: innesca il colpo di fuoco. */
  fireTick?: number
  registerEditor: (editor: monaco.editor.IStandaloneCodeEditor) => void
}

export const DEFAULT_SQL = `-- Nuova query — modello transazione sicura
-- Sostituisci dbo.Tabella e premi F5 / Ctrl+Invio
BEGIN TRAN;

SELECT * FROM dbo.Tabella ORDER BY 1 DESC;

ROLLBACK;
`

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

export default function SqlEditor({
  connectionId,
  summary,
  executing,
  aiEnabled,
  onAiEnabledChange,
  aiConfigured,
  aiStatusText,
  onExecute,
  onContentChange,
  onSave,
  onSaveAs,
  onOpenFile,
  fontSize = 13,
  theme = 'vs-dark',
  onZoomFont,
  onToggleTheme,
  dragonLevel = 0,
  fireTick = 0,
  registerEditor,
}: Props) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const disposablesRef = useRef<monaco.IDisposable[]>([])
  const stateRef = useRef({ connectionId, summary, aiEnabled, onExecute })
  stateRef.current = { connectionId, summary, aiEnabled, onExecute }
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const onSaveAsRef = useRef(onSaveAs)
  onSaveAsRef.current = onSaveAs
  const onZoomFontRef = useRef(onZoomFont)
  onZoomFontRef.current = onZoomFont
  // L'istanza editor in stato React: l'effect del colorizer si (ri)registra
  // automaticamente quando editor o schema cambiano (pulizia inclusa)
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null)
  // Colpo di fuoco del drago a ogni esecuzione
  const [fireVisible, setFireVisible] = useState(false)
  useEffect(() => {
    if (!fireTick) return
    setFireVisible(true)
    const t = window.setTimeout(() => setFireVisible(false), 1900)
    return () => window.clearTimeout(t)
  }, [fireTick])
  // Pannello impostazioni di formattazione
  const [profileOpen, setProfileOpen] = useState(false)
  // Verifica di sintassi opzionale (errori reali di SQL Server con "Riga N:")
  const [syntaxCheck, setSyntaxCheck] = useState(false)
  // Finestra anteprima dati della tabella sotto il cursore (F4)
  const [previewTarget, setPreviewTarget] = useState<{ schema: string; table: string } | null>(null)
  // tabella attualmente sotto l'hover (per il pulsante cliccabile nella tooltip)
  const hoveredTableRef = useRef<{ schema: string; table: string } | null>(null)

  // Il link "command:sqlIntelli.openPreview" nella tooltip NON esegue comandi in
  // Monaco standalone (l'opener dei command: è roba da workbench): intercettiamo il
  // click sull'anchor con un listener a livello documento e apriamo la preview.
  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null
      const a = target?.closest?.('a[data-href]')
      if (!a) return
      const href = a.getAttribute('data-href') ?? ''
      if (!href.startsWith('command:sqlIntelli.openPreview')) return
      ev.preventDefault()
      ev.stopPropagation()
      const t = hoveredTableRef.current
      if (t) setPreviewTarget(t)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])
  // Registrazione robusta del colorizer, copre ogni ordine di mount/summary
  const colorizerRef = useRef<{
    ed: monaco.editor.IStandaloneCodeEditor
    sm: DatabaseSummary
    disposables: monaco.IDisposable[]
  } | null>(null)

  const ensureColorizer = () => {
    const ed = editorRef.current
    const sm = stateRef.current.summary
    if (!ed || !sm) return
    const cur = colorizerRef.current
    if (cur && cur.ed === ed && cur.sm === sm) return
    cur?.disposables.forEach(d => d.dispose())
    colorizerRef.current = { ed, sm, disposables: registerTableColorizer(ed, sm) }
  }

  useEffect(() => {
    return () => {
      disposablesRef.current.forEach(d => d.dispose())
      disposablesRef.current = []
      colorizerRef.current?.disposables.forEach(d => d.dispose())
      colorizerRef.current = null
    }
  }, [])

  useEffect(() => {
    ensureColorizer()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, editor])

  /**
   * Verifica di sintassi opzionale: con il toggle attivo, a ogni modifica (debounce)
   * chiede al backend di eseguire il testo in una transazione con rollback; gli errori
   * reali di SQL Server ("Riga N: …") diventano sottolineature nel documento.
   */
  useEffect(() => {
    const model = editorRef.current?.getModel()
    const connId = connectionId
    if (!syntaxCheck || !model || !connId) {
      if (model) monaco.editor.setModelMarkers(model, 'sql-check', [])
      return
    }
    let timer: number | null = null
    let cancelled = false
    const run = async () => {
      const text = model.getValue()
      if (!text.trim()) {
        monaco.editor.setModelMarkers(model, 'sql-check', [])
        return
      }
      try {
        const res = await api.checkSyntax(connId, text)
        if (cancelled) return
        const issues = syntaxIssuesFromCheck(res.error, res.messages)
        const markers: monaco.editor.IMarkerData[] = issues.map(i => ({
          startLineNumber: i.line,
          startColumn: 1,
          endLineNumber: i.line,
          endColumn: Math.max(1, model.getLineLength(i.line)) + 1,
          message: i.message,
          severity: monaco.MarkerSeverity.Error,
        }))
        monaco.editor.setModelMarkers(model, 'sql-check', markers)
      } catch {
        if (!cancelled) monaco.editor.setModelMarkers(model, 'sql-check', [])
      }
    }
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(run, 900)
    }
    const sub = model.onDidChangeContent(schedule)
    schedule()
    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
      sub.dispose()
      monaco.editor.setModelMarkers(model, 'sql-check', [])
    }
  }, [syntaxCheck, connectionId])

  const handleFormat = () => {
    const ed = editorRef.current
    const model = ed?.getModel()
    if (!ed || !model) return
    try {
      // come l'esecuzione: con una selezione si formatta SOLO quella parte
      const sel = ed.getSelection()
      const selected = sel && !sel.isEmpty() ? model.getValueInRange(sel) : null
      const { text, usesSelection } = pickFormatTarget(selected, model.getValue())
      const profileXml = loadFormatProfileXml()
      const profile = buildFormatProfile(profileXml)
      const formatted = formatSqlWithProfile(text, profile)
      const range = usesSelection ? sel! : model.getFullModelRange()
      ed.executeEdits('format', [{ range, text: formatted }])
    } catch {
      /* SQL non valido: nessuna azione */
    }
  }

  /**
   * Testo da eseguire: come SSMS, se c'è una selezione nell'editor viene eseguita
   * SOLO la selezione (ripulita dagli spazi ai bordi); altrimenti tutto il contenuto.
   */
  const getSqlToExecute = (): string => {
    const ed = editorRef.current
    const model = ed?.getModel()
    if (!ed || !model) return ''
    const sel = ed.getSelection()
    const selected = sel && !sel.isEmpty() ? model.getValueInRange(sel) : null
    return pickSqlToExecute(selected, ed.getValue())
  }

  const handleMount: OnMount = (editor, _monacoInstance) => {
    editorRef.current = editor
    registerEditor(editor)
    setEditor(editor)
    ensureColorizer()

    // Esegui: F5 e Ctrl+Invio (registra nella cronologia le tabelle usate)
    const runQuery = () => {
      const sql = getSqlToExecute()
      recordTablesFromSql(sql)
      stateRef.current.onExecute(sql)
    }
    editor.addCommand(monaco.KeyCode.F5, () => runQuery())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runQuery())
    // Salva: Ctrl+S
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current?.())
    // Salva con nome: Ctrl+Shift+S
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, () => onSaveAsRef.current?.())
    // Formatta: Ctrl+Shift+F
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, handleFormat)
    // Anteprima dati della tabella sotto il cursore: F4 (e pulsante toolbar)
    const openPreviewUnderCursor = () => {
      const model = editor.getModel()
      const pos = editor.getPosition()
      const sm = stateRef.current.summary
      if (!model || !pos || !sm) return
      const resolved = resolveTokenAt(model.getValue(), model.getOffsetAt(pos), sm)
      if (resolved?.kind === 'table') {
        setPreviewTarget({ schema: resolved.table.schema, table: resolved.table.name })
      }
    }
    editor.addCommand(monaco.KeyCode.F4, openPreviewUnderCursor)

    registerSchemaCompletions()
    registerInlineCompletions()
    registerSqlDiagnostics()
    registerBlockGuides()
    registerFolding()
    disposablesRef.current.push(...registerInsertHighlight(editor))
    disposablesRef.current.push(
      registerSqlHover(() => ({
        summary: stateRef.current.summary,
        connectionId: stateRef.current.connectionId,
        onTableHover: (schema, table) => {
          hoveredTableRef.current = { schema, table }
        },
      })),
    )
    // Zoom con Ctrl+rotella del mouse (listener nativo sul DOM dell'editor)
    const domNode = editor.getDomNode()
    if (domNode) {
      const onWheel = (ev: WheelEvent) => {
        if (ev.ctrlKey || ev.metaKey) {
          ev.preventDefault()
          onZoomFontRef.current?.(ev.deltaY < 0 ? 1 : -1)
        }
      }
      domNode.addEventListener('wheel', onWheel)
      disposablesRef.current.push({
        dispose: () => domNode.removeEventListener('wheel', onWheel),
      })
    }
  }

  const registerSchemaCompletions = () => {
    disposablesRef.current.push(
      monaco.languages.registerCompletionItemProvider('sql', {
        triggerCharacters: ['.', ' ', '[', '"', '(', '*', '@'],
        provideCompletionItems: (model, position) => {
          // la preview dati ha il SUO provider filtrato sulla tabella
          if (model.uri.toString().startsWith('sql-intelli://preview')) return { suggestions: [] }
          const baseSt = stateRef.current
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
          // Tabelle TEMPORANEE definite nel testo (#t): senza aggiungerle al sommario
          // le loro colonne non sarebbero proponibili ("... LEFT JOIN #t ON 1 = 1 WHERE ")
          const localTables = extractLocalTables(fullText, baseSt.summary?.tables ?? [])
          const st =
            baseSt.summary && localTables.length > 0
              ? { ...baseSt, summary: { ...baseSt.summary, tables: [...baseSt.summary.tables, ...localTables] } }
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
            // DECLARE @var → tipi di dato T-SQL (non tabelle!)
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
            if (isOrderBy) {
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
              return { suggestions }
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

            // Colonne qualificate con alias/tabella: dopo "r." o "RUN_MISSIONI." suggerisce
            // le colonne di quella tabella (es. "FROM RUN_MISSIONI r WHERE r.")
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
          }
          return { suggestions }
        },
      }),
    )
  }

  const registerInlineCompletions = () => {
    disposablesRef.current.push(
      monaco.languages.registerInlineCompletionsProvider('sql', {
        provideInlineCompletions: async (model, position, context, token) => {
          const st = stateRef.current
          if (!st.aiEnabled) return { items: [] }
          // la preview dati ha un mini-editor: niente autocompletamento IA lì
          if (model.uri.toString().startsWith('sql-intelli://preview')) return { items: [] }

          const textBefore = model.getValueInRange(
            new monaco.Range(1, 1, position.lineNumber, position.column),
          )
          const trimmed = textBefore.trim()
          if (trimmed.length < 4 || /[;,)]\s*$/.test(trimmed)) return { items: [] }

          const isManual = context.triggerKind === monaco.languages.InlineCompletionTriggerKind.Explicit
          if (!isManual) {
            await debounce(900, token)
            if (token.isCancellationRequested) return { items: [] }
          }

          try {
            const resp = await api.autocomplete(st.connectionId, textBefore)
            if (token.isCancellationRequested || !resp.suggestions?.length) return { items: [] }
            const insertRange = new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column,
            )
            return {
              items: [{ insertText: resp.suggestions[0].text, range: insertRange }],
            }
          } catch {
            return { items: [] }
          }
        },
        disposeInlineCompletions: () => {
          /* nessuna risorsa da liberare */
        },
      }),
    )
  }

  /** Diagnostica in tempo reale: sottolinea parentesi/apici non bilanciati e colonne inesistenti. */
  const registerSqlDiagnostics = () => {
    const model = editorRef.current?.getModel()
    if (!model) return
    disposablesRef.current.push(
      monaco.languages.registerCodeLensProvider('sql', {
        provideCodeLenses: () => ({ lenses: [] }),
      }),
    )
    const update = () => {
      const ed = editorRef.current
      const m = ed?.getModel()
      if (!ed || !m) return
      const text = m.getValue()
      const diags = runSqlDiagnostics(text, { summary: stateRef.current.summary })
      const markers: monaco.editor.IMarkerData[] = diags.map(d => {
        const start = positionAt(text, d.start)
        const end = positionAt(text, d.end)
        return {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: Math.max(end.column, start.column + 1),
          message: d.message,
          severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
        }
      })
      monaco.editor.setModelMarkers(m, 'sql-diag', markers)
    }
    const sub = model.onDidChangeContent(() => update())
    disposablesRef.current.push({ dispose: () => sub.dispose() })
    update()
  }

  /**
   * Righe verticali tra BEGIN e END (e CASE/END): disegna una linea continua nella
   * colonna della keyword di apertura per ogni riga del blocco, come in Visual Studio.
   */
  const registerBlockGuides = () => {
    const model = editorRef.current?.getModel()
    if (!model) return
    const decorationIds: string[] = []
    const update = () => {
      const m = editorRef.current?.getModel()
      if (!m) return
      const text = m.getValue()
      const guides = computeBlockGuides(text)
      const newDecorations: monaco.editor.IModelDeltaDecoration[] = []
      // più guide sulla STESSA colonna di una riga (es. IF agganciato al BEGIN) →
      // una sola linea: niente linee doppie
      const guideKeys = new Set<string>()
      for (const g of guides) {
        // linea verticale su ogni riga compresa tra apertura e chiusura (incluse).
        // Sulle righe vuote o più corte della colonna della guida Monaco non disegna
        // il box (la linea si interrompe): si usa la fine della riga e si compensa con
        // un margine in "ch" (classe sql-guide-offset-N) per restare sulla colonna giusta.
        for (let line = g.openLine; line <= g.closeLine; line++) {
          const key = `${line}:${g.column}`
          if (guideKeys.has(key)) continue
          guideKeys.add(key)
          const lineLen = m.getLineLength(line)
          const effCol = Math.min(g.column, Math.max(1, lineLen + 1))
          const offset = g.column - effCol
          const cls =
            `sql-block-guide sql-guide-depth-${Math.min(g.depth, 4)}` +
            (offset > 0 ? ` sql-guide-offset-${Math.min(offset, 20)}` : '')
          newDecorations.push({
            range: new monaco.Range(line, effCol, line, effCol),
            options: {
              isWholeLine: false,
              // classe custom: disegna il bordo verticale (CSS in index.css)
              beforeContentClassName: cls,
            },
          })
        }
        // evidenzia le keyword di apertura/chiusura (END alla colonna della guida,
        // non alla colonna 1: per i blocchi indentati l'evidenza sarebbe sugli spazi)
        const openRange = new monaco.Range(g.openLine, g.column, g.openLine, g.column + (g.kind === 'if' ? 2 : 5))
        newDecorations.push({
          range: openRange,
          options: { inlineClassName: 'sql-block-keyword' },
        })
        const closeRange = new monaco.Range(g.closeLine, g.column, g.closeLine, g.column + 3)
        newDecorations.push({
          range: closeRange,
          options: { inlineClassName: 'sql-block-keyword' },
        })
      }
      const old = decorationIds.splice(0)
      decorationIds.push(...m.deltaDecorations(old, newDecorations))
    }
    const sub = model.onDidChangeContent(() => update())
    disposablesRef.current.push({ dispose: () => sub.dispose() })
    update()
  }

  /**
   * Folding: chiudi/espandi porzioni di codice con le frecce nella gutter.
   * Copre blocchi BEGIN/END, regioni SSMS (--#region/--#endregion) e commenti
   * a blocco su più righe. Scorciatoie Monaco: Ctrl+Shift+[ (chiudi), Ctrl+Shift+]
   * (apri), Ctrl+K Ctrl+L (alterna), Ctrl+K Ctrl+0 (chiudi tutto), Ctrl+K Ctrl+J (apri tutto).
   */
  const registerFolding = () => {
    disposablesRef.current.push(
      monaco.languages.registerFoldingRangeProvider('sql', {
        provideFoldingRanges: model => {
          const ranges = computeFoldingRanges(model.getValue())
          return ranges.map(r => ({
            start: r.start,
            end: r.end,
            kind:
              r.kind === 'region'
                ? monaco.languages.FoldingRangeKind.Region
                : r.kind === 'comment'
                  ? monaco.languages.FoldingRangeKind.Comment
                  : undefined,
          }))
        },
      }),
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="relative">
            <Button
              variant="primary"
              onClick={() => {
                const sql = getSqlToExecute()
                recordTablesFromSql(sql)
                onExecute(sql)
              }}
              loading={executing}
              title="Esegui (F5 / Ctrl+Invio) — se hai selezionato del testo esegue solo la selezione"
            >
              <Play className="h-4 w-4" /> Esegui
            </Button>
            {/* Fuoco del drago: scaturisce dal pulsante a ogni query eseguita */}
            {fireVisible && (
              <div className="pointer-events-none absolute -top-5 left-1/2 z-30 h-16 w-24 -translate-x-1/2">
                {Array.from({ length: Math.min(6 + Math.floor(dragonLevel / 10), 18) }).map((_, i) => (
                  <span
                    key={`${fireTick}-${i}`}
                    className="dragon-flame absolute text-lg leading-none"
                    style={{
                      left: `${6 + (i * 82) / Math.min(6 + Math.floor(dragonLevel / 10), 18)}%`,
                      bottom: '4px',
                      animationDelay: `${(i % 6) * 0.13}s`,
                      animationDuration: `${1.2 + (i % 4) * 0.3}s`,
                      fontSize: `${14 + Math.min(dragonLevel / 100, 1) * 10}px`,
                    }}
                  >
                    🔥
                  </span>
                ))}
              </div>
            )}
          </span>
          <Button variant="secondary" onClick={() => onSave?.()} title="Salva la query (Ctrl+S) — sovrascrive il file originale se aperto">
            <Save className="h-4 w-4" /> Salva
          </Button>
          <Button variant="ghost" onClick={() => onSaveAs?.()} title="Salva con nome (Ctrl+Shift+S) — scegli dove salvarla">
            <Save className="h-4 w-4" /> Salva con nome
          </Button>
          <Button variant="ghost" onClick={() => onOpenFile?.()} title="Apri file .sql (permette di sovrascrivere l'originale)">
            <FolderOpen className="h-4 w-4" /> Apri file
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              editorRef.current?.focus()
              void editorRef.current?.getAction('editor.action.commentLine')?.run()
            }}
            title="Commenta / togli il commento alle righe selezionate (Ctrl+/)"
          >
            <MessageSquare className="h-4 w-4" /> Commenta
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              editorRef.current?.focus()
              void editorRef.current?.getAction('editor.action.indentLines')?.run()
            }}
            title="Aumenta il rientro delle righe selezionate (Tab)"
          >
            <IndentIncrease className="h-4 w-4" /> Rientra
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              editorRef.current?.focus()
              void editorRef.current?.getAction('editor.action.outdentLines')?.run()
            }}
            title="Riduce il rientro delle righe selezionate (Shift+Tab)"
          >
            <IndentDecrease className="h-4 w-4" /> Fuori rientro
          </Button>
          <Button variant="secondary" onClick={handleFormat} title="Formatta (Ctrl+Shift+F) — con una selezione formatta solo quella parte">
            <Wand2 className="h-4 w-4" /> Formatta
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              // apre l'anteprima della tabella sotto il cursore (come F4)
              const ed = editorRef.current
              const model = ed?.getModel()
              const pos = ed?.getPosition()
              const sm = stateRef.current.summary
              if (!ed || !model || !pos || !sm) return
              const resolved = resolveTokenAt(model.getValue(), model.getOffsetAt(pos), sm)
              if (resolved?.kind === 'table') {
                setPreviewTarget({ schema: resolved.table.schema, table: resolved.table.name })
              }
            }}
            title="Anteprima dati della tabella sotto il cursore (F4) — genera INSERT/UPDATE/MERGE/DELETE/#tmp"
          >
            <Table2 className="h-4 w-4" /> Anteprima
          </Button>
          <Button
            variant="ghost"
            onClick={() => setProfileOpen(true)}
            title="Impostazioni di formattazione (importa/edita/esporta il profilo T-SQL)"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" onClick={() => editorRef.current?.setValue('')}>
            <Eraser className="h-4 w-4" /> Svuota
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Button variant="ghost" onClick={() => onZoomFont?.(-1)} title="Riduci testo (Ctrl+rotella giù)">
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="w-6 text-center text-xs tabular-nums text-zinc-400">{fontSize}</span>
            <Button variant="ghost" onClick={() => onZoomFont?.(1)} title="Ingrandisci testo (Ctrl+rotella su)">
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
          <Button
            variant="ghost"
            onClick={() => onToggleTheme?.()}
            title={theme === 'vs-dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}
          >
            {theme === 'vs-dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Toggle checked={aiEnabled} onChange={onAiEnabledChange} label="Autocompletamento IA" />
          <Toggle
            checked={syntaxCheck}
            onChange={setSyntaxCheck}
            label="Verifica sintassi"
            title="Sottolinea gli errori reali di SQL Server (esegue il testo in una transazione che viene annullata — nessun effetto collaterale)"
          />
          <Badge tone={aiConfigured ? 'emerald' : 'amber'}>{aiStatusText}</Badge>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          defaultLanguage="sql"
          theme={theme}
          path="sql-intelli://main.sql"
          defaultValue={DEFAULT_SQL}
          onMount={handleMount}
          onChange={value => onContentChange?.(value ?? '')}
          loading={
            <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500">
              <Spinner /> Caricamento editor…
            </div>
          }
          options={{
            fontSize,
            fontFamily: 'Cascadia Code, Consolas, "Courier New", monospace',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            tabSize: 2,
            padding: { top: 10 },
            renderLineHighlight: 'all',
            // guide di indentazione verticali (visibili nei blocchi BEGIN/END dopo la formattazione)
            guides: { bracketPairs: false, indentation: true, highlightActiveIndentation: true },
            // folding: frecce nella gutter per chiudere porzioni di codice (BEGIN/END, --#region, commenti)
            folding: true,
            foldingHighlight: true,
            showFoldingControls: 'always',
            suggest: { showWords: false },
            quickSuggestions: { other: 'on', comments: false, strings: false },
            wordBasedSuggestions: 'off',
            inlineSuggest: { enabled: true, showToolbar: 'onHover' },
          }}
        />
      </div>
      {profileOpen && <FormatProfilePanel onClose={() => setProfileOpen(false)} />}
      {previewTarget && connectionId && (
        <DataPreviewModal
          target={previewTarget}
          connectionId={connectionId}
          summary={stateRef.current.summary}
          theme={theme}
          onClose={() => setPreviewTarget(null)}
        />
      )}
    </div>
  )
}

/** Attende `ms` millisecondi o fino alla cancellazione del token. */
function debounce(ms: number, token: monaco.CancellationToken): Promise<void> {
  return new Promise(resolve => {
    const sub = token.onCancellationRequested(() => {
      window.clearTimeout(id)
      resolve()
    })
    const id = window.setTimeout(() => {
      sub.dispose()
      resolve()
    }, ms)
  })
}
