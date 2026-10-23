// PIANO DI ESECUZIONE + INDICE SUGGERITO (motore puro).
// Richiesta utente: "piano di esecuzione + indice suggerito".
//
// I test usano un piano VERO di SQL Server (salvato in fixtures): così il parser è verificato
// contro l'XML reale e non contro un'idea dell'XML. La variante "con indice" ha in più un blocco
// MissingIndexGroup con lo stesso schema di showplan (colonne fra parentesi quadre come le manda
// SQL Server).
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { analizzaPiano, nomeIndice, scriptIndiceSuggerito } from '../executionPlan'
import type { IndiceSuggerito } from '../executionPlan'
import senzaIndice from './fixtures/piano-senza-indice.xml?raw'
import conIndice from './fixtures/piano-con-indice.xml?raw'

describe('analizzaPiano: piano reale di SQL Server', () => {
  it('legge lo statement e gli operatori', () => {
    const p = analizzaPiano(senzaIndice)
    expect(p).not.toBeNull()
    console.log(`  costo: ${p!.costo}, nodi: ${p!.nodi.length}`)
    for (const n of p!.nodi.slice(0, 6)) console.log(`    ${'  '.repeat(n.profondita)}${n.operatore} · ${n.oggetto ?? '-'} · righe ${n.righe}`)
    // lo statement è quello con il filtro
    expect(p!.statement).toContain('MAG_CELLE')
    expect(p!.costo).toBeGreaterThan(0)
    // operatori attesi in QUESTO piano vero
    const ops = p!.nodi.map(n => n.operatore)
    expect(ops).toContain('Sort')
    expect(ops).toContain('Nested Loops')
    expect(ops.some(o => /Index (Seek|Scan)/i.test(o))).toBe(true)
    // le tabelle coinvolte compaiono come oggetto (senza parentesi quadre)
    expect(p!.nodi.some(n => n.oggetto === 'dbo.MAG_CELLE')).toBe(true)
    expect(p!.nodi.some(n => n.oggetto === 'dbo.MAG_BAIE')).toBe(true)
    // l'albero è ordinato per profondità
    const profondita = p!.nodi.map(n => n.profondita)
    expect([...profondita].sort((a, b) => a - b)).toEqual(profondita)
    // questo piano non propone indici
    expect(p!.indici).toHaveLength(0)
  })

  it('legge gli indici suggeriti (MissingIndexGroup) e genera lo script', () => {
    const p = analizzaPiano(conIndice)
    expect(p).not.toBeNull()
    expect(p!.indici).toHaveLength(1)
    const i = p!.indici[0]
    console.log(`  ${i.schema}.${i.tabella} impatto ${i.impatto}% uguaglianza=${i.uguaglianza} disuguaglianza=${i.disuguaglianza} include=${i.include}`)
    console.log(i.script)
    expect(i.schema).toBe('dbo')
    expect(i.tabella).toBe('MAG_CELLE')
    expect(i.impatto).toBeCloseTo(87.3456, 3)
    // le colonne arrivano fra parentesi quadre e vanno ripulite
    expect(i.uguaglianza).toEqual(['CEL_CORRIDOIO'])
    expect(i.disuguaglianza).toEqual(['CEL_CELLA'])
    expect(i.include).toEqual(['CEL_DES'])
    expect(i.script).toContain('CREATE NONCLUSTERED INDEX')
    expect(i.script).toContain('ON [dbo].[MAG_CELLE] ([CEL_CORRIDOIO], [CEL_CELLA])')
    expect(i.script).toContain('INCLUDE ([CEL_DES])')
    expect(i.script).toContain('87.3%')
  })

  it('null su XML non valido o vuoto', () => {
    expect(analizzaPiano('')).toBeNull()
    expect(analizzaPiano('non xml')).toBeNull()
    expect(analizzaPiano('<qualcosa></qualcosa>')).toBeNull()
  })
})

describe('script dell indice suggerito', () => {
  const base: IndiceSuggerito = {
    schema: 'dbo',
    tabella: 'RUN_MISSIONI',
    impatto: 42.1,
    uguaglianza: ['MIS_UDC'],
    disuguaglianza: [],
    include: [],
    script: '',
  }

  it('senza INCLUDE non scrive la clausola', () => {
    const s = scriptIndiceSuggerito(base)
    expect(s).toContain('ON [dbo].[RUN_MISSIONI] ([MIS_UDC])')
    expect(s).not.toContain('INCLUDE')
    expect(s.trim().endsWith(';')).toBe(true)
    // il commento ricorda che l'indice va valutato
    expect(s).toContain('impatto stimato 42.1%')
    expect(s).toContain('Valutalo prima di crearlo')
  })

  it('nome dell indice leggibile e entro i 128 caratteri', () => {
    expect(nomeIndice('MAG_CELLE', ['CEL_CORRIDOIO', 'CEL_CELLA'])).toBe('IX_MAG_CELLE_CEL_CORRIDOIO_CEL_CELLA')
    expect(nomeIndice('T', ['a b', 'c-d'])).toBe('IX_T_a_b_c_d')
    const lungo = nomeIndice('T', Array.from({ length: 40 }, (_, i) => `COLONNA_LUNGA_${i}`))
    expect(lungo.length).toBeLessThanOrEqual(128)
  })

  it('raddoppia le quadre nei nomi che le contengono', () => {
    const s = scriptIndiceSuggerito({ ...base, tabella: 'T]X', uguaglianza: ['A]B'] })
    expect(s).toContain('[T]]X]')
    expect(s).toContain('[A]]B]')
  })
})
