import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Code2, Table2 } from 'lucide-react'
import type { CellValue, QueryResult } from '../types'
import { Badge, Button, Spinner } from './ui'
import SelectableResultGrid from './SelectableResultGrid'

interface Props {
  result: QueryResult | null
  executing: boolean
}

export default function ResultsPanel({ result, executing }: Props) {
  const [setIndex, setSetIndex] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  // modalità generatore: seleziona righe/colonne e genera INSERT/UPDATE/MERGE/DELETE/#tmp
  const [genMode, setGenMode] = useState(false)

  useEffect(() => {
    setSetIndex(0)
    setPage(1)
    setGenMode(false)
  }, [result])

  if (executing) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-400">
        <Spinner /> Esecuzione query in corso…
      </div>
    )
  }
  if (!result) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-600">
        <Table2 className="h-4 w-4" /> Esegui una query per vedere i risultati.
      </div>
    )
  }
  if (result.error) {
    return (
      <div className="m-4 flex items-start gap-2 rounded-md border border-rose-800 bg-rose-950/50 p-3 text-sm text-rose-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="whitespace-pre-wrap font-mono">{result.error}</span>
      </div>
    )
  }

  const activeSet = result.resultSets[Math.min(setIndex, Math.max(result.resultSets.length - 1, 0))]
  if (!activeSet) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-600">
        Nessun result set restituito.
      </div>
    )
  }

  const totalRows = activeSet.rows.length
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize))
  const safePage = Math.min(page, pageCount)
  const pageRows = activeSet.rows.slice((safePage - 1) * pageSize, safePage * pageSize)
  const start = totalRows === 0 ? 0 : (safePage - 1) * pageSize + 1
  const end = Math.min(safePage * pageSize, totalRows)

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-xs text-zinc-400">
        {result.resultSets.length > 1 && (
          <div className="flex items-center gap-1">
            {result.resultSets.map((s, i) => (
              <button
                key={i}
                onClick={() => {
                  setSetIndex(i)
                  setPage(1)
                }}
                className={`rounded px-2 py-0.5 font-medium transition-colors ${
                  i === setIndex ? 'bg-sky-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                Set {i + 1} · {s.rowCount} righe
              </button>
            ))}
          </div>
        )}
        <span className="ml-auto flex items-center gap-2">
          <Button
            variant={genMode ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setGenMode(v => !v)}
            title="Seleziona righe/colonne e genera INSERT/UPDATE/MERGE/DELETE/INSERT INTO # dai risultati"
          >
            <Code2 className="h-3.5 w-3.5" /> {genMode ? 'Generatore attivo' : 'Genera SQL'}
          </Button>
          <Badge tone="zinc">{(result.elapsedMs / 1000).toFixed(2)} s</Badge>
          {activeSet.affectedRows > 0 && <Badge tone="amber">{activeSet.affectedRows} righe modificate</Badge>}
          {activeSet.truncated && (
            <Badge tone="rose">Risultati troncati a {totalRows.toLocaleString('it-IT')} righe</Badge>
          )}
        </span>
      </div>

      {genMode ? (
        <div className="min-h-0 flex-1">
          <SelectableResultGrid columns={activeSet.columns} rows={pageRows as CellValue[][]} />
        </div>
      ) : (
        <>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="w-12 border-b border-zinc-700 bg-zinc-800 px-2 py-1.5 text-right font-medium text-zinc-500">
                #
              </th>
              {activeSet.columns.map((c, i) => (
                <th
                  key={`${c.name}-${i}`}
                  className="border-b border-zinc-700 bg-zinc-800 px-3 py-1.5 font-semibold text-zinc-100"
                >
                  {c.name}
                  <span className="ml-1.5 font-normal text-zinc-500">{c.dataType}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, ri) => (
              <tr key={ri} className={ri % 2 ? 'bg-zinc-900/50' : 'bg-zinc-950'}>
                <td className="border-b border-zinc-800/60 px-2 py-1 text-right font-mono text-xs text-zinc-600">
                  {start + ri}
                </td>
                {row.map((cell, ci) => (
                  <Cell key={ci} value={cell} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-400">
        <span>
          Righe {start}–{end} di {totalRows.toLocaleString('it-IT')}
        </span>
        <div className="flex items-center gap-2">
          <select
            value={pageSize}
            onChange={e => {
              setPageSize(Number(e.target.value))
              setPage(1)
            }}
            className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-300 focus:border-sky-500 focus:outline-none"
          >
            {[25, 50, 100, 200].map(n => (
              <option key={n} value={n}>
                {n} per pagina
              </option>
            ))}
          </select>
          <button
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
            className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="tabular-nums">
            {safePage} / {pageCount}
          </span>
          <button
            disabled={safePage >= pageCount}
            onClick={() => setPage(safePage + 1)}
            className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
        </>
      )}
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
    <td
      className="max-w-[440px] truncate border-b border-zinc-800/60 px-3 py-1 font-mono text-zinc-200"
      title={text}
    >
      {text}
    </td>
  )
}
