import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ChevronLeft, ChevronRight, Code2, Rows3, Square, Table2 } from 'lucide-react'
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
  /**
   * Vista "tutti i result set uno di seguito all'altro" (un solo scorrimento, niente
   * paginazione). È un'IMPOSTAZIONE DELLA TAB corrente: la ricorda App per ogni editor.
   */
  continuous?: boolean
  onContinuousChange?: (v: boolean) => void
}

export default function ResultsPanel({
  result,
  executing,
  sourceSql,
  summary,
  onOpenObject,
  onJumpToLine,
  continuous = false,
  onContinuousChange,
}: Props) {
  const [setIndex, setSetIndex] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  // modalità generatore: seleziona righe/colonne e genera INSERT/UPDATE/MERGE/DELETE/#tmp
  const [genMode, setGenMode] = useState(false)
  // contenitore della vista in sequenza: serve al pulsante "Torna su"
  const seqRef = useRef<HTMLDivElement | null>(null)

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

  // "tutti i result set in sequenza": ha senso solo con più di un set
  const multiSet = result.resultSets.length > 1
  const continuo = continuous && multiSet
  const righeTotali = result.resultSets.reduce((n, s) => n + s.rows.length, 0)

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-xs text-zinc-400">
        {multiSet && (
          <Button
            variant={continuo ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => onContinuousChange?.(!continuo)}
            title={
              continuo
                ? 'Torna alla vista con un result set alla volta (con paginazione)'
                : 'Mostra tutti i result set uno di seguito all’altro, con un solo scorrimento'
            }
          >
            {continuo ? <Square className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
            {continuo ? 'Un set alla volta' : 'Tutti in sequenza'}
          </Button>
        )}
        {multiSet && (!continuo || genMode) && (
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
        {continuo && (
          <span className="font-medium text-zinc-300">
            {result.resultSets.length} result set in sequenza · {righeTotali.toLocaleString('it-IT')} righe
          </span>
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
            /* lo schema serve a usare TUTTE le colonne della primary key (anche composita) nella
               condizione ON della MERGE: la chiave non è detto che sia una sola */
            summary={summary}
            firstRowNumber={start}
          />
        </div>
      ) : continuo ? (
        /* VISTA IN SEQUENZA: tutti i result set uno sotto l'altro in UN SOLO scorrimento
           (niente paginazione: si scorre fino in fondo). La barra di ogni set resta fissa
           in alto mentre lo si attraversa, così si sa sempre quale set si sta leggendo. */
        <>
          <div ref={seqRef} className="min-h-0 flex-1 overflow-auto" data-testid="risultati-in-sequenza">
            {result.resultSets.map((s, i) => (
              <section key={i} data-set={i + 1}>
                <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-y border-zinc-700 bg-zinc-900/95 px-3 py-1 text-xs backdrop-blur">
                  <span className="font-semibold text-sky-300">Set {i + 1}</span>
                  <span className="text-zinc-400">
                    {s.rowCount.toLocaleString('it-IT')} righe · {s.columns.length} colonne
                  </span>
                  {s.affectedRows > 0 && <Badge tone="amber">{s.affectedRows} righe modificate</Badge>}
                  {s.truncated && (
                    <Badge tone="rose">troncato a {s.rowCount.toLocaleString('it-IT')} righe</Badge>
                  )}
                </div>
                {s.columns.length > 0 && s.rows.length > 0 ? (
                  <ResultDataTable
                    columns={s.columns}
                    rows={s.rows as CellValue[][]}
                    firstRowNumber={1}
                    stickyHeader={false}
                  />
                ) : (
                  <div className="px-3 py-2 text-xs text-zinc-500">Nessuna riga.</div>
                )}
              </section>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-400">
            <span>
              {result.resultSets.length} result set · {righeTotali.toLocaleString('it-IT')} righe in totale
            </span>
            <button
              onClick={() => seqRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
              title="Torna all'inizio dei risultati"
            >
              <ArrowUp className="h-3.5 w-3.5" /> Torna su
            </button>
          </div>
        </>
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
