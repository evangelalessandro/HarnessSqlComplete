// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import ConnectAnimation from '../components/ConnectAnimation'

// abilita il supporto a act() nell'ambiente jsdom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ConnectAnimation: animazione scenica di connessione', () => {
  let container: HTMLDivElement
  let root: Root

  afterEach(() => {
    vi.useRealTimers()
    if (root) {
      act(() => root.unmount())
    }
    container?.remove()
  })

  const mount = (server?: string, database?: string) => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(createElement(ConnectAnimation, { server, database }))
    })
  }

  it('mostra la finestra terminale con il titolo sqlintelli.exe', () => {
    vi.useFakeTimers()
    mount('SRV01', 'DB1')
    expect(container.textContent).toContain('sqlintelli.exe')
    expect(container.textContent).toContain('SRV01')
    expect(container.textContent).toContain('DB1')
  })

  it('digita le righe di log e raggiunge il 100%', () => {
    vi.useFakeTimers()
    mount('SRV01', 'DB1')
    // avanza a blocchi: ogni act() lascia ri-renderizzare React tra una riga e l'altra
    for (let i = 0; i < 40; i++) {
      act(() => {
        vi.advanceTimersByTime(1_000)
      })
    }
    const text = container.textContent ?? ''
    expect(text).toContain('handshake con SRV01')
    expect(text).toContain('PRONTO — benvenuto in SQL Intelligence Assistant')
    expect(text).toContain('100%')
  })

  it('resta stabile quando la connessione fallisce subito (unmount anticipato)', () => {
    vi.useFakeTimers()
    mount()
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(container.textContent).toContain('bootstrap')
    act(() => root.unmount())
    expect(container.textContent ?? '').not.toContain('PRONTO')
  })
})
