// Gamification del lavoro: badge compatto + pannello con grafico giocoso.
// Mostra da quanto tempo si lavora alla query attiva, quante esecuzioni (ok/errore),
// la percentuale di successo, la streak e i punti XP con livello e medaglia.
import { Clock, Flame, Play, Target, TrendingUp, TriangleAlert, Trophy, X } from 'lucide-react'
import {
  averageExecMs,
  dayKey,
  formatDuration,
  levelInfo,
  successRate,
  type QueryStats,
} from '../gamification'
import { Badge, Button } from './ui'

/** Colore della barra in base all'esito (verde ok, rosso errore). */
const OUTCOME_COLOR = { ok: '#34d399', error: '#fb7185' } as const

/** Badge compatto nell'header: livello, tempo di lavoro, esecuzioni ok/errore. */
export function QueryStatsBadge({ stats, onClick }: { stats: QueryStats; onClick: () => void }) {
  const level = levelInfo(stats)
  const last = stats.outcomes.slice(-14)
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/70 px-2 py-1 text-xs text-zinc-300 transition-colors hover:border-sky-700 hover:text-zinc-100"
      title="Progressi su questa query: tempo di lavoro, esecuzioni, livello (clicca per il dettaglio)"
    >
      <span className="text-sm leading-none">{level.badge}</span>
      <span className="font-semibold text-zinc-100">Lv {level.level}</span>
      <span className="flex items-center gap-1 tabular-nums text-zinc-400">
        <Clock className="h-3 w-3" /> {formatDuration(stats.activeMs)}
      </span>
      <span className="flex items-center gap-1 tabular-nums text-zinc-400">
        <Play className="h-3 w-3" /> {stats.execCount}
      </span>
      {stats.errorCount > 0 && (
        <span className="flex items-center gap-1 tabular-nums text-rose-300">
          <TriangleAlert className="h-3 w-3" /> {stats.errorCount}
        </span>
      )}
      {/* mini grafico degli ultimi esiti */}
      <span className="flex items-end gap-[2px]">
        {last.map((o, i) => (
          <span
            key={i}
            className="w-[3px] rounded-sm"
            style={{ height: o === 'ok' ? 10 : 6, backgroundColor: OUTCOME_COLOR[o] }}
          />
        ))}
      </span>
    </button>
  )
}

/** Grafico a barre "ultime esecuzioni" (giocoso: barre alte = riuscite). */
function OutcomeChart({ outcomes }: { outcomes: QueryStats['outcomes'] }) {
  const last = outcomes.slice(-40)
  if (last.length === 0) {
    return <p className="text-xs text-zinc-500">Nessuna esecuzione ancora: lancia la query (F5) e inizia a guadagnare XP!</p>
  }
  const max = Math.max(...last.map((o, i) => (o === 'ok' ? 24 : 10 + (i % 3))))
  return (
    <div className="flex h-16 items-end gap-[3px]">
      {last.map((o, i) => {
        const h = o === 'ok' ? 24 : 10 + (i % 3) * 3
        return (
          <span
            key={i}
            title={o === 'ok' ? 'esecuzione riuscita' : 'esecuzione con errore'}
            className="w-2 rounded-t"
            style={{ height: `${Math.round((h / max) * 100)}%`, backgroundColor: OUTCOME_COLOR[o], opacity: o === 'ok' ? 1 : 0.85 }}
          />
        )
      })}
    </div>
  )
}

/** Istogramma delle esecuzioni per giorno (ultimi 14 giorni). */
function DayChart({ dayCounts }: { dayCounts: QueryStats['dayCounts'] }) {
  const days: { key: string; label: string; count: number }[] = []
  const now = Date.now()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 86_400_000)
    const key = dayKey(d.getTime())
    days.push({ key, label: String(d.getDate()).padStart(2, '0'), count: dayCounts[key] ?? 0 })
  }
  const max = Math.max(1, ...days.map(d => d.count))
  return (
    <div className="flex items-end gap-1">
      {days.map(d => (
        <div key={d.key} className="flex flex-col items-center gap-1" title={`${d.key}: ${d.count} esecuzioni`}>
          <div className="flex h-14 w-4 items-end rounded bg-zinc-800/70">
            <div
              className="w-full rounded bg-sky-500/80"
              style={{ height: `${(d.count / max) * 100}%` }}
            />
          </div>
          <span className="text-[9px] text-zinc-500">{d.label}</span>
        </div>
      ))}
    </div>
  )
}

