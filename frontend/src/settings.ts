// Impostazioni dell'editor (dimensione testo, tema, posizione delle nuove tab) in localStorage.
import type { NewTabPosition } from './tabOps'
import type { MotoreFormattazione, OpzioniSqlFluff } from './formatEngine'
import { MOTORI_FORMATTAZIONE, normalizzaOpzioniSqlFluff } from './formatEngine'

const KEY = 'sqlIntelli.settings.v1'

export interface EditorSettings {
  fontSize: number
  theme: 'vs' | 'vs-dark'
  /** Dove aprire le nuove tab: a sinistra ('start'), dopo quella attiva o in fondo. */
  newTabPosition: NewTabPosition
  /** Motore di formattazione: 'nostro' (profilo dell'app) o 'sqlfluff' (CLI Python). */
  formatter: MotoreFormattazione
  /** Opzioni di SQLFluff (rientri, maiuscole, virgola, larghezza riga). */
  sqlFluff: OpzioniSqlFluff
  /**
   * Invio dopo la virgola → la virgola va in testa alla riga nuova (stile del progetto).
   * Richiesta utente: "Enter e virgola intelligenti".
   */
  virgolaACapo: boolean
}

const DEFAULTS: EditorSettings = {
  fontSize: 13,
  theme: 'vs-dark',
  newTabPosition: 'end',
  formatter: 'nostro',
  sqlFluff: normalizzaOpzioniSqlFluff(undefined),
  virgolaACapo: true,
}

/** Posizioni valide per le nuove tab (usato per validare il valore salvato). */
const TAB_POSITIONS: NewTabPosition[] = ['start', 'afterActive', 'end']

export function loadSettings(): EditorSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULTS }
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const p = JSON.parse(raw) as Partial<EditorSettings>
    return {
      fontSize:
        typeof p.fontSize === 'number' && p.fontSize >= 8 && p.fontSize <= 40 ? p.fontSize : DEFAULTS.fontSize,
      theme: p.theme === 'vs' ? 'vs' : 'vs-dark',
      newTabPosition: TAB_POSITIONS.includes(p.newTabPosition as NewTabPosition)
        ? (p.newTabPosition as NewTabPosition)
        : DEFAULTS.newTabPosition,
      formatter: MOTORI_FORMATTAZIONE.includes(p.formatter as MotoreFormattazione)
        ? (p.formatter as MotoreFormattazione)
        : DEFAULTS.formatter,
      sqlFluff: normalizzaOpzioniSqlFluff(p.sqlFluff),
      // salvo scelta esplicita, la virgola va a capo (comportamento predefinito)
      virgolaACapo: typeof p.virgolaACapo === 'boolean' ? p.virgolaACapo : DEFAULTS.virgolaACapo,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: EditorSettings): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignora */
  }
}
