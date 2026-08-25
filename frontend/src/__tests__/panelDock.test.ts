import { describe, expect, it } from 'vitest'
import {
  clampPanelSize,
  DEFAULT_PANEL_STATE,
  dockSideFromDrop,
  MIN_PANEL_HEIGHT,
  MIN_PANEL_WIDTH,
  normalizePanelState,
  resolveRightDock,
} from '../panelLayout'

describe('panelLayout: dimensioni minime dei pannelli', () => {
  it('non scende sotto i minimi', () => {
    expect(clampPanelSize(10, 10)).toEqual({ width: MIN_PANEL_WIDTH, height: MIN_PANEL_HEIGHT })
  })

  it('arrotonda e limita al massimo', () => {
    const s = clampPanelSize(333.7, 2000)
    expect(s.width).toBe(334)
    expect(s.height).toBe(1200)
  })

  it('lascia intatte le dimensioni valide', () => {
    expect(clampPanelSize(400, 300)).toEqual({ width: 400, height: 300 })
  })
})

describe('panelLayout: dove si aggancia un pannello rilasciato', () => {
  const viewport = { width: 1400, height: 900 }
  const sidebar = { left: 0, top: 60, width: 320, height: 700 }

  it('rilascio dentro la sidebar → sinistra', () => {
    expect(dockSideFromDrop({ x: 150, y: 400 }, viewport, sidebar)).toBe('left')
  })

  it('rilascio sul bordo destro dello schermo → destra', () => {
    expect(dockSideFromDrop({ x: 1300, y: 400 }, viewport, sidebar)).toBe('right')
  })

  it('rilascio al centro → null (resta flottante)', () => {
    expect(dockSideFromDrop({ x: 800, y: 400 }, viewport, sidebar)).toBeNull()
  })

  it('senza rettangolo sidebar la zona sinistra non aggancia', () => {
    expect(dockSideFromDrop({ x: 150, y: 400 }, viewport, null)).toBeNull()
  })
})

describe('panelLayout: un solo pannello a destra', () => {
  it('se è già lui, resta', () => {
    expect(resolveRightDock('db', 'db')).toEqual({ right: 'db', movedToLeft: null })
  })

  it('un altro pannello prende il posto e l\'ex-destinazione torna a sinistra', () => {
    expect(resolveRightDock('objects', 'db')).toEqual({ right: 'objects', movedToLeft: 'db' })
  })

  it('nessun pannello a destra → nessuno torna a sinistra', () => {
    expect(resolveRightDock('db', null)).toEqual({ right: 'db', movedToLeft: null })
  })
})

describe('panelLayout: normalizzazione dello stato persistito', () => {
  it('stato mancante → default completi', () => {
    const s = normalizePanelState(null)
    expect(s.db).toEqual(DEFAULT_PANEL_STATE.db)
    expect(s.objects).toEqual(DEFAULT_PANEL_STATE.objects)
  })

  it('stato di una versione precedente (senza dockSide/larghezza) riceve i default', () => {
    const old = { db: { open: true, floating: false, x: 10, y: 20, height: 150 } }
    const s = normalizePanelState(old)
    expect(s.db.x).toBe(10)
    expect(s.db.y).toBe(20)
    expect(s.db.dockSide).toBe('left')
    expect(s.db.width).toBe(DEFAULT_PANEL_STATE.db.width)
    expect(s.db.dockHeight).toBe(150)
    expect(s.objects.open).toBe(true)
  })

  it('valori corrotti non fanno crashare e cadono sui default', () => {
    const s = normalizePanelState({ db: { open: 'sì', x: 'abc', dockSide: 'su' }, objects: null })
    expect(s.db.open).toBe(true)
    expect(s.db.x).toBe(DEFAULT_PANEL_STATE.db.x)
    expect(s.db.dockSide).toBe('left')
    expect(s.objects.open).toBe(true)
  })

  it('dockSide "right" viene conservato', () => {
    const s = normalizePanelState({ db: { dockSide: 'right', width: 450 } })
    expect(s.db.dockSide).toBe('right')
    expect(s.db.width).toBe(450)
  })

  it('lo stato è serializzabile in JSON (per localStorage)', () => {
    const json = JSON.stringify(DEFAULT_PANEL_STATE)
    const parsed = JSON.parse(json)
    expect(parsed.db).toEqual(DEFAULT_PANEL_STATE.db)
    expect(parsed.objects).toEqual(DEFAULT_PANEL_STATE.objects)
  })
})
