// INDICI e VINCOLI negli script di generazione e cancellazione (richiesta utente: "metti nello
// script di generazione\cancellazione e treeview anche gli indici e constraint").
//
// - lo script CREATE della tabella porta anche gli indici NON di vincolo (compresi UNIQUE INDEX,
//   colonne INCLUDE e indici filtrati), come fa SSMS "Script Table as → CREATE";
// - PRIMARY KEY / UNIQUE CONSTRAINT restano DENTRO la CREATE TABLE come CONSTRAINT (è lì che
//   SQL Server li vuole) e si cancellano con ALTER TABLE … DROP CONSTRAINT;
// - gli indici veri si cancellano con DROP INDEX … ON …;
// - una chiave esterna si può generare da sola (scriptForeignKey).
import { describe, expect, it } from 'vitest'
import {
  indiceVincolo,
  scriptCreateIndex,
  scriptCreateTable,
  scriptDropConstraint,
  scriptDropIndex,
  scriptForeignKey,
} from '../helpers'
import type { ForeignKeyInfo } from '../types'
import { mkCol, mkTbl } from './schema'

const tabella = mkTbl('dbo', 'Ordini', [
  mkCol('id', 'int', { isIdentity: true }),
  mkCol('cliente_id', 'int'),
  mkCol('importo', 'decimal', { isNullable: true }),
])
tabella.indexes = [
  { name: 'PK_Ordini', isPrimaryKey: true, isUnique: true, columns: ['id'], isClustered: true },
  // vincolo UNIQUE: resta dentro la CREATE TABLE
  { name: 'UQ_Ordini_Cliente', isPrimaryKey: false, isUnique: true, isUniqueConstraint: true, columns: ['cliente_id'] },
  // indice NON unico: ora entra nello script come CREATE INDEX
  {
    name: 'IX_Ordini_Importo',
    isPrimaryKey: false,
    isUnique: false,
    columns: ['importo', 'cliente_id'],
    descendingColumns: ['cliente_id'],
    includedColumns: ['id'],
    filterDefinition: '([importo]>(0))',
    fillFactor: 90,
    fileGroup: 'SECONDARY',
  },
  // UNIQUE INDEX (non vincolo): CREATE UNIQUE INDEX / DROP INDEX
  { name: 'UX_Ordini_Cliente', isPrimaryKey: false, isUnique: true, isUniqueConstraint: false, columns: ['cliente_id'] },
]

describe('scriptCreateIndex: stile SSMS "Script Index as → CREATE"', () => {
  const ix = tabella.indexes![2]
  const sql = scriptCreateIndex(tabella, ix)
  console.log(sql)

  it('intestazione, tipo di indice e tabella', () => {
    expect(sql).toContain('/****** Object:  Index [IX_Ordini_Importo] ******/')
    expect(sql).toContain('CREATE NONCLUSTERED INDEX [IX_Ordini_Importo] ON [dbo].[Ordini]')
  })

  it('colonne chiave una per riga con ASC/DESC', () => {
    expect(sql).toContain('(\n\t[importo] ASC,\n\t[cliente_id] DESC\n)')
  })

  it('colonne INCLUDE e filtro degli indici filtrati', () => {
    expect(sql).toContain('INCLUDE ([id])')
    expect(sql).toContain('WHERE ([importo]>(0))')
  })

  it('opzioni e filegroup come per i vincoli', () => {
    expect(sql).toContain('WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ')
    expect(sql).toContain('FILLFACTOR = 90')
    expect(sql).toContain(') ON [SECONDARY]')
    expect(sql.trimEnd().endsWith('GO')).toBe(true)
  })

  it('un indice UNIQUE scrive CREATE UNIQUE INDEX', () => {
    expect(scriptCreateIndex(tabella, tabella.indexes![3])).toContain(
      'CREATE UNIQUE NONCLUSTERED INDEX [UX_Ordini_Cliente] ON [dbo].[Ordini]',
    )
  })

  it('CLUSTERED dove il database di origine lo è', () => {
    const c = mkTbl('dbo', 'T', [mkCol('a', 'int')])
    c.indexes = [{ name: 'IX_c', isPrimaryKey: false, isUnique: false, columns: ['a'], isClustered: true }]
    expect(scriptCreateIndex(c, c.indexes[0])).toContain('CREATE CLUSTERED INDEX [IX_c]')
  })
})

