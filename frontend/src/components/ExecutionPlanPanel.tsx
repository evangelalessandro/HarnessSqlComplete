// PIANO DI ESECUZIONE (pannello): operatori del piano stimato e indici suggeriti con lo script pronto.
// Richiesta utente: "piano di esecuzione + indice suggerito".
import { Activity, AlertTriangle, Database, Loader2, X } from 'lucide-react'
import type { PianoEsecuzione } from '../executionPlan'

export default function ExecutionPlanPanel({
  piano,
  inCorso,
  errore,
  altriStatement,
  onClose,
  onApriScript,
}: {
  piano: PianoEsecuzione | null
  inCorso: boolean
  /** Errore di SQL Server (di solito un errore di sintassi) o messaggio di "nessun piano". */
  errore: string | null
  /** Quanti altri statement c'erano nel testo (si mostra il più costoso). */
  altriStatement: number
  onClose: () => void
  onApriScript: (titolo: string, sql: string) => void
}) {
  const costoMax = piano ? Math.max(...piano.nodi.map(n => n.costo), 0.000001) : 1
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 p-6" data-piano="pannello">
      <div className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/80 px-4 py-2.5">
          <Activity className="h-4 w-4 text-sky-400" />
          <span className="text-sm font-semibold text-zinc-100">Piano di esecuzione</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
            stimato
          </span>
          <span className="text-[11px] text-zinc-500">la query NON è stata eseguita</span>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            title="Chiudi (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {inCorso && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Chiedo il piano a SQL Server (senza eseguire la query)…
            </div>
          )}

          {!inCorso && errore && (
            <div className="flex items-start gap-2 rounded border border-rose-900 bg-rose-950/50 p-3 text-xs text-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <pre className="whitespace-pre-wrap font-mono">{errore}</pre>
            </div>
          )}

          {!inCorso && piano && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
                <span>
                  Costo stimato: <b className="text-zinc-200">{piano.costo.toFixed(4)}</b>
                </span>
                <span>
                  Operatori: <b className="text-zinc-200">{piano.nodi.length}</b>
                </span>
                {altriStatement > 0 && (
                  <span className="text-zinc-500">
                    (nel testo c'erano altri {altriStatement} statement: mostrato quello più costoso)
                  </span>
                )}
              </div>
              {piano.statement && (
                <pre className="mb-3 max-h-20 overflow-auto rounded border border-zinc-800 bg-zinc-950/60 p-2 font-mono text-[11px] text-zinc-400">
                  {piano.statement}
                </pre>
              )}

              <div className="mb-4 overflow-hidden rounded border border-zinc-800">
                <div className="grid grid-cols-[1fr_auto_auto_90px] gap-2 border-b border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  <span>Operatore</span>
                  <span>Oggetto</span>
                  <span className="text-right">Righe stimate</span>
                  <span className="text-right">Costo</span>
                </div>
                {piano.nodi.map((n, i) => (
                  <div
                    key={`${i}-${n.operatore}-${n.oggetto ?? ''}`}
                    data-piano-nodo={n.operatore}
                    className="grid grid-cols-[1fr_auto_auto_90px] items-center gap-2 border-b border-zinc-800/60 px-2 py-0.5 text-xs text-zinc-300 last:border-b-0"
                  >
                    <span className="min-w-0 truncate" style={{ paddingLeft: n.profondita * 14 }} title={n.logico ?? n.operatore}>
                      {n.profondita > 0 && <span className="text-zinc-600">└ </span>}
                      <span className={/scan/i.test(n.operatore) ? 'text-amber-300' : /seek/i.test(n.operatore) ? 'text-emerald-300' : ''}>
                        {n.operatore}
                      </span>
                    </span>
                    <span className="font-mono text-[11px] text-zinc-500">{n.oggetto ?? ''}</span>
                    <span className="text-right font-mono text-[11px] text-zinc-400">{n.righe === null ? '—' : n.righe.toFixed(0)}</span>
                    <span className="flex items-center justify-end gap-1">
                      <span className="h-1.5 rounded bg-sky-500/70" style={{ width: `${Math.max(2, (n.costo / costoMax) * 46)}px` }} />
                      <span className="w-10 text-right font-mono text-[10px] text-zinc-500">{n.costo.toFixed(4)}</span>
                    </span>
                  </div>
                ))}
              </div>

              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Indici suggeriti</div>
              {piano.indici.length === 0 ? (
                <p className="text-xs text-zinc-500" data-piano-indici="nessuno">
                  Nessun indice suggerito da SQL Server per questo piano (spesso vuol dire che gli indici
                  esistenti bastano, o che la tabella è abbastanza piccola).
                </p>
              ) : (
                <div className="space-y-3">
                  {piano.indici.map((ind, i) => (
                    <div key={`${ind.schema}.${ind.tabella}-${i}`} className="rounded border border-amber-900/70 bg-amber-950/20 p-2" data-piano-indice={ind.tabella}>
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-amber-200">
                        <Database className="h-3.5 w-3.5" />
                        <span className="font-mono">{ind.schema}.{ind.tabella}</span>
                        <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-semibold">
                          impatto stimato {ind.impatto.toFixed(1)}%
                        </span>
                        <button
                          onClick={() => onApriScript(`Indice ${ind.tabella}`, ind.script)}
                          className="ml-auto rounded border border-amber-700 px-2 py-0.5 text-[11px] font-medium text-amber-100 transition-colors hover:bg-amber-900/60"
                        >
                          Apri in una tab
                        </button>
                      </div>
                      <pre className="overflow-x-auto rounded bg-zinc-950/70 p-2 font-mono text-[11px] text-zinc-300" data-piano-script>
                        {ind.script}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-zinc-800 bg-zinc-900/80 px-4 py-2 text-[11px] text-zinc-500">
          <span>Piano STIMATO (SET SHOWPLAN_XML ON): nessun dato letto o modificato.</span>
          <button
            onClick={onClose}
            className="ml-auto rounded bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  )
}
