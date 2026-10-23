// Finestra "Modifiche": la griglia con gli oggetti del database e QUANDO sono stati modificati.
// Qui c'è solo la logica pura (niente React): tipo dell'oggetto, date leggibili, "quanto fa",
// filtri e ordinamento — così si può verificare con i test unitari.
import type { ObjectChangeRow } from './types'

/** Tipo dell'oggetto così come lo mostra l'app (le stesse diciture dei risultati di ricerca). */
export type TipoModifica = 'procedura' | 'funzione' | 'vista' | 'tabella' | 'trigger'

/**
 * `sys.objects.type` → tipo dell'app. Le funzioni (scalari, inline, tabella) diventano tutte
 * "funzione"; il resto è mappato sul tipo corrispondente.
 */
export function tipoDaCodice(typeCode: string): TipoModifica | null {
  switch (typeCode.trim().toUpperCase()) {
    case 'P':
    case 'PC':
      return 'procedura'
    case 'FN':
    case 'IF':
    case 'TF':
    case 'FS':
    case 'FT':
      return 'funzione'
    case 'V':
      return 'vista'
    case 'U':
      return 'tabella'
    case 'TR':
      return 'trigger'
    default:
      return null
  }
}

/** Etichetta al plurale usata dai filtri e dal riepilogo. */
export function etichettaTipo(t: TipoModifica): string {
  switch (t) {
    case 'procedura':
      return 'Store'
    case 'funzione':
      return 'Funzioni'
    case 'vista':
      return 'Viste'
    case 'tabella':
      return 'Tabelle'
    case 'trigger':
      return 'Trigger'
  }
}

export const TIPI_MODIFICA: TipoModifica[] = ['procedura', 'funzione', 'vista', 'tabella', 'trigger']

/** Il tipo "italiano" della finestra → il kind usato dal resto dell'app per aprire l'oggetto. */
export function tipoOggettoApp(
  t: TipoModifica,
): 'procedure' | 'function' | 'view' | 'trigger' | null {
  switch (t) {
    case 'procedura':
      return 'procedure'
    case 'funzione':
      return 'function'
    case 'vista':
      return 'view'
    case 'trigger':
      return 'trigger'
    case 'tabella':
      return null
  }
}

/** Nome qualificato, senza schema per dbo (come nel resto dell'app). */
export function nomeModifica(r: ObjectChangeRow): string {
  return r.schema === 'dbo' ? r.name : `${r.schema}.${r.name}`
}

/**
 * Data e ora locali "gg/mm/aaaa hh:mm" (le date di SQL Server arrivano in UTC e `Date` le
 * converte nell'ora del browser).
 */
export function formatDataOra(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const due = (n: number) => String(n).padStart(2, '0')
  return `${due(d.getDate())}/${due(d.getMonth() + 1)}/${d.getFullYear()} ${due(d.getHours())}:${due(d.getMinutes())}`
}

/** Solo il giorno "gg/mm/aaaa". */
export function formatGiorno(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const due = (n: number) => String(n).padStart(2, '0')
  return `${due(d.getDate())}/${due(d.getMonth() + 1)}/${d.getFullYear()}`
}

/**
 * Quanto tempo fa, in italiano ("ora", "5 minuti fa", "3 ore fa", "2 giorni fa", "il 12/03/2024").
 * Oltre i 30 giorni si mostra la data, perché "57 giorni fa" non aiuta.
 */
export function quantoFa(iso: string | null, adesso: Date = new Date()): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const secondi = Math.max(0, Math.round((adesso.getTime() - d.getTime()) / 1000))
  if (secondi < 60) return 'ora'
  const minuti = Math.round(secondi / 60)
  if (minuti < 60) return `${minuti} ${minuti === 1 ? 'minuto' : 'minuti'} fa`
  const ore = Math.round(minuti / 60)
  if (ore < 24) return `${ore} ${ore === 1 ? 'ora' : 'ore'} fa`
  const giorni = Math.round(ore / 24)
  if (giorni <= 30) return `${giorni} ${giorni === 1 ? 'giorno' : 'giorni'} fa`
  return `il ${formatGiorno(iso)}`
}

/** La modifica è di oggi? (usato per evidenziare la riga) */
export function modificatoOggi(iso: string | null, adesso: Date = new Date()): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return (
    d.getFullYear() === adesso.getFullYear() &&
    d.getMonth() === adesso.getMonth() &&
    d.getDate() === adesso.getDate()
  )
}

export type ChiaveOrdine = 'modifiedAt' | 'createdAt' | 'name' | 'tipo' | 'schema'
export type VersoOrdine = 'asc' | 'desc'
export type FinestraPeriodo = 'tutto' | '1' | '7' | '30'

