// "VERSIONE DI PARTENZA" di un oggetto aperto in modifica (vedi objectVersion.ts).
// Richiesta utente: "se apro in edit una store\funzione mostrami se ce n'era una già aperta e se
// sto lavorando da una versione di partenza che è vecchia".
import { describe, expect, it } from 'vitest'
import {
  etichettaOggetto,
  improntaDefinizione,
  nuovoObjectRef,
  quandoAperta,
  testoPerLaTab,
  trovaTabOggetto,
  versioneSuperata,
} from '../objectVersion'
import type { EditorTab } from '../types'

const tab = (id: string, ref?: EditorTab['objectRef']): EditorTab => ({
  id,
  title: id,
  sql: '',
  objectRef: ref,
})

const DEFINIZIONE = `CREATE PROCEDURE [dbo].[ws_Prova]
AS
BEGIN
  SELECT 1 AS A
END`

describe('improntaDefinizione', () => {
  it('stessa definizione → stessa impronta (8 caratteri esadecimali)', () => {
    const h = improntaDefinizione(DEFINIZIONE)
    expect(h).toMatch(/^[0-9a-f]{8}$/)
    expect(improntaDefinizione(DEFINIZIONE)).toBe(h)
  })

  it('i fine riga CRLF/CR non contano (stesso testo, stessa impronta)', () => {
    const lf = DEFINIZIONE
    const crlf = DEFINIZIONE.replace(/\n/g, '\r\n')
    const cr = DEFINIZIONE.replace(/\n/g, '\r')
    expect(improntaDefinizione(crlf)).toBe(improntaDefinizione(lf))
    expect(improntaDefinizione(cr)).toBe(improntaDefinizione(lf))
  })

  it('testo diverso → impronta diversa', () => {
    expect(improntaDefinizione(DEFINIZIONE)).not.toBe(improntaDefinizione(DEFINIZIONE.replace('SELECT 1', 'SELECT 2')))
    expect(improntaDefinizione('')).not.toBe(improntaDefinizione(' '))
  })
})

describe('versioneSuperata', () => {
  const base = improntaDefinizione(DEFINIZIONE)

  it('false se la definizione sul database è quella di partenza', () => {
    expect(versioneSuperata(base, DEFINIZIONE)).toBe(false)
    expect(versioneSuperata(base, DEFINIZIONE.replace(/\n/g, '\r\n'))).toBe(false)
  })

  it('true se qualcuno l ha cambiata dopo l apertura', () => {
    expect(versioneSuperata(base, DEFINIZIONE.replace('SELECT 1', 'SELECT 2'))).toBe(true)
  })
})

describe('trovaTabOggetto', () => {
  const ref = nuovoObjectRef('dbo', 'ws_Prova', 'procedure', 'alter', DEFINIZIONE)

  it('trova la tab che ha già aperto lo stesso oggetto (anche con maiuscole diverse)', () => {
    const tabs = [tab('a', ref), tab('b')]
    expect(trovaTabOggetto(tabs, 'DBO', 'WS_PROVA')?.id).toBe('a')
  })

  it('ignora le tab senza oggetto e quella da escludere', () => {
    const tabs = [tab('a', ref), tab('b', nuovoObjectRef('dbo', 'altra', 'procedure', 'alter', 'x'))]
    expect(trovaTabOggetto(tabs, 'dbo', 'ws_prova', 'a')).toBeUndefined()
    expect(trovaTabOggetto(tabs, 'dbo', 'inesistente')).toBeUndefined()
    expect(trovaTabOggetto([tab('solo')], 'dbo', 'ws_prova')).toBeUndefined()
  })

  it('schema diverso = oggetto diverso', () => {
    const tabs = [tab('a', ref)]
    expect(trovaTabOggetto(tabs, 'vendite', 'ws_Prova')).toBeUndefined()
  })
})

describe('nuovoObjectRef / etichette', () => {
  it('registra schema, nome, tipo, modo e impronta del testo della tab', () => {
    const ref = nuovoObjectRef('dbo', 'ws_Prova', 'procedure', 'alter', DEFINIZIONE, 1000)
    expect(ref.schema).toBe('dbo')
    expect(ref.name).toBe('ws_Prova')
    expect(ref.kind).toBe('procedure')
    expect(ref.modo).toBe('alter')
    expect(ref.baseHash).toBe(improntaDefinizione(DEFINIZIONE))
    expect(ref.openedAt).toBe(1000)
    expect(ref.stale).toBeUndefined()
  })

  it('testoPerLaTab: CREATE OR ALTER solo in modalità "alter"', () => {
    const finto = (d: string) => `ALTER ${d}`
    expect(testoPerLaTab('alter', 'X', finto)).toBe('ALTER X')
    expect(testoPerLaTab('open', 'X', finto)).toBe('X')
  })

  it('etichetta: senza schema per dbo, con schema per gli altri', () => {
    expect(etichettaOggetto('dbo', 'ws_Prova')).toBe('ws_Prova')
    expect(etichettaOggetto('DBO', 'ws_Prova')).toBe('ws_Prova')
    expect(etichettaOggetto('vendite', 'ws_Prova')).toBe('vendite.ws_Prova')
  })

  it('quandoAperta: giorno/mese ora:minuti', () => {
    const d = new Date(2026, 8, 21, 14, 5) // 21/09 14:05
    expect(quandoAperta(d.getTime())).toBe('21/09 14:05')
  })
})
