// SCHEDA XML: mostra un valore XML indetato, con ogni nodo colorato, e permette di cercarci sopra.
//
// RICHIESTA UTENTE: "se il campo è un xml aprimi una scheda che me lo faccia vedere in modo che possa
// capire, che sia indentato ed ogni nodo abbia un colore, e che ci possa fare delle ricerche sopra".
//
// Sta in una TAB (non in una finestra modale) come la ricerca e i diagrammi: così si può tenere aperta
// accanto alla query e tornarci quando serve.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Braces, Copy, FileCode2, Search, WrapText, X } from 'lucide-react'
import { Badge, Button } from './ui'
import { copiaTesto } from '../clipboard'
import {
  contaOccorrenze,
  formattaXml,
  righeConMatch,
  tokenPerRiga,
  type TipoTokenXml,
} from '../xmlFormat'

interface Props {
  /** Colonna del risultato da cui arriva il valore (per il titolo e la barra). */
  colonna: string
  /** Valore XML originale (grigio non formattato). */
  valore: string
  /** Chiude la scheda. */
  onClose: () => void
}

/** Colore di ogni tipo di pezzo di XML (tema scuro e chiaro con le stesse classi). */
const CLASSE_TOKEN: Record<TipoTokenXml, string> = {
  tag: 'text-zinc-500',
  nome: 'text-sky-300',
  attributo: 'text-amber-300',
  valore: 'text-emerald-300',
  testo: 'text-zinc-300',
  commento: 'text-zinc-500 italic',
  cdata: 'text-fuchsia-300',
  prologo: 'text-violet-300',
  dichiarazione: 'text-violet-300',
}

/** Evidenzia TUTTE le occorrenze della ricerca dentro un testo (senza distinguere maiuscole). */
function evidenzia(testo: string, query: string) {
  const q = query.trim()
  if (!q) return testo
  const fuori: { testo: string; match: boolean }[] = []
  const basso = testo.toLowerCase()
  const cercato = q.toLowerCase()
  let i = 0
  while (i <= testo.length) {
    const dove = basso.indexOf(cercato, i)
    if (dove < 0) {
      if (i < testo.length) fuori.push({ testo: testo.slice(i), match: false })
      break
    }
    if (dove > i) fuori.push({ testo: testo.slice(i, dove), match: false })
    fuori.push({ testo: testo.slice(dove, dove + q.length), match: true })
    i = dove + q.length
  }
  return fuori
}

