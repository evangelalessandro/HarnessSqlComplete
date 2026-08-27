import { useEffect, useRef, useState } from 'react'
import { Play, RotateCcw, Table2, X } from 'lucide-react'
import { api } from '../api'
import type { CellValue, DatabaseSummary, QueryResult } from '../types'
import { Button, Spinner } from './ui'
import SelectableResultGrid from './SelectableResultGrid'

interface Props {
  /** Tabella da anteprime (null = finestra chiusa). */
  target: { schema: string; table: string } | null
  connectionId: string
  summary: DatabaseSummary | null
  onClose: () => void
}

const DEFAULT_TOP = 100

function bracket(name: string): string {
  return `[${name.replace(/\]/g, ']]')}]`
}

function defaultQuery(schema: string, table: string): string {
  return `SELECT TOP ${DEFAULT_TOP} * FROM ${bracket(schema)}.${bracket(table)}`
}

/** Anteprima dati con QUERY MODIFICABILE: togli/metti campi, ordina, cambia il WHERE…
 * la griglia riflette la query; la selezione righe/colonne genera INSERT/UPDATE/MERGE/DELETE/#tmp. */
export default function DataPreviewModal({ target, connectionId, summary, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const runSeq = useRef(0)

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
    const q = defaultQuery(target.schema, target.table)
    setQuery(q)
    setResult(null)
    setError(null)
    void run(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, connectionId])

  if (!target) return null

  const set = result?.resultSets?.[0]
  // colonne identity della tabella (dallo schema) → chiave di MERGE/DELETE
  const tableMeta = summary?.tables.find(
    t => t.name.toLowerCase() === target.table.toLowerCase() && t.schema.toLowerCase() === target.schema.toLowerCase(),
  )
  const identityColumns = (tableMeta?.columns ?? [])
    .filter(c => c.isIdentity)
    .map(c => c.name)

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

        {/* Query modificabile */}
        <div className="flex items-center gap-2 border-b border-zinc-700 bg-zinc-900 px-3 py-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void run(query)
            }}
            spellCheck={false}
            title="Modifica la SELECT: togli/metti campi, ordina (ORDER BY), filtra (WHERE)… poi premi Esegui"
            className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100 focus:border-sky-500 focus:outline-none"
          />
          <Button size="sm" onClick={() => void run(query)} loading={loading} title="Esegui la query (Ctrl+Invio)">
            <Play className="h-3.5 w-3.5" /> Esegui
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const q = defaultQuery(target.schema, target.table)
              setQuery(q)
              void run(q)
            }}
            title="Ripristina la SELECT TOP 100 * originale"
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
            />
          )}
        </div>
      </div>
    </div>
  )
}
