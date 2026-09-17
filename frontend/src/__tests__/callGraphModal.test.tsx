// @vitest-environment node
// La finestra del diagramma viene RENDERIZZATA davvero (render lato server): così si
// accorgono gli errori che il solo type-check non vede (accessi a undefined, dati mancanti)
// e si controlla che i casi limite mostrino i messaggi giusti invece di una pagina vuota.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CallGraphModal from '../components/CallGraphModal'
import type { RoutineCallGraph } from '../types'
import { realCallEdges } from './fixtures/routineCallGraph'

const realGraph: RoutineCallGraph = { edges: realCallEdges, truncated: false }

function render(props: Partial<Parameters<typeof CallGraphModal>[0]> = {}) {
  return renderToStaticMarkup(
    <CallGraphModal
      target={{ schema: 'dbo', name: 'fn_IADOVODASISID', kind: 'function' }}
      graph={realGraph}
      loading={false}
      error={null}
      onClose={() => {}}
      onOpenObject={() => {}}
      onReload={() => {}}
      {...props}
    />,
  )
}

describe('finestra del diagramma chiamate', () => {
  it('mostra i legami reali della routine analizzata', () => {
    const html = render()
    expect(html).toContain('Diagramma chiamate')
    expect(html).toContain('fn_IADOVODASISID')
    expect(html).toContain('Chi la chiama')
    expect(html).toContain('<svg')
    // una targhetta del tipo e almeno un nodo disegnato con il suo rettangolo
    expect(html).toMatch(/PROC|FUNC/)
    expect((html.match(/<rect/g) ?? []).length).toBeGreaterThan(5)
  })

  it('senza chiamanti spiega che è un punto di ingresso', () => {
    // dbo.ws_CIDEDO_L2_AAMAGEGUPIVODIBOP non è chiamata da nessuno (dato reale)
    const html = render({ target: { schema: 'dbo', name: 'ws_CIDEDO_L2_AAMAGEGUPIVODIBOP', kind: 'procedure' } })
    expect(html).toContain('Nessuna routine la chiama')
    expect(html).toContain('ws_CIDEDO_L2_AAMAGEGUPIVODIBOP')
  })

  it('segnala i cicli quando la routine è ricorsiva (dato reale)', () => {
    // dbo.fn_TOSOGIPEDAP chiama se stessa nel database vero
    const html = render({ target: { schema: 'dbo', name: 'fn_TOSOGIPEDAP', kind: 'function' } })
    expect(html).toContain('↻')
    expect(html).toContain('ciclo')
  })

  it('durante il caricamento mostra l attesa, senza diagramma', () => {
    const html = render({ graph: null, loading: true })
    expect(html).toContain('Lettura dei legami')
    expect(html).not.toContain('<svg width="100%"')
  })

  it('mostra l errore del backend senza rompersi', () => {
    const html = render({ graph: null, loading: false, error: 'Connessione non trovata o scaduta.' })
    expect(html).toContain('Connessione non trovata o scaduta.')
  })

  it('regge grafo vuoto e routine inesistente', () => {
    const html = render({ graph: { edges: [], truncated: false }, target: { schema: 'dbo', name: 'NON_ESISTE' } })
    expect(html).toContain('NON_ESISTE')
    expect(html).toContain('Nessuna routine la chiama')
  })

  it('avvisa se il backend ha troncato l elenco dei legami', () => {
    const html = render({ graph: { edges: realCallEdges.slice(0, 50), truncated: true } })
    expect(html).toContain('troncato')
  })
})
