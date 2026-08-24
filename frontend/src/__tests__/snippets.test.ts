import { describe, expect, it } from 'vitest'
import { buildStatementSnippets } from '../helpers'

describe('buildStatementSnippets: template statement (stile Visual Studio)', () => {
  it('digitando "ins" propone INSERT INTO', () => {
    const res = buildStatementSnippets('ins')
    expect(res.some(s => s.label === 'INSERT INTO')).toBe(true)
    expect(res[0].insertText).toContain('INSERT INTO ${1:[schema.]tabella}')
    expect(res[0].insertText).toContain('VALUES (${3:val1, val2})')
  })

  it('digitando "sel" propone SELECT', () => {
    const res = buildStatementSnippets('sel')
    expect(res.some(s => s.label === 'SELECT')).toBe(true)
    expect(res[0].insertText).toContain('FROM ${2:[schema.]tabella}')
  })

  it('digitando "upd"/"del"/"mer" propone UPDATE/DELETE/MERGE', () => {
    expect(buildStatementSnippets('upd').some(s => s.label === 'UPDATE')).toBe(true)
    expect(buildStatementSnippets('del').some(s => s.label === 'DELETE FROM')).toBe(true)
    expect(buildStatementSnippets('mer').some(s => s.label === 'MERGE INTO')).toBe(true)
  })

  it('con meno di 2 caratteri non propone nulla', () => {
    expect(buildStatementSnippets('i')).toEqual([])
    expect(buildStatementSnippets('')).toEqual([])
  })

  it('con parola non corrispondente non propone nulla', () => {
    expect(buildStatementSnippets('xyz')).toEqual([])
  })

  it('case-insensitive e con keyword completa', () => {
    expect(buildStatementSnippets('INSERT').some(s => s.label === 'INSERT INTO')).toBe(true)
    expect(buildStatementSnippets('Sel').some(s => s.label === 'SELECT')).toBe(true)
  })
})
