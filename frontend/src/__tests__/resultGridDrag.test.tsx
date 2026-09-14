// @vitest-environment jsdom
// Trascinamento delle colonne nella griglia risultati, provato su un DOM REALE:
// si monta il componente, si simulano dragstart/dragover/drop sull'header e si controlla
// che l'ordine delle colonne (e delle celle) cambi davvero, senza toccare i numeri di riga.
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import SelectableResultGrid from '../components/SelectableResultGrid'

// React 19 richiede questo per usare act() fuori da un test runner dedicato
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const columns = [
  { name: 'MIS_UDC', dataType: 'nvarchar' },
  { name: 'MIS_OPERATORE', dataType: 'nvarchar' },
  { name: 'MIS_MISSIONE', dataType: 'int' },
]
const rows = [
  ['UDC1', 'MARIO', 1],
  ['UDC2', 'LUCA', 2],
  ['UDC3', 'ANNA', 3],
  ['UDC4', 'SARA', 4],
]

let container: HTMLDivElement | null = null
let root: Root | null = null

function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<SelectableResultGrid columns={columns} rows={rows} initialTarget="dbo.RUN_MISSIONI" />)
  })
  return container
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  container = null
  root = null
})

/** Colonne mostrate, nell'ordine in cui appaiono (il titolo porta nome e tipo). */
function shownColumns(el: HTMLElement): string[] {
  return [...el.querySelectorAll('thead th')]
    .slice(2) // salta la colonna del numero di riga e quella della selezione
    .map(th => th.getAttribute('title') ?? '')
    .filter(Boolean)
    .map(t => t.split(' ')[0])
}

/** Valori della prima riga di dati (dopo numero di riga e casella di selezione). */
function firstRowValues(el: HTMLElement): string[] {
  const tds = [...(el.querySelectorAll('tbody tr')[0]?.querySelectorAll('td') ?? [])]
  return tds.slice(2).map(td => td.textContent?.trim() ?? '')
}

/** Numeri di riga mostrati: la prima cella è la casella di selezione, il numero è la seconda. */
function rowNumbers(el: HTMLElement): string[] {
  return [...el.querySelectorAll('tbody tr')].map(tr => tr.querySelectorAll('td')[1]?.textContent?.trim() ?? '')
}

/** Simula il trascinamento di un header su un altro (come fa il browser). */
function dragHeader(el: HTMLElement, fromIndex: number, toIndex: number) {
  const heads = [...el.querySelectorAll('thead th')].slice(2) // salta numero riga e selezione
  const from = heads[fromIndex]
  const to = heads[toIndex]
  const dataTransfer = {
    effectAllowed: '',
    dropEffect: '',
    setData: () => {},
    getData: () => '',
  }
  const fire = (target: Element, type: string) => {
    const ev = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer })
    act(() => {
      target.dispatchEvent(ev)
    })
  }
  fire(from, 'dragstart')
  fire(to, 'dragover')
  fire(to, 'drop')
  fire(from, 'dragend')
}

describe('griglia risultati: spostamento delle colonne con il mouse', () => {
  it('ordine iniziale e numeri di riga', () => {
    const el = mount()
    expect(shownColumns(el)).toEqual(['MIS_UDC', 'MIS_OPERATORE', 'MIS_MISSIONE'])
    expect(firstRowValues(el)).toEqual(['UDC1', 'MARIO', '1'])
    expect(rowNumbers(el)).toEqual(['1', '2', '3', '4'])
  })

  it('trascinando la prima colonna sull ultima, l ordine cambia (celle comprese)', () => {
    const el = mount()
    dragHeader(el, 0, 2)
    expect(shownColumns(el)).toEqual(['MIS_OPERATORE', 'MIS_MISSIONE', 'MIS_UDC'])
    // le celle seguono le colonne: ora la prima è l'operatore
    expect(firstRowValues(el)).toEqual(['MARIO', '1', 'UDC1'])
    // e i numeri di riga restano al loro posto
    expect(rowNumbers(el)).toEqual(['1', '2', '3', '4'])
  })

  it('trascinando l ultima colonna sulla prima, va davanti', () => {
    const el = mount()
    dragHeader(el, 2, 0)
    expect(shownColumns(el)).toEqual(['MIS_MISSIONE', 'MIS_UDC', 'MIS_OPERATORE'])
    expect(firstRowValues(el)).toEqual(['1', 'UDC1', 'MARIO'])
  })

  it('trascinare due volte torna all ordine di partenza', () => {
    const el = mount()
    dragHeader(el, 0, 2)
    dragHeader(el, 2, 0)
    expect(shownColumns(el)).toEqual(['MIS_UDC', 'MIS_OPERATORE', 'MIS_MISSIONE'])
    expect(firstRowValues(el)).toEqual(['UDC1', 'MARIO', '1'])
  })

  it('rilasciare una colonna su se stessa non cambia nulla', () => {
    const el = mount()
    dragHeader(el, 1, 1)
    expect(shownColumns(el)).toEqual(['MIS_UDC', 'MIS_OPERATORE', 'MIS_MISSIONE'])
  })

  it('NON cambia le colonne dichiarate: la griglia resta coerente con lo schema del risultato', () => {
    const el = mount()
    dragHeader(el, 0, 2)
    // i nomi restano gli stessi tre (nessuno perso o duplicato)
    expect([...shownColumns(el)].sort()).toEqual(['MIS_MISSIONE', 'MIS_OPERATORE', 'MIS_UDC'])
    // ogni riga ha sempre 3 celle di dati oltre a numero e casella
    for (const tr of el.querySelectorAll('tbody tr')) {
      expect(tr.querySelectorAll('td').length).toBe(5)
    }
  })
})
