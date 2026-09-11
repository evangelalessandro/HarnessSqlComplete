import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Table2, X } from 'lucide-react'
import { api } from '../api'
import { sortTableReport } from '../helpers'
import type { SortDir, TableReportSortKey } from '../helpers'
import type { TableReportRow } from '../types'
import { Button, Spinner } from './ui'

interface Props {
  connectionId: string
  onClose: () => void
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

/** KB → MB/GB con una cifra decimale. */
export function fmtKb(kb: number): string {
  if (kb >= 1 << 20) return `${(kb / (1 << 20)).toFixed(1)} GB`
  if (kb >= 1 << 10) return `${(kb / (1 << 10)).toFixed(1)} MB`
  return `${kb} KB`
}

export function fmtNum(n: number): string {
  return n.toLocaleString('it-IT')
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
}

export default function TableReportModal({ connectionId, onClose }: Props) {
  const [rows, setRows] = useState<TableReportRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<TableReportSortKey>('reservedKb')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [filter, setFilter] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        setRows(await api.tableReport(connectionId))
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [connectionId])

  const onSort = (key: TableReportSortKey) => {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(key === 'name' || key === 'createDate' || key === 'lastRead' || key === 'lastWrite' ? 'asc' : 'desc')
    }
  }

  const sorted = useMemo(() => {
    if (!rows) return []
    let out = sortTableReport(rows, sortKey, sortDir)
    const f = filter.trim().toLowerCase()
    if (f) out = out.filter(r => `${r.schema}.${r.name}`.toLowerCase().includes(f))
    return out
  }, [rows, sortKey, sortDir, filter])

  const totals = useMemo(() => {
    if (!rows) return { tables: 0, reservedKb: 0, usedKb: 0, rows: 0 }
    return {
      tables: rows.length,
      reservedKb: rows.reduce((a, r) => a + r.reservedKb, 0),
      usedKb: rows.reduce((a, r) => a + r.usedKb, 0),
      rows: rows.reduce((a, r) => a + r.rowCount, 0),
    }
  }, [rows])

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-[min(1180px,96vw)] flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
          <Table2 className="h-5 w-5 text-sky-400" />
          <h2 className="text-sm font-semibold text-zinc-100">Report utilizzo tabelle</h2>
          {rows && (
            <span className="text-xs text-zinc-500">
              {fmtNum(totals.tables)} tabelle · {fmtNum(totals.rows)} righe · {fmtKb(totals.reservedKb)} riservati
            </span>
          )}
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filtra per nome…"
            className="ml-auto w-44 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none"
          />
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            title="Chiudi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {err && (
            <div className="m-4 rounded-md border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{err}</div>
          )}
          {!rows && !err && (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-zinc-500">
              <Spinner /> Caricamento report…
            </div>
          )}
          {rows && (
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-zinc-800/95">
                <tr>
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
                    <td colSpan={COLS.length} className="px-3 py-8 text-center text-zinc-600">
                      Nessuna tabella trovata.
                    </td>
                  </tr>
                )}
                {sorted.map(r => (
                  <tr key={`${r.schema}.${r.name}`} className="border-b border-zinc-800/70 transition-colors hover:bg-sky-950/30">
                    <td className="max-w-64 truncate px-2.5 py-1.5 font-mono text-zinc-200" title={`${r.schema}.${r.name}`}>
                      {r.schema !== 'dbo' ? `${r.schema}.${r.name}` : r.name}
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
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-600">
          <span>
            Ordinamento: <span className="font-semibold text-zinc-400">{COLS.find(c => c.key === sortKey)?.label}</span>{' '}
            ({sortDir === 'asc' ? 'crescente' : 'decrescente'}) — clicca sull'intestazione per cambiare.
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Chiudi
          </Button>
        </div>
      </div>
    </div>
  )
}
