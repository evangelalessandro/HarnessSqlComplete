// Messaggi di SQL Server come in SSMS: quando una query richiama più stored procedure e una
// fallisce, si deve vedere SUBITO quale. In più, dagli errori che citano oggetti del database
// ("Invalid object name 'dbo.X'") si deve poterli APRIRE in una tab, come col tasto destro.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PrintPanel from '../components/PrintPanel'
import QueryErrorBanner from '../components/QueryErrorBanner'
import {
  errorMessagesByDisplay,
  errorObjectAction,
  errorObjectButtonLabel,
  errorObjectKindLabel,
  errorObjectsFor,
  errorProcedureNames,
  hasErrorMessage,
  hasQueryError,
  messageHeader,
  objectsInErrorText,
} from '../sqlMessages'
import type { QueryMessage, QueryResult } from '../types'
import { demoStoreLikeSummary } from './schema'

const summary = demoStoreLikeSummary()

const err = (over: Partial<QueryMessage> = {}): QueryMessage => ({
  text: 'Errore dentro la procedura',
  display: 'Msg 50000, Livello 16, Stato 1, Procedura zzz_test_proc, Riga 42\nErrore dentro la procedura',
  number: 50000,
  severity: 16,
  state: 1,
  procedure: 'zzz_test_proc',
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
    expect(messageHeader(err())).toBe('Msg 50000, Livello 16, Stato 1 · Procedura zzz_test_proc · Riga 42')
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
    expect(map.get(e.display)?.procedure).toBe('zzz_test_proc')
    expect(map.has('prima')).toBe(false)
  })

  it('i messaggi informativi non contano come errori', () => {
    expect(hasErrorMessage([print('a'), print('b')])).toBe(false)
    expect(hasErrorMessage([err()])).toBe(true)
    expect(hasErrorMessage(null)).toBe(false)
    expect(hasErrorMessage(undefined)).toBe(false)
  })

  it('hasQueryError: errore nel campo error o fra i messaggi', () => {
    expect(hasQueryError({ error: 'Msg 50000' })).toBe(true)
    expect(hasQueryError({ error: null, errors: [err()] })).toBe(true)
    expect(hasQueryError({ error: null, errors: [print('solo un print')] })).toBe(false)
    expect(hasQueryError({ error: null, errors: [] })).toBe(false)
    expect(hasQueryError({ error: '' })).toBe(false)
  })

  it('elenca le procedure coinvolte senza duplicati', () => {
    expect(errorProcedureNames([err(), err(), err({ procedure: 'ws_AIVIG' }), print('x')])).toEqual([
      'zzz_test_proc',
      'ws_AIVIG',
    ])
    expect(errorProcedureNames([err({ procedure: null })])).toEqual([])
  })
})

describe('oggetti del database citati negli errori', () => {
  it('riconosce la tabella citata in un errore reale', () => {
    expect(objectsInErrorText("Invalid object name 'dbo.RUN_MISSIONI'.", summary)).toEqual([
      { kind: 'table', schema: 'dbo', name: 'RUN_MISSIONI' },
    ])
  })

  it('ignora gli oggetti che NON esistono: aprire una tab non avrebbe senso', () => {
    expect(objectsInErrorText("Invalid object name 'dbo.TabellaCheNonEsiste'.", summary)).toEqual([])
  })

  it('riconosce i nomi fra parentesi quadre e quelli senza schema', () => {
    expect(objectsInErrorText("Invalid object name '[dbo].[MAG_CELLE]'.", summary)).toEqual([])
    expect(objectsInErrorText('Invalid object name [DAT_UDC].', summary)).toEqual([
      { kind: 'table', schema: 'dbo', name: 'DAT_UDC' },
    ])
    expect(objectsInErrorText('Invalid column name DAT_UDC.', summary)).toEqual([
      { kind: 'table', schema: 'dbo', name: 'DAT_UDC' },
    ])
  })

  it('riconosce procedure e funzioni (anche nella prosa del messaggio)', () => {
    const testo = "Errore 50000, livello 16, procedura zzz_test_proc, riga 3: errore di prova"
    expect(objectsInErrorText(testo, summary)).toEqual([{ kind: 'procedure', schema: 'dbo', name: 'zzz_test_proc' }])
  })

  it('non ripete lo stesso oggetto più volte', () => {
    const testo = "dbo.RUN_MISSIONI non valido; vedi anche dbo.RUN_MISSIONI"
    expect(objectsInErrorText(testo, summary)).toHaveLength(1)
  })

  it('senza schema caricato o senza testo non propone nulla', () => {
    expect(objectsInErrorText("Invalid object name 'dbo.RUN_MISSIONI'.", null)).toEqual([])
    expect(objectsInErrorText('', summary)).toEqual([])
  })

  it('etichette dei pulsanti: le tabelle si aprono in CREATE, le routine si modificano', () => {
    expect(errorObjectAction({ kind: 'table', schema: 'dbo', name: 'X' })).toBe('Apri CREATE')
    expect(errorObjectAction({ kind: 'procedure', schema: 'dbo', name: 'X' })).toBe('Modifica')
    expect(errorObjectKindLabel('table')).toBe('tabella')
    expect(errorObjectKindLabel('function')).toBe('funzione')
  })
})

