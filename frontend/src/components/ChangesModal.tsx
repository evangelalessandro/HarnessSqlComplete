import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, History, RefreshCw, X } from 'lucide-react'
import { api } from '../api'
import {
  TIPI_MODIFICA,
  contaPerTipo,
  etichettaTipo,
  filtraModifiche,
  formatDataOra,
  formatGiorno,
  modificatoOggi,
  nomeModifica,
  ordinaModifiche,
  quantoFa,
  riepilogoModifiche,
  tipoDaCodice,
  tipoOggettoApp,
} from '../changes'
import type { ChiaveOrdine, FinestraPeriodo, TipoModifica, VersoOrdine } from '../changes'
import type { ObjectChangeRow } from '../types'
import { Badge, Button, Spinner } from './ui'

interface Props {
  connectionId: string
  database: string
  onClose: () => void
  /** Doppio clic su una riga: apre l'oggetto (CREATE OR ALTER) come dal tasto destro. */
  onOpenObject?: (kind: 'procedure' | 'function' | 'view' | 'trigger', schema: string, name: string) => void
}

const COLS: { key: ChiaveOrdine; label: string; cls?: string }[] = [
  { key: 'modifiedAt', label: 'Modificato il', cls: 'w-44' },
  { key: 'name', label: 'Oggetto' },
  { key: 'tipo', label: 'Tipo', cls: 'w-24' },
  { key: 'schema', label: 'Schema', cls: 'w-24' },
  { key: 'createdAt', label: 'Creato il', cls: 'w-44' },
]

/** Ogni quanto "quanto fa" viene ricalcolato mentre la finestra è aperta. */
const OGNI_QUANTO = 60_000

/**
 * FINESTRA "MODIFICHE": la griglia degli oggetti del database con giorno e ora dell'ultima
 * modifica (e della creazione). Si ordina cliccando le intestazioni, si filtra per nome, tipo e
 * periodo; doppio clic su una riga apre l'oggetto per modificarlo.
 */
