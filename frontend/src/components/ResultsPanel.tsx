import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Code2, Table2 } from 'lucide-react'
import type { CellValue, DatabaseSummary, QueryMessage, QueryResult } from '../types'
import { suggestTargetTables } from '../sqlGen'
import { Badge, Button, Spinner } from './ui'
import SelectableResultGrid from './SelectableResultGrid'
import ResultDataTable from './ResultDataTable'
import QueryErrorBanner from './QueryErrorBanner'
import { firstErrorMessage } from '../sqlMessages'
import type { ErrorObjectRef } from '../sqlMessages'

interface Props {
  result: QueryResult | null
  executing: boolean
  /** SQL eseguito che ha prodotto `result`: serve a proporre la tabella target del generatore. */
  sourceSql?: string
  /** Schema caricato: serve a riconoscere gli oggetti citati negli errori. */
  summary?: DatabaseSummary | null
  /** Apre un oggetto citato nell'errore in una nuova tab (Modifica / CREATE). */
  onOpenObject?: (o: ErrorObjectRef) => void
  /** Doppio clic sull'errore: porta il cursore sulla riga indicata da SQL Server. */
  onJumpToLine?: (m: QueryMessage) => void
}

export default function ResultsPanel({
  result,
  executing,
  sourceSql,
  summary,
  onOpenObject,
  onJumpToLine,
}: Props) {
  const [setIndex, setSetIndex] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  // modalità generatore: seleziona righe/colonne e genera INSERT/UPDATE/MERGE/DELETE/#tmp
  const [genMode, setGenMode] = useState(false)

  // Tabella target PROPOSTA (modificabile) per ogni result set: ricavata dal SQL
  // eseguito ("data un recordset non serve digitare il nome tabella: lo proponiamo").
  const suggestedTargets = useMemo(() => (sourceSql ? suggestTargetTables(sourceSql) : []), [sourceSql])

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
      <QueryErrorBanner
        error={result.error}
        summary={summary}
        onOpenObject={onOpenObject}
        message={firstErrorMessage(result)}
        onJumpToLine={onJumpToLine}
      />
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
          <SelectableResultGrid
            key={setIndex}
            columns={activeSet.columns}
            rows={pageRows as CellValue[][]}
            initialTarget={suggestedTargets[setIndex] || suggestedTargets.find(t => t !== '') || ''}
            firstRowNumber={start}
          />
        </div>
      ) : (
        <>
      {/* Vista normale: stessa tabella del generatore (numero di riga, linee delle colonne,
          tre colori alternati, colonne spostabili trascinando l'intestazione) */}
      <div className="min-h-0 flex-1 overflow-auto">
        <ResultDataTable columns={activeSet.columns} rows={pageRows as CellValue[][]} firstRowNumber={start} />
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
