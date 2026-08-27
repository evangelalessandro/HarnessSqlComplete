// Pannello di DEBUG delle chiamate SQL: esegue lo script batch per batch su una
// connessione PERSISTENTE (come farebbe Visual Studio). Variabili, tabelle #temp e
// transazioni restano vive tra i passi. Ad ogni STEP si vedono risultati e messaggi
// (con SET STATISTICS TIME/IO ON → CPU/tempo e letture logiche di ogni statement).
import { useEffect, useRef, useState } from 'react'
import { Bug, ChevronRight, RotateCcw, SkipForward, X } from 'lucide-react'
import { api } from '../api'
import type { CellValue, DebugBatchInfo, DebugStepResponse } from '../types'
import { Badge, Button, Spinner } from './ui'

interface Props {
  connectionId: string
  sql: string
  onClose: () => void
}

const ERROR_HINT = /sintassi non corretta|non è stato possibile|errore|non valido|violazione/i

export default function DebugPanel({ connectionId, sql, onClose }: Props) {
  const [batches, setBatches] = useState<DebugBatchInfo[]>([])
  const [current, setCurrent] = useState(-1) // indice dell'ultimo batch eseguito (-1 = nessuno)
  const [steps, setSteps] = useState<Record<number, DebugStepResponse>>({})
  const [busy, setBusy] = useState(false)
  const [fatal, setFatal] = useState<string | null>(null)
  const seq = useRef(0)

  const stopSession = async () => {
    try {
      await api.debugStop(connectionId)
    } catch {
      /* ignora */
    }
  }

  const start = async () => {
    const s = ++seq.current
    setBusy(true)
    setFatal(null)
    try {
      const res = await api.debugStart(connectionId, sql)
      if (s !== seq.current) return
      setBatches(res.batches)
      setCurrent(-1)
      setSteps({})
    } catch (e) {
      if (s !== seq.current) return
      setFatal(e instanceof Error ? e.message : String(e))
    } finally {
      if (s === seq.current) setBusy(false)
    }
  }

  // avvio automatico all'apertura
  useEffect(() => {
    void start()
    return () => {
      seq.current++
      void stopSession()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, sql])

  const step = async () => {
    const s = ++seq.current
    setBusy(true)
    try {
      const res = await api.debugStep(connectionId)
      if (s !== seq.current) return
      setCurrent(res.currentIndex)
      setSteps(prev => ({ ...prev, [res.currentIndex]: res }))
    } catch (e) {
      if (s !== seq.current) return
      setFatal(e instanceof Error ? e.message : String(e))
    } finally {
      if (s === seq.current) setBusy(false)
    }
  }

  const runAll = async () => {
    const s = ++seq.current
    setBusy(true)
    try {
      const res = await api.debugRun(connectionId)
      if (s !== seq.current) return
      let last = -1
      const map: Record<number, DebugStepResponse> = {}
      for (const st of res.steps) {
        map[st.currentIndex] = st
        last = st.currentIndex
      }
      setSteps(map)
      setCurrent(last)
    } catch (e) {
      if (s !== seq.current) return
      setFatal(e instanceof Error ? e.message : String(e))
    } finally {
      if (s === seq.current) setBusy(false)
    }
  }

  const reset = async () => {
    seq.current++
    await stopSession()
    void start()
  }

  const close = async () => {
    seq.current++
    await stopSession()
    onClose()
  }

  const done = batches.length > 0 && current >= batches.length - 1
  const lastStep = current >= 0 ? steps[current] : undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Barra controlli */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-300">
        <Bug className="h-3.5 w-3.5 text-amber-400" />
        <span className="font-medium">Debug batch per batch</span>
        <Badge tone="zinc">
          {batches.length === 0 ? 'avvio…' : `passo ${current + 1} di ${batches.length}`}
        </Badge>
        <div className="ml-auto flex items-center gap-1.5">
          {busy && <Spinner />}
          <Button size="sm" onClick={() => void step()} disabled={busy || done || batches.length === 0} title="Esegue il batch successivo">
            <SkipForward className="h-3.5 w-3.5" /> Passo
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void runAll()} disabled={busy || done || batches.length === 0} title="Esegue tutti i batch rimanenti">
            <ChevronRight className="h-3.5 w-3.5" /> Esegui tutto
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void reset()} disabled={busy} title="Riavvia la sessione (nuova connessione)">
            <RotateCcw className="h-3.5 w-3.5" /> Ripristina
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void close()} title="Chiudi il debug (chiude la connessione)">
            <X className="h-3.5 w-3.5" /> Chiudi
          </Button>
        </div>
      </div>

      {fatal && (
        <div className="border-b border-rose-800 bg-rose-950/50 px-3 py-2 text-sm text-rose-200">{fatal}</div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Elenco batch */}
        <div className="w-64 shrink-0 overflow-auto border-r border-zinc-800">
          {batches.map((b, i) => {
            const st = steps[i]
            const isCurrent = i === current
            const isNext = i === current + 1 && !done
            const hasError = st?.error || (st?.messages ?? []).some(m => ERROR_HINT.test(m))
            return (
              <div
                key={i}
                className={`border-b border-zinc-800/60 px-2 py-1.5 ${
                  isCurrent ? 'bg-amber-950/40' : isNext ? 'bg-sky-950/40' : ''
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      hasError ? 'bg-rose-500' : st ? 'bg-emerald-500' : isNext ? 'bg-sky-400' : 'bg-zinc-700'
                    }`}
                  />
                  <span className="font-mono text-[11px] text-zinc-400">riga {b.startLine}</span>
                  {isCurrent && <Badge tone="amber">corrente</Badge>}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-300" title={b.text}>
                  {b.text.split('\n')[0]}
                </div>
              </div>
            )
          })}
        </div>

        {/* Risultati del passo corrente */}
        <div className="min-w-0 flex-1 overflow-auto">
          {busy && current === -1 && !lastStep ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-400">
              <Spinner /> Preparazione sessione di debug…
            </div>
          ) : !lastStep ? (
            <div className="flex h-full items-center justify-center px-6 text-sm text-zinc-500">
              Premi <b className="mx-1">Passo</b> per eseguire il primo batch: vedrai risultati e messaggi (con
              STATISTICS TIME/IO) batch dopo batch.
            </div>
          ) : (
            <div className="p-3">
              <div className="mb-2 flex items-center gap-2">
                <Badge tone={lastStep.error || lastStep.messages.some(m => ERROR_HINT.test(m)) ? 'rose' : 'emerald'}>
                  {lastStep.error ? 'ERRORE' : `Batch ${lastStep.currentIndex + 1}/${lastStep.batchCount}`}
                </Badge>
                {lastStep.error && <span className="whitespace-pre-wrap font-mono text-xs text-rose-300">{lastStep.error}</span>}
              </div>
              {lastStep.resultSets.map((set, si) => (
                <div key={si} className="mb-3 overflow-auto rounded border border-zinc-800">
                  <table className="w-full border-collapse text-left text-[12px]">
                    <thead>
                      <tr>
                        {set.columns.map((c, ci) => (
                          <th key={ci} className="border-b border-zinc-700 bg-zinc-800 px-2 py-1 font-semibold text-zinc-100">
                            {c.name} <span className="font-normal text-zinc-500">{c.dataType}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {set.rows.map((row, ri) => (
                        <tr key={ri} className={ri % 2 ? 'bg-zinc-900/50' : 'bg-zinc-950'}>
                          {row.map((cell, ci) => (
                            <DebugCell key={ci} value={cell} />
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {lastStep.messages.length > 0 && (
                <div className="rounded border border-zinc-800 bg-zinc-950 p-2">
                  {lastStep.messages.map((m, i) => (
                    <div
                      key={i}
                      className={`whitespace-pre-wrap font-mono text-[11px] ${
                        ERROR_HINT.test(m) ? 'text-rose-300' : 'text-zinc-400'
                      }`}
                    >
                      {m}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DebugCell({ value }: { value: CellValue }) {
  if (value === null || value === undefined) {
    return <td className="border-b border-zinc-800/60 px-2 py-1 italic text-zinc-600">NULL</td>
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return (
    <td className="max-w-[320px] truncate border-b border-zinc-800/60 px-2 py-1 font-mono text-zinc-200" title={text}>
      {text}
    </td>
  )
}
