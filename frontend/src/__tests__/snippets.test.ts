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

  // Segnalazione utente: "la parola enable o disable non viene fuori dall'intellisense".
  it('digitando "dis"/"ena" propone le direttive sui TRIGGER (con nome e ON tabella)', () => {
    const dis = buildStatementSnippets('dis')
    expect(dis.some(s => s.label === 'DISABLE TRIGGER')).toBe(true)
    expect(dis.some(s => s.label === 'DISABLE TRIGGER ALL')).toBe(true)
    expect(dis.find(s => s.label === 'DISABLE TRIGGER')!.insertText).toBe(
      'DISABLE TRIGGER ${1:[schema.]trigger} ON ${2:[schema.]tabella};\n',
    )
    const ena = buildStatementSnippets('ena')
    expect(ena.some(s => s.label === 'ENABLE TRIGGER')).toBe(true)
    expect(ena.find(s => s.label === 'ENABLE TRIGGER ALL')!.insertText).toBe(
      'ENABLE TRIGGER ALL ON ${1:[schema.]tabella};\n',
    )
  })

  // Richiesta utente: "deve essere come le altre tipo EXEC, una parola chiave, blue" — queste
  // voci si presentano come KEYWORD (icona blu), non con l'icona "snippet".
  it('le direttive sui trigger sono marcate come parola chiave', () => {
    for (const s of buildStatementSnippets('dis')) expect(s.keyword).toBe(true)
    for (const s of buildStatementSnippets('ena')) expect(s.keyword).toBe(true)
    // gli altri snippet restano snippet
    expect(buildStatementSnippets('sel').every(s => !s.keyword)).toBe(true)
    expect(buildStatementSnippets('mer').every(s => !s.keyword)).toBe(true)
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
