import { useEffect, useMemo, useState } from 'react'
import { ClipboardCopy, Table2, X } from 'lucide-react'
import { api } from '../api'
import { buildDeleteSql, buildInsertIntoTempSql, buildInsertSql, buildMergeSql, buildUpdateSql } from '../sqlGen'
import type { GenColumn } from '../sqlGen'
import type { CellValue, DatabaseSummary, QueryResult } from '../types'
import { Badge, Button, Spinner } from './ui'

interface Props {
  /** Tabella da anteprime (null = finestra chiusa). */
  target: { schema: string; table: string } | null
  connectionId: string
  summary: DatabaseSummary | null
  onClose: () => void
}

const PREVIEW_ROWS = 100

/** Griglia dati dell'anteprima + generazione INSERT/UPDATE/MERGE dalle selezioni. */
export default function DataPreviewModal({ target, connectionId, summary, onClose }: Props) {
  const [result, setResult] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [selectedCols, setSelectedCols] = useState<Set<number>>(new Set())
  const [copied, setCopied] = useState(false)
  // nome della temporanea per "INSERT INTO #" (default: #<Tabella>)
  const [tempName, setTempName] = useState('')

  useEffect(() => {
    if (!target) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setResult(null)
    setSelectedRows(new Set())
    setSelectedCols(new Set())
    setTempName(`#${target.table}`)
    api
      .previewTable(connectionId, target.schema, target.table, PREVIEW_ROWS)
      .then(res => {
        if (cancelled) return
        setResult(res)
        if (res.error) setError(res.error)
        else if (res.resultSets[0]?.columns) {
          // colonne tutte selezionate di default
          setSelectedCols(new Set(res.resultSets[0].columns.map((_, i) => i)))
        }
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [target, connectionId])

  // colonne con metadata dallo schema (isIdentity per la chiave del MERGE)
  const columns: GenColumn[] = useMemo(() => {
    const set = result?.resultSets[0]
    if (!set) return []
    const tableMeta = summary?.tables.find(
      t => t.name.toLowerCase() === target?.table.toLowerCase() && t.schema.toLowerCase() === target?.schema.toLowerCase(),
    )
    return set.columns.map((c, i) => ({
      name: c.name,
      dataType: c.dataType,
      isIdentity: tableMeta?.columns?.[i]?.isIdentity ?? false,
    }))
  }, [result, summary, target])

  const rows: CellValue[][] = useMemo(() => result?.resultSets[0]?.rows ?? [], [result])

  const selColIndexes = useMemo(() => [...selectedCols].sort((a, b) => a - b), [selectedCols])
  const selCols: GenColumn[] = selColIndexes.map(i => columns[i]).filter(Boolean)
  const selRows = useMemo(
    () => [...selectedRows].sort((a, b) => a - b).map(i => rows[i]).filter(Boolean),
    [selectedRows, rows],
  )

  const sql = useMemo(() => {
    if (!target || selCols.length === 0 || selRows.length === 0) return null
    const keys = columns.filter(c => c.isIdentity).map(c => c.name)
    const gen = {
      INSERT: () => buildInsertSql(target.schema, target.table, selCols, selRows),
      UPDATE: () =>
        selRows.map(r => buildUpdateSql(target.schema, target.table, columns, selColIndexes, r)).join('\n\n'),
      MERGE: () => buildMergeSql(target.schema, target.table, selCols, selRows, keys.length ? keys : undefined),
      DELETE: () =>
        selRows
          .map(r => buildDeleteSql(target.schema, target.table, columns, keys.length ? keys : undefined, r))
          .join('\n\n'),
      'INSERT#': () => {
        const name = tempName.trim().startsWith('#') ? tempName.trim() : `#${tempName.trim()}`
        return buildInsertIntoTempSql(name, selCols, selRows)
      },
    }
    return gen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, selCols, selRows, columns, selColIndexes, tempName])

  const [kind, setKind] = useState<'INSERT' | 'UPDATE' | 'MERGE' | 'DELETE' | 'INSERT#'>('INSERT')
  const output = useMemo(() => {
    if (!sql) return ''
    try {
      return sql[kind]()
    } catch {
      return ''
    }
  }, [sql, kind])

  const toggleRow = (i: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }
  const toggleCol = (i: number) => {
    setSelectedCols(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }
  const toggleAllRows = () => {
    setSelectedRows(prev => (prev.size === rows.length ? new Set() : new Set(rows.map((_, i) => i))))
  }

  const copy = async () => {
    if (!output) return
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard non disponibile */
    }
  }

  if (!target) return null
  const set = result?.resultSets[0]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="flex h-[80vh] w-[min(1100px,95vw)] flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Intestazione */}
        <div className="flex items-center gap-2 border-b border-zinc-700 bg-zinc-800/80 px-4 py-2.5">
          <Table2 className="h-4 w-4 text-sky-400" />
          <h2 className="text-sm font-semibold text-zinc-100">
            Anteprima dati — {target.schema}.{target.table}
          </h2>
          <Badge tone="zinc">prime {PREVIEW_ROWS} righe</Badge>
          {loading && <Spinner />}
          <button onClick={onClose} className="ml-auto rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && !loading && (
          <div className="border-b border-rose-800 bg-rose-950/50 px-4 py-2 text-sm text-rose-200">{error}</div>
        )}

        {/* Griglia */}
        <div className="min-h-0 flex-1 overflow-auto">
          {loading && !set ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-400">
              <Spinner /> Caricamento anteprima…
            </div>
          ) : set && set.columns.length > 0 ? (
            <table className="w-full border-collapse text-left text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="w-10 border-b border-zinc-700 bg-zinc-800 px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={selectedRows.size === rows.length && rows.length > 0}
                      onChange={toggleAllRows}
                      className="accent-sky-500"
                    />
                  </th>
                  {set.columns.map((c, i) => (
                    <th key={`${c.name}-${i}`} className="border-b border-zinc-700 bg-zinc-800 px-3 py-1.5">
                      <label className="flex cursor-pointer items-center gap-1.5 font-semibold text-zinc-100">
                        <input
                          type="checkbox"
                          checked={selectedCols.has(i)}
                          onChange={() => toggleCol(i)}
                          className="accent-sky-500"
                        />
                        {c.name}
                        <span className="font-normal text-zinc-500">{c.dataType}</span>
                      </label>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr
                    key={ri}
                    className={`cursor-pointer transition-colors ${selectedRows.has(ri) ? 'bg-sky-950/60' : ri % 2 ? 'bg-zinc-900/50' : 'bg-zinc-950'}`}
                    onClick={() => toggleRow(ri)}
                  >
                    <td className="border-b border-zinc-800/60 px-2 py-1">
                      <input
                        type="checkbox"
                        checked={selectedRows.has(ri)}
                        onChange={() => toggleRow(ri)}
                        onClick={e => e.stopPropagation()}
                        className="accent-sky-500"
                      />
                    </td>
                    {row.map((cell, ci) => (
                      <Cell key={ci} value={cell} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            !loading && (
              <div className="flex h-full items-center justify-center text-sm text-zinc-600">Nessun dato.</div>
            )
          )}
        </div>

        {/* Generatore SQL */}
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-700 bg-zinc-800/80 px-4 py-2 text-sm">
          <span className="text-xs text-zinc-400">Genera:</span>
          {(['INSERT', 'UPDATE', 'MERGE', 'DELETE', 'INSERT#'] as const).map(k => (
            <Button
              key={k}
              variant={kind === k ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setKind(k)}
              disabled={!sql}
              title={
                k === 'UPDATE'
                  ? 'Un UPDATE per ogni riga selezionata (WHERE sulle colonne non aggiornate)'
                  : k === 'DELETE'
                    ? 'Un DELETE per ogni riga selezionata (WHERE sulla chiave)'
                    : k === 'INSERT#'
                      ? 'Crea e popola una tabella temporanea (#tmp) con i dati selezionati'
                      : undefined
              }
            >
              {k === 'INSERT#' ? 'INSERT INTO #' : k}
            </Button>
          ))}
          {kind === 'INSERT#' && (
            <input
              value={tempName}
              onChange={e => setTempName(e.target.value)}
              placeholder="#tmpTable"
              className="w-40 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-200 focus:border-sky-500 focus:outline-none"
            />
          )}
          <span className="ml-2 text-xs text-zinc-500">
            {selCols.length} colonne · {selRows.length} righe selezionate
          </span>
          <Button variant="secondary" size="sm" className="ml-auto" onClick={copy} disabled={!output}>
            <ClipboardCopy className="h-3.5 w-3.5" /> {copied ? 'Copiato!' : 'Copia SQL'}
          </Button>
        </div>
        <pre className="max-h-56 min-h-24 flex-1 overflow-auto border-t border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-emerald-200">
          {output || 'Seleziona almeno una riga e una colonna per generare lo statement.'}
        </pre>
      </div>
    </div>
  )
}

function Cell({ value }: { value: CellValue }) {
  if (value === null || value === undefined) {
    return <td className="border-b border-zinc-800/60 px-3 py-1 italic text-zinc-600">NULL</td>
  }
  let text: string
  if (typeof value === 'boolean') text = String(value)
  else if (typeof value === 'object') text = JSON.stringify(value)
  else text = String(value)
  return (
    <td className="max-w-[380px] truncate border-b border-zinc-800/60 px-3 py-1 font-mono text-zinc-200" title={text}>
      {text}
    </td>
  )
}
