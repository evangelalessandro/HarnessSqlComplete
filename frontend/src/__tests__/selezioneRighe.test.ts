// SELEZIONE DELLE RIGHE NELLA GRIGLIA DEI RISULTATI (richiesta utente: "posso selezionare una o più
// righe della griglia e che abbia qualche colore in evidenza per capire che l'ho selezionata").
// La logica sta in funzioni pure (resultGrid.ts) così si può provare senza browser.
import { describe, expect, it } from 'vitest'
import {
  aggiornaSelezioneRighe,
  modoSelezioneDaEvento,
  rowBackgroundClass,
  SELECTED_ROW_CLASS,
  selezioneVuota,
} from '../resultGrid'

describe('selezione delle righe: clic semplice, Ctrl, Maiusc', () => {
  it('clic semplice: seleziona solo quella riga', () => {
    let s = aggiornaSelezioneRighe(selezioneVuota(), 3, 'sostituisci')
    expect([...s.righe]).toEqual([3])
    expect(s.ancora).toBe(3)
    // un altro clic semplice sostituisce
    s = aggiornaSelezioneRighe(s, 7, 'sostituisci')
    expect([...s.righe]).toEqual([7])
  })

  it('clic semplice sulla riga già selezionata la deseleziona', () => {
    const s = aggiornaSelezioneRighe(selezioneVuota(), 3, 'sostituisci')
    const vuoto = aggiornaSelezioneRighe(s, 3, 'sostituisci')
    expect(vuoto.righe.size).toBe(0)
    expect(vuoto.ancora).toBeNull()
  })

  it('Ctrl+clic aggiunge e toglie senza perdere le altre', () => {
    let s = aggiornaSelezioneRighe(selezioneVuota(), 1, 'sostituisci')
    s = aggiornaSelezioneRighe(s, 4, 'aggiungi')
    s = aggiornaSelezioneRighe(s, 9, 'aggiungi')
    expect([...s.righe].sort((a, b) => a - b)).toEqual([1, 4, 9])
    s = aggiornaSelezioneRighe(s, 4, 'aggiungi')
    expect([...s.righe].sort((a, b) => a - b)).toEqual([1, 9])
  })

  it('Maiusc+clic seleziona l intervallo dalla riga dell ultimo clic', () => {
    let s = aggiornaSelezioneRighe(selezioneVuota(), 2, 'sostituisci')
    s = aggiornaSelezioneRighe(s, 6, 'intervallo')
    expect([...s.righe].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6])
    // l'ancora resta quella di partenza: allargando si riparte sempre da lì
    expect(s.ancora).toBe(2)
    s = aggiornaSelezioneRighe(s, 4, 'intervallo')
    expect([...s.righe].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6])
  })

  it('Maiusc+clic all indietro funziona lo stesso', () => {
    let s = aggiornaSelezioneRighe(selezioneVuota(), 8, 'sostituisci')
    s = aggiornaSelezioneRighe(s, 5, 'intervallo')
    expect([...s.righe].sort((a, b) => a - b)).toEqual([5, 6, 7, 8])
  })

  it('senza ancora Maiusc+clic seleziona solo quella riga', () => {
    const s = aggiornaSelezioneRighe(selezioneVuota(), 5, 'intervallo')
    expect([...s.righe]).toEqual([5])
  })

  it('la selezione in ingresso non viene modificata', () => {
    const prima = aggiornaSelezioneRighe(selezioneVuota(), 1, 'sostituisci')
    const copia = new Set(prima.righe)
    aggiornaSelezioneRighe(prima, 2, 'aggiungi')
    expect([...prima.righe]).toEqual([...copia])
  })

  it('i tasti modificatori scelgono il modo giusto', () => {
    expect(modoSelezioneDaEvento({})).toBe('sostituisci')
    expect(modoSelezioneDaEvento({ ctrlKey: true })).toBe('aggiungi')
    expect(modoSelezioneDaEvento({ metaKey: true })).toBe('aggiungi')
    expect(modoSelezioneDaEvento({ shiftKey: true })).toBe('intervallo')
    // Maiusc ha la precedenza su Ctrl, come nei fogli di calcolo
    expect(modoSelezioneDaEvento({ ctrlKey: true, shiftKey: true })).toBe('intervallo')
  })

  it('la riga selezionata usa lo sfondo dedicato (visibile anche col tema chiaro)', () => {
    expect(rowBackgroundClass(0, true)).toBe(SELECTED_ROW_CLASS)
    expect(rowBackgroundClass(0, false)).not.toBe(SELECTED_ROW_CLASS)
  })
})
