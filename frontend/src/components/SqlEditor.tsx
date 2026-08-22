import { useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { Eraser, Play, Wand2 } from 'lucide-react'
import { format } from 'sql-formatter'
import monaco from '../monacoSetup'
import { api } from '../api'
import type { DatabaseSummary, TableInfo } from '../types'
import { buildExecParamSnippet, buildJoinText, buildSelectListSuggestions, columnInfoMarkdown, completionSortText, filterUnusedParams, findExecContext, findTableRefs, parseInsertContext, qualified, rankTablesForJoin, sqlIdent, statementRangeAt, usageDetail } from '../helpers'
import { registerInsertHighlight } from '../sqlInsertHighlight'
import { registerTableColorizer } from '../sqlTableColors'
import { registerSqlHover } from '../sqlHover'
import { Badge, Button, Spinner, Toggle } from './ui'

interface Props {
  connectionId: string
  summary: DatabaseSummary | null
  executing: boolean
  aiEnabled: boolean
  onAiEnabledChange: (v: boolean) => void
  aiConfigured: boolean
  aiStatusText: string
  onExecute: (sql: string) => void
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
  registerEditor,
}: Props) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const disposablesRef = useRef<monaco.IDisposable[]>([])
  const stateRef = useRef({ connectionId, summary, aiEnabled, onExecute })
  stateRef.current = { connectionId, summary, aiEnabled, onExecute }
  // L'istanza editor in stato React: l'effect del colorizer si (ri)registra
  // automaticamente quando editor o schema cambiano (pulizia inclusa)
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null)
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

  const handleFormat = () => {
    const ed = editorRef.current
    const model = ed?.getModel()
    if (!ed || !model) return
    try {
      const formatted = format(model.getValue(), {
        language: 'sql',
        keywordCase: 'upper',
        tabWidth: 2,
        useTabs: false,
      })
      ed.executeEdits('format', [{ range: model.getFullModelRange(), text: formatted }])
    } catch {
      /* SQL non valido: nessuna azione */
    }
  }

  const handleMount: OnMount = (editor, _monacoInstance) => {
    editorRef.current = editor
    registerEditor(editor)
    setEditor(editor)
    ensureColorizer()

    // Esegui: F5 e Ctrl+Invio
    editor.addCommand(monaco.KeyCode.F5, () => stateRef.current.onExecute(editor.getValue()))
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => stateRef.current.onExecute(editor.getValue()))
    // Formatta: Ctrl+Shift+F
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, handleFormat)

    registerSchemaCompletions()
    registerInlineCompletions()
    disposablesRef.current.push(...registerInsertHighlight(editor))
    disposablesRef.current.push(
      registerSqlHover(() => ({
        summary: stateRef.current.summary,
        connectionId: stateRef.current.connectionId,
      })),
    )
  }

  const registerSchemaCompletions = () => {
    disposablesRef.current.push(
      monaco.languages.registerCompletionItemProvider('sql', {
        triggerCharacters: ['.', ' ', '[', '"', '('],
        provideCompletionItems: (model, position) => {
          const st = stateRef.current
          const word = model.getWordUntilPosition(position)
          const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
          const textBefore = model.getValueInRange(
            new monaco.Range(1, 1, position.lineNumber, position.column),
          )
          // Testo prima della parola in corso (per capire se siamo in posizione FROM/JOIN)
          const prefix = textBefore.slice(0, Math.max(0, textBefore.length - word.word.length))
          const isTablePosition = /(?:FROM|JOIN|UPDATE|INTO|TABLE)\s*$/i.test(prefix)
          const isJoinPosition = /(?:(?:LEFT|RIGHT|INNER|OUTER|CROSS|FULL)\s+)?JOIN\s*$/i.test(prefix)

          const suggestions: monaco.languages.CompletionItem[] = []
          let rank = 0
          const push = (item: monaco.languages.CompletionItem) => {
            suggestions.push({ ...item, sortText: completionSortText(rank) })
            rank++
          }

          if (st.summary) {
            // Aiuto INSERT: dentro la lista colonne di "INSERT INTO tab (" →
            // suggerisce le colonne della tabella, con opzione "tutte le colonne"
            const insertCtx = parseInsertContext(textBefore)
            if (insertCtx && insertCtx.colOpen !== -1) {
              const cursorOffset = model.getOffsetAt(position)
              const inInsertColumns =
                insertCtx.colClose === null || cursorOffset <= insertCtx.colClose
              if (inInsertColumns) {
                const insTable = st.summary.tables.find(
                  t =>
                    t.name.toLowerCase() === insertCtx.table.toLowerCase() &&
                    (!insertCtx.schema || t.schema.toLowerCase() === insertCtx.schema.toLowerCase()),
                )
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
                      push({
                        label: `@${par.name}`,
                        detail: `${par.dataType}${par.mode === 'OUTPUT' ? ' · OUTPUT' : ''} · ${execProc.schema}.${execProc.name}`,
                        kind: monaco.languages.CompletionItemKind.Variable,
                        insertText: atSign ? par.name : `@${par.name}`,
                        range,
                        filterText: `@${par.name}`,
                      })
                    }
                    return { suggestions }
                  }
                }
              }
            }

            const contextTables = findTableRefs(textBefore)
            const summaryTables = st.summary.tables

            // Aiuto SELECT: se il cursore è nella select-list (tra SELECT e FROM dello statement),
            // suggerisce le colonne delle tabelle referenziate in tutto lo statement (anche dopo il cursore)
            const fullText = model.getValue()
            const cursorOffset = model.getOffsetAt(position)
            const stmtRange = statementRangeAt(fullText, cursorOffset)
            const stmtText = fullText.slice(stmtRange.start, stmtRange.end)
            const stmtBefore = stmtText.slice(0, cursorOffset - stmtRange.start)
            const inSelectList = /\bSELECT\b/i.test(stmtBefore) && !/\bFROM\b/i.test(stmtBefore)
            if (inSelectList) {
              const sel = buildSelectListSuggestions(stmtText, stmtBefore, st.summary)
              if (sel.starText) {
                const starIdx = stmtBefore.lastIndexOf('*')
                const starPos = model.getPositionAt(stmtRange.start + starIdx)
                const starRange = new monaco.Range(
                  starPos.lineNumber,
                  starPos.column,
                  position.lineNumber,
                  position.column,
                )
                push({
                  label: `— tutti i campi (${sel.starCount}) —`,
                  detail: 'espande * con le colonne delle tabelle dello statement',
                  kind: monaco.languages.CompletionItemKind.Snippet,
                  insertText: sel.starText,
                  range: starRange,
                })
              }
              for (const col of sel.columns) {
                push({
                  label: col.name,
                  detail: `${col.dataType}${col.isNullable ? ' NULL' : ''}${col.isIdentity ? ' IDENTITY' : ''} · ${col.ownerLabel}${col.shared ? ' (condivisa)' : ''}`,
                  documentation: col.documentation,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: sqlIdent(col.name),
                  range,
                  filterText: col.name,
                })
              }
            }

            const contextTableInfos = contextTables
              .map(name => summaryTables.find(x => x.name.toLowerCase() === name))
              .filter((x): x is TableInfo => x !== undefined)
            const ranked = rankTablesForJoin(st.summary.tables, st.summary.foreignKeys, contextTables)

            // Tabelle: prima quelle collegabili via FK (con clausola ON), poi per utilizzo reale
            for (const { table: t, hints } of ranked) {
              const details = [usageDetail(t.usage)]
              if (hints.length > 0) details.push(`${hints.length} FK`)
              const detail = details.filter(Boolean).join(' · ') || `tabella · ${t.columnCount} colonne`
              let insertText = qualified(t.schema, t.name)
              if (isJoinPosition && hints.length > 0) {
                insertText = buildJoinText(t, hints[0], [...contextTableInfos, t])
              }
              push({
                label: `${t.schema}.${t.name}`,
                detail,
                documentation: columnInfoMarkdown(t, null),
                kind: monaco.languages.CompletionItemKind.Struct,
                insertText,
                range,
                filterText: t.name,
              })
            }

            for (const v of st.summary.views) {
              push({
                label: `${v.schema}.${v.name}`,
                detail: 'vista',
                kind: monaco.languages.CompletionItemKind.Class,
                insertText: qualified(v.schema, v.name),
                range,
              })
            }

            for (const p of st.summary.procedures) {
              const params = p.parameters ?? []
              const suffix = params.length
                ? ' ' + params.map((par, i) => `@${par.name}=${'$'}{${i + 1}:${par.name}}`).join(', ')
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

            if (!isTablePosition) {
              // Colonne delle tabelle referenziate nel testo prima del cursore
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

              for (const k of SQL_KEYWORDS) {
                push({
                  label: k,
                  kind: monaco.languages.CompletionItemKind.Keyword,
                  insertText: k,
                  range,
                })
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={() => onExecute(editorRef.current?.getValue() ?? '')} loading={executing}>
            <Play className="h-4 w-4" /> Esegui
          </Button>
          <Button variant="secondary" onClick={handleFormat}>
            <Wand2 className="h-4 w-4" /> Formatta
          </Button>
          <Button variant="ghost" onClick={() => editorRef.current?.setValue('')}>
            <Eraser className="h-4 w-4" /> Svuota
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <Toggle checked={aiEnabled} onChange={onAiEnabledChange} label="Autocompletamento IA" />
          <Badge tone={aiConfigured ? 'emerald' : 'amber'}>{aiStatusText}</Badge>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          defaultLanguage="sql"
          theme="vs-dark"
          path="sql-intelli://main.sql"
          defaultValue={DEFAULT_SQL}
          onMount={handleMount}
          loading={
            <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500">
              <Spinner /> Caricamento editor…
            </div>
          }
          options={{
            fontSize: 13,
            fontFamily: 'Cascadia Code, Consolas, "Courier New", monospace',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            tabSize: 2,
            padding: { top: 10 },
            renderLineHighlight: 'all',
            suggest: { showWords: false },
            quickSuggestions: { other: 'on', comments: false, strings: false },
            wordBasedSuggestions: 'off',
            inlineSuggest: { enabled: true, showToolbar: 'onHover' },
          }}
        />
      </div>
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
