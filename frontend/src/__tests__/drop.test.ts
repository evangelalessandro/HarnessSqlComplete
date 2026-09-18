// Suggerimenti per "ALTER TABLE … DROP COLUMN" e "… DROP CONSTRAINT": dopo DROP si propongono
// COLUMN/CONSTRAINT, dopo DROP COLUMN le colonne della tabella, dopo DROP CONSTRAINT i vincoli
// (CHECK, FOREIGN KEY, PRIMARY KEY, UNIQUE) della tabella.
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import * as monaco from 'monaco-editor'
import { provideSqlCompletions } from '../sqlCompletions'
import { detectAlterTableDropContext, splitQualifiedName } from '../tsqlSnippets'
import type { DatabaseSummary } from '../types'
import { demoStoreLikeSummary } from './schema'

const base = demoStoreLikeSummary()

/** Tabella Ordini con chiave primaria, più un vincolo CHECK: servono per DROP CONSTRAINT. */
const conVincoli: DatabaseSummary = {
  ...base,
  tables: base.tables.map(t =>
    t.name === 'Ordini'
      ? { ...t, indexes: [{ name: 'PK_Ordini', isPrimaryKey: true, isUnique: true, columns: ['id'] }] }
      : t,
  ),
  checkConstraints: [
    { schema: 'dbo', tableName: 'Ordini', name: 'CK_Ordini_totale', definition: '([totale]>=(0))', isDisabled: false },
  ],
}

function suggest(sql: string, summary: DatabaseSummary = base) {
  const model = monaco.editor.createModel(sql, 'sql')
  try {
    return provideSqlCompletions({
      model,
      position: model.getPositionAt(sql.length),
      state: { connectionId: 'test', summary, aiEnabled: false, onExecute: () => {} },
    })
  } finally {
    model.dispose()
  }
}

const nomi = (sql: string, summary: DatabaseSummary = base) =>
  (suggest(sql, summary)?.suggestions ?? []).map(s => String(s.label))

describe('detectAlterTableDropContext', () => {
  it('DROP da solo (o parola chiave a metà) → COLUMN / CONSTRAINT', () => {
    expect(detectAlterTableDropContext('ALTER TABLE dbo.T DROP ')).toEqual({ kind: 'keywords' })
    expect(detectAlterTableDropContext('ALTER TABLE dbo.T DROP')).toEqual({ kind: 'keywords' })
    expect(detectAlterTableDropContext('alter table dbo.T drop COL')).toEqual({ kind: 'keywords' })
    expect(detectAlterTableDropContext('ALTER TABLE dbo.T DROP CONS')).toEqual({ kind: 'keywords' })
  })

  it('DROP COLUMN → la tabella (anche con nome parziale già digitato)', () => {
    expect(detectAlterTableDropContext('ALTER TABLE dbo.T DROP COLUMN ')).toEqual({
      kind: 'column',
      schema: 'dbo',
      table: 'T',
    })
    expect(detectAlterTableDropContext('ALTER TABLE dbo.T DROP COLUMN')).toEqual({
      kind: 'column',
      schema: 'dbo',
      table: 'T',
    })
    expect(detectAlterTableDropContext('ALTER TABLE [dbo].[T] DROP COLUMN [COL')).toEqual({
      kind: 'column',
      schema: 'dbo',
      table: 'T',
    })
  })

  it('DROP CONSTRAINT → la tabella', () => {
    expect(detectAlterTableDropContext('ALTER TABLE dbo.T DROP CONSTRAINT ')).toEqual({
      kind: 'constraint',
      schema: 'dbo',
      table: 'T',
    })
    expect(detectAlterTableDropContext('ALTER TABLE dbo.T DROP CONSTRAINT CK_x')).toEqual({
      kind: 'constraint',
      schema: 'dbo',
      table: 'T',
    })
  })

  it('senza schema la tabella resta senza schema (si cerca per nome)', () => {
    expect(detectAlterTableDropContext('ALTER TABLE T DROP COLUMN ')).toEqual({
      kind: 'column',
      schema: '',
      table: 'T',
    })
  })

  it('altre forme non sono il contesto DROP', () => {
    expect(detectAlterTableDropContext('ALTER TABLE dbo.T ADD ')).toBeNull()
    expect(detectAlterTableDropContext('ALTER TABLE dbo.T DROP pippo ')).toBeNull()
    expect(detectAlterTableDropContext('SELECT * FROM dbo.T DROP COLUMN ')).toBeNull()
  })

  it('splitQualifiedName toglie parentesi e schema di default', () => {
    expect(splitQualifiedName('[dbo].[DAT_UDC]')).toEqual({ schema: 'dbo', table: 'DAT_UDC' })
    expect(splitQualifiedName('dbo.DAT_UDC')).toEqual({ schema: 'dbo', table: 'DAT_UDC' })
    expect(splitQualifiedName('DAT_UDC')).toEqual({ schema: '', table: 'DAT_UDC' })
  })
})

