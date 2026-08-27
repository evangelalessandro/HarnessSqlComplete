import { useEffect, useMemo, useState } from 'react'
import MatrixRain from './MatrixRain'

interface Props {
  server?: string
  database?: string
}

function buildLines(server: string, database: string): string[] {
  const srv = server?.trim() || 'SQL Server'
  return [
    '> sqlintelli://bootstrap v4.2.0 — caricamento moduli',
    '> query engine ... OK',
    '> intellisense engine ... OK',
    '> formatter T-SQL ... OK',
    `> handshake con ${srv} ...`,
    '> apertura tunnel dati ... OK',
    '> autenticazione utente ... OK',
    database && database.trim() ? `> caricamento metadati: ${database}` : '> caricamento metadati ...',
    '> costruzione albero oggetti (tabelle, viste, procedure, trigger) ...',
    '> indicizzazione colonne per i suggerimenti ...',
    '> collegamento assistente AI ... OK',
    '> PRONTO — benvenuto in SQL Intelligence Assistant',
  ].filter(Boolean)
}

/** Esadecimale casuale che scorre in basso (dettaglio "hacker"). */
function randomHex(byteCount: number): string {
  const out: string[] = []
  for (let i = 0; i < byteCount; i++) {
    out.push(Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase())
  }
  return out.join(' ')
}

export default function ConnectAnimation({ server, database }: Props) {
  const lines = useMemo(() => buildLines(server ?? '', database ?? ''), [server, database])
  const [lineIdx, setLineIdx] = useState(0)
  const [chars, setChars] = useState(0)
  const [hex, setHex] = useState(() => randomHex(24))

  // Ticker di digitazione: aggiunge un carattere alla riga corrente
  useEffect(() => {
    const t = window.setInterval(() => {
      setChars(c => (c < lines[lineIdx].length ? c + 1 : c))
    }, 14)
    return () => window.clearInterval(t)
  }, [lineIdx, lines])

  // Riga completata → breve pausa → riga successiva
  useEffect(() => {
    if (chars >= lines[lineIdx].length && lineIdx + 1 < lines.length) {
      const t = window.setTimeout(() => {
        setLineIdx(i => i + 1)
        setChars(0)
      }, 240)
      return () => window.clearTimeout(t)
    }
  }, [chars, lineIdx, lines])

  // Scorrimento esadecimale casuale (effetto terminale)
  useEffect(() => {
    const t = window.setInterval(() => setHex(randomHex(24)), 130)
    return () => window.clearInterval(t)
  }, [])

  const current = lines[lineIdx]
  const progress = Math.min(
    100,
    Math.round(((lineIdx + Math.min(chars, current.length) / current.length) / lines.length) * 100),
  )
  const filled = Math.round((progress / 100) * 22)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-zinc-950/90 p-4 backdrop-blur-sm">
      <MatrixRain />
      <div className="relative z-10 w-full max-w-2xl">
        <div className="crt-flicker relative overflow-hidden rounded-lg border border-emerald-900/70 bg-black/85 shadow-[0_0_80px_rgba(16,185,129,0.25),inset_0_0_40px_rgba(16,185,129,0.06)]">
          <div className="crt-scanline pointer-events-none absolute inset-0 z-20" />

          {/* Barra del titolo stile terminale */}
          <div className="flex items-center gap-2 border-b border-emerald-900/50 bg-zinc-950/90 px-3 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
            <span className="ml-2 font-mono text-[11px] tracking-wide text-emerald-400/90">
              sqlintelli.exe — connessione in corso
            </span>
            <span className="ml-auto hidden font-mono text-[10px] text-emerald-600 sm:inline">
              {server || 'SQL Server'}
              {database ? ` · ${database}` : ''}
            </span>
          </div>

          {/* Logo ASCII */}
          <div className="px-6 pt-4 text-center font-mono text-[11px] leading-tight text-emerald-400">
            <pre className="inline-block text-left">
              {`╔══════════════════════════════════════════╗
║  ███████╗ ██████╗ ██╗     ██╗███╗   ██╗ ████████╗
║  ██╔════╝██╔═══██╗██║     ██║████╗  ██║ ╚══██╔══╝
║  ███████╗██║   ██║██║     ██║██╔██╗ ██║    ██║
║  ╚════██║██║▄▄ ██║██║     ██║██║╚██╗██║    ██║
║  ███████║╚██████╔╝███████╗██║██║ ╚████║    ██║
║  ╚══════╝ ╚══▀▀═╝ ╚══════╝╚═╝╚═╝  ╚═══╝    ╚═╝
╚══════════════════════════════════════════╝`}
            </pre>
          </div>

          {/* Log di connessione */}
          <div className="h-60 overflow-hidden px-6 py-3 font-mono text-[13px] leading-6 text-emerald-300">
            {lines.slice(0, lineIdx + 1).map((ln, i) => (
              <div key={i} className={i === lineIdx ? 'text-emerald-200' : 'text-emerald-500/80'}>
                <span>{i === lineIdx ? ln.slice(0, chars) : ln}</span>
                {i === lineIdx && <span className="crt-caret ml-0.5 text-emerald-300">▮</span>}
              </div>
            ))}
          </div>

          {/* Barra di avanzamento */}
          <div className="flex items-center gap-3 px-6 pb-3 font-mono text-xs text-emerald-400">
            <span className="whitespace-pre text-emerald-500">[{'█'.repeat(filled)}{'░'.repeat(22 - filled)}]</span>
            <span className="tabular-nums">{progress}%</span>
            <span className="ml-auto hidden text-emerald-600/80 sm:inline">ctrl+c per annullare… (scherzo)</span>
          </div>

          {/* Riga esadecimale */}
          <div className="border-t border-emerald-900/50 px-6 py-2 font-mono text-[10px] tracking-wide text-emerald-600/70">
            {hex}
          </div>
        </div>
      </div>
    </div>
  )
}
