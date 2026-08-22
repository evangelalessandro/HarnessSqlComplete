import { useEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { Eraser, Play, Wand2 } from 'lucide-react'
import { format } from 'sql-formatter'
import monaco from '../monacoSetup'
import { api } from '../api'
import type { DatabaseSummary } from '../types'
import { findTableRefs, qualified } from '../helpers'
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

const DEFAULT_SQL = `-- SQL Intelligence Assistant
-- F5 / Ctrl+Invio : esegui la query
-- Ctrl+Spazio    : completamento IA inline (DeepSeek)
-- Ctrl+Shift+F   : formatta SQL

SELECT TOP 100 *
FROM [dbo].[TableName];
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

  useEffect(() => {
    return () => {
      disposablesRef.current.forEach(d => d.dispose())
      disposablesRef.current = []
    }
  }, [])

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

    // Esegui: F5 e Ctrl+Invio
    editor.addCommand(monaco.KeyCode.F5, () => stateRef.current.onExecute(editor.getValue()))
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => stateRef.current.onExecute(editor.getValue()))
    // Formatta: Ctrl+Shift+F
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, handleFormat)

    registerSchemaCompletions()
    registerInlineCompletions()
  }

  const registerSchemaCompletions = () => {
    disposablesRef.current.push(
      monaco.languages.registerCompletionItemProvider('sql', {
        triggerCharacters: ['.', ' ', '[', '"'],
        provideCompletionItems: (model, position) => {
          const st = stateRef.current
          const word = model.getWordUntilPosition(position)
          const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
          const suggestions: monaco.languages.CompletionItem[] = []
          const textBefore = model
            .getValueInRange(new monaco.Range(1, 1, position.lineNumber, position.column))
            .toLowerCase()

          for (const k of SQL_KEYWORDS) {
            suggestions.push({
              label: k,
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: k,
              range,
            })
          }

          if (st.summary) {
            for (const t of st.summary.tables) {
              suggestions.push({
                label: `${t.schema}.${t.name}`,
                detail: `tabella · ${t.columnCount} colonne`,
                kind: monaco.languages.CompletionItemKind.Struct,
                insertText: qualified(t.schema, t.name),
                range,
              })
            }
            for (const v of st.summary.views) {
              suggestions.push({
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
              suggestions.push({
                label: `${p.schema}.${p.name}`,
                detail: 'stored procedure',
                kind: monaco.languages.CompletionItemKind.Function,
                insertText: qualified(p.schema, p.name) + suffix,
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
              })
            }

            // Colonne delle tabelle referenziate nel testo prima del cursore
            for (const ref of findTableRefs(textBefore)) {
              const t = st.summary.tables.find(x => x.name.toLowerCase() === ref)
              if (!t?.columns) continue
              for (const c of t.columns) {
                suggestions.push({
                  label: c.name,
                  detail: `colonna di ${t.schema}.${t.name} · ${c.dataType}${c.isNullable ? ' NULL' : ''}`,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: `[${c.name}]`,
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
