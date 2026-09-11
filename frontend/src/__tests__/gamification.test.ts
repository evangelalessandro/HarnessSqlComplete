import { beforeEach, describe, expect, it } from 'vitest'
import {
  averageExecMs,
  clearQueryStats,
  dayKey,
  emptyQueryStats,
  formatDuration,
  IDLE_MS,
  levelInfo,
  loadQueryStats,
  MAX_OUTCOMES,
  recordEdit,
  recordExecution,
  saveQueryStats,
  successRate,
  xpFor,
} from '../gamification'

// mock minimale di localStorage (ambiente node)
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
  }
})

const T0 = Date.UTC(2026, 0, 15, 9, 0, 0)

describe('gamification: tempo di lavoro sulla query', () => {
  it('la prima modifica segna l\'inizio e accumula il tempo attivo', () => {
    let s = emptyQueryStats()
    expect(s.startedAt).toBe(0)
    s = recordEdit(s, T0)
    expect(s.startedAt).toBe(T0)
    expect(s.activeMs).toBe(0) // niente intervallo precedente
    s = recordEdit(s, T0 + 5_000)
    expect(s.activeMs).toBe(5_000)
    expect(s.edits).toBe(2)
  })

  it('le pause lunghe non contano come lavoro (cap a IDLE_MS)', () => {
    let s = recordEdit(emptyQueryStats(), T0)
    s = recordEdit(s, T0 + 10 * IDLE_MS) // pausa lunghissima
    expect(s.activeMs).toBe(IDLE_MS) // conta al massimo la soglia di inattività
    expect(s.edits).toBe(2)
  })

  it('formatDuration: secondi, minuti, ore', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(90_000)).toBe('1m 30s')
    expect(formatDuration(3_600_000 + 5 * 60_000)).toBe('1h 05m')
  })
})

describe('gamification: esecuzioni ok/errore, streak e grafico', () => {
  it('registra esecuzioni, errori, durate ed esiti', () => {
    let s = emptyQueryStats()
    s = recordExecution(s, 120, true, T0)
    s = recordExecution(s, 400, false, T0 + 1_000)
    s = recordExecution(s, 200, true, T0 + 2_000)
    expect(s.execCount).toBe(3)
    expect(s.errorCount).toBe(1)
    expect(s.outcomes).toEqual(['ok', 'error', 'ok'])
    expect(s.lastExecMs).toBe(200)
    expect(s.totalExecMs).toBe(720)
    expect(averageExecMs(s)).toBe(240)
    expect(successRate(s)).toBe(67)
    expect(s.streak).toBe(1) // ultima riuscita
    expect(s.bestStreak).toBe(1)
  })

  it('la streak cresce con le riuscite e si azzera con un errore (con record)', () => {
    let s = emptyQueryStats()
    for (let i = 0; i < 4; i++) s = recordExecution(s, 10, true, T0 + i * 1_000)
    expect(s.streak).toBe(4)
    expect(s.bestStreak).toBe(4)
    s = recordExecution(s, 10, false, T0 + 5_000)
    expect(s.streak).toBe(0)
    expect(s.bestStreak).toBe(4)
    s = recordExecution(s, 10, true, T0 + 6_000)
    expect(s.streak).toBe(1)
    expect(s.bestStreak).toBe(4)
  })

  it('conta le esecuzioni per giorno (per l\'istogramma)', () => {
    let s = emptyQueryStats()
    const day1 = Date.UTC(2026, 0, 15, 10, 0, 0)
    const day2 = Date.UTC(2026, 0, 16, 10, 0, 0)
    s = recordExecution(s, 10, true, day1)
    s = recordExecution(s, 10, true, day1 + 60_000)
    s = recordExecution(s, 10, false, day2)
    expect(s.dayCounts[dayKey(day1)]).toBe(2)
    expect(s.dayCounts[dayKey(day2)]).toBe(1)
  })

  it('gli esiti tenuti per il grafico sono limitati (MAX_OUTCOMES)', () => {
    let s = emptyQueryStats()
    for (let i = 0; i < MAX_OUTCOMES + 25; i++) s = recordExecution(s, 5, i % 2 === 0, T0 + i * 100)
    expect(s.outcomes.length).toBe(MAX_OUTCOMES)
    expect(s.execCount).toBe(MAX_OUTCOMES + 25) // il conteggio totale resta
  })

  it('senza esecuzioni la percentuale di successo è 0 (non NaN)', () => {
    expect(successRate(emptyQueryStats())).toBe(0)
    expect(averageExecMs(emptyQueryStats())).toBe(0)
  })
})

