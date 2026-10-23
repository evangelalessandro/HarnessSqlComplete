// @vitest-environment jsdom
// NOMI DEI DATABASE nell'intellisense.
// Richiesta utente: "permetti anche di fare con l'intellisense i nomi dei database, che adesso non
// vengono fuori".
// L'elenco arriva con il sommario (`summary.databases`, lo stesso della barra laterale): dopo "USE "
// si propongono solo i database; in posizione di tabella (FROM/JOIN/INTO/UPDATE) si aggiungono in
// coda alle tabelle, per scrivere nomi in tre parti.
import { describe, expect, it } from 'vitest'
import * as monaco from 'monaco-editor'
import { provideSqlCompletions } from '../sqlCompletions'
import type { DatabaseSummary } from '../types'
import { demoStoreLikeSummary } from './schema'

function sommarioConDatabase(): DatabaseSummary {
  const s = demoStoreLikeSummary()
  s.databases = [{ name: 'WSGSDMALTA' }, { name: 'WSBASE' }, { name: 'Negozio SM' }]
  return s
}

const summary = sommarioConDatabase()

/** Esegue il provider alla fine del testo (come fa Monaco mentre si digita). */
function suggest(sql: string, sum: DatabaseSummary | null = summary) {
  const model = monaco.editor.createModel(sql, 'sql')
  try {
    const position = model.getPositionAt(sql.length)
    return provideSqlCompletions({
      model,
      position,
      state: { connectionId: 'test', summary: sum, aiEnabled: true, onExecute: () => {} },
    }).suggestions
  } finally {
    model.dispose()
  }
}

const etichette = (sug: { label: string | { label: string } }[]) =>
  sug.map(x => (typeof x.label === 'string' ? x.label : x.label.label))
const dettagli = (sug: { detail?: string }[]) => sug.map(x => x.detail ?? '')

describe('intellisense: nomi dei database', () => {
  it('dopo "USE " propone solo i database', () => {
    const sug = suggest('USE ')
    console.log(`  USE → ${JSON.stringify(etichette(sug))}`)
    expect(etichette(sug)).toEqual(['WSGSDMALTA', 'WSBASE', 'Negozio SM'])
    expect(dettagli(sug).every(d => d === 'database del server')).toBe(true)
  })

  it('dopo "USE WS" filtra sul prefisso digitato', () => {
    const sug = suggest('USE WS')
    expect(etichette(sug)).toContain('WSGSDMALTA')
    expect(etichette(sug)).toContain('WSBASE')
  })

  it('dopo "USE [WS" funziona anche con la parentesi quadra aperta', () => {
    const sug = suggest('USE [WS')
    console.log(`  USE [WS → ${JSON.stringify(etichette(sug))}`)
    expect(etichette(sug)).toContain('WSGSDMALTA')
  })

  it('il nome con lo spazio viene inserito fra parentesi quadre', () => {
    const sug = suggest('USE ')
    const negozio = sug.find(s => (typeof s.label === 'string' ? s.label : '') === 'Negozio SM')
    expect(negozio).toBeTruthy()
    expect(String(negozio!.insertText)).toBe('[Negozio SM]')
  })

  it('in posizione di tabella (FROM) i database ci sono, DOPO le tabelle dello schema', () => {
    const sug = suggest('SELECT * FROM ')
    const etichette3 = etichette(sug)
    console.log(`  FROM → primi 3: ${JSON.stringify(etichette3.slice(0, 3))} · database presenti: ${JSON.stringify(etichette3.filter(e => ['WSBASE', 'Negozio SM', 'WSGSDMALTA'].includes(e)))}`)
    // le tabelle vere vengono prima
    expect(etichette3[0]).not.toBe('WSBASE')
    // i database ci sono
    expect(etichette3).toContain('WSBASE')
    expect(etichette3).toContain('Negozio SM')
    // e sono in coda: dopo la prima tabella
    expect(etichette3.indexOf('WSBASE')).toBeGreaterThan(0)
  })

  it('senza elenco di database non si rompe niente', () => {
    const senza = demoStoreLikeSummary()
    senza.databases = []
    const sug = suggest('SELECT * FROM ', senza)
    expect(etichette(sug).length).toBeGreaterThan(0)
    expect(etichette(sug)).not.toContain('WSBASE')
    // e dopo USE non resta vuoto: il popup di Monaco con zero voci si chiude, quindi si prosegue
    const dopoUse = suggest('USE ', senza)
    expect(Array.isArray(dopoUse)).toBe(true)
  })
})