describe('suggerimenti nel provider', () => {
  it('dopo "DROP " propone COLUMN e CONSTRAINT', () => {
    const voci = nomi('ALTER TABLE dbo.DAT_UDC DROP ')
    expect(voci).toContain('COLUMN')
    expect(voci).toContain('CONSTRAINT')
  })

  it('dopo "DROP COLUMN " propone le colonne della tabella (non le parole chiave)', () => {
    const voci = nomi('ALTER TABLE dbo.DAT_UDC DROP COLUMN ')
    expect(voci).toContain('UDC_UDC')
    expect(voci).toContain('UDC_DESCR')
    expect(voci).not.toContain('COLUMN')
  })

  it('funziona con il nome fra parentesi quadre e senza schema', () => {
    expect(nomi('ALTER TABLE [dbo].[DAT_UDC] DROP COLUMN ')).toContain('UDC_UDC')
    expect(nomi('ALTER TABLE DAT_UDC DROP COLUMN ')).toContain('UDC_UDC')
    expect(nomi('ALTER TABLE dbo.DAT_UDC DROP COLUMN')).toContain('UDC_UDC')
  })

  it('dopo "DROP CONSTRAINT " propone CHECK, chiave primaria e chiavi esterne DELLA tabella', () => {
    const voci = nomi('ALTER TABLE dbo.Ordini DROP CONSTRAINT ', conVincoli)
    expect(voci).toContain('CK_Ordini_totale')
    expect(voci).toContain('PK_Ordini')
    expect(voci).toContain('FK_ORDINI_CLIENTI')
    // vincoli di altre tabelle non c'entrano
    expect(voci).not.toContain('FK_RUN_MISSIONI_DAT_UDC')
  })

  it('le chiavi esterne si propongono solo per la loro tabella', () => {
    const voci = nomi('ALTER TABLE dbo.RUN_MISSIONI DROP CONSTRAINT ')
    expect(voci).toContain('FK_RUN_MISSIONI_DAT_UDC')
    expect(voci).not.toContain('FK_ORDINI_CLIENTI')
  })

  it('tabella senza vincoli: il popup NON resta vuoto (si prosegue con i suggerimenti normali)', () => {
    const voci = nomi('ALTER TABLE dbo.Articoli DROP CONSTRAINT ')
    expect(voci.length).toBeGreaterThan(0)
  })

  it('una tabella sconosciuta non svuota il popup', () => {
    expect(nomi('ALTER TABLE dbo.NonEsiste DROP COLUMN ').length).toBeGreaterThan(0)
  })

  it('subito dopo "ALTER TABLE t " continuano a proporsi gli snippet (non le colonne)', () => {
    const voci = nomi('ALTER TABLE dbo.DAT_UDC ')
    expect(voci).toContain('DROP COLUMN')
    expect(voci).toContain('ADD colonna')
  })
})
