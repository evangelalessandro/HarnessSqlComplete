// Gerarchia delle tab: una tab aperta da un link diventa FIGLIA di quella attiva.
// Segnalazione utente: "mi fai una tab sotto quella corrente, in senso di gerarchia, così da
// avere le figlie della tab principale sotto … massimo 5 livelli … le posso draggare dove voglio
// e riportarle in prima linea … se chiudo quella sopra chiedimi se chiudere anche le figlie".
import { describe, expect, it } from 'vitest'
import {
  MAX_TAB_DEPTH,
  childParentFor,
  closeTabIds,
  descendants,
  directChildren,
  insertTabAsChild,
  moveTabSubtree,
  sanitizeTabParents,
  subtreeIds,
  tabDepth,
} from '../tabTree'
import type { EditorTab } from '../types'

function tab(id: string, parentId?: string): EditorTab {
  return { id, title: id, sql: '', parentId }
}

/** A -> A1 -> A2 (catena), B principale. */
const albero: EditorTab[] = [tab('A'), tab('A1', 'A'), tab('A2', 'A1'), tab('B')]

describe('tabDepth', () => {
  it('conta i livelli sotto la principale', () => {
    expect(tabDepth(albero, 'A')).toBe(0)
    expect(tabDepth(albero, 'A1')).toBe(1)
    expect(tabDepth(albero, 'A2')).toBe(2)
    expect(tabDepth(albero, 'B')).toBe(0)
  })

  it('padre mancante o ciclo valgono 0 (la tab torna principale)', () => {
    expect(tabDepth([tab('X', 'sparita')], 'X')).toBe(0)
    expect(tabDepth([tab('X', 'Y'), tab('Y', 'X')], 'X')).toBe(0)
  })
})

describe('childParentFor: la nuova tab è figlia di quella attiva', () => {
  it('senza tab attiva la nuova tab è principale', () => {
    expect(childParentFor(albero, '')).toBeUndefined()
    expect(childParentFor(albero, 'inesistente')).toBeUndefined()
  })

  it('figlia della tab attiva, al livello successivo', () => {
    expect(childParentFor(albero, 'A')).toBe('A')
    expect(childParentFor(albero, 'A2')).toBe('A2')
  })

  it('al livello massimo la nuova tab diventa SORELLA (non si scava oltre 5)', () => {
    const catena: EditorTab[] = [tab('l0')]
    for (let i = 1; i <= MAX_TAB_DEPTH; i++) catena.push(tab(`l${i}`, `l${i - 1}`))
    expect(tabDepth(catena, `l${MAX_TAB_DEPTH}`)).toBe(MAX_TAB_DEPTH)
    // la tab attiva è all'ultimo livello consentito: il padre usato è il suo
    expect(childParentFor(catena, `l${MAX_TAB_DEPTH}`)).toBe(`l${MAX_TAB_DEPTH - 1}`)
  })
})

describe('insertTabAsChild', () => {
  it('mette la figlia subito dopo il padre (in fondo al suo gruppo)', () => {
    const dopo = insertTabAsChild(albero, tab('A1b'), 'A')
    expect(dopo.map(t => t.id)).toEqual(['A', 'A1', 'A2', 'A1b', 'B'])
    expect(dopo.find(t => t.id === 'A1b')!.parentId).toBe('A')
  })

  it('con un padre inesistente accoda la tab come principale', () => {
    const dopo = insertTabAsChild(albero, tab('Z'), 'sparita')
    expect(dopo.map(t => t.id)).toEqual(['A', 'A1', 'A2', 'B', 'Z'])
    expect(dopo[dopo.length - 1].parentId).toBeUndefined()
  })
})

describe('moveTabSubtree: trascinare stacca e riporta in prima linea', () => {
  it('sposta la tab dove è stata lasciata e le toglie il padre', () => {
    const dopo = moveTabSubtree(albero, 'A2', 'B')
    expect(dopo.map(t => t.id)).toEqual(['A', 'A1', 'A2', 'B'])
    expect(dopo.find(t => t.id === 'A2')!.parentId).toBeUndefined()
  })

  it('la tab trascinata si porta dietro le sue figlie', () => {
    const dopo = moveTabSubtree(albero, 'A1', 'B')
    // A1 (con A2) davanti a B, A resta principale
    expect(dopo.map(t => t.id)).toEqual(['A', 'A1', 'A2', 'B'])
    expect(dopo.find(t => t.id === 'A1')!.parentId).toBeUndefined()
    // A2 resta figlia di A1
    expect(dopo.find(t => t.id === 'A2')!.parentId).toBe('A1')
  })

  it('non sposta un gruppo dentro se stesso', () => {
    expect(moveTabSubtree(albero, 'A', 'A2')).toBe(albero)
  })
})

describe('chiusura con le figlie', () => {
  it('descrive figlie e discendenti', () => {
    expect(directChildren(albero, 'A').map(t => t.id)).toEqual(['A1'])
    expect(descendants(albero, 'A').map(t => t.id)).toEqual(['A1', 'A2'])
    expect(subtreeIds(albero, 'A')).toEqual(['A', 'A1', 'A2'])
  })

  it('closeTabIds: solo lei oppure tutto il ramo', () => {
    expect(closeTabIds(albero, 'A', false)).toEqual(['A'])
    expect(closeTabIds(albero, 'A', true)).toEqual(['A', 'A1', 'A2'])
    expect(closeTabIds(albero, 'A1', true)).toEqual(['A1', 'A2'])
  })
})

describe('sanitizeTabParents', () => {
  it('padre chiuso → la tab torna principale', () => {
    const dopo = sanitizeTabParents([tab('A'), tab('B', 'A')].filter(t => t.id !== 'A'))
    expect(dopo[0].parentId).toBeUndefined()
  })

  it('catena più lunga del massimo → si taglia al livello massimo', () => {
    const catena: EditorTab[] = [tab('l0')]
    for (let i = 1; i <= MAX_TAB_DEPTH + 2; i++) catena.push(tab(`l${i}`, `l${i - 1}`))
    const dopo = sanitizeTabParents(catena)
    for (const t of dopo) expect(tabDepth(dopo, t.id)).toBeLessThanOrEqual(MAX_TAB_DEPTH)
    // l'ultima resta appesa, ma entro il limite
    expect(tabDepth(dopo, `l${MAX_TAB_DEPTH + 2}`)).toBe(MAX_TAB_DEPTH)
  })

  it('ciclo → spezzato', () => {
    const dopo = sanitizeTabParents([tab('X', 'Y'), tab('Y', 'X')])
    expect(dopo.every(t => tabDepth(dopo, t.id) === 0)).toBe(true)
  })

  it('senza problemi restituisce lo stesso array (nessuna copia inutile)', () => {
    expect(sanitizeTabParents([tab('A'), tab('B', 'A')])).toHaveLength(2)
    const sano = [tab('A'), tab('B', 'A')]
    expect(sanitizeTabParents(sano)).toBe(sano)
  })
})
