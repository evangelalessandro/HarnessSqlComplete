// Logica pura dei pannelli dock (Database/Oggetti): dimensioni minime,
// scelta del lato di aggancio al rilascio di un pannello flottante,
// risoluzione della colonna destra (uno solo alla volta) e normalizzazione
// dello stato persistito in localStorage.

export interface PanelSize {
  width: number
  height: number
}

export const MIN_PANEL_WIDTH = 240
export const MIN_PANEL_HEIGHT = 140
export const MAX_PANEL_WIDTH = 900
export const MAX_PANEL_HEIGHT = 1200

/** Limita le dimensioni di un pannello flottante ai minimi/massimi. */
export function clampPanelSize(width: number, height: number): PanelSize {
  return {
    width: Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(width))),
    height: Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, Math.round(height))),
  }
}

export type DockSide = 'left' | 'right'

export interface DropPoint {
  x: number
  y: number
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Decide dove agganciare un pannello flottante rilasciato in (x, y):
 * - dentro il rettangolo della sidebar (o in generale nella zona sinistra) → 'left';
 * - vicino al bordo destro dello schermo → 'right';
 * - altrimenti null (il pannello resta flottante).
 */
export function dockSideFromDrop(
  point: DropPoint,
  viewport: { width: number; height: number },
  sidebarRect: Rect | null,
): DockSide | null {
  if (
    sidebarRect &&
    point.x >= sidebarRect.left &&
    point.x <= sidebarRect.left + sidebarRect.width &&
    point.y >= sidebarRect.top &&
    point.y <= sidebarRect.top + sidebarRect.height
  ) {
    return 'left'
  }
  if (point.x > viewport.width - 220) return 'right'
  return null
}

/**
 * La colonna destra ospita UN solo pannello: se `panel` è già quello a destra
 * resta; altrimenti il pannello attualmente a destra torna a sinistra e
 * `panel` prende il suo posto.
 */
export function resolveRightDock(
  panel: 'db' | 'objects',
  currentRight: 'db' | 'objects' | null,
): { right: 'db' | 'objects'; movedToLeft: 'db' | 'objects' | null } {
  if (currentRight === panel) return { right: panel, movedToLeft: null }
  return { right: panel, movedToLeft: currentRight }
}

/** Stato persistito di un singolo pannello (in localStorage 'sql-intelli:panels'). */
export interface PanelInfo {
  open: boolean
  floating: boolean
  dockSide: DockSide
  x: number
  y: number
  /** Dimensioni quando è flottante. */
  width: number
  height: number
  /** Altezza quando è ancorato a sinistra (pannello Database; regolata dal divisore). */
  dockHeight: number
}

export interface PanelState {
  db: PanelInfo
  objects: PanelInfo
}

export const DEFAULT_PANEL_STATE: PanelState = {
  db: { open: true, floating: false, dockSide: 'left', x: 60, y: 60, width: 340, height: 340, dockHeight: 180 },
  objects: { open: true, floating: false, dockSide: 'left', x: 60, y: 280, width: 340, height: 420, dockHeight: 0 },
}

const clampNum = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const clampBool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback

const clampSide = (v: unknown): DockSide => (v === 'right' ? 'right' : 'left')

function normalizePanelInfo(raw: unknown, def: PanelInfo): PanelInfo {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    open: clampBool(r.open, def.open),
    floating: clampBool(r.floating, def.floating),
    dockSide: clampSide(r.dockSide),
    x: clampNum(r.x, def.x),
    y: clampNum(r.y, def.y),
    width: clampNum(r.width, def.width),
    height: clampNum(r.height, def.height),
    // le versioni precedenti usavano "height" per l'altezza ancorata del pannello Database
    dockHeight: clampNum(r.dockHeight ?? r.height, def.dockHeight),
  }
}

/**
 * Normalizza lo stato caricato da localStorage (può essere di una versione
 * precedente dell'app o corrotto): ogni campo mancante riceve il default,
 * senza mai lanciare eccezioni.
 */
export function normalizePanelState(raw: unknown): PanelState {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    db: normalizePanelInfo(r.db, DEFAULT_PANEL_STATE.db),
    objects: normalizePanelInfo(r.objects, DEFAULT_PANEL_STATE.objects),
  }
}