export interface FiltriModifiche {
  /** Testo cercato nel nome (e nello schema). */
  testo?: string
  /** Tipi da mostrare; vuoto/assente = tutti. */
  tipi?: TipoModifica[]
  /** Solo le modifiche degli ultimi N giorni ('tutto' = nessun limite). */
  periodo?: FinestraPeriodo
}

/** Filtra per nome, tipo e periodo (le date nulle restano solo con periodo "tutto"). */
export function filtraModifiche(
  righe: ObjectChangeRow[],
  filtri: FiltriModifiche,
  adesso: Date = new Date(),
): ObjectChangeRow[] {
  const testo = (filtri.testo ?? '').trim().toLowerCase()
  const tipi = filtri.tipi ?? []
  const giorni = filtri.periodo && filtri.periodo !== 'tutto' ? Number(filtri.periodo) : 0
  const limite = giorni > 0 ? adesso.getTime() - giorni * 24 * 3600 * 1000 : 0
  return righe.filter(r => {
    if (testo && !`${r.schema}.${r.name}`.toLowerCase().includes(testo)) return false
    if (tipi.length > 0) {
      const t = tipoDaCodice(r.typeCode)
      if (!t || !tipi.includes(t)) return false
    }
    if (limite > 0) {
      const d = r.modifiedAt ? new Date(r.modifiedAt).getTime() : NaN
      if (Number.isNaN(d) || d < limite) return false
    }
    return true
  })
}

/** Ordinamento stabile: a parità di valore si confronta il nome, così l'ordine non "salta". */
export function ordinaModifiche(
  righe: ObjectChangeRow[],
  chiave: ChiaveOrdine,
  verso: VersoOrdine,
): ObjectChangeRow[] {
  const segno = verso === 'asc' ? 1 : -1
  const valore = (r: ObjectChangeRow): string | number => {
    switch (chiave) {
      case 'modifiedAt':
        return r.modifiedAt ? new Date(r.modifiedAt).getTime() : 0
      case 'createdAt':
        return r.createdAt ? new Date(r.createdAt).getTime() : 0
      case 'name':
        return `${r.schema}.${r.name}`.toLowerCase()
      case 'schema':
        return r.schema.toLowerCase()
      case 'tipo':
        return (tipoDaCodice(r.typeCode) ?? 'zzz') + r.name.toLowerCase()
    }
  }
  return [...righe].sort((a, b) => {
    const va = valore(a)
    const vb = valore(b)
    let esito = 0
    if (typeof va === 'number' && typeof vb === 'number') esito = va - vb
    else esito = String(va).localeCompare(String(vb), 'it')
    if (esito !== 0) return esito * segno
    return `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`, 'it')
  })
}

/** Quanti oggetti per tipo (per i pulsanti dei filtri, che mostrano il conteggio). */
export function contaPerTipo(righe: ObjectChangeRow[]): Record<TipoModifica, number> {
  const out: Record<TipoModifica, number> = {
    procedura: 0,
    funzione: 0,
    vista: 0,
    tabella: 0,
    trigger: 0,
  }
  for (const r of righe) {
    const t = tipoDaCodice(r.typeCode)
    if (t) out[t]++
  }
  return out
}

/**
 * Righe raggruppate per GIORNO di modifica (il più recente per primo): la finestra mostra una
 * intestazione di giorno e sotto le modifiche di quel giorno, come uno storico.
 */
export function raggruppaPerGiorno(
  righe: ObjectChangeRow[],
): { giorno: string; righe: ObjectChangeRow[] }[] {
  const perGiorno = new Map<string, ObjectChangeRow[]>()
  for (const r of ordinaModifiche(righe, 'modifiedAt', 'desc')) {
    const chiave = r.modifiedAt ? formatGiorno(r.modifiedAt) : 'senza data'
    if (!perGiorno.has(chiave)) perGiorno.set(chiave, [])
    perGiorno.get(chiave)!.push(r)
  }
  return [...perGiorno.entries()].map(([giorno, gruppo]) => ({ giorno, righe: gruppo }))
}

/** Riepilogo in una riga per l'intestazione della finestra. */
export function riepilogoModifiche(righe: ObjectChangeRow[], adesso: Date = new Date()): string {
  const conteggi = contaPerTipo(righe)
  const oggi = righe.filter(r => modificatoOggi(r.modifiedAt, adesso)).length
  const parti = [`${righe.length} oggetti`]
  if (conteggi.procedura > 0) parti.push(`${conteggi.procedura} store`)
  if (conteggi.funzione > 0) parti.push(`${conteggi.funzione} funzioni`)
  if (conteggi.vista > 0) parti.push(`${conteggi.vista} viste`)
  if (conteggi.tabella > 0) parti.push(`${conteggi.tabella} tabelle`)
  if (conteggi.trigger > 0) parti.push(`${conteggi.trigger} trigger`)
  parti.push(oggi > 0 ? `${oggi} modificati oggi` : 'nessuno modificato oggi')
  return parti.join(' · ')
}
