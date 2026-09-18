// Suggerimenti per "ALTER TABLE … DROP COLUMN" e "… DROP CONSTRAINT": dopo DROP si propongono
// COLUMN/CONSTRAINT, dopo DROP COLUMN le colonne della tabella, dopo DROP CONSTRAINT i vincoli
// (CHECK, FOREIGN KEY, PRIMARY KEY, UNIQUE) della tabella.
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import * as monaco from 'monaco-editor'
import { provideSqlCompletions } from '../sqlCompletions'
import { detectAlterTableDropContext, dropColumnSnippet, splitQualifiedName, vincoliCollegati } from '../tsqlSnippets'
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

describe('SNIPPET "DROP COLUMN sicuro" (vincoli collegati + controllo esistenza)', () => {
  const snippet = dropColumnSnippet('dbo.DAT_UDC')

  it('controlla che la colonna esista ancora', () => {
    expect(snippet).toContain('IF EXISTS (SELECT 1 FROM sys.columns')
    expect(snippet).toContain("OBJECT_ID(N'[dbo].[DAT_UDC]')")
    expect(snippet).toContain('PRINT N')
  })

  it('toglie i vincoli collegati prima della colonna', () => {
    expect(snippet).toContain('sys.default_constraints'.replace('sys.default_constraints', 'sys.objects')) // DEFAULT/CHECK
    expect(snippet).toContain('sys.check_constraints')
    expect(snippet).toContain('sys.foreign_key_columns')
    expect(snippet).toContain('sys.key_constraints')
    expect(snippet).toContain('ALTER TABLE [dbo].[DAT_UDC] DROP COLUMN')
  })

  it('segnala le chiavi esterne di ALTRE tabelle che puntano alla colonna', () => {
    expect(snippet).toContain('altre tabelle puntano a questa colonna')
    expect(snippet).toContain('referenced_object_id')
  })

  it('il nome della colonna è UN segnaposto ripetuto (si scrive una volta sola)', () => {
    const segnaposti = snippet.match(/\$\{1:colonna\}/g) ?? []
    expect(segnaposti.length).toBeGreaterThan(5)
    // non ci sono altri segnaposti (nessun ${2…}) e il token interno è stato sostituito
    expect(snippet).not.toContain('__COLONNA__')
    expect(snippet).not.toMatch(/\$\{2/)
  })

  it('accetta anche il nome con parentesi quadre e senza schema', () => {
    expect(dropColumnSnippet('[dbo].[T]')).toContain("OBJECT_ID(N'[dbo].[T]')")
    expect(dropColumnSnippet('T')).toContain("OBJECT_ID(N'[T]')")
  })
})

describe('vincoliCollegati: cosa va tolto prima di eliminare la colonna', () => {
  const summary = {
    checkConstraints: [
      { schema: 'dbo', tableName: 'Ordini', name: 'CK_Ordini_totale', definition: '([totale]>=(0))' },
      { schema: 'dbo', tableName: 'Ordini', name: 'CK_Altro', definition: '([id]>(0))' },
    ],
    foreignKeys: [
      {
        name: 'FK_ORDINI_CLIENTI',
        schema: 'dbo',
        table: 'Ordini',
        column: 'customer_id',
        refSchema: 'dbo',
        refTable: 'Clienti',
        refColumn: 'id',
      },
      {
        name: 'FK_RIGHE_ORDINE',
        schema: 'dbo',
        table: 'Righe',
        column: 'ordine_id',
        refSchema: 'dbo',
        refTable: 'Ordini',
        refColumn: 'id',
      },
    ],
  }
  const indici = [
    { name: 'PK_Ordini', isPrimaryKey: true, isUnique: true, columns: ['id'] },
    { name: 'UQ_Ordini_cod', isPrimaryKey: false, isUnique: true, columns: ['codice'] },
  ]

  it('CHECK che cita la colonna, FK uscente e PK che la contiene', () => {
    const perId = vincoliCollegati(summary, 'dbo', 'Ordini', 'id', indici).map(v => v.name)
    expect([...perId].sort()).toEqual(['CK_Altro', 'FK_RIGHE_ORDINE', 'PK_Ordini'])
  })

  it('la FK della colonna customer_id è quella uscente verso Clienti', () => {
    const perCustomer = vincoliCollegati(summary, 'dbo', 'Ordini', 'customer_id', indici)
    expect(perCustomer.map(v => v.name)).toEqual(['FK_ORDINI_CLIENTI'])
    expect(perCustomer[0].kind).toContain('Clienti')
  })

  it('la FK da un altra tabella è segnalata come tale', () => {
    const fk = vincoliCollegati(summary, 'dbo', 'Ordini', 'id', indici).find(v => v.name === 'FK_RIGHE_ORDINE')
    expect(fk?.kind).toContain('altra tabella')
  })

  it('colonna senza vincoli → elenco vuoto', () => {
    expect(vincoliCollegati(summary, 'dbo', 'Ordini', 'descrizione', indici)).toEqual([])
  })

  it('i vincoli di altre tabelle non entrano', () => {
    const perTotale = vincoliCollegati(summary, 'dbo', 'Ordini', 'totale', indici)
    expect(perTotale.map(v => v.name)).toEqual(['CK_Ordini_totale'])
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

  it('propone lo snippet "DROP COLUMN sicuro" con il nome della tabella già dentro', () => {
    const res = suggest('ALTER TABLE dbo.DAT_UDC DROP COLUMN ')
    const voce = res?.suggestions.find(s => String(s.label).startsWith('DROP COLUMN sicuro'))
    expect(voce).toBeDefined()
    expect(String(voce!.insertText)).toContain('IF EXISTS (SELECT 1 FROM sys.columns')
    expect(String(voce!.insertText)).toContain("OBJECT_ID(N'[dbo].[DAT_UDC]')")
    expect(String(voce!.insertText)).toContain('DROP COLUMN')
    expect(String(voce!.insertText)).toContain('${1:colonna}')
    // lo snippet sostituisce TUTTO lo statement: il testo prima del cursore si cancella con
    // additionalTextEdits (dal primo carattere di "ALTER TABLE" fino alla parola digitata)
    const edits = (voce as { additionalTextEdits?: { range: monaco.IRange }[] }).additionalTextEdits ?? []
    expect(edits).toHaveLength(1)
    expect(edits[0].range.startColumn).toBe(1)
    // e si trova anche scrivendo un pezzo del nome ("sic")
    const conParziale = suggest('ALTER TABLE dbo.DAT_UDC DROP COLUMN sic')
    expect((conParziale?.suggestions ?? []).some(s => String(s.label).startsWith('DROP COLUMN sicuro'))).toBe(true)
  })

  it('nelle colonne indica i vincoli collegati (da togliere prima)', () => {
    const res = suggest('ALTER TABLE dbo.Ordini DROP COLUMN ', conVincoli)
    const id = res?.suggestions.find(s => String(s.label) === 'id')
    expect(String(id?.detail ?? '')).toContain('PK_Ordini')
    expect(String(id?.detail ?? '')).toContain('vincoli collegati')
    // la colonna con la chiave esterna mostra il vincolo uscente
    const customer = res?.suggestions.find(s => String(s.label) === 'customer_id')
    expect(String(customer?.detail ?? '')).toContain('FK_ORDINI_CLIENTI')
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