export default function ChangesModal({ connectionId, database, onClose, onOpenObject }: Props) {
  const [righe, setRighe] = useState<ObjectChangeRow[] | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [caricando, setCaricando] = useState(false)
  const [chiave, setChiave] = useState<ChiaveOrdine>('modifiedAt')
  const [verso, setVerso] = useState<VersoOrdine>('desc')
  const [testo, setTesto] = useState('')
  const [tipi, setTipi] = useState<TipoModifica[]>([])
  const [periodo, setPeriodo] = useState<FinestraPeriodo>('tutto')
  const [adesso, setAdesso] = useState(() => new Date())

  const carica = async () => {
    setCaricando(true)
    setErrore(null)
    try {
      setRighe(await api.objectChanges(connectionId))
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e))
    } finally {
      setCaricando(false)
    }
  }

  useEffect(() => {
    void carica()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId])

  // l'età relativa ("5 minuti fa") va tenuta viva mentre la finestra è aperta
  useEffect(() => {
    const t = setInterval(() => setAdesso(new Date()), OGNI_QUANTO)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const visibili = useMemo(
    () => ordinaModifiche(filtraModifiche(righe ?? [], { testo, tipi, periodo }, adesso), chiave, verso),
    [righe, testo, tipi, periodo, chiave, verso, adesso],
  )

  const conteggi = useMemo(() => contaPerTipo(righe ?? []), [righe])

  const ordina = (k: ChiaveOrdine) => {
    if (k === chiave) setVerso(v => (v === 'asc' ? 'desc' : 'asc'))
    else {
      setChiave(k)
      setVerso(k === 'modifiedAt' || k === 'createdAt' ? 'desc' : 'asc')
    }
  }

  const alternaTipo = (t: TipoModifica) =>
    setTipi(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]))

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      data-modifiche="finestra"
    >
      <div
        className="flex max-h-[92vh] w-[min(1100px,96vw)] flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
          <History className="h-5 w-5 text-amber-400" />
          <h2 className="text-sm font-semibold text-zinc-100">Modifiche agli oggetti</h2>
          <span className="text-xs text-zinc-500" data-modifiche="riepilogo">
            {database}
            {righe ? ` — ${riepilogoModifiche(righe, adesso)}` : ''}
          </span>
          <input
            value={testo}
            onChange={e => setTesto(e.target.value)}
            placeholder="Filtra per nome…"
            data-modifiche="filtro"
            className="ml-auto w-52 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none"
          />
          <select
            value={periodo}
            onChange={e => setPeriodo(e.target.value as FinestraPeriodo)}
            data-modifiche="periodo"
            className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 focus:border-sky-500 focus:outline-none"
            title="Mostra solo le modifiche degli ultimi…"
          >
            <option value="tutto">Sempre</option>
            <option value="1">Ultime 24 ore</option>
            <option value="7">Ultimi 7 giorni</option>
            <option value="30">Ultimi 30 giorni</option>
          </select>
          <button
            onClick={() => void carica()}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            title="Ricarica l'elenco"
            data-modifiche="ricarica"
          >
            <RefreshCw className={`h-4 w-4 ${caricando ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            title="Chiudi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* filtri per tipo, con il conteggio: si possono combinare fra loro */}
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-zinc-800 px-4 py-1.5 text-xs">
          <button
            onClick={() => setTipi([])}
            className={`rounded-full border px-2 py-0.5 transition-colors ${
              tipi.length === 0
                ? 'border-sky-600 bg-sky-950/50 text-sky-300'
                : 'border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
            }`}
            data-modifiche="tipo-tutti"
          >
            Tutti {righe ? righe.length : ''}
          </button>
          {TIPI_MODIFICA.map(t => (
            <button
              key={t}
              onClick={() => alternaTipo(t)}
              className={`rounded-full border px-2 py-0.5 transition-colors ${
                tipi.includes(t)
                  ? 'border-sky-600 bg-sky-950/50 text-sky-300'
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
              }`}
              data-modifiche={`tipo-${t}`}
            >
              {etichettaTipo(t)} {conteggi[t]}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {errore && (
            <div className="m-4 rounded-md border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">
              {errore}
            </div>
          )}
          {!righe && !errore && (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-zinc-500">
              <Spinner /> Caricamento modifiche…
            </div>
          )}
          {righe && (
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-zinc-800/95">
                <tr>
                  {COLS.map(c => (
                    <th
                      key={c.key}
                      onClick={() => ordina(c.key)}
                      className={`cursor-pointer select-none whitespace-nowrap border-b border-zinc-700 px-2.5 py-2 text-left font-semibold text-zinc-300 transition-colors hover:bg-zinc-700/60 hover:text-white ${c.cls ?? ''}`}
                      title="Clicca per ordinare"
                      data-modifiche={`col-${c.key}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.label}
                        {chiave === c.key ? (
                          verso === 'asc' ? (
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
                  <th className="border-b border-zinc-700 px-2.5 py-2 text-left font-semibold text-zinc-300">
                    Quando
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibili.length === 0 && (
                  <tr>
                    <td colSpan={COLS.length + 1} className="px-3 py-8 text-center text-zinc-600">
                      Nessun oggetto trovato con questi filtri.
                    </td>
                  </tr>
                )}
                {visibili.map(r => {
                  const tipo = tipoDaCodice(r.typeCode)
                  const apribile = onOpenObject ? tipoOggettoApp(tipo ?? 'tabella') : null
                  return (
                    <tr
                      key={`${r.typeCode}-${r.schema}.${r.name}`}
                      onDoubleClick={() => {
                        if (!onOpenObject || !apribile) return
                        onOpenObject(apribile, r.schema, r.name)
                        onClose()
                      }}
                      className={`border-b border-zinc-800/70 transition-colors hover:bg-sky-950/30 ${
                        apribile ? 'cursor-pointer' : ''
                      }`}
                      title={apribile ? 'Doppio clic per aprire e modificare' : undefined}
                      data-modifiche="riga"
                    >
                      <td
                        className={`whitespace-nowrap px-2.5 py-1.5 font-mono ${
                          modificatoOggi(r.modifiedAt, adesso) ? 'text-emerald-300' : 'text-zinc-300'
                        }`}
                        data-modifiche="data"
                      >
                        {formatDataOra(r.modifiedAt)}
                      </td>
                      <td className="max-w-80 truncate px-2.5 py-1.5 font-mono text-zinc-200" title={`${r.schema}.${r.name}`}>
                        {nomeModifica(r)}
                      </td>
                      <td className="px-2.5 py-1.5">
                        {tipo ? <Badge tone="zinc">{tipo}</Badge> : <span className="text-zinc-500">{r.typeCode}</span>}
                      </td>
                      <td className="px-2.5 py-1.5 text-zinc-400">{r.schema}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-zinc-500">
                        {formatDataOra(r.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-zinc-400">{quantoFa(r.modifiedAt, adesso)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-600">
          <span data-modifiche="conteggio">
            {righe
              ? `${visibili.length} di ${righe.length} oggetti${visibili.length > 0 ? ` — giorno più recente: ${formatGiorno(visibili[0]?.modifiedAt ?? null)}` : ''}`
              : 'Lettura delle date da SQL Server…'}
          </span>
          <span className="flex items-center gap-2">
            <span className="hidden sm:inline">
              Ordinato per <span className="font-semibold text-zinc-400">{COLS.find(c => c.key === chiave)?.label}</span>{' '}
              ({verso === 'asc' ? 'crescente' : 'decrescente'})
            </span>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Chiudi
            </Button>
          </span>
        </div>
      </div>
    </div>
  )
}
