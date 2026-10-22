// RICERCA GENERALE NEL DATABASE (stile Redgate SQL Search): si cerca un testo nei NOMI e nelle
// DEFINIZIONI delle strutture e, se richiesto, nei DATI delle tabelle. I risultati stanno sopra,
// l'ANTEPRIMA (script con il match evidenziato, colonne o riga trovata) sotto.
// La ricerca è ristretta al database della connessione attiva: nessuna query su altri database.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Database as DbIcon,
  History,
  Loader2,
  Pencil,
  Search,
  Share2,
  X,
} from 'lucide-react'
import { api } from '../api'
import monaco from '../monacoSetup'
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
  MAX_RICERCHE_RICORDATE,
  parseSearchHistory,
  pushSearchHistory,
  removeFromSearchHistory,
  searchMeta,
  SEARCH_HISTORY_KEY,
  splitHighlight,
  tableOfHit,
} from '../sqlSearch'
import { searchTokens } from '../helpers'
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

/** Cronologia delle ricerche: si legge/salva in localStorage (max 10 voci). */
function leggiCronologia(): string[] {
  try {
    if (typeof localStorage === 'undefined') return []
    return parseSearchHistory(localStorage.getItem(SEARCH_HISTORY_KEY))
  } catch {
    return []
  }
}
function saveCronologia(voci: string[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(voci))
  } catch {
    /* storage pieno o disabilitato: la cronologia resta solo in memoria */
  }
}

/**
 * Classi CSS di una riga dell'anteprima: tutte le righe che contengono il testo cercato hanno lo
 * sfondo giallino e un bordo a sinistra (le "sottolinea"); quella segnalata dal backend è più marcata.
 * Richiesta utente: "sottolinea bene … tutte le righe in cui si trova".
 */
export function classiRiga(rigaDelMatch: number | null, riga: number, righeConMatch: Set<number>): string | undefined {
  if (riga === rigaDelMatch) return 'bg-amber-500/20 shadow-[inset_2px_0_0_0_#f59e0b]'
  if (righeConMatch.has(riga)) return 'bg-amber-500/10 shadow-[inset_2px_0_0_0_rgba(245,158,11,0.55)]'
  return undefined
}

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

/** Escape per l'uso in una RegExp. */
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Evidenzia le occorrenze del testo cercato DENTRO l'HTML colorato da Monaco: si toccano solo i
 * pezzi di testo (mai i tag), altrimenti sostituendo una parola che compare nel markup — "span",
 * "class" — si romperebbe l'HTML.
 */
export function evidenziaHtml(html: string, cerca: string): string {
  const parole = searchTokens(cerca)
    .map(p => escapeRegExp(p))
    // prima le parole più lunghe: "corridoio" non deve essere coperto da "corr"
    .sort((a, b) => b.length - a.length)
  if (parole.length === 0 || cerca.trim().length < 2) return html
  const re = new RegExp(parole.join('|'), 'gi')
  return html
    .split(/(<[^>]*>)/)
    .map(parte => (parte.startsWith('<') ? parte : parte.replace(re, m => `<mark class="rounded bg-amber-500/30 px-0.5 text-amber-100">${m}</mark>`)))
    .join('')
}

/**
 * Sintassi a colori del testo SQL: si usa il coloratore di Monaco (stesse parole chiave, stringhe
 * e commenti dell'editor) e si tiene il risultato per riga, così numeri di riga ed evidenziazione
 * del match restano quelli di prima.
 */
