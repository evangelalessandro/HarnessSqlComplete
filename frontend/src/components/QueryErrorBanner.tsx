// Barra di errore di una query + pulsanti per gli oggetti del database citati nel messaggio.
//
// SQL Server nomina gli oggetti nei suoi errori ("Invalid object name 'dbo.X'",
// "...conflicted with the FOREIGN KEY constraint ... table 'dbo.Y'"). Qui, per ogni oggetto
// che ESISTE nel database, compare un pulsante che lo apre in una nuova tab: "Modifica"
// (CREATE OR ALTER) per routine, viste e trigger, "Apri CREATE" per le tabelle — gli stessi
// script che si ottengono col tasto destro nell'albero.
import { AlertTriangle, ExternalLink } from 'lucide-react'
import type { DatabaseSummary } from '../types'
import { errorObjectAction, errorObjectKindLabel, objectsInErrorText } from '../sqlMessages'
import type { ErrorObjectRef } from '../sqlMessages'

interface Props {
  /** Testo dell'errore (già con intestazione in stile SSMS). */
  error: string
  /** Schema caricato: serve a riconoscere quali oggetti esistono davvero. */
  summary?: DatabaseSummary | null
  /** Apre l'oggetto citato in una nuova tab. */
  onOpenObject?: (o: ErrorObjectRef) => void
}

export default function QueryErrorBanner({ error, summary, onOpenObject }: Props) {
  const oggetti = objectsInErrorText(error, summary)
  return (
    <div className="m-4 flex items-start gap-2 rounded-md border border-rose-800 bg-rose-950/50 p-3 text-sm text-rose-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="whitespace-pre-wrap font-mono">{error}</span>
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
                {errorObjectAction(o)} {o.schema}.{o.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
