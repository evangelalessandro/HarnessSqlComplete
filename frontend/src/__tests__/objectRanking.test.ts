// Ordinamento degli oggetti per VICINANZA alla parola cercata: con "swap" deve venire prima una store che
// contiene "swap" (XX_swap_ecccc) rispetto a nomi che contengono solo le singole lettere sparse.
//
// Segnalazione utente: "nell'intellisense se cerco qualcosa, ordina per quello che è più vicino".
import { describe, expect, it } from 'vitest'
import { objectMatchScore } from '../helpers'

describe('objectMatchScore: vicinanza del nome alla parola cercata', () => {
  it('nome identico > inizio > pezzo > dentro > lettere sparse', () => {
    const swap = (nome: string) => objectMatchScore('swap', nome)
    expect(swap('swap')).toBeGreaterThan(swap('swap_ecccc'))
    expect(swap('swap_ecccc')).toBeGreaterThan(swap('xx_swap_ecccc'))
    // "dentro" (contiguo ma senza separatori) vale meno di "pezzo" (_swap_)
    expect(swap('xx_swap_ecccc')).toBeGreaterThan(swap('zzswapzz_ecccc'))
    // e "dentro" vale più delle sole lettere sparse
    expect(swap('zzswapzz_ecccc')).toBeGreaterThan(swap('salva_ws_porta_pk'))
  })

  it('il caso segnalato: "swap" trova prima XX_swap_ecccc che i nomi con lettere sparse', () => {
    const nomi = [
      'ws_L2_EndMissIng_MagManUomo',
      'ws_SalvaWsportaPk_xx', // s-w-a-p sparsi
      'ws_CUSTOM_XX_swap_ecccc',
      'ws_AlgoritmoNAVETTE_Picking_Stalli',
      'fn_swap_ready',
    ]
    const ordinati = [...nomi].sort((a, b) => objectMatchScore('swap', b) - objectMatchScore('swap', a))
    expect(ordinati[0]).toBe('fn_swap_ready')
    expect(ordinati[1]).toBe('ws_CUSTOM_XX_swap_ecccc')
    // i nomi senza "swap" contiguo finiscono in fondo
    const iPrimoSenzaSwap = ordinati.findIndex(n => !n.toLowerCase().includes('swap'))
    const iUltimoConSwap = ordinati.map(n => n.toLowerCase().includes('swap')).lastIndexOf(true)
    expect(iPrimoSenzaSwap).toBeGreaterThan(iUltimoConSwap)
  })

  it('lo schema non conta: dbo.xx_swap vale come xx_swap', () => {
    expect(objectMatchScore('swap', 'dbo.xx_swap_ecccc')).toBe(objectMatchScore('swap', 'xx_swap_ecccc'))
  })

  it('parola vuota o senza corrispondenza → 0', () => {
    expect(objectMatchScore('', 'xx_swap')).toBe(0)
    expect(objectMatchScore('zzz', 'xx_swap')).toBe(0)
  })

  it('le lettere sparse hanno comunque un punteggio (non spariscono)', () => {
    expect(objectMatchScore('swap', 'salva_ws_porta_pk')).toBeGreaterThan(0)
  })
})
