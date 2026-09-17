import { describe, expect, it } from 'vitest'
import { chooseResultTab } from '../queryTabs'
import type { QueryMessage, QueryResult, QueryResultSet } from '../types'

const set = (columns: string[], rows: unknown[][] = []): QueryResultSet => ({
  columns: columns.map(name => ({ name, dataType: 'int' })),
  rows,
  rowCount: rows.length,
  affectedRows: 0,
  truncated: false,
})

const result = (
  resultSets: QueryResultSet[],
  error: string | null = null,
  errors: QueryMessage[] | null = null,
): Pick<QueryResult, 'error' | 'resultSets'> & { errors?: QueryMessage[] | null } => ({
  resultSets,
  error,
  errors,
})

const errMsg = (over: Partial<QueryMessage> = {}): QueryMessage => ({
  text: 'Errore',
  display: 'Msg 50000, Livello 16, Stato 1, Procedura ws_X, Riga 1\nErrore',
  number: 50000,
  severity: 16,
  state: 1,
  procedure: 'ws_X',
  line: 1,
  isError: true,
  ...over,
})

describe('chooseResultTab: dove finiscono i risultati della query', () => {
  it('nessuna SELECT, solo PRINT → schermata dei print', () => {
    expect(chooseResultTab(result([]))).toBe('print')
  })

  it('UPDATE senza result set (nessuna colonna) → schermata dei print', () => {
    expect(chooseResultTab(result([set([])]))).toBe('print')
  })

  it('una SELECT vera → schermata dei risultati', () => {
    expect(chooseResultTab(result([set(['id', 'nome'])]))).toBe('results')
  })

  it('SELECT che restituisce 0 righe ma con colonne → schermata dei risultati', () => {
    expect(chooseResultTab(result([set(['id'], [])]))).toBe('results')
  })

  it('update + select insieme → schermata dei risultati (c\'è una SELECT)', () => {
    expect(chooseResultTab(result([set([]), set(['id'])]))).toBe('results')
  })

  it('ERRORE → si apre la schermata dei messaggi, dove l errore si vede per primo', () => {
    expect(chooseResultTab(result([], 'errore di sintassi'))).toBe('print')
    expect(chooseResultTab(result([set(['id'])], 'errore runtime'))).toBe('print')
  })

  it('errore E result set insieme → prima i messaggi con l errore, poi i risultati', () => {
    // caso segnalato: la query restituisce sia un errore sia delle righe
    expect(chooseResultTab(result([set(['id', 'nome'])], null, [errMsg()]))).toBe('print')
    expect(chooseResultTab(result([set(['id'])], 'Msg ... Procedura ws_X, Riga 1'))).toBe('print')
    // i risultati restano disponibili nella loro tab
    expect(chooseResultTab(result([set(['id'])], null, [errMsg({ isError: false })]))).toBe('results')
  })

  it('messaggi NON di errore (solo PRINT) con una SELECT → risultati', () => {
    expect(chooseResultTab(result([set(['id'])], null, [errMsg({ isError: false, number: 0 })]))).toBe('results')
    expect(chooseResultTab(result([set(['id'])], null, []))).toBe('results')
  })
})
