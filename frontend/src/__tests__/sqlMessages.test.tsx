// Messaggi di SQL Server come in SSMS: quando una query richiama più stored procedure e una
// fallisce, si deve vedere SUBITO quale. Il backend manda numero/livello/stato/procedura/riga;
// qui si controlla la logica di visualizzazione e il componente che li mostra.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PrintPanel from '../components/PrintPanel'
import { errorMessagesByDisplay, errorProcedureNames, hasErrorMessage, messageHeader } from '../sqlMessages'
import type { QueryMessage, QueryResult } from '../types'

const err = (over: Partial<QueryMessage> = {}): QueryMessage => ({
  text: 'Errore dentro la procedura',
  display: 'Msg 50000, Livello 16, Stato 1, Procedura ws_L2_SetCorridoioMiss, Riga 42\nErrore dentro la procedura',
  number: 50000,
  severity: 16,
  state: 1,
  procedure: 'ws_L2_SetCorridoioMiss',
  line: 42,
  isError: true,
  ...over,
})

const print = (text: string): QueryMessage => ({
  text,
  display: text,
  number: 0,
  severity: 0,
  state: 0,
  procedure: null,
  line: 0,
  isError: false,
})

const result = (messages: string[], errors: QueryMessage[]): QueryResult => ({
  resultSets: [],
  totalAffectedRows: 0,
  messages,
  elapsedMs: 12,
  error: null,
  errors,
})

describe('intestazione in stile SSMS', () => {
  it('riporta numero, livello, stato, procedura e riga', () => {
    expect(messageHeader(err())).toBe('Msg 50000, Livello 16, Stato 1 · Procedura ws_L2_SetCorridoioMiss · Riga 42')
  })

  it('senza procedura (errore nel batch) omette il pezzo della procedura', () => {
    expect(messageHeader(err({ procedure: null }))).toBe('Msg 50000, Livello 16, Stato 1 · Riga 42')
  })

  it('i PRINT non hanno intestazione', () => {
    expect(messageHeader(print('ciao'))).toBe('')
  })
})

describe('riconoscere gli errori fra i messaggi', () => {
  it('mappa gli errori sul testo mostrato, per colorare le righe giuste', () => {
    const e = err()
    const map = errorMessagesByDisplay([print('prima'), e])
    expect(map.size).toBe(1)
    expect(map.get(e.display)?.procedure).toBe('ws_L2_SetCorridoioMiss')
    expect(map.has('prima')).toBe(false)
  })

  it('i messaggi informativi non contano come errori', () => {
    expect(hasErrorMessage([print('a'), print('b')])).toBe(false)
    expect(hasErrorMessage([err()])).toBe(true)
    expect(hasErrorMessage(null)).toBe(false)
    expect(hasErrorMessage(undefined)).toBe(false)
  })

  it('elenca le procedure coinvolte senza duplicati', () => {
    expect(errorProcedureNames([err(), err(), err({ procedure: 'ws_Altra' }), print('x')])).toEqual([
      'ws_L2_SetCorridoioMiss',
      'ws_Altra',
    ])
    expect(errorProcedureNames([err({ procedure: null })])).toEqual([])
  })
})

describe('pannello Messaggi', () => {
  const html = (r: QueryResult) => renderToStaticMarkup(<PrintPanel result={r} />)

  it('mostra la procedura e la riga dell errore', () => {
    const out = html(result(['prima della chiamata', err().display], [err()]))
    expect(out).toContain('Procedura ws_L2_SetCorridoioMiss')
    expect(out).toContain('Riga 42')
    expect(out).toContain('Errore dentro la procedura')
    // il PRINT resta visibile
    expect(out).toContain('prima della chiamata')
  })

  it('evidenzia il conteggio degli errori', () => {
    expect(html(result([err().display], [err()]))).toContain('1 errore')
    // due errori DIVERSI (testo diverso): il conteggio li somma
    const altra = err({ procedure: 'ws_Altra', display: 'Msg 50000, Livello 16, Stato 1, Procedura ws_Altra, Riga 9\nAltro' })
    expect(html(result([err().display, altra.display], [err(), altra]))).toContain('2 errori')
    expect(html(result(['solo print'], []))).not.toContain('errore')
  })

  it('lo stesso errore ripetuto non viene contato due volte', () => {
    // il testo mostrato è la chiave: due messaggi identici sono lo stesso errore
    expect(html(result([err().display, err().display], [err(), err()]))).toContain('1 errore')
  })

  it('propone di aprire la procedura che ha dato errore', () => {
    const out = renderToStaticMarkup(
      <PrintPanel result={result([err().display], [err()])} onOpenProcedure={() => {}} />,
    )
    expect(out).toContain('Apri ws_L2_SetCorridoioMiss')
  })

  it('senza handler non mostra il pulsante di apertura', () => {
    const out = html(result([err().display], [err()]))
    expect(out).not.toContain('Apri ws_L2_SetCorridoioMiss')
  })

  it('errore generale: mostra la barra rossa con il testo del backend', () => {
    const out = html({ ...result([], []), error: 'Msg 50000, Livello 16, Stato 1, Procedura ws_X, Riga 7\nOps' })
    expect(out).toContain('Procedura ws_X')
    expect(out).toContain('Ops')
  })

  it('senza messaggi lo dice esplicitamente', () => {
    expect(html(result([], []))).toContain('Nessun messaggio')
  })
})