function Stat({ label, value, tone = 'zinc' }: { label: string; value: string; tone?: 'zinc' | 'emerald' | 'rose' | 'amber' }) {
  const color =
    tone === 'emerald' ? 'text-emerald-300' : tone === 'rose' ? 'text-rose-300' : tone === 'amber' ? 'text-amber-300' : 'text-zinc-100'
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  )
}

/** Pannello dettagliato con XP, medaglie e grafici. */
export function QueryStatsModal({ stats, onClose }: { stats: QueryStats; onClose: () => void }) {
  const level = levelInfo(stats)
  const rate = successRate(stats)
  const firstName = stats.startedAt > 0 ? new Date(stats.startedAt).toLocaleString('it-IT') : '—'
  const medals: string[] = []
  if (stats.execCount > 0 && rate === 100) medals.push('🎯 Zero errori')
  if (stats.bestStreak >= 3) medals.push(`🔥 Streak x${stats.bestStreak}`)
  if (stats.execCount >= 10) medals.push('⚙️ Macchina da query')
  if (stats.activeMs >= 30 * 60_000) medals.push('⏳ Maratona da 30 minuti')
  if (stats.edits >= 100) medals.push('✍️ Rafinatore')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-[min(720px,96vw)] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-zinc-100">Progressi su questa query</h3>
          <button onClick={onClose} className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Livello + barra XP */}
        <div className="mb-4 rounded-lg border border-zinc-800 bg-gradient-to-r from-sky-950/40 to-zinc-900/40 p-3">
          <div className="mb-2 flex items-center gap-3">
            <span className="text-2xl leading-none">{level.badge}</span>
            <div>
              <div className="text-sm font-semibold text-zinc-100">
                Livello {level.level} · {level.title}
              </div>
              <div className="text-xs text-zinc-400">
                {level.nextTitle
                  ? `${level.xpForNext} XP per diventare “${level.nextTitle}”`
                  : 'Livello massimo raggiunto 🏆'}
              </div>
            </div>
            <Badge tone="sky">{level.xp} XP</Badge>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all"
              style={{ width: `${Math.round(level.progress * 100)}%` }}
            />
          </div>
        </div>

        {/* Numeri */}
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Tempo di lavoro" value={formatDuration(stats.activeMs)} tone="amber" />
          <Stat label="Esecuzioni" value={String(stats.execCount)} />
          <Stat label="Riuscite" value={String(stats.execCount - stats.errorCount)} tone="emerald" />
          <Stat label="Con errore" value={String(stats.errorCount)} tone={stats.errorCount > 0 ? 'rose' : 'zinc'} />
          <Stat label="% successo" value={`${rate}%`} tone={rate === 100 && stats.execCount > 0 ? 'emerald' : 'zinc'} />
          <Stat label="Streak attuale" value={String(stats.streak)} tone={stats.streak > 0 ? 'emerald' : 'zinc'} />
          <Stat label="Streak record" value={String(stats.bestStreak)} />
          <Stat label="Durata media" value={stats.execCount > 0 ? formatDuration(averageExecMs(stats)) : '—'} />
        </div>

        {/* Grafici */}
        <div className="mb-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            <TrendingUp className="h-3.5 w-3.5" /> Ultime esecuzioni (verde = ok, rosso = errore)
          </div>
          <OutcomeChart outcomes={stats.outcomes} />
        </div>
        <div className="mb-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            <Target className="h-3.5 w-3.5" /> Esecuzioni per giorno (ultimi 14)
          </div>
          <DayChart dayCounts={stats.dayCounts} />
        </div>

        {medals.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {medals.map(m => (
              <span key={m} className="rounded-full border border-amber-700/60 bg-amber-950/40 px-2 py-0.5 text-[11px] text-amber-200">
                {m}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          <Flame className="h-3 w-3 text-amber-400" /> Lavoro iniziato il {firstName} · {stats.edits} modifiche al testo
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
            Chiudi
          </Button>
        </div>
      </div>
    </div>
  )
}
