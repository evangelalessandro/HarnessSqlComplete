import { describe, expect, it } from 'vitest'
import { chooseResultTab } from '../queryTabs'
import type { QueryResult, QueryResultSet } from '../types'

const set = (columns: string[], rows: unknown[][] = []): QueryResultSet => ({
  columns: columns.map(name => ({ name, dataType: 'int' })),
  rows,
  rowCount: rows.length,
  affectedRows: 0,
  truncated: false,
})

const result = (resultSets: QueryResultSet[], error: string | null = null): Pick<QueryResult, 'error' | 'resultSets'> => ({
  resultSets,
  error,
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

  it('errore → schermata dei risultati (mostra l\'errore)', () => {
    expect(chooseResultTab(result([], 'errore di sintassi'))).toBe('results')
    expect(chooseResultTab(result([set(['id'])], 'errore runtime'))).toBe('results')
  })
})
