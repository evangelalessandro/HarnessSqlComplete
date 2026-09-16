import { Printer, ExternalLink } from 'lucide-react'
import type { DatabaseSummary, QueryMessage, QueryResult } from '../types'
import {
  errorMessagesByDisplay,
  errorObjectAction,
  errorObjectButtonLabel,
  errorObjectKindLabel,
  errorObjectsFor,
  firstErrorMessage,
  messageHeader,
} from '../sqlMessages'
import type { ErrorObjectRef } from '../sqlMessages'
import { Badge } from './ui'
import QueryErrorBanner from './QueryErrorBanner'

interface Props {
  result: QueryResult | null
  /** Schema caricato: serve a riconoscere gli oggetti citati negli errori. */
  summary?: DatabaseSummary | null
  /** Apre un oggetto citato nell'errore in una nuova tab (Modifica / CREATE). */
  onOpenObject?: (o: ErrorObjectRef) => void
  /** Doppio clic su un errore: porta il cursore sulla riga indicata da SQL Server. */
  onJumpToLine?: (m: QueryMessage) => void
}

export default function PrintPanel({ result, summary, onOpenObject, onJumpToLine }: Props) {
  if (!result) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-600">
        Esegui una query per vedere i messaggi PRINT.
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
            // errore: intestazione in stile SSMS + pulsanti per gli oggetti citati; doppio clic
            // sulla riga → si va alla riga indicata (mappata sulla definizione nella tab)
            const oggetti = errorObjectsFor(err, summary)
            return (
              <div
                key={i}
                onDoubleClick={() => onJumpToLine?.(err)}
                title={onJumpToLine ? 'Doppio clic: vai alla riga indicata da SQL Server' : undefined}
                className={`flex gap-3 border-b border-zinc-900 bg-rose-950/30 py-1 ${onJumpToLine ? 'cursor-pointer hover:bg-rose-950/50' : ''}`}
              >
                <span className="select-none text-rose-700">{String(i + 1).padStart(3, '0')}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-rose-400">{messageHeader(err)}</span>
                  <span className="whitespace-pre-wrap text-rose-200">{err.text}</span>
                  {oggetti.length > 0 && onOpenObject && (
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      {oggetti.map(o => (
                        <button
                          key={`${o.kind}-${o.schema}.${o.name}`}
                          onClick={() => onOpenObject(o)}
                          title={`${errorObjectAction(o)} ${o.schema}.${o.name} (${errorObjectKindLabel(o.kind)}) in una nuova tab`}
                          className="inline-flex items-center gap-1 rounded border border-rose-800 px-1.5 py-0.5 text-[11px] text-rose-300 transition-colors hover:bg-rose-900/40"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {errorObjectButtonLabel(o)}
                        </button>
                      ))}
                    </span>
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
