import { describe, expect, it } from 'vitest'
import { DEFAULT_PANEL_STATE } from '../panelLayout'

/**
 * Stato dei pannelli dock (Database/Oggetti) come in Visual Studio:
 * chiudibili (open), staccabili (floating), ridimensionabili e agganciabili
 * a sinistra (sidebar) o a destra (colonna laterale).
 * Il modulo Sidebar persiste questo stato in localStorage ('sql-intelli:panels').
 */
describe('Dock panels (stile Visual Studio)', () => {
  it('lo stato di default ha entrambi i pannelli aperti, ancorati a sinistra e non flottanti', () => {
    expect(DEFAULT_PANEL_STATE.db.open).toBe(true)
    expect(DEFAULT_PANEL_STATE.objects.open).toBe(true)
    expect(DEFAULT_PANEL_STATE.db.floating).toBe(false)
    expect(DEFAULT_PANEL_STATE.objects.floating).toBe(false)
    expect(DEFAULT_PANEL_STATE.db.dockSide).toBe('left')
    expect(DEFAULT_PANEL_STATE.objects.dockSide).toBe('left')
  })

  it('l\'altezza ancorata del pannello Database ha un valore di partenza sensato', () => {
    expect(DEFAULT_PANEL_STATE.db.dockHeight).toBeGreaterThanOrEqual(60)
  })

  it('la forma dello stato è serializzabile in JSON (per localStorage)', () => {
    const json = JSON.stringify(DEFAULT_PANEL_STATE)
    const parsed = JSON.parse(json)
    expect(parsed.db).toEqual(DEFAULT_PANEL_STATE.db)
    expect(parsed.objects).toEqual(DEFAULT_PANEL_STATE.objects)
  })

  it('chiudere un pannello non tocca l\'altro', () => {
    const closed = { ...DEFAULT_PANEL_STATE, objects: { ...DEFAULT_PANEL_STATE.objects, open: false } }
    expect(closed.db.open).toBe(true)
    expect(closed.objects.open).toBe(false)
  })

  it('spostare un pannello flottante aggiorna solo x/y', () => {
    const moved = { ...DEFAULT_PANEL_STATE, db: { ...DEFAULT_PANEL_STATE.db, x: 320, y: 140 } }
    expect(moved.db.x).toBe(320)
    expect(moved.db.y).toBe(140)
    expect(moved.db.width).toBe(DEFAULT_PANEL_STATE.db.width)
  })
})