export function useSqlColorato(righe: string[]): string[] | null {
  const [html, setHtml] = useState<string[] | null>(null)
  const chiave = righe.join('\n')
  useEffect(() => {
    let annullato = false
    if (righe.length === 0) {
      setHtml(null)
      return
    }
    void Promise.all(
      // Il coloratore incapsula l'HTML in blocchi <div>: dentro le righe dell'anteprima servono
      // INLINE, altrimenti ogni riga eredita i margini dei blocchi e le righe si distanziano
      // tantissimo (segnalazione utente: "viene una spaziatura tra le righe enorme").
      righe.map(r =>
        (r ? monaco.editor.colorize(r, 'sql', {}) : Promise.resolve(''))
          .then(h =>
            String(h)
              .replace(/<div/gi, '<span')
              .replace(/<\/div>/gi, '</span>')
              // il coloratore chiude con un ritorno a capo: dentro un <pre> creerebbe una riga
              // vuota in più (era la "spaziatura enorme" fra le righe dell'anteprima)
              .replace(/\r?\n/g, '')
              // e può aggiungere un <br>: dentro un <pre> raddoppierebbe l'altezza della riga
              .replace(/(<br\s*\/?>)+$/gi, ''),
          )
          .catch(() => r),
      ),
    ).then(risultato => {
      if (!annullato) setHtml(risultato)
    })
    return () => {
      annullato = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiave])
  return html
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
  /** Ultime ricerche (max 10), ricordate anche chiudendo l'app. */
  const [cronologia, setCronologia] = useState<string[]>(() => leggiCronologia())
  const [storicoAperto, setStoricoAperto] = useState(false)
  /** Posizione nella cronologia mentre si usano le frecce su/giù (-1 = non si sta navigando). */
  const [indiceStorico, setIndiceStorico] = useState(-1)
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

  const cerca = useCallback(
    async (termine?: string) => {
      const q = (termine ?? testo).trim()
      if (q.length < 2) {
        setErrore('Scrivi almeno 2 caratteri.')
        return
      }
      // la ricerca entra nella cronologia (ultime MAX_RICERCHE_RICORDATE parole cercate)
      setCronologia(prev => {
        const nuova = pushSearchHistory(prev, q)
        saveCronologia(nuova)
        return nuova
      })
      setIndiceStorico(-1)
      setStoricoAperto(false)
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
    },
    [testo, conDati, connectionId],
  )

  /**
   * MODIFICA dalla ricerca: apre la stored procedure / funzione / vista / trigger in una tab con
   * CREATE OR ALTER (stessa azione della voce "Modifica" del tasto destro nell'albero). La tab
   * nasce figlia di quella attiva.
   * La vecchia voce "Apri definizione" (che apriva lo stesso oggetto con il CREATE originale) è
   * stata tolta: era lo stesso comando, cambiava solo la parola CREATE/CREATE OR ALTER.
   */
  const apri = useCallback(
    (hit: TextSearchHit) => {
      const kind = editableKind(hit.kind)
      if (!kind) return
      onOpenObject(kind, hit.schema, hit.name, 'alter')
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
  /**
   * TUTTE le righe della definizione in cui compare il testo cercato (richiesta utente: "sottolinea
   * bene, nell'oggetto in cui trovi quello che cerco, tutte le righe in cui si trova"). Prima veniva
   * evidenziata solo la riga segnalata dal backend; ora si evidenziano tutte quelle che contengono le
   * parole cercate (in qualsiasi ordine), con la riga del match più marcata.
   */
  const righeConMatch = useMemo(() => {
    const insieme = new Set<number>()
    const token = searchTokens(testo).map(t => t.toLowerCase())
    if (token.length === 0) return insieme
    righeDefinizione.forEach((r, i) => {
      const basso = r.toLowerCase()
      if (token.every(t => basso.includes(t))) insieme.add(i + 1)
    })
    return insieme
  }, [righeDefinizione, testo])
  /** Le stesse righe con la SINTASSI A COLORI (coloratore di Monaco, come nell'editor). */
  const htmlColorato = useSqlColorato(righeDefinizione)

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
            data-ricerca="testo"
            value={testo}
            onChange={e => setTesto(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                void cerca()
                return
              }
              // frecce su/giù: si ripescano le ultime ricerche (come in una shell)
              if (e.key === 'ArrowUp' && cronologia.length > 0) {
                e.preventDefault()
                const i = Math.min(indiceStorico + 1, cronologia.length - 1)
                setIndiceStorico(i)
                setTesto(cronologia[i])
              } else if (e.key === 'ArrowDown' && indiceStorico >= 0) {
                e.preventDefault()
                const i = indiceStorico - 1
                setIndiceStorico(i)
                setTesto(i < 0 ? '' : cronologia[i])
              }
            }}
            placeholder="Testo da cercare in nomi, definizioni e (opzionale) dati…"
            className={`${inputClass} min-w-64 flex-1`}
          />
          {/* ULTIME RICERCHE: le ultime 10 parole cercate, ripescabili con un clic */}
          <div className="relative">
            <button
              data-ricerca="cronologia"
              onClick={() => setStoricoAperto(v => !v)}
              disabled={cronologia.length === 0}
              className="flex items-center gap-1.5 rounded border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              title={
                cronologia.length > 0
                  ? `Ultime ricerche (${cronologia.length} di ${MAX_RICERCHE_RICORDATE}) — clic per ripescarle`
                  : 'Nessuna ricerca ancora: compariranno qui le ultime 10'
              }
            >
              <History className="h-3.5 w-3.5" />
              {cronologia.length > 0 && <span className="tabular-nums">{cronologia.length}</span>}
            </button>
            {storicoAperto && cronologia.length > 0 && (
              <>
                <div className="fixed inset-0 z-[75]" onClick={() => setStoricoAperto(false)} />
                <div className="absolute right-0 z-[80] mt-1 w-80 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
                  <div className="border-b border-zinc-800 px-3 pb-1.5 pt-1 text-[11px] text-zinc-500">
                    Ultime ricerche — clic per ripeterla
                  </div>
                  {cronologia.map(t => (
                    <div key={t} className="flex items-center gap-1 pr-1">
                      <button
                        data-ricerca="voce-cronologia"
                        onClick={() => {
                          setTesto(t)
                          setStoricoAperto(false)
                          void cerca(t)
                        }}
                        className="min-w-0 flex-1 truncate px-3 py-1 text-left font-mono text-xs text-zinc-200 hover:bg-zinc-800"
                        title={`Cerca di nuovo "${t}"`}
                      >
                        {t}
                      </button>
                      <button
                        data-ricerca="togli-cronologia"
                        onClick={() => {
                          setCronologia(prev => {
                            const nuova = removeFromSearchHistory(prev, t)
                            saveCronologia(nuova)
                            return nuova
                          })
                          setIndiceStorico(-1)
                        }}
                        className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                        title="Togli dalla cronologia"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    data-ricerca="svuota-cronologia"
                    onClick={() => {
                      setCronologia([])
                      saveCronologia([])
                      setStoricoAperto(false)
                      setIndiceStorico(-1)
                    }}
                    className="mt-1 w-full border-t border-zinc-800 px-3 py-1.5 text-left text-[11px] text-zinc-400 hover:bg-zinc-800"
                  >
                    Svuota la cronologia
                  </button>
                </div>
              </>
            )}
          </div>
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
            {esito?.hits.map((h, indice) => {
              const attivo = scelto && hitKey(scelto) === hitKey(h)
              // identità dell'OGGETTO della riga: per colonne/vincoli/calcolate conta anche la
              // tabella (due tabelle possono avere una colonna con lo stesso nome)
              const perTabella = h.kind === 'column' || h.kind === 'constraint' || h.kind === 'computed'
              const oggetto = perTabella
                ? `${h.kind}|${h.schema}.${tableOfHit(h)}|${h.name}`.toLowerCase()
                : `${h.kind}|${h.schema}.${h.name}`.toLowerCase()
              return (
                <button
                  /* chiave React: hitKey + posizione, perché due hit sui DATI possono essere
                     identici (stesso valore in due righe) e con chiavi uguali React sbagliava la
                     riconciliazione (righe vecchie che restavano nell'elenco) */
                  key={`${hitKey(h)}#${indice}`}
                  data-ricerca="riga"
                  /* oggetto della riga: serve a controllare che non compaia due volte (una per il
                     nome e una per la definizione dello stesso oggetto) */
                  data-ricerca-nome={oggetto}
                  onClick={() => setScelto(h)}
                  onDoubleClick={() => apri(h)}
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
                    <button
                      data-ricerca="modifica"
                      onClick={() => apri(scelto)}
                      className="flex items-center gap-1 rounded bg-sky-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-sky-500"
                      title="Modifica: apre CREATE OR ALTER in una nuova tab (figlia di quella attiva)"
                    >
                      <Pencil className="h-3 w-3" /> Modifica
                    </button>
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
                {definizione.testo && htmlColorato && (
                  <pre className="overflow-x-auto font-mono text-[11px] leading-5 text-zinc-300">
                    {righeDefinizione.map((r, i) => (
                      <div
                        key={i}
                        data-riga={i + 1}
                        className={classiRiga(scelto.line, i + 1, righeConMatch)}
                      >
                        <span className="mr-3 inline-block w-10 select-none text-right text-zinc-600">{i + 1}</span>
                        {htmlColorato[i] !== undefined ? (
                          <span
                            data-sintassi="colorata"
                            dangerouslySetInnerHTML={{ __html: evidenziaHtml(htmlColorato[i], testo) }}
                          />
                        ) : (
                          <Evidenzia testo={r} cerca={testo.trim()} />
                        )}
                      </div>
                    ))}
                  </pre>
                )}
                {definizione.testo && !htmlColorato && (
                  <pre className="overflow-x-auto font-mono text-[11px] leading-5 text-zinc-300">
                    {righeDefinizione.map((r, i) => (
                      <div
                        key={i}
                        data-riga={i + 1}
                        className={classiRiga(scelto.line, i + 1, righeConMatch)}
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
                      apri(h)
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Modifica (CREATE OR ALTER)
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
