// GAMIFICATION del lavoro: quanto tempo sto lavorando a una query, quante esecuzioni
// ho fatto, quante con errore, XP/livello e dati per il grafico giocoso.
// Logica PURA e testabile; la persistenza è in localStorage, per istanza SQL e per tab.

export interface QueryStats {
  /** Inizio del lavoro sulla query (prima attività), 0 = mai iniziata. */
  startedAt: number
  /** Tempo ATTIVO accumulato (ms): conta solo mentre si scrive/esegue (le pause lunghe no). */
  activeMs: number
  /** Ultimo momento di attività. */
  lastActivityAt: number
  /** Modifiche al testo (quanto ci ho lavorato). */
  edits: number
  /** Esecuzioni totali / con errore. */
  execCount: number
  errorCount: number
  /** Durata dell'ultima esecuzione e totale (ms). */
  lastExecMs: number
  totalExecMs: number
  /** Esiti delle ultime esecuzioni (per il grafico a barre). */
  outcomes: ('ok' | 'error')[]
  /** Esecuzioni per giorno (YYYY-MM-DD) → istogramma delle ultime settimane. */
  dayCounts: Record<string, number>
  /** Esecuzioni consecutive riuscite (streak attuale e record). */
  streak: number
  bestStreak: number
}

/** Oltre questa inattività il tempo non è più considerato "lavoro" (pausa). */
export const IDLE_MS = 90_000
/** Quanti esiti tenere per il grafico. */
export const MAX_OUTCOMES = 60

export function emptyQueryStats(): QueryStats {
  return {
    startedAt: 0,
    activeMs: 0,
    lastActivityAt: 0,
    edits: 0,
    execCount: 0,
    errorCount: 0,
    lastExecMs: 0,
    totalExecMs: 0,
    outcomes: [],
    dayCounts: {},
    streak: 0,
    bestStreak: 0,
  }
}

/** Chiave giorno locale (YYYY-MM-DD). */
export function dayKey(now: number): string {
  const d = new Date(now)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const g = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${g}`
}

/**
 * Segna attività: somma al tempo attivo l'intervallo dall'ultima attività (limitato a
 * IDLE_MS, così le pause lunghe non gonfiano il conteggio) e aggiorna l'inizio lavoro.
 */
function touch(stats: QueryStats, now: number): QueryStats {
  const delta = stats.lastActivityAt > 0 ? Math.min(Math.max(0, now - stats.lastActivityAt), IDLE_MS) : 0
  return {
    ...stats,
    activeMs: stats.activeMs + delta,
    lastActivityAt: now,
    startedAt: stats.startedAt > 0 ? stats.startedAt : now,
  }
}

/** Una modifica al testo. */
export function recordEdit(stats: QueryStats, now: number): QueryStats {
  const s = touch(stats, now)
  return { ...s, edits: s.edits + 1 }
}

/** Un'esecuzione (query eseguita), con esito e durata. */
export function recordExecution(stats: QueryStats, ms: number, ok: boolean, now: number): QueryStats {
  const s = touch(stats, now)
  const day = dayKey(now)
  const outcomes = [...s.outcomes, ok ? ('ok' as const) : ('error' as const)].slice(-MAX_OUTCOMES)
  const streak = ok ? s.streak + 1 : 0
  return {
    ...s,
    execCount: s.execCount + 1,
    errorCount: s.errorCount + (ok ? 0 : 1),
    lastExecMs: Math.max(0, Math.round(ms)),
    totalExecMs: s.totalExecMs + Math.max(0, Math.round(ms)),
    outcomes,
    dayCounts: { ...s.dayCounts, [day]: (s.dayCounts[day] ?? 0) + 1 },
    streak,
    bestStreak: Math.max(s.bestStreak, streak),
  }
}

/** Percentuale di esecuzioni riuscite (0-100, 0 se mai eseguita). */
export function successRate(stats: QueryStats): number {
  if (stats.execCount === 0) return 0
  return Math.round(((stats.execCount - stats.errorCount) / stats.execCount) * 100)
}

/** Durata media delle esecuzioni (ms). */
export function averageExecMs(stats: QueryStats): number {
  if (stats.execCount === 0) return 0
  return Math.round(stats.totalExecMs / stats.execCount)
}

/** Durata leggibile: "45s", "12m 30s", "1h 05m". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

/** Livelli: soglia XP, titolo e medaglia. */
const LEVELS: { xp: number; title: string; badge: string }[] = [
  { xp: 0, title: 'Novizio', badge: '🥚' },
  { xp: 40, title: 'Apprendista', badge: '🐣' },
  { xp: 120, title: 'Analista', badge: '🐥' },
  { xp: 260, title: 'Smontatore di query', badge: '🦅' },
  { xp: 480, title: 'Veterano T-SQL', badge: '🐉' },
  { xp: 800, title: 'Maestro dei JOIN', badge: '🔥' },
  { xp: 1300, title: 'Leggenda del database', badge: '🏆' },
]

/**
 * XP: esecuzioni (10 l'una), minuti di lavoro attivo (2 l'uno), streak record (3),
 * modifiche (0,2 l'una). Il livello cresce con l'XP.
 */
export function xpFor(stats: QueryStats): number {
  const minutes = stats.activeMs / 60_000
  return Math.round(stats.execCount * 10 + minutes * 2 + stats.bestStreak * 3 + stats.edits * 0.2)
}

export interface LevelInfo {
  level: number
  title: string
  badge: string
  xp: number
  xpInLevel: number
  xpForNext: number
  /** 0..1 quanto manca al livello successivo (1 = livello massimo). */
  progress: number
  nextTitle: string | null
}

export function levelInfo(stats: QueryStats): LevelInfo {
  const xp = xpFor(stats)
  let idx = 0
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].xp) idx = i
  const cur = LEVELS[idx]
  const next = LEVELS[idx + 1] ?? null
  const xpInLevel = xp - cur.xp
  const span = next ? next.xp - cur.xp : 1
  return {
    level: idx + 1,
    title: cur.title,
    badge: cur.badge,
    xp,
    xpInLevel,
    xpForNext: next ? next.xp - xp : 0,
    progress: next ? Math.min(1, xpInLevel / span) : 1,
    nextTitle: next?.title ?? null,
  }
}

// ---------- Persistenza (localStorage, per istanza SQL e per tab) ----------

const KEY = 'sqlIntelli.stats.v1.'

function keyFor(instance: string, tabId: string): string {
  return `${KEY}${instance.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_')}.${tabId}`
}

export function loadQueryStats(instance: string, tabId: string): QueryStats | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(keyFor(instance, tabId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<QueryStats>
    return { ...emptyQueryStats(), ...parsed }
  } catch {
    return null
  }
}

export function saveQueryStats(instance: string, tabId: string, stats: QueryStats): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(keyFor(instance, tabId), JSON.stringify(stats))
  } catch {
    /* storage non disponibile */
  }
}

export function clearQueryStats(instance: string, tabId: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(keyFor(instance, tabId))
  } catch {
    /* ignora */
  }
}
