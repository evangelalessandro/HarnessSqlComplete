// RICERCA GENERALE NEL DATABASE (stile Redgate SQL Search): si cerca un testo nei NOMI e nelle
// DEFINIZIONI delle strutture e, se richiesto, nei DATI delle tabelle. I risultati stanno sopra,
// l'ANTEPRIMA (script con il match evidenziato, colonne o riga trovata) sotto.
// La ricerca è ristretta al database della connessione attiva: nessuna query su altri database.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Database as DbIcon,
  FileCode2,
  Loader2,
  Pencil,
  Search,
  Share2,
  X,
} from 'lucide-react'
import { api } from '../api'
import { Badge, inputClass } from './ui'
import {
  canEdit,
  canPreviewColumns,
  canPreviewDefinition,
  countByKind,
  editableKind,
  hitKey,
  hitTitle,
  kindLabel,
  kindTone,
  matchLabel,
  searchMeta,
  splitHighlight,
  tableOfHit,
} from '../sqlSearch'
import type { DatabaseSummary, TextSearchHit, TextSearchResult } from '../types'

interface Props {
  connectionId: string
  /** Database su cui si sta cercando (mostrato in alto: la ricerca NON esce da qui). */
  database: string
  /** Sommario dello schema: serve per l'anteprima delle tabelle e delle colonne. */
  summary: DatabaseSummary | null
  /** Chiude la ricerca (la tab si chiude con la sua "×"): se assente non c'è il pulsante. */
  onClose?: () => void
  /** Apre l'oggetto trovato in una nuova tab (figlia di quella attiva), come dal tasto destro. */
  onOpenObject: (kind: 'procedure' | 'function' | 'view' | 'trigger', schema: string, name: string, mode: 'alter' | 'open') => void
  /** Apre il diagramma delle chiamate della routine trovata. */
  onShowCallGraph?: (schema: string, name: string, kind: 'procedure' | 'function') => void
}

/** Voce del menu col tasto destro sui risultati. */
const VOCE_MENU =
  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-zinc-800'

