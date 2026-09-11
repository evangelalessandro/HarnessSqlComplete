import { describe, expect, it } from 'vitest'
import { buildTabClosePlan, countClosableTabs, insertTabAfterActive, newTabIndex } from '../tabOps'
import type { EditorTab } from '../types'
import appSource from '../App.tsx?raw'

const tab = (id: string, pinned = false): EditorTab => ({ id, title: id, sql: '', pinned })

describe('TAB: chiusure multiple in stile SSMS (tasto destro)', () => {
  const tabs = [
    tab('A', true), // appuntata in testa
    tab('B'),
    tab('C', true), // appuntata in mezzo
    tab('D'), // ancoraggio (tasto destro qui)
    tab('E'),
    tab('F'),
  ]

  it('a destra: chiude solo le non appuntate dopo l\'ancora', () => {
    const plan = buildTabClosePlan(tabs, 'D', 'right')
    expect(plan.removedIds).toEqual(['E', 'F'])
    expect(plan.kept.map(t => t.id)).toEqual(['A', 'B', 'C', 'D'])
    expect(plan.focusId).toBe('D') // l'ancora resta
  })

  it('a sinistra: chiude solo le non appuntate prima dell\'ancora', () => {
    const plan = buildTabClosePlan(tabs, 'D', 'left')
    expect(plan.removedIds).toEqual(['B'])
    expect(plan.kept.map(t => t.id)).toEqual(['A', 'C', 'D', 'E', 'F'])
    expect(plan.focusId).toBe('D')
  })

  it('tutte le altre: chiude tutte le non appuntate tranne l\'ancora (pin protetti)', () => {
    const plan = buildTabClosePlan(tabs, 'D', 'others')
    expect(plan.removedIds).toEqual(['B', 'E', 'F'])
    expect(plan.kept.map(t => t.id)).toEqual(['A', 'C', 'D'])
    expect(plan.focusId).toBe('D')
  })

  it('non appuntate: chiude tutte quelle senza pin (anche l\'ancora)', () => {
    const plan = buildTabClosePlan(tabs, 'D', 'unpinned')
    expect(plan.removedIds).toEqual(['B', 'D', 'E', 'F'])
    expect(plan.kept.map(t => t.id)).toEqual(['A', 'C'])
    // l'ancora è stata chiusa → focus sulla prima superstite
    expect(plan.focusId).toBe('A')
  })

  it('se l\'attiva (non l\'ancora) viene chiusa, il focus va sull\'ancora superstite', () => {
    // la tab attiva è B, si chiude tutto a destra di D → B resta, focus invariato (gestito altrove)
    const plan = buildTabClosePlan(tabs, 'D', 'right')
    expect(plan.kept.some(t => t.id === 'B')).toBe(true)
    expect(plan.focusId).toBe('D')
  })

  it('nessuna superstite (tutte non appuntate) → lista vuota e focus vuoto', () => {
    const only = [tab('X'), tab('Y'), tab('Z')]
    const plan = buildTabClosePlan(only, 'Y', 'unpinned')
    expect(plan.kept).toEqual([])
    expect(plan.removedIds).toEqual(['X', 'Y', 'Z'])
    expect(plan.focusId).toBe('')
  })

  it('count: quante tab chiuderebbe ogni azione (per disabilitare le voci vuote)', () => {
    expect(countClosableTabs(tabs, 'D', 'right')).toBe(2)
    expect(countClosableTabs(tabs, 'D', 'left')).toBe(1)
    expect(countClosableTabs(tabs, 'D', 'others')).toBe(3)
    expect(countClosableTabs(tabs, 'D', 'unpinned')).toBe(4)
    // tutte appuntate → nessuna azione ha senso
    const allPinned = [tab('A', true), tab('B', true)]
    expect(countClosableTabs(allPinned, 'A', 'others')).toBe(0)
    expect(countClosableTabs(allPinned, 'A', 'right')).toBe(0)
    expect(countClosableTabs(allPinned, 'A', 'unpinned')).toBe(0)
  })
})

describe('TAB: dove finisce una tab nuova', () => {
  const tabs = [tab('A'), tab('B'), tab('C'), tab('D')]

  it('subito dopo la tab attiva, non in fondo a destra', () => {
    // attiva B → la nuova tab va fra B e C
    expect(insertTabAfterActive(tabs, tab('N'), 'B').map(t => t.id)).toEqual(['A', 'B', 'N', 'C', 'D'])
    expect(newTabIndex(tabs, 'B')).toBe(2)
  })

  it('se l attiva è l ultima resta in fondo (come prima)', () => {
    expect(insertTabAfterActive(tabs, tab('N'), 'D').map(t => t.id)).toEqual(['A', 'B', 'C', 'D', 'N'])
  })

  it('se l attiva è la prima, la nuova tab va subito dopo di lei', () => {
    expect(insertTabAfterActive(tabs, tab('N'), 'A').map(t => t.id)).toEqual(['A', 'N', 'B', 'C', 'D'])
  })

  it('senza tab attiva (o attiva inesistente) si accoda', () => {
    expect(insertTabAfterActive(tabs, tab('N'), '').map(t => t.id)).toEqual(['A', 'B', 'C', 'D', 'N'])
    expect(insertTabAfterActive(tabs, tab('N'), 'Z').map(t => t.id)).toEqual(['A', 'B', 'C', 'D', 'N'])
    expect(insertTabAfterActive([], tab('N'), '').map(t => t.id)).toEqual(['N'])
  })

  it('le altre tab restano nell ordine originale (anche con tab appuntate)', () => {
    const mixed = [tab('P1', true), tab('B'), tab('P2', true), tab('D')]
    const out = insertTabAfterActive(mixed, tab('N'), 'B')
    expect(out.map(t => t.id)).toEqual(['P1', 'B', 'N', 'P2', 'D'])
    // nessuna delle tab esistenti viene duplicata o persa
    for (const t of mixed) expect(out.filter(x => x.id === t.id).length).toBe(1)
  })

  it('l apertura di una tab nell app usa questa regola', () => {
    expect(appSource).toContain('insertTabAfterActive(prev, tab, activeEditorTab)')
    // e non deve essere tornata l aggiunta in fondo
    expect(appSource).not.toContain('setEditorTabs(prev => [...prev, tab])')
  })
})
