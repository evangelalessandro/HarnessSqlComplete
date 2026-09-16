// Barra di errore di una query + pulsanti per gli oggetti del database citati nel messaggio.
//
// SQL Server nomina gli oggetti nei suoi errori ("Invalid object name 'dbo.X'",
// "...conflicted with the FOREIGN KEY constraint ... table 'dbo.Y'"). Qui, per ogni oggetto
// che ESISTE nel database, compare un pulsante che lo apre in una nuova tab: "Modifica"
// (CREATE OR ALTER) per routine, viste e trigger, "Apri CREATE" per le tabelle — gli stessi
// script che si ottengono col tasto destro nell'albero.
import { AlertTriangle, ExternalLink } from 'lucide-react'
import type { DatabaseSummary, QueryMessage } from '../types'
import { errorObjectAction, errorObjectButtonLabel, errorObjectKindLabel, objectsInErrorText } from '../sqlMessages'
import type { ErrorObjectRef } from '../sqlMessages'

interface Props {
  /** Testo dell'errore (già con intestazione in stile SSMS). */
  error: string
  /** Schema caricato: serve a riconoscere quali oggetti esistono davvero. */
  summary?: DatabaseSummary | null
  /** Apre l'oggetto citato in una nuova tab. */
  onOpenObject?: (o: ErrorObjectRef) => void
  /** Messaggio strutturato (procedura + riga): serve al doppio clic per andare alla riga. */
  message?: QueryMessage | null
  /** Doppio clic sull'errore: porta il cursore sulla riga indicata da SQL Server. */
  onJumpToLine?: (m: QueryMessage) => void
}

export default function QueryErrorBanner({ error, summary, onOpenObject, message, onJumpToLine }: Props) {
  const oggetti = objectsInErrorText(error, summary)
  const salta = message && onJumpToLine ? () => onJumpToLine(message) : undefined
  return (
    <div
      onDoubleClick={salta}
      title={salta ? 'Doppio clic: vai alla riga indicata da SQL Server' : undefined}
      className={`m-4 flex items-start gap-2 rounded-md border border-rose-800 bg-rose-950/50 p-3 text-sm text-rose-200 ${salta ? 'cursor-pointer hover:bg-rose-950/70' : ''}`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="block whitespace-pre-wrap font-mono">{error}</span>
        {oggetti.length > 0 && onOpenObject && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-rose-400/80">Oggetti citati</span>
            {oggetti.map(o => (
              <button
                key={`${o.kind}-${o.schema}.${o.name}`}
                onClick={() => onOpenObject(o)}
                title={`${errorObjectAction(o)} ${o.schema}.${o.name} (${errorObjectKindLabel(o.kind)}) in una nuova tab`}
                className="inline-flex items-center gap-1 rounded border border-rose-700 bg-rose-900/40 px-2 py-0.5 text-[11px] text-rose-100 transition-colors hover:bg-rose-800/60"
              >
                <ExternalLink className="h-3 w-3" />
                {errorObjectButtonLabel(o)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