/** Evidenzia le occorrenze del testo cercato dentro una riga. */
function Evidenzia({ testo, cerca }: { testo: string; cerca: string }) {
  return (
    <>
      {splitHighlight(testo, cerca).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded bg-amber-500/30 px-0.5 text-amber-100">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}

export default function SearchPanel({ connectionId, database, summary, onClose, onOpenObject, onShowCallGraph }: Props) {
  const [testo, setTesto] = useState('')
  const [conDati, setConDati] = useState(false)
  const [esito, setEsito] = useState<TextSearchResult | null>(null)
  const [cercando, setCercando] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [scelto, setScelto] = useState<TextSearchHit | null>(null)
  /** Menu col tasto destro su un risultato (stile SSMS): Modifica / Apri definizione / Diagramma. */
  const [menu, setMenu] = useState<{ hit: TextSearchHit; x: number; y: number } | null>(null)
  // definizione dell'oggetto scelto (per l'anteprima), caricata su richiesta
  const [definizione, setDefinizione] = useState<{ testo: string; caricando: boolean; errore: string | null }>({
    testo: '',
    caricando: false,
    errore: null,
  })
  const inputRef = useRef<HTMLInputElement | null>(null)
  const anteprimaRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // La ricerca vive in una TAB: non si chiude con Esc (si chiude con la "×" della tab).

  const cerca = useCallback(async () => {
    const q = testo.trim()
    if (q.length < 2) {
      setErrore('Scrivi almeno 2 caratteri.')
      return
    }
    setErrore(null)
    setCercando(true)
    try {
      const r = await api.textSearch(connectionId, q, conDati)
      setEsito(r)
      setScelto(r.hits[0] ?? null)
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e))
      setEsito(null)
      setScelto(null)
    } finally {
      setCercando(false)
    }
  }, [testo, conDati, connectionId])

  /**
   * MODIFICA dalla ricerca: apre la stored procedure / funzione / vista / trigger in una tab,
   * con la stessa azione della voce "Modifica" del tasto destro nell'albero
   * ('alter' = CREATE OR ALTER, 'open' = definizione originale). La tab nasce figlia di quella attiva.
   */
  const apri = useCallback(
    (hit: TextSearchHit, mode: 'alter' | 'open') => {
      const kind = editableKind(hit.kind)
      if (!kind) return
      onOpenObject(kind, hit.schema, hit.name, mode)
    },
    [onOpenObject],
  )

  // l'anteprima della definizione si carica quando si sceglie un oggetto con script
  useEffect(() => {
    if (!scelto || !canPreviewDefinition(scelto.kind)) {
      setDefinizione({ testo: '', caricando: false, errore: null })
      return
    }
    let vivo = true
    setDefinizione({ testo: '', caricando: true, errore: null })
    void api
      .getObjectDefinition(connectionId, scelto.schema, scelto.name)
      .then(r => {
        if (vivo) setDefinizione({ testo: r.definition ?? '', caricando: false, errore: null })
      })
      .catch(e => {
        if (vivo) setDefinizione({ testo: '', caricando: false, errore: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      vivo = false
    }
  }, [scelto, connectionId])

  // la riga trovata va mostrata subito: si scorre l'anteprima fino a lì
  useEffect(() => {
    if (!scelto?.line) return
    const el = anteprimaRef.current?.querySelector<HTMLElement>(`[data-riga="${scelto.line}"]`)
    el?.scrollIntoView({ block: 'center' })
  }, [scelto, definizione.testo])

  /** Colonne della tabella per l'anteprima dei risultati "tabella"/"colonna". */
  const colonneTabella = useMemo(() => {
    if (!scelto) return null
    const nome = tableOfHit(scelto)
    const t = summary?.tables.find(x => x.name.toLowerCase() === nome.toLowerCase())
    return t?.columns ?? null
  }, [scelto, summary])

  const righeDefinizione = useMemo(() => definizione.testo.split('\n'), [definizione.testo])

  return (
    <div
      data-ricerca="pannello"
      className="flex h-full min-h-0 flex-col overflow-hidden border border-zinc-800 bg-zinc-900"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* intestazione */}
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <Search className="h-4 w-4 text-sky-400" />
          <span className="text-sm font-semibold text-zinc-100">Ricerca nel database</span>
          <span className="flex items-center gap-1 text-[11px] text-zinc-500" title="La ricerca resta dentro questo database">
            <DbIcon className="h-3 w-3" />
            {database}
          </span>
          {onClose && (
            <button onClick={onClose} className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" title="Chiudi la ricerca">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* barra di ricerca */}
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <input
            ref={inputRef}
            value={testo}
            onChange={e => setTesto(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void cerca()
            }}
            placeholder="Testo da cercare in nomi, definizioni e (opzionale) dati…"
            className={`${inputClass} min-w-64 flex-1`}
          />
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400" title="Cerca anche nei valori delle colonne di testo: può essere lento, la scansione è limitata">
            <input
              type="checkbox"
              data-ricerca="dati"
              checked={conDati}
              onChange={e => setConDati(e.target.checked)}
              className="accent-sky-600"
            />
            anche nei dati
          </label>
          <button
            data-ricerca="cerca"
            onClick={() => void cerca()}
            disabled={cercando}
            className="flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {cercando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Cerca
          </button>
        </div>

        {errore && <div className="border-b border-rose-900 bg-rose-950/60 px-3 py-1.5 text-xs text-rose-200">{errore}</div>}

        {/* risultati */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-500" data-ricerca="meta">
            {esito ? (
              <>
                <span>{searchMeta(esito, conDati)}</span>
                {esito.hits.length > 0 && <span className="text-zinc-600">· {countByKind(esito.hits)}</span>}
              </>
            ) : (
              <span>Nessuna ricerca ancora eseguita.</span>
            )}
          </div>

          <div className="max-h-[38%] min-h-24 overflow-y-auto" data-ricerca="risultati">
            {esito?.hits.length === 0 && (
              <p className="p-4 text-xs text-zinc-500">
                {esito.message ? esito.message : `Nessun risultato per “${testo}”.`}
              </p>
            )}
            {esito?.hits.map(h => {
              const attivo = scelto && hitKey(scelto) === hitKey(h)
              return (
                <button
                  key={hitKey(h)}
                  data-ricerca="riga"
                  onClick={() => setScelto(h)}
                  onDoubleClick={() => apri(h, 'alter')}
                  onContextMenu={e => {
                    e.preventDefault()
                    setScelto(h)
                    setMenu({
                      hit: h,
                      x: Math.min(e.clientX, window.innerWidth - 260),
                      y: Math.min(e.clientY, window.innerHeight - 170),
                    })
                  }}
                  title={canEdit(h.kind) ? 'Doppio clic: Modifica (CREATE OR ALTER) — tasto destro: azioni' : undefined}
                  className={`flex w-full items-start gap-2 border-b border-zinc-800/60 px-3 py-1.5 text-left transition-colors ${
                    attivo ? 'bg-sky-950/50' : 'hover:bg-zinc-800/50'
                  }`}
                >
                  <Badge tone={kindTone(h.kind)} className="mt-0.5 shrink-0">
                    {kindLabel(h.kind)}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs text-zinc-200">
                      {hitTitle(h)}
                      {h.line ? <span className="text-zinc-500"> : {h.line}</span> : null}
                    </span>
                    <span className="block truncate text-[11px] text-zinc-500">
                      {h.detail}
                      {h.snippet ? ` — ${h.snippet}` : ''}
                    </span>
                  </span>
                  <span className="mt-0.5 shrink-0 text-[10px] text-zinc-600">{matchLabel(h.matchIn)}</span>
                </button>
              )
            })}
          </div>

          {/* ANTEPRIMA (sotto i risultati) */}
          <div
            ref={anteprimaRef}
            data-ricerca="anteprima"
            className="min-h-0 flex-1 overflow-auto border-t border-zinc-700 bg-zinc-950/60 p-3"
          >
            {!scelto && <p className="text-xs text-zinc-600">Scegli un risultato per vederne l’anteprima.</p>}

            {scelto && canPreviewDefinition(scelto.kind) && (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-zinc-300">{hitTitle(scelto)}</span>
                  {canEdit(scelto.kind) && (
                    <>
                      <button
                        data-ricerca="modifica"
                        onClick={() => apri(scelto, 'alter')}
                        className="flex items-center gap-1 rounded bg-sky-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-sky-500"
                        title="Modifica: apre CREATE OR ALTER in una nuova tab (figlia di quella attiva)"
                      >
                        <Pencil className="h-3 w-3" /> Modifica
                      </button>
                      <button
                        data-ricerca="definizione"
                        onClick={() => apri(scelto, 'open')}
                        className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                        title="Apre la definizione originale (CREATE) in una nuova tab"
                      >
                        <FileCode2 className="h-3 w-3" /> Apri definizione
                      </button>
                    </>
                  )}
                  {onShowCallGraph && (scelto.kind === 'procedure' || scelto.kind === 'function') && (
                    <button
                      data-ricerca="diagramma"
                      onClick={() => onShowCallGraph(scelto.schema, scelto.name, scelto.kind as 'procedure' | 'function')}
                      className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                    >
                      <Share2 className="h-3 w-3" /> Diagramma chiamate
                    </button>
                  )}
                </div>
                {definizione.caricando && (
                  <p className="flex items-center gap-2 text-xs text-zinc-500">
                    <Loader2 className="h-3 w-3 animate-spin" /> carico la definizione…
                  </p>
                )}
                {definizione.errore && <p className="text-xs text-rose-300">{definizione.errore}</p>}
                {definizione.testo && (
                  <pre className="overflow-x-auto font-mono text-[11px] leading-5 text-zinc-300">
                    {righeDefinizione.map((r, i) => (
                      <div
                        key={i}
                        data-riga={i + 1}
                        className={scelto.line === i + 1 ? 'bg-amber-500/10' : undefined}
                      >
                        <span className="mr-3 inline-block w-10 select-none text-right text-zinc-600">{i + 1}</span>
                        <Evidenzia testo={r} cerca={testo.trim()} />
                      </div>
                    ))}
                  </pre>
                )}
              </>
            )}

            {scelto && canPreviewColumns(scelto.kind) && (
              <>
                <div className="mb-2 font-mono text-xs text-zinc-300">
                  {scelto.kind === 'table' ? hitTitle(scelto) : scelto.detail}
                </div>
                {colonneTabella ? (
                  <table className="text-[11px] text-zinc-300">
                    <tbody>
                      {colonneTabella.map(c => (
                        <tr key={c.name} className={c.name.toLowerCase() === scelto.name.toLowerCase() ? 'bg-amber-500/10' : undefined}>
                          <td className="pr-4 font-mono">
                            <Evidenzia testo={c.name} cerca={testo.trim()} />
                          </td>
                          <td className="text-zinc-500">{c.dataType}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-xs text-zinc-600">{scelto.snippet ?? 'Nessun dettaglio disponibile.'}</p>
                )}
              </>
            )}

            {scelto?.kind === 'data' && (
              <>
                <div className="mb-2 flex items-center gap-2 font-mono text-xs text-zinc-300">
                  {scelto.detail}
                  <Badge tone="sky">riga trovata</Badge>
                </div>
                {scelto.row ? (
                  <table className="text-[11px] text-zinc-300">
                    <thead>
                      <tr>
                        {scelto.row.columns.map(c => (
                          <th key={c} className="pr-4 text-left font-mono font-semibold text-zinc-400">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {scelto.row.values.map((v, i) => (
                          <td key={i} className="pr-4 font-mono align-top">
                            <Evidenzia testo={v} cerca={testo.trim()} />
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                ) : (
                  <p className="text-xs text-zinc-600">Nessun valore disponibile.</p>
                )}
              </>
            )}

            {esito?.truncated && (
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" />
                Risultati limitati per non bloccare il database: restringi il testo cercato.
              </p>
            )}
          </div>
        </div>

        {/* Tasto destro su un risultato: Modifica (CREATE OR ALTER) / Apri definizione / Diagramma */}
        {menu && (
          <>
            <div
              className="fixed inset-0 z-[75]"
              onClick={() => setMenu(null)}
              onContextMenu={e => {
                e.preventDefault()
                setMenu(null)
              }}
            />
            <div
              className="fixed z-[80] min-w-60 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-2xl"
              style={{ left: menu.x, top: menu.y }}
            >
              <div className="truncate border-b border-zinc-800 px-3 pb-1.5 pt-1 font-mono text-[11px] text-zinc-400">
                {hitTitle(menu.hit)}
              </div>
              {canEdit(menu.hit.kind) ? (
                <>
                  <button
                    data-ricerca="menu-modifica"
                    className={VOCE_MENU}
                    onClick={() => {
                      const h = menu.hit
                      setMenu(null)
                      apri(h, 'alter')
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Modifica (CREATE OR ALTER)
                  </button>
                  <button
                    data-ricerca="menu-definizione"
                    className={VOCE_MENU}
                    onClick={() => {
                      const h = menu.hit
                      setMenu(null)
                      apri(h, 'open')
                    }}
                  >
                    <FileCode2 className="h-3.5 w-3.5" /> Apri definizione
                  </button>
                  {(menu.hit.kind === 'procedure' || menu.hit.kind === 'function') && onShowCallGraph && (
                    <button
                      data-ricerca="menu-diagramma"
                      className={VOCE_MENU}
                      onClick={() => {
                        const h = menu.hit
                        setMenu(null)
                        onShowCallGraph(h.schema, h.name, h.kind as 'procedure' | 'function')
                      }}
                    >
                      <Share2 className="h-3.5 w-3.5" /> Diagramma chiamate
                    </button>
                  )}
                </>
              ) : (
                <div className="px-3 py-1.5 text-[11px] text-zinc-500">
                  Per questo risultato non c’è una definizione da modificare.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