describe('scriptDropIndex / scriptDropConstraint', () => {
  it('un indice vero si cancella con DROP INDEX … ON …', () => {
    expect(scriptDropIndex(tabella, tabella.indexes![2])).toBe('DROP INDEX IX_Ordini_Importo ON Ordini;\n')
  })

  it('un vincolo (PK o UNIQUE CONSTRAINT) si cancella con ALTER TABLE … DROP CONSTRAINT', () => {
    expect(scriptDropIndex(tabella, tabella.indexes![0])).toBe('ALTER TABLE Ordini DROP CONSTRAINT PK_Ordini;\n')
    expect(scriptDropIndex(tabella, tabella.indexes![1])).toBe(
      'ALTER TABLE Ordini DROP CONSTRAINT UQ_Ordini_Cliente;\n',
    )
  })

  it('un UNIQUE INDEX (non vincolo) si cancella con DROP INDEX', () => {
    expect(scriptDropIndex(tabella, tabella.indexes![3])).toBe('DROP INDEX UX_Ordini_Cliente ON Ordini;\n')
  })

  it('scriptDropConstraint vale per CHECK, FK e DEFAULT', () => {
    expect(scriptDropConstraint('dbo', 'Ordini', 'CK_Ordini_Importo')).toBe(
      'ALTER TABLE Ordini DROP CONSTRAINT CK_Ordini_Importo;\n',
    )
    expect(scriptDropConstraint('vendite', 'Righe', 'FK_Righe_Ordini')).toBe(
      'ALTER TABLE vendite.Righe DROP CONSTRAINT FK_Righe_Ordini;\n',
    )
  })

  it('indiceVincolo: PK e UNIQUE constraint sì, indici no (e senza il dato vale il comportamento storico)', () => {
    expect(indiceVincolo({ name: 'a', isPrimaryKey: true, isUnique: true, columns: ['x'] })).toBe(true)
    expect(indiceVincolo({ name: 'b', isPrimaryKey: false, isUnique: true, columns: ['x'] })).toBe(true)
    expect(
      indiceVincolo({ name: 'c', isPrimaryKey: false, isUnique: true, isUniqueConstraint: false, columns: ['x'] }),
    ).toBe(false)
    expect(indiceVincolo({ name: 'd', isPrimaryKey: false, isUnique: false, columns: ['x'] })).toBe(false)
  })
})

describe('scriptForeignKey: la chiave esterna da sola', () => {
  const fk: ForeignKeyInfo[] = [
    { name: 'FK_Ordini_Clienti', schema: 'dbo', table: 'Ordini', column: 'cliente_id', refSchema: 'dbo', refTable: 'Clienti', refColumn: 'id' },
  ]

  it('emette ADD CONSTRAINT … FOREIGN KEY … REFERENCES e il CHECK', () => {
    const sql = scriptForeignKey('dbo', 'Ordini', 'FK_Ordini_Clienti', fk)
    console.log(sql)
    expect(sql).toContain('ALTER TABLE Ordini  WITH CHECK ADD  CONSTRAINT [FK_Ordini_Clienti] FOREIGN KEY([cliente_id])')
    expect(sql).toContain('REFERENCES [dbo].[Clienti] ([id])')
    expect(sql).toContain('ALTER TABLE Ordini CHECK CONSTRAINT [FK_Ordini_Clienti]')
  })

  it('chiave composita: tutte le colonne nell ordine letto', () => {
    const comp: ForeignKeyInfo[] = [
      { name: 'FK_c', schema: 'dbo', table: 'T', column: 'a', refSchema: 'dbo', refTable: 'U', refColumn: 'x' },
      { name: 'FK_c', schema: 'dbo', table: 'T', column: 'b', refSchema: 'dbo', refTable: 'U', refColumn: 'y' },
    ]
    expect(scriptForeignKey('dbo', 'T', 'FK_c', comp)).toContain('FOREIGN KEY([a], [b])')
    expect(scriptForeignKey('dbo', 'T', 'FK_c', comp)).toContain('([x], [y])')
  })

  it('senza righe non emette nulla', () => {
    expect(scriptForeignKey('dbo', 'T', 'FK_x', [])).toBe('')
  })
})

describe('scriptCreateTable: gli indici entrano nello script di generazione', () => {
  const sql = scriptCreateTable(tabella, {})

  it('l indice non unico compare come CREATE INDEX (prima spariva)', () => {
    expect(sql).toContain('CREATE NONCLUSTERED INDEX [IX_Ordini_Importo] ON [dbo].[Ordini]')
    expect(sql).toContain('INCLUDE ([id])')
  })

  it('l UNIQUE INDEX compare come CREATE UNIQUE INDEX, non come CONSTRAINT', () => {
    expect(sql).toContain('CREATE UNIQUE NONCLUSTERED INDEX [UX_Ordini_Cliente] ON [dbo].[Ordini]')
    expect(sql).not.toContain('CONSTRAINT [UX_Ordini_Cliente]')
  })

  it('i vincoli restano DENTRO la CREATE TABLE e non vengono duplicati', () => {
    expect(sql).toContain(' CONSTRAINT [PK_Ordini] PRIMARY KEY CLUSTERED ')
    expect(sql).toContain(' CONSTRAINT [UQ_Ordini_Cliente] UNIQUE NONCLUSTERED ')
    expect(sql).not.toContain('CREATE UNIQUE NONCLUSTERED INDEX [UQ_Ordini_Cliente]')
    expect(sql).not.toContain('INDEX [PK_Ordini]')
  })

  it('gli indici arrivano dopo i vincoli e prima delle proprietà estese', () => {
    const iIndice = sql.indexOf('CREATE NONCLUSTERED INDEX [IX_Ordini_Importo]')
    const iTabella = sql.indexOf('CREATE TABLE [dbo].[Ordini](')
    expect(iTabella).toBeGreaterThan(-1)
    expect(iIndice).toBeGreaterThan(iTabella)
  })
})
