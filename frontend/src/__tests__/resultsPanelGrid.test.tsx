// @vitest-environment jsdom
// LA VISTA NORMALE DEI RISULTATI (quella che si vede dopo aver eseguito una query).
//
// Bug segnalato: "nella griglia dei risultati non riesco a spostare le colonne e non vedo
// i colori alternati". Causa: il pannello risultati aveva una tabella scritta a parte, con
// due soli colori quasi identici (zinc-950 e zinc-900 al 50%) e senza intestazioni
// trascinabili; le migliorie stavano solo nel componente del generatore SQL.
// Questi test guardano il pannello risultati vero, non il componente condiviso.
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import ResultsPanel from '../components/ResultsPanel'
import { ZEBRA_CLASSES } from '../resultGrid'
import type { QueryResult } from '../types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const result: QueryResult = {
  resultSets: [
    {
      columns: [
        { name: 'MIS_UDC', dataType: 'nvarchar' },
        { name: 'MIS_OPERATORE', dataType: 'nvarchar' },
        { name: 'MIS_MISSIONE', dataType: 'int' },
      ],
      rows: [
        ['UDC1', 'MARIO', 1],
        ['UDC2', 'LUCA', 2],
        ['UDC3', 'ANNA', 3],
        ['UDC4', 'SARA', 4],
      ],
      rowCount: 4,
      affectedRows: 0,
      truncated: false,
    },
  ],
  totalAffectedRows: 0,
  messages: [],
  elapsedMs: 8,
  error: null,
}

let container: HTMLDivElement | null = null
let root: Root | null = null

function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<ResultsPanel result={result} executing={false} />)
  })
  return container
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  container = null
  root = null
})

const heads = (el: HTMLElement) => [...el.querySelectorAll('thead th')]
/** Colonne mostrate nell'ordine in cui appaiono (senza la colonna del numero di riga). */
const shownColumns = (el: HTMLElement) =>
  heads(el)
    .slice(1)
    .map(th => (th.getAttribute('title') ?? '').split(' ')[0])
const rowNumbers = (el: HTMLElement) =>
  [...el.querySelectorAll('tbody tr')].map(tr => tr.querySelector('td')?.textContent?.trim() ?? '')
const firstRowValues = (el: HTMLElement) =>
  [...(el.querySelectorAll('tbody tr')[0]?.querySelectorAll('td') ?? [])].slice(1).map(td => td.textContent?.trim() ?? '')

function dragHeader(el: HTMLElement, fromIndex: number, toIndex: number) {
  const list = heads(el).slice(1) // salta la colonna del numero di riga
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: () => {}, getData: () => '' }
  const fire = (target: Element, type: string) => {
    const ev = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer })
    act(() => {
      target.dispatchEvent(ev)
    })
  }
  fire(list[fromIndex], 'dragstart')
  fire(list[toIndex], 'dragover')
  fire(list[toIndex], 'drop')
  fire(list[fromIndex], 'dragend')
}

describe('vista normale dei risultati: foglio dati', () => {
  it('ha il NUMERO DI RIGA come prima colonna e le linee fra le colonne', () => {
    const el = mount()
    const first = heads(el)[0]
    expect(first.textContent?.trim()).toBe('#')
    expect(first.className).toContain('sticky')
    expect(first.className).toContain('border-r')
    for (const th of heads(el).slice(1)) {
      expect(th.className, 'linea verticale mancante').toContain('border-r')
    }
    // le celle del corpo hanno la linea verticale
    const cell = el.querySelector('tbody tr td:nth-child(3)')
    expect(cell?.className).toContain('border-r')
  })

  it('numera le righe da 1', () => {
    const el = mount()
    expect(rowNumbers(el)).toEqual(['1', '2', '3', '4'])
  })

  it('colora le righe a gruppi di TRE (prima erano due toni quasi uguali)', () => {
    const el = mount()
    const trs = [...el.querySelectorAll('tbody tr')]
    expect(trs).toHaveLength(4)
    expect(trs[0].className).toContain(ZEBRA_CLASSES[0])
    expect(trs[1].className).toContain(ZEBRA_CLASSES[1])
    expect(trs[2].className).toContain(ZEBRA_CLASSES[2])
    expect(trs[3].className).toContain(ZEBRA_CLASSES[0])
  })

  it('le intestazioni sono TRASCINABILI', () => {
    const el = mount()
    for (const th of heads(el).slice(1)) {
      expect(th.getAttribute('draggable')).toBe('true')
      expect(th.className).toContain('cursor-grab')
    }
  })

  it('trascinando una colonna l ordine cambia, celle comprese, e i numeri di riga restano', () => {
    const el = mount()
    expect(shownColumns(el)).toEqual(['MIS_UDC', 'MIS_OPERATORE', 'MIS_MISSIONE'])
    expect(firstRowValues(el)).toEqual(['UDC1', 'MARIO', '1'])

    dragHeader(el, 0, 2)

    expect(shownColumns(el)).toEqual(['MIS_OPERATORE', 'MIS_MISSIONE', 'MIS_UDC'])
    expect(firstRowValues(el)).toEqual(['MARIO', '1', 'UDC1'])
    expect(rowNumbers(el)).toEqual(['1', '2', '3', '4'])
  })
})