describe('oggetti da proporre per un errore', () => {
  it('mette per prima la procedura che ha sollevato l errore, con la sua riga', () => {
    const refs = errorObjectsFor(err(), summary)
    expect(refs[0]).toEqual({ kind: 'procedure', schema: 'dbo', name: 'zzz_test_proc', line: 42 })
  })

  it('aggiunge anche gli oggetti citati nel testo, senza riga (la riga è della procedura)', () => {
    const refs = errorObjectsFor(err({ text: "Inserimento non riuscito nella tabella 'dbo.DAT_UDC'" }), summary)
    expect(refs.map(r => r.name)).toEqual(['zzz_test_proc', 'DAT_UDC'])
    expect(refs[1].line).toBeUndefined()
  })

  it('una procedura temporanea (non nello schema) non produce pulsanti inutili', () => {
    const refs = errorObjectsFor(err({ procedure: '#prova_err', text: 'Errore di prova' }), summary)
    expect(refs).toEqual([])
  })

  it('il pulsante dice anche la riga, quando si sa', () => {
    expect(errorObjectButtonLabel({ kind: 'procedure', schema: 'dbo', name: 'ws_X', line: 42 })).toBe(
      'Modifica dbo.ws_X (riga 42)',
    )
    expect(errorObjectButtonLabel({ kind: 'table', schema: 'dbo', name: 'DAT_UDC' })).toBe('Apri CREATE dbo.DAT_UDC')
    expect(errorObjectButtonLabel({ kind: 'procedure', schema: 'dbo', name: 'ws_X', line: 0 })).toBe('Modifica dbo.ws_X')
  })
})

describe('pannello Messaggi', () => {
  const html = (r: QueryResult) => renderToStaticMarkup(<PrintPanel result={r} />)
  const htmlConApertura = (r: QueryResult) =>
    renderToStaticMarkup(<PrintPanel result={r} summary={summary} onOpenObject={() => {}} />)

  it('mostra la procedura e la riga dell errore', () => {
    const out = html(result(['prima della chiamata', err().display], [err()]))
    expect(out).toContain('Procedura zzz_test_proc')
    expect(out).toContain('Riga 42')
    expect(out).toContain('Errore dentro la procedura')
    expect(out).toContain('prima della chiamata')
  })

  it('propone di aprire gli oggetti citati nell errore', () => {
    const e = err({ text: "Invalid object name 'dbo.RUN_MISSIONI'." })
    const out = htmlConApertura(result([e.display], [e]))
    expect(out).toContain('Modifica dbo.zzz_test_proc')
    expect(out).toContain('Apri CREATE dbo.RUN_MISSIONI')
  })

  it('senza handler non mostra pulsanti', () => {
    const e = err({ text: "Invalid object name 'dbo.RUN_MISSIONI'." })
    expect(html(result([e.display], [e]))).not.toContain('Apri CREATE')
  })

  it('evidenzia il conteggio degli errori', () => {
    expect(html(result([err().display], [err()]))).toContain('1 errore')
    const altra = err({ procedure: 'ws_AIVIG', display: 'Msg 50000, Livello 16, Stato 1, Procedura ws_AIVIG, Riga 9\nAltro' })
    expect(html(result([err().display, altra.display], [err(), altra]))).toContain('2 errori')
    expect(html(result(['solo print'], []))).not.toContain('errore')
  })

  it('lo stesso errore ripetuto non viene contato due volte', () => {
    expect(html(result([err().display, err().display], [err(), err()]))).toContain('1 errore')
  })

  it('senza messaggi lo dice esplicitamente', () => {
    expect(html(result([], []))).toContain('Nessun messaggio')
  })
})

describe('barra di errore', () => {
  it('mostra il testo e i pulsanti per gli oggetti citati', () => {
    const out = renderToStaticMarkup(
      <QueryErrorBanner
        error={"Msg 208, Livello 16, Stato 1, Riga 3\nInvalid object name 'dbo.RUN_MISSIONI'."}
        summary={summary}
        onOpenObject={() => {}}
      />,
    )
    expect(out).toContain('Invalid object name')
    expect(out).toContain('Oggetti citati')
    expect(out).toContain('Apri CREATE dbo.RUN_MISSIONI')
  })

  it('errore senza oggetti riconoscibili: solo il testo', () => {
    const out = renderToStaticMarkup(
      <QueryErrorBanner error="Timeout scaduto." summary={summary} onOpenObject={() => {}} />,
    )
    expect(out).toContain('Timeout scaduto.')
    expect(out).not.toContain('Oggetti citati')
  })
})