describe('gamification: XP e livelli', () => {
  it('l\'XP cresce con esecuzioni, tempo attivo, streak e modifiche', () => {
    const base = xpFor(emptyQueryStats())
    expect(base).toBe(0)
    let s = recordExecution(emptyQueryStats(), 10, true, T0)
    for (let i = 0; i < 4; i++) s = recordExecution(s, 10, true, T0 + (i + 1) * 1_000)
    expect(xpFor(s)).toBeGreaterThan(base)
  })

  it('i livelli hanno titolo, medaglia e progresso verso il successivo', () => {
    const l0 = levelInfo(emptyQueryStats())
    expect(l0.level).toBe(1)
    expect(l0.title).toBe('Novizio')
    expect(l0.progress).toBe(0)
    expect(l0.nextTitle).toBe('Apprendista')

    // molti XP → livello alto
    let s = emptyQueryStats()
    for (let i = 0; i < 200; i++) s = recordExecution(s, 100, true, T0 + i * 1_000)
    s = { ...s, activeMs: 60 * 60_000, edits: 500 }
    const hi = levelInfo(s)
    expect(hi.level).toBeGreaterThanOrEqual(4)
    expect(hi.badge.length).toBeGreaterThan(0)
    expect(hi.progress).toBeGreaterThanOrEqual(0)
    expect(hi.progress).toBeLessThanOrEqual(1)
  })

  it('al livello massimo il progresso è 1 e non c\'è un livello successivo', () => {
    const s = { ...emptyQueryStats(), execCount: 5000, bestStreak: 100, activeMs: 600 * 60_000, edits: 1000 }
    const l = levelInfo(s)
    expect(l.level).toBe(7)
    expect(l.progress).toBe(1)
    expect(l.nextTitle).toBeNull()
    expect(l.xpForNext).toBe(0)
  })
})

describe('gamification: persistenza per istanza e tab', () => {
  it('salva e ricarica le statistiche', () => {
    let s = recordExecution(recordEdit(emptyQueryStats(), T0), 250, true, T0 + 1_000)
    saveQueryStats('localhost\\SQL2022', 'tab-2', s)
    const loaded = loadQueryStats('localhost\\SQL2022', 'tab-2')!
    expect(loaded.execCount).toBe(1)
    expect(loaded.edits).toBe(1)
    expect(loaded.lastExecMs).toBe(250)
    expect(loaded.startedAt).toBe(T0)
  })

  it('istanze o tab diverse non si mescolano', () => {
    saveQueryStats('serverA', 'tab-1', { ...emptyQueryStats(), execCount: 3 })
    saveQueryStats('serverB', 'tab-1', { ...emptyQueryStats(), execCount: 7 })
    saveQueryStats('serverA', 'tab-2', { ...emptyQueryStats(), execCount: 9 })
    expect(loadQueryStats('serverA', 'tab-1')!.execCount).toBe(3)
    expect(loadQueryStats('serverB', 'tab-1')!.execCount).toBe(7)
    expect(loadQueryStats('serverA', 'tab-2')!.execCount).toBe(9)
  })

  it('dati assenti o corrotti → default (non lancia)', () => {
    expect(loadQueryStats('mai-visto', 'tab-1')).toBeNull()
    store.set('sqlIntelli.stats.v1.mai-visto.tab-1', '{corrotto')
    expect(loadQueryStats('mai-visto', 'tab-1')).toBeNull()
  })

  it('clearQueryStats rimuove le statistiche della tab', () => {
    saveQueryStats('srv', 'tab-9', { ...emptyQueryStats(), execCount: 5 })
    clearQueryStats('srv', 'tab-9')
    expect(loadQueryStats('srv', 'tab-9')).toBeNull()
  })
})
