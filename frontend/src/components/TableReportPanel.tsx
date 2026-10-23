// REPORT UTILIZZO TABELLE del database ATTIVO: spazio riservato/usato, dati, indici, righe e
// accessi. Si apre in una TAB (come la Ricerca e i diagrammi), non in una finestra, e riguarda
// SOLO il database della connessione (il nome è scritto in testa).
// In fondo: l'ISTOGRAMMA delle 20 tabelle più pesanti, che segue il filtro per nome, e la
// selezione delle tabelle per generare lo script che ne svuota il contenuto.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, BarChart3, Database as DbIcon, RefreshCw, Table2, Trash2 } from 'lucide-react'
import { api } from '../api'
import {
  filtraTabelleReport,
  fmtKb,
  fmtNum,
  scriptDeleteTablesContent,
  sortTableReport,
  topTablesBySize,
} from '../helpers'
import type { SortDir, TableReportSortKey } from '../helpers'
import type { TableReportRow } from '../types'
import { Button, Spinner } from './ui'

// Le due formattazioni stanno in helpers (servono anche allo script di svuotamento): qui si
// ri-esportano perché erano il punto di riferimento per chi le importava da questo file.
export { fmtKb, fmtNum }

interface Props {
  connectionId: string
  /** Database attivo: il report riguarda SOLO questo. */
  database: string
  /** Apre lo script generato in una nuova tab (come le altre voci "script" dell'app). */
  onOpenScript?: (title: string, sql: string) => void
}

const COLS: { key: TableReportSortKey; label: string; align?: 'r' }[] = [
  { key: 'name', label: 'Tabella' },
  { key: 'rowCount', label: 'Righe', align: 'r' },
  { key: 'reservedKb', label: 'Riservato', align: 'r' },
  { key: 'usedKb', label: 'Usato', align: 'r' },
  { key: 'dataKb', label: 'Dati', align: 'r' },
  { key: 'indexKb', label: 'Indici', align: 'r' },
  { key: 'unusedKb', label: 'Libero', align: 'r' },
  { key: 'indexCount', label: 'N° ind.', align: 'r' },
  { key: 'reads', label: 'Letture', align: 'r' },
  { key: 'writes', label: 'Scritture', align: 'r' },
  { key: 'lastRead', label: 'Ultimo accesso' },
  { key: 'lastWrite', label: 'Ultima modifica' },
  { key: 'createDate', label: 'Creata' },
]

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * Nome qualificato "schema.nome" SEMPRE: in un report che si ordina e si filtra, il nome da solo
 * non è univoco (tabelle omonime in schemi diversi) e non si capisce a quale database appartiene.
 * Il database è quello scritto in testa al pannello.
 */
function nomeTabella(r: { schema: string; name: string }): string {
  return `${r.schema}.${r.name}`
}

