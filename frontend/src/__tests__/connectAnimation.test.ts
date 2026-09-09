// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import ConnectAnimation from '../components/ConnectAnimation'
import { detectPrintMagic, isTextOffsetInComment, nextDragonLevel, remainingMinDelay } from '../helpers'

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

describe('remainingMinDelay: durata minima dell\'animazione di connessione', () => {
  it('restituisce i millisecondi rimanenti se la durata minima non è ancora raggiunta', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const started = Date.now() - 2_000 // iniziata 2s fa
    expect(remainingMinDelay(started, 5_000)).toBe(3_000)
    vi.useRealTimers()
  })

  it('restituisce 0 se la durata minima è già stata superata', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const started = Date.now() - 6_000 // iniziata 6s fa
    expect(remainingMinDelay(started, 5_000)).toBe(0)
    vi.useRealTimers()
  })

  it('restituisce 0 appena iniziata se la durata minima è 0', () => {
    expect(remainingMinDelay(Date.now(), 0)).toBe(0)
  })
})

describe('detectPrintMagic: il drago/fuoco compare solo con PRINT "drago"/"fuoco"', () => {
  it("PRINT 'drago' → drago", () => {
    expect(detectPrintMagic("PRINT 'drago'")).toBe('drago')
    expect(detectPrintMagic("print N'Drago' -- nota")).toBe('drago')
  })

  it("PRINT 'fuoco' → fuoco", () => {
    expect(detectPrintMagic("PRINT 'fuoco'")).toBe('fuoco')
    expect(detectPrintMagic("PRINT 'accendi il fuoco'")).toBe('fuoco')
  })

  it('query normali o altri PRINT → null (drago e fuoco restano nascosti)', () => {
    expect(detectPrintMagic('SELECT TOP 100 * FROM dbo.T')).toBeNull()
    expect(detectPrintMagic("PRINT 'ciao'")).toBeNull()
    expect(detectPrintMagic("PRINT 'sparo'")).toBeNull()
  })
})

describe('isTextOffsetInComment: nessun suggerimento dentro i commenti', () => {
  const sql = "SELECT a, b -- nota riga\nFROM dbo.T /* blocco */\nWHERE x = 'a -- b' AND y = 1"

  it('dentro commento di riga → true', () => {
    const idx = sql.indexOf('nota')
    expect(isTextOffsetInComment(sql, idx)).toBe(true)
    // a fine riga dopo il commento (prima del \n) è ancora commento
    expect(isTextOffsetInComment(sql, sql.indexOf('riga') + 4)).toBe(true)
  })

  it('dopo la riga commentata il codice NON è in commento', () => {
    expect(isTextOffsetInComment(sql, sql.indexOf('FROM dbo.T') + 2)).toBe(false)
  })

  it('dentro commento a blocco → true, fuori → false', () => {
    expect(isTextOffsetInComment(sql, sql.indexOf('blocco') + 1)).toBe(true)
    expect(isTextOffsetInComment(sql, sql.indexOf('WHERE x') + 3)).toBe(false)
  })

  it('le stringhe con "--" o "/*" non sono commenti', () => {
    const inStr = sql.indexOf("'a -- b'")
    expect(isTextOffsetInComment(sql, inStr + 3)).toBe(false)
  })
})

describe('nextDragonLevel: il drago cresce a ogni query (max 100)', () => {
  it('incrementa di 1', () => {
    expect(nextDragonLevel(0)).toBe(1)
    expect(nextDragonLevel(42)).toBe(43)
  })

  it('si ferma a 100', () => {
    expect(nextDragonLevel(100)).toBe(100)
    expect(nextDragonLevel(99)).toBe(100)
  })

  it('tratta i negativi come 0', () => {
    expect(nextDragonLevel(-5)).toBe(1)
  })
})
