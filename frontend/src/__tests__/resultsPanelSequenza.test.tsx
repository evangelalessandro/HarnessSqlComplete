// @vitest-environment jsdom
// RISULTATI CON PIÙ RESULT SET IN SEQUENZA (richiesta utente: "nei risultati di una query se ha
// tanti resultset permettimi anche di vederli uno di seguito all'altro, magari con una bella
// scrollbar che posso scorrere a fondo, metti una opzione per la tab corrente").
//
// - vista normale: un result set alla volta (con i pulsanti Set 1/Set 2 e la paginazione);
// - opzione "Tutti in sequenza": TUTTI i set uno sotto l'altro in un unico scorrimento, senza
//   paginazione, con la barra di ogni set fissa in alto mentre lo si attraversa.
// L'opzione è per TAB: il pannello la riceve da App e la notifica con onContinuousChange.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import ResultsPanel from '../components/ResultsPanel'
import type { QueryResult } from '../types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const set = (prefix: string, n: number) => ({
  columns: [
    { name: 'MIS_UDC', dataType: 'nvarchar' },
    { name: 'MIS_MISSIONE', dataType: 'int' },
  ],
  rows: Array.from({ length: n }, (_, i) => [`${prefix}${i + 1}`, i + 1]),
  rowCount: n,
  affectedRows: 0,
  truncated: false,
})

const result: QueryResult = {
  resultSets: [set('A', 3), set('B', 2), set('C', 4)],
  totalAffectedRows: 0,
  messages: [],
  elapsedMs: 12,
  error: null,
}

let container: HTMLDivElement | null = null
let root: Root | null = null

function mount(props: Partial<Parameters<typeof ResultsPanel>[0]> = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<ResultsPanel result={result} executing={false} {...props} />)
  })
  return container
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  container = null
  root = null
})

const bottone = (el: HTMLElement, testo: string) =>
  [...el.querySelectorAll('button')].find(b => (b.textContent ?? '').includes(testo))
const sezioni = (el: HTMLElement) => [...el.querySelectorAll('[data-testid="risultati-in-sequenza"] section')]
const valoriPrimaColonna = (el: HTMLElement) =>
  [...el.querySelectorAll('tbody tr')].map(tr => tr.querySelectorAll('td')[1]?.textContent?.trim() ?? '')

describe('risultati con più result set: vista in sequenza', () => {
  it('senza l opzione mostra UN set alla volta con i pulsanti dei set', () => {
    const el = mount()
    expect(bottone(el, 'Set 1')).toBeTruthy()
    expect(bottone(el, 'Set 2')).toBeTruthy()
    expect(bottone(el, 'Set 3')).toBeTruthy()
    expect(bottone(el, 'Tutti in sequenza')).toBeTruthy()
    expect(sezioni(el)).toHaveLength(0)
    expect(valoriPrimaColonna(el)).toEqual(['A1', 'A2', 'A3'])
  })

  it('con l opzione attiva mostra TUTTI i set uno di seguito, con tutte le righe', () => {
    const el = mount({ continuous: true, onContinuousChange: () => {} })
    const blocchi = sezioni(el)
    expect(blocchi).toHaveLength(3)
    // ogni set ha la sua barra con il conteggio
    expect(blocchi[0].textContent).toContain('Set 1')
    expect(blocchi[1].textContent).toContain('Set 2')
    expect(blocchi[2].textContent).toContain('Set 3')
    // TUTTE le righe di TUTTI i set, senza paginazione (9 righe in totale)
    expect(valoriPrimaColonna(el)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2', 'C3', 'C4'])
    // un solo contenitore che scorre
    expect(el.querySelectorAll('[data-testid="risultati-in-sequenza"]')).toHaveLength(1)
    // e la barra di sintesi in fondo
    expect(el.textContent).toContain('3 result set')
    expect(el.textContent).toContain('9 righe in totale')
  })

  it('in sequenza le intestazioni delle tabelle NON sono fisse (si sovrapporrebbero)', () => {
    const el = mount({ continuous: true, onContinuousChange: () => {} })
    for (const thead of el.querySelectorAll('thead')) {
      expect(thead.className).not.toContain('sticky')
    }
    const el2 = mount()
    expect(el2.querySelector('thead')?.className).toContain('sticky')
  })

  it('il pulsante notifica il cambio di vista (impostazione della tab)', () => {
    const onContinuousChange = vi.fn()
    const el = mount({ onContinuousChange })
    act(() => {
      ;(bottone(el, 'Tutti in sequenza') as HTMLButtonElement).click()
    })
    expect(onContinuousChange).toHaveBeenCalledWith(true)
  })

  it('con un solo result set l opzione non compare (non servirebbe)', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root!.render(
        <ResultsPanel
          result={{ ...result, resultSets: [set('A', 2)] }}
          executing={false}
          onContinuousChange={() => {}}
        />,
      )
    })
    expect(bottone(container, 'Tutti in sequenza')).toBeFalsy()
    expect(bottone(container, 'Set 1')).toBeFalsy()
  })
})