export default function TableReportPanel({ connectionId, database, onOpenScript }: Props) {
  const [rows, setRows] = useState<TableReportRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<TableReportSortKey>('reservedKb')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [filter, setFilter] = useState('')
  const [caricando, setCaricando] = useState(false)
  /** Tabelle selezionate (chiave "schema.nome"): sono quelle dello script di svuotamento. */
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const carica = useCallback(async () => {
    setCaricando(true)
    setErr(null)
    try {
      setRows(await api.tableReport(connectionId))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setCaricando(false)
    }
  }, [connectionId])

  useEffect(() => {
    void carica()
  }, [carica])

  const onSort = (key: TableReportSortKey) => {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(key === 'name' || key === 'createDate' || key === 'lastRead' || key === 'lastWrite' ? 'asc' : 'desc')
    }
  }

  /** Righe che passano il filtro per nome: le usano SIA l'elenco SIA l'istogramma. */
  const filtrate = useMemo(() => filtraTabelleReport(rows ?? [], filter), [rows, filter])
  const sorted = useMemo(() => sortTableReport(filtrate, sortKey, sortDir), [filtrate, sortKey, sortDir])

  const totals = useMemo(() => {
    if (!rows) return { tables: 0, reservedKb: 0, usedKb: 0, rows: 0 }
    return {
      tables: rows.length,
      reservedKb: rows.reduce((a, r) => a + r.reservedKb, 0),
      usedKb: rows.reduce((a, r) => a + r.usedKb, 0),
      rows: rows.reduce((a, r) => a + r.rowCount, 0),
    }
  }, [rows])

  /** Istogramma: le 20 tabelle più pesanti FRA QUELLE FILTRATE. */
  const pesanti = useMemo(() => topTablesBySize(filtrate, 20), [filtrate])
  const maxKb = pesanti[0]?.reservedKb ?? 0

  const chiave = (r: { schema: string; name: string }) => `${r.schema}.${r.name}`
  const toggle = (r: { schema: string; name: string }) =>
    setSelected(prev => {
      const next = new Set(prev)
      const k = chiave(r)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  const tutteVisibili = filtrate.length > 0 && filtrate.every(r => selected.has(chiave(r)))
  const toggleTutte = () =>
    setSelected(prev => {
      if (filtrate.every(r => prev.has(chiave(r)))) return new Set()
      const next = new Set(prev)
      for (const r of filtrate) next.add(chiave(r))
      return next
    })

  const scelte = useMemo(() => (rows ?? []).filter(r => selected.has(chiave(r))), [rows, selected])
  const scelteKb = scelte.reduce((a, r) => a + r.reservedKb, 0)

  /** Script "svuota contenuto" delle tabelle selezionate, in una nuova tab. */
  const svuota = () => {
    if (scelte.length === 0 || !onOpenScript) return
    const titolo = `DELETE contenuto (${scelte.length} tabell${scelte.length === 1 ? 'a' : 'e'})`
    onOpenScript(titolo, scriptDeleteTablesContent(scelte))
  }

  return (
    <div
      data-report="pannello"
      className="flex h-full min-h-0 flex-col overflow-hidden border border-zinc-800 bg-zinc-900"
    >
      {/* intestazione */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Table2 className="h-4 w-4 text-sky-400" />
        <span className="text-sm font-semibold text-zinc-100">Report utilizzo tabelle</span>
        <span
          className="flex items-center gap-1 text-[11px] text-zinc-500"
          title="Il report riguarda solo questo database"
        >
          <DbIcon className="h-3 w-3" />
          {database}
        </span>
        {rows && (
          <span className="text-[11px] text-zinc-500" data-report="totali">
            {fmtNum(totals.tables)} tabelle · {fmtNum(totals.rows)} righe · {fmtKb(totals.reservedKb)} riservati
          </span>
        )}
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          data-report="filtro"
          placeholder="Filtra per nome…"
          title="Filtra l'elenco E l'istogramma per nome (anche schema.nome)"
          className="ml-auto w-44 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none"
        />
        <button
          onClick={() => void carica()}
          disabled={caricando}
          data-report="ricarica"
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
          title="Rileggi il report dal database"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${caricando ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {err && (
        <div className="m-3 rounded-md border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{err}</div>
      )}
      {!rows && !err && (
        <div className="flex h-40 items-center justify-center gap-2 text-sm text-zinc-500">
          <Spinner /> Caricamento report…
        </div>
      )}

      {/* ELENCO */}
      {rows && (
        <div className="min-h-0 flex-1 overflow-auto" data-report="elenco">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-zinc-800/95">
              <tr>
                <th className="w-8 border-b border-zinc-700 px-2 py-2" title="Seleziona le tabelle filtrate">
                  <input
                    type="checkbox"
                    checked={tutteVisibili}
                    onChange={toggleTutte}
                    className="h-3.5 w-3.5 accent-sky-500"
                  />
                </th>
                {COLS.map(c => (
                  <th
                    key={c.key}
                    onClick={() => onSort(c.key)}
                    className={`cursor-pointer select-none whitespace-nowrap border-b border-zinc-700 px-2.5 py-2 font-semibold text-zinc-300 transition-colors hover:bg-zinc-700/60 hover:text-white ${
                      c.align === 'r' ? 'text-right' : 'text-left'
                    }`}
                    title="Clicca per ordinare"
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {sortKey === c.key ? (
                        sortDir === 'asc' ? (
                          <ArrowUp className="h-3 w-3 text-sky-400" />
                        ) : (
                          <ArrowDown className="h-3 w-3 text-sky-400" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 text-zinc-600" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={COLS.length + 1} className="px-3 py-8 text-center text-zinc-600">
                    Nessuna tabella trovata{filter.trim() ? ` per “${filter.trim()}”.` : '.'}
                  </td>
                </tr>
              )}
              {sorted.map(r => {
                const sel = selected.has(chiave(r))
                return (
                  <tr
                    key={chiave(r)}
                    data-report="riga"
                    className={`border-b border-zinc-800/70 transition-colors ${
                      sel ? 'bg-sky-950/40' : 'hover:bg-sky-950/30'
                    }`}
                  >
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={sel}
                        onChange={() => toggle(r)}
                        title={`Seleziona ${chiave(r)}`}
                        className="h-3.5 w-3.5 accent-sky-500"
                      />
                    </td>
                    <td
                      className="max-w-64 truncate px-2.5 py-1.5 font-mono text-zinc-200"
                      title={`${r.schema}.${r.name}`}
                    >
                      {nomeTabella(r)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-zinc-300">{fmtNum(r.rowCount)}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-zinc-200" title={`${fmtNum(r.reservedKb)} KB`}>
                      {fmtKb(r.reservedKb)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-zinc-300" title={`${fmtNum(r.usedKb)} KB`}>
                      {fmtKb(r.usedKb)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-emerald-300/90" title={`${fmtNum(r.dataKb)} KB`}>
                      {fmtKb(r.dataKb)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-sky-300/90" title={`${fmtNum(r.indexKb)} KB`}>
                      {fmtKb(r.indexKb)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-zinc-500" title={`${fmtNum(r.unusedKb)} KB`}>
                      {fmtKb(r.unusedKb)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-zinc-300">{r.indexCount}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-zinc-300">{fmtNum(r.reads)}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-zinc-300">{fmtNum(r.writes)}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-zinc-400">{fmtDate(r.lastRead)}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-zinc-400">{fmtDate(r.lastWrite)}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-zinc-500">{fmtDate(r.createDate)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ISTOGRAMMA (sotto l'elenco) delle 20 tabelle più pesanti fra quelle filtrate */}
      {rows && pesanti.length > 0 && (
        <div className="shrink-0 border-t border-zinc-800 px-3 py-2" data-report="istogramma">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <BarChart3 className="h-4 w-4 text-sky-400" />
            <h3 className="text-xs font-semibold text-zinc-300">
              Le {pesanti.length} tabelle più pesanti
              {filter.trim() ? ` fra quelle filtrate (${fmtNum(filtrate.length)})` : ''}
            </h3>
            <span className="text-[11px] text-zinc-500">
              barra = spazio su disco · <span className="text-emerald-300/90">dati</span> +{' '}
              <span className="text-sky-300/90">indici</span> + <span className="text-zinc-400">libero</span> — clicca
              una barra per selezionare la tabella
            </span>
          </div>
          <div className="max-h-[30vh] space-y-0.5 overflow-auto pr-1">
            {pesanti.map(r => {
              const sel = selected.has(chiave(r))
              const quota = (kb: number) => `${maxKb > 0 ? Math.min(100, (kb / maxKb) * 100) : 0}%`
              return (
                <button
                  key={chiave(r)}
                  onClick={() => toggle(r)}
                  data-report="barra"
                  title={`${chiave(r)} — ${fmtNum(r.rowCount)} righe · dati ${fmtKb(r.dataKb)} · indici ${fmtKb(
                    r.indexKb,
                  )} · riservato ${fmtKb(r.reservedKb)}`}
                  className={`flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left transition-colors ${
                    sel ? 'bg-sky-950/60 ring-1 ring-sky-700/60' : 'hover:bg-zinc-800/60'
                  }`}
                >
                  <input type="checkbox" checked={sel} readOnly className="h-3.5 w-3.5 accent-sky-500" />
                  <span className="w-56 shrink-0 truncate font-mono text-[11px] text-zinc-300">{nomeTabella(r)}</span>
                  <span className="flex h-3.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-zinc-800/80">
                    <span className="h-full bg-emerald-500/80" style={{ width: quota(r.dataKb) }} />
                    <span className="h-full bg-sky-500/80" style={{ width: quota(r.indexKb) }} />
                    <span className="h-full bg-zinc-600/70" style={{ width: quota(r.unusedKb) }} />
                  </span>
                  <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-zinc-400">
                    {fmtKb(r.reservedKb)}
                  </span>
                  <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-zinc-500">
                    {fmtNum(r.rowCount)} righe
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* PIÈ DI PAGINA: ordinamento, selezione e script di svuotamento */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-zinc-800 px-3 py-2 text-[11px] text-zinc-600">
        <span>
          Ordinamento:{' '}
          <span className="font-semibold text-zinc-400">{COLS.find(c => c.key === sortKey)?.label}</span> (
          {sortDir === 'asc' ? 'crescente' : 'decrescente'}) — clicca sull'intestazione per cambiare.
        </span>
        <span className="flex items-center gap-2">
          <span className="text-zinc-500" data-report="selezionate">
            {scelte.length} selezionate
            {scelte.length > 0 ? ` · ${fmtKb(scelteKb)} su disco` : ''}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={svuota}
            disabled={scelte.length === 0 || !onOpenScript}
            title="Genera un DELETE FROM per ogni tabella selezionata e aprilo in una nuova tab"
          >
            <Trash2 className="h-3.5 w-3.5" /> Svuota il contenuto ({scelte.length})
          </Button>
        </span>
      </div>
    </div>
  )
}
