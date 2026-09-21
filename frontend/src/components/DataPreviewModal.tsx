import { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { Play, RotateCcw, Table2, X } from 'lucide-react'
import { api } from '../api'
import { sqlIdent } from '../helpers'
import type { CellValue, DatabaseSummary, QueryResult } from '../types'
import { Button, Spinner } from './ui'
import SelectableResultGrid from './SelectableResultGrid'

interface Props {
  /** Tabella da anteprime (null = finestra chiusa). */
  target: { schema: string; table: string } | null
  connectionId: string
  summary: DatabaseSummary | null
  theme?: string
  onClose: () => void
}

const DEFAULT_TOP = 100
/** URI del modello del mini-editor: i provider dell'editor principale lo ignorano. */
const PREVIEW_URI = 'sql-intelli://preview.sql'

function bracket(name: string): string {
  return `[${name.replace(/\]/g, ']]')}]`
}

/** Query di default con TUTTI i campi scritti (facile toglierli) invece di *. */
function defaultQuery(schema: string, table: string, columns: string[]): string {
  const cols = columns.length > 0 ? columns.map(c => bracket(c)).join(', ') : '*'
  return `SELECT TOP ${DEFAULT_TOP} ${cols}\nFROM ${bracket(schema)}.${bracket(table)}`
}

/** Keyword essenziali proposte nel mini-editor (oltre alle colonne della tabella). */
const PREVIEW_KEYWORDS = [
  'SELECT', 'TOP', 'FROM', 'WHERE', 'ORDER', 'BY', 'GROUP', 'HAVING', 'AND', 'OR', 'NOT',
  'AS', 'DESC', 'ASC', 'NULL', 'IS', 'IN', 'LIKE', 'BETWEEN', 'CASE', 'WHEN', 'THEN', 'ELSE',
  'END', 'JOIN', 'ON', 'DISTINCT',
]

/** Anteprima dati: mini-editor con intellisense FILTRATO sulla tabella in questione
 * (query di default con tutti i campi) + griglia selezionabile con generatore SQL. */
export default function DataPreviewModal({ target, connectionId, summary, theme = 'vs-dark', onClose }: Props) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const runSeq = useRef(0)
  // stato letto dal completion provider del mini-editor (colonne della tabella)
  const previewState = useRef({ schema: '', table: '', columns: [] as string[] })
  const miniRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

  const tableMeta = target
    ? summary?.tables.find(
        t => t.name.toLowerCase() === target.table.toLowerCase() && t.schema.toLowerCase() === target.schema.toLowerCase(),
      )
    : undefined
  const tableColumns = (tableMeta?.columns ?? []).map(c => c.name)

  // aggiorna lo stato per il provider del mini-editor
  useEffect(() => {
    previewState.current = {
      schema: target?.schema ?? '',
      table: target?.table ?? '',
      columns: tableColumns,
    }
  }, [target, tableColumns])

  const run = async (q: string) => {
    if (!target) return
    const seq = ++runSeq.current
    setLoading(true)
    setError(null)
    try {
      const res = await api.execute(connectionId, q, 30)
      if (seq !== runSeq.current) return
      setResult(res)
      if (res.error) setError(res.error)
    } catch (e) {
      if (seq !== runSeq.current) return
      setError(e instanceof Error ? e.message : String(e))
      setResult(null)
    } finally {
      if (seq === runSeq.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (!target) return
    const q = defaultQuery(target.schema, target.table, tableColumns)
    setQuery(q)
    setResult(null)
    setError(null)
    void run(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, connectionId])

  // provider di completamento SOLO per il mini-editor, filtrato sulla tabella
  useEffect(() => {
    const disp = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: [' ', ','],
      provideCompletionItems: (model, position) => {
        if (model.uri.toString() !== PREVIEW_URI) return { suggestions: [] }
        const { schema, table, columns } = previewState.current
        const word = model.getWordUntilPosition(position)
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
        const textBefore = model.getValueInRange(new monaco.Range(1, 1, position.lineNumber, position.column))
        const suggestions: monaco.languages.CompletionItem[] = []
        // dopo FROM/JOIN → il nome della tabella
        if (/(?:FROM|JOIN)\s+[^\s,;]*$/i.test(textBefore)) {
          suggestions.push({
            label: `${schema}.${table}`,
            kind: monaco.languages.CompletionItemKind.Struct,
            insertText: `${schema}.${table}`,
            range,
            filterText: table,
          })
          return { suggestions }
        }
        // colonne della tabella (e keyword essenziali)
        for (const c of columns) {
          suggestions.push({
            label: c,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: sqlIdent(c),
            range,
            filterText: c,
          })
        }
        for (const k of PREVIEW_KEYWORDS) {
          suggestions.push({
            label: k,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: k,
            range,
            filterText: k,
          })
        }
        return { suggestions }
      },
    })
    return () => disp.dispose()
  }, [])

  if (!target) return null

  const set = result?.resultSets?.[0]
  // colonne identity della tabella (dallo schema) → chiave di MERGE/DELETE
  const identityColumns = (tableMeta?.columns ?? []).filter(c => c.isIdentity).map(c => c.name)
  // colonne della PRIMARY KEY (anche composita): sono le chiavi della MERGE (condizione ON) e
  // non devono mai finire nell'UPDATE SET
  const pkColumns = (tableMeta?.indexes ?? [])
    .filter(i => i.isPrimaryKey)
    .flatMap(i => i.columns ?? [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="flex h-[85vh] w-[min(1200px,96vw)] flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Intestazione */}
        <div className="flex items-center gap-2 border-b border-zinc-700 bg-zinc-800/80 px-4 py-2.5">
          <Table2 className="h-4 w-4 text-sky-400" />
          <h2 className="text-sm font-semibold text-zinc-100">Anteprima dati — {target.schema}.{target.table}</h2>
          {loading && <Spinner />}
          <button
            onClick={onClose}
            className="ml-auto rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mini-editor query (intellisense solo della tabella) */}
        <div className="flex items-center gap-2 border-b border-zinc-700 bg-zinc-900 px-3 py-1.5">
          <div className="min-w-0 flex-1 overflow-hidden rounded border border-zinc-700 bg-zinc-950">
            <Editor
              height="42px"
              defaultLanguage="sql"
              theme={theme}
              path={PREVIEW_URI}
              value={query}
              onChange={v => setQuery(v ?? '')}
              onMount={ed => {
                miniRef.current = ed
                ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                  void run(ed.getValue())
                })
              }}
              options={{
                minimap: { enabled: false },
                lineNumbers: 'off',
                folding: false,
                glyphMargin: false,
                lineDecorationsWidth: 0,
                scrollBeyondLastLine: false,
                wordWrap: 'off',
                fontSize: 12,
                automaticLayout: true,
                scrollbar: { vertical: 'hidden', horizontal: 'auto' },
                suggest: { showWords: false },
                quickSuggestions: { other: 'on', comments: false, strings: false },
              }}
            />
          </div>
          <Button size="sm" onClick={() => void run(query)} loading={loading} title="Esegui la query (Ctrl+Invio)">
            <Play className="h-3.5 w-3.5" /> Esegui
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const q = defaultQuery(target.schema, target.table, tableColumns)
              setQuery(q)
              void run(q)
            }}
            title="Ripristina la SELECT TOP 100 con tutti i campi"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {error && !loading && (
          <div className="border-b border-rose-800 bg-rose-950/50 px-4 py-2 text-sm text-rose-200">{error}</div>
        )}

        {/* Griglia selezionabile + generatore SQL (condiviso con i risultati query) */}
        <div className="min-h-0 flex-1">
          {loading && !set ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-400">
              <Spinner /> Esecuzione query…
            </div>
          ) : (
            <SelectableResultGrid
              columns={set?.columns ?? []}
              rows={(set?.rows ?? []) as CellValue[][]}
              initialTarget={`${target.schema}.${target.table}`}
              identityColumns={identityColumns}
              keyColumns={pkColumns}
            />
          )}
        </div>
      </div>
    </div>
  )
}
