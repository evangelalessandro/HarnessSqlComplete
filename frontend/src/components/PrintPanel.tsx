import { AlertTriangle, Printer } from 'lucide-react'
import type { QueryResult } from '../types'
import { errorMessagesByDisplay, messageHeader } from '../sqlMessages'
import { Badge } from './ui'

interface Props {
  result: QueryResult | null
  /** Apre la definizione di una procedura citata nell'errore (nuova tab, CREATE OR ALTER). */
  onOpenProcedure?: (name: string) => void
}

export default function PrintPanel({ result, onOpenProcedure }: Props) {
  if (!result) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-600">
        Esegui una query per vedere i messaggi PRINT.
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
  // messaggi che sono errori: si riconoscono dal testo già composto dal backend
  const errorByDisplay = errorMessagesByDisplay(result.errors)
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-400">
        <Printer className="h-3.5 w-3.5" />
        Messaggi (PRINT / output)
        <span className="ml-auto flex items-center gap-2">
          {errorByDisplay.size > 0 && (
            <Badge tone="rose">
              {errorByDisplay.size === 1 ? '1 errore' : `${errorByDisplay.size} errori`}
            </Badge>
          )}
          {result.totalAffectedRows > 0 && (
            <Badge tone="amber">{result.totalAffectedRows.toLocaleString('it-IT')} righe modificate</Badge>
          )}
          <Badge tone="zinc">{(result.elapsedMs / 1000).toFixed(2)} s</Badge>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-zinc-950 p-3 font-mono text-[13px]">
        {result.messages.length === 0 ? (
          <span className="text-zinc-600">Nessun messaggio (PRINT) prodotto dall'esecuzione.</span>
        ) : (
          result.messages.map((m, i) => {
            const err = errorByDisplay.get(m)
            if (!err) {
              return (
                <div key={i} className="flex gap-3 border-b border-zinc-900 py-1">
                  <span className="select-none text-zinc-600">{String(i + 1).padStart(3, '0')}</span>
                  <span className="whitespace-pre-wrap text-emerald-300">{m}</span>
                </div>
              )
            }
            // errore: intestazione in stile SSMS con la PROCEDURA in evidenza (cliccabile)
            return (
              <div key={i} className="flex gap-3 border-b border-zinc-900 bg-rose-950/30 py-1">
                <span className="select-none text-rose-700">{String(i + 1).padStart(3, '0')}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-rose-400">{messageHeader(err)}</span>
                  <span className="whitespace-pre-wrap text-rose-200">{err.text}</span>
                  {err.procedure && onOpenProcedure && (
                    <button
                      onClick={() => onOpenProcedure(err.procedure!)}
                      className="mt-0.5 rounded border border-rose-800 px-1.5 py-0.5 text-[11px] text-rose-300 transition-colors hover:bg-rose-900/40"
                      title={`Apri ${err.procedure} in una nuova tab (CREATE OR ALTER)`}
                    >
                      Apri {err.procedure}
                    </button>
                  )}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