export default function XmlViewerTab({ colonna, valore, onClose }: Props) {
  /** Indentato (default) oppure come sta nel campo. */
  const [indentato, setIndentato] = useState(true)
  const [query, setQuery] = useState('')
  /** Indice del match a cui si è arrivati con le frecce. */
  const [matchCorrente, setMatchCorrente] = useState(0)
  const [copiato, setCopiato] = useState(false)
  const corpoRef = useRef<HTMLDivElement | null>(null)

  const testo = useMemo(() => {
    if (!indentato) return valore
    try {
      return formattaXml(valore)
    } catch {
      return valore
    }
  }, [valore, indentato])

  const righe = useMemo(() => testo.split('\n'), [testo])
  const occorrenze = useMemo(() => contaOccorrenze(testo, query), [testo, query])
  const righeTrovate = useMemo(() => righeConMatch(testo, query), [testo, query])

  // nuovo testo/ricerca: si riparte dal primo match
  useEffect(() => {
    setMatchCorrente(0)
  }, [testo, query])

  /** Porta a schermo la riga del match corrente (con la ricerca attiva). */
  useEffect(() => {
    if (!query.trim() || righeTrovate.length === 0) return
    const riga = righeTrovate[Math.min(matchCorrente, righeTrovate.length - 1)]
    const el = corpoRef.current?.querySelector(`[data-riga-xml="${riga}"]`)
    el?.scrollIntoView({ block: 'center' })
  }, [matchCorrente, query, righeTrovate])

  const vaiAl = (passo: 1 | -1) => {
    if (righeTrovate.length === 0) return
    setMatchCorrente(prev => {
      const n = righeTrovate.length
      return (prev + passo + n) % n
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-xml-scheda="">
      {/* barra: colonna, comandi e ricerca */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs">
        <FileCode2 className="h-4 w-4 text-violet-400" />
        <span className="font-semibold text-zinc-200">XML</span>
        <Badge tone="zinc">{colonna}</Badge>
        <span className="text-zinc-500">
          {righe.length} righe · {valore.length.toLocaleString('it-IT')} caratteri
        </span>
        <Button
          variant={indentato ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setIndentato(v => !v)}
          title={indentato ? 'Mostra il testo come sta nel campo (non indentato)' : 'Indenta il testo'}
          data-xml-indenta={indentato ? 'on' : 'off'}
        >
          <WrapText className="h-3.5 w-3.5" />
          <span className="sr-only">Indenta</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void copiaTesto(testo).then(ok => {
              setCopiato(ok)
              if (ok) setTimeout(() => setCopiato(false), 1500)
            })
          }
          title="Copia tutto l'XML (indentato se lo è a video)"
          data-xml-copia=""
        >
          <Copy className="h-3.5 w-3.5 text-sky-400" />
          <span className="sr-only">Copia</span>
          {copiato && <span className="ml-1 text-emerald-300">Copiato ✓</span>}
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <div className="flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1">
            <Search className="h-3.5 w-3.5 text-zinc-500" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  vaiAl(e.shiftKey ? -1 : 1)
                }
                if (e.key === 'Escape') setQuery('')
              }}
              placeholder="Cerca nell’XML… (Invio = successivo, Maiusc+Invio = precedente)"
              className="w-72 bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
              data-xml-cerca=""
            />
            {query.trim() && (
              <span className="whitespace-nowrap text-[11px] text-zinc-400" data-xml-conteggio="">
                {righeTrovate.length === 0
                  ? 'nessun risultato'
                  : `riga ${righeTrovate[Math.min(matchCorrente, righeTrovate.length - 1)]} · ${righeTrovate.length} righe · ${occorrenze} occorrenze`}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => vaiAl(-1)}
            disabled={righeTrovate.length === 0}
            title="Risultato precedente (Maiusc+Invio)"
            data-xml-precedente=""
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => vaiAl(1)}
            disabled={righeTrovate.length === 0}
            title="Risultato successivo (Invio)"
            data-xml-successivo=""
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} title="Chiudi la scheda (Ctrl+F4)">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* corpo: una riga per volta, con i colori per tipo di nodo e la ricerca evidenziata */}
      <div className="min-h-0 flex-1 overflow-auto bg-zinc-950" ref={corpoRef} data-xml-corpo="">
        <pre className="m-0 p-0 font-mono text-[12.5px] leading-[1.5]">
          {righe.map((riga, i) => {
            const numero = i + 1
            const trovata = query.trim() !== '' && riga.toLowerCase().includes(query.trim().toLowerCase())
            return (
              <div
                key={numero}
                data-riga-xml={numero}
                data-riga-trovata={trovata ? 'sì' : undefined}
                className={`flex min-w-full ${trovata ? 'bg-amber-500/10' : ''}`}
              >
                <span className="sticky left-0 w-12 shrink-0 select-none border-r border-zinc-800 bg-zinc-950 pr-2 text-right text-zinc-600">
                  {numero}
                </span>
                <span className="whitespace-pre pl-3 text-zinc-200">
                  {tokenPerRiga(riga).map((tok, k) => {
                    const pezzi = evidenzia(tok.testo, query)
                    return (
                      <span key={k} className={CLASSE_TOKEN[tok.tipo]}>
                        {typeof pezzi === 'string'
                          ? pezzi
                          : pezzi.map((p, j) =>
                              p.match ? (
                                <mark key={j} className="rounded bg-amber-400/80 px-0.5 text-zinc-900">
                                  {p.testo}
                                </mark>
                              ) : (
                                <span key={j}>{p.testo}</span>
                              ),
                            )}
                      </span>
                    )
                  })}
                </span>
              </div>
            )
          })}
        </pre>
      </div>

      <div className="flex items-center gap-2 border-t border-zinc-800 bg-zinc-900/60 px-3 py-1 text-[11px] text-zinc-500">
        <Braces className="h-3.5 w-3.5 text-violet-400" />
        Tag azzurri · attributi ambra · valori verdi · commenti grigi · CDATA fucsia ·
        <span className="ml-auto">invio = risultato successivo · Esc = pulisci la ricerca</span>
      </div>
    </div>
  )
}
