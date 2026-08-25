import { describe, expect, it } from 'vitest'
import { pickFormatTarget, pickSqlToExecute } from '../executeSelection'

describe('pickSqlToExecute: esegui solo la selezione (come SSMS)', () => {
  it('con selezione esegue solo la selezione', () => {
    expect(pickSqlToExecute('SELECT 1', 'SELECT 1\nSELECT 2')).toBe('SELECT 1')
  })

  it('senza selezione (cursore fermo) esegue tutto', () => {
    expect(pickSqlToExecute(null, 'SELECT 1\nSELECT 2')).toBe('SELECT 1\nSELECT 2')
    expect(pickSqlToExecute(undefined, 'SELECT 1')).toBe('SELECT 1')
  })

  it('selezione con spazi ai bordi viene ripulita', () => {
    expect(pickSqlToExecute('  SELECT 1  ', 'SELECT 1\nSELECT 2')).toBe('SELECT 1')
    expect(pickSqlToExecute('\nSELECT 1\n', 'SELECT 1\nSELECT 2')).toBe('SELECT 1')
  })

  it('selezione di sole righe vuote ricade su tutto il codice', () => {
    expect(pickSqlToExecute('   \n  ', 'SELECT 1\nSELECT 2')).toBe('SELECT 1\nSELECT 2')
  })

  it('selezione multilinea viene preservata (solo bordi ripuliti)', () => {
    expect(pickSqlToExecute('SELECT 1\nSELECT 2\n', 'SELECT 1\nSELECT 2\nSELECT 3')).toBe('SELECT 1\nSELECT 2')
  })
})

describe('pickFormatTarget: formatta solo la selezione (come SSMS)', () => {
  it('con selezione formatta solo quella parte (usesSelection true)', () => {
    expect(pickFormatTarget('  SELECT 1  ', 'SELECT 1\nSELECT 2')).toEqual({ text: 'SELECT 1', usesSelection: true })
  })

  it('senza selezione formatta tutto (usesSelection false)', () => {
    expect(pickFormatTarget(null, 'SELECT 1\nSELECT 2')).toEqual({ text: 'SELECT 1\nSELECT 2', usesSelection: false })
    expect(pickFormatTarget(undefined, 'SELECT 1')).toEqual({ text: 'SELECT 1', usesSelection: false })
  })

  it('selezione di sole righe vuote → formatta tutto', () => {
    expect(pickFormatTarget('   \n  ', 'SELECT 1')).toEqual({ text: 'SELECT 1', usesSelection: false })
  })

  it('selezione multilinea ripulita solo ai bordi', () => {
    expect(pickFormatTarget('\nSELECT 1\nSELECT 2\n', 'SELECT 1\nSELECT 2\nSELECT 3')).toEqual({
      text: 'SELECT 1\nSELECT 2',
      usesSelection: true,
    })
  })
})
