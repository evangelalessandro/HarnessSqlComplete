// Switcher delle tab in stile Alt+Tab: "al primo mi apre la penultima toccata, e se lo rifaccio mi apre
// quella da cui provenivo".
//
// NOTA: Alt+Tab non è utilizzabile in una pagina web (è il selettore di finestre di Windows e il browser
// non lo consegna alla pagina): la scorciatoia è Alt+PagGiù / Alt+PagSu.
import { describe, expect, it } from 'vitest'
import { ordineMru, prossimaSelezione } from '../tabSwitcher'

describe('ordineMru: cronologia di ultimo uso', () => {
  it('mette la tab attiva in testa e scarta quelle chiuse', () => {
    expect(ordineMru(['a', 'b', 'c'], ['c', 'a', 'zzz'])).toEqual(['c', 'a', 'b'])
  })

  it('le tab mai usate finiscono in fondo, nell ordine di apertura', () => {
    expect(ordineMru(['a', 'b', 'c', 'd'], ['b'])).toEqual(['b', 'a', 'c', 'd'])
  })

  it('lista vuota o senza tab vive', () => {
    expect(ordineMru([], ['a'])).toEqual([])
    expect(ordineMru(['a'], [])).toEqual(['a'])
  })
})

describe('prossimaSelezione: primo salto = penultima toccata', () => {
  it('con la lista chiusa parte dalla penultima (indice 1)', () => {
    expect(prossimaSelezione(4, null, false)).toBe(1)
  })

  it('andando indietro parte dall ultima', () => {
    expect(prossimaSelezione(4, null, true)).toBe(3)
  })

  it('una sola tab: si resta sulla stessa', () => {
    expect(prossimaSelezione(1, null, false)).toBe(0)
    expect(prossimaSelezione(1, 0, true)).toBe(0)
  })

  it('scorre in modo circolare: dopo la penultima torna la tab di provenienza', () => {
    // tab attiva = 0; penultima = 1; rifacendolo → 2 … e giro completo
    let sel = prossimaSelezione(3, null, false)
    expect(sel).toBe(1)
    sel = prossimaSelezione(3, sel, false)
    expect(sel).toBe(2)
    sel = prossimaSelezione(3, sel, false)
    expect(sel).toBe(0)
  })

  it('con Shift (indietro) dall indice 1 si torna alla tab attiva (0)', () => {
    expect(prossimaSelezione(3, 1, true)).toBe(0)
  })
})
