// SCRIPT CREATE TABLE completo (richiesta utente: "lo script di creazione di una tabella deve
// riportare anche proprietà estese, trigger, constraint, primary key, ecc…").
import { describe, expect, it } from 'vitest'
import { scriptCreateTable } from '../helpers'
import type { CheckConstraintInfo, ForeignKeyInfo, TriggerInfo } from '../types'
import { mkCol, mkTbl } from './schema'

const tabella = mkTbl('dbo', 'Ordini', [
  mkCol('id', 'int', { isIdentity: true }),
  mkCol('cliente_id', 'int'),
  mkCol('importo', 'decimal', { isNullable: true }),
])
tabella.indexes = [
  {
    name: 'PK_Ordini',
    isPrimaryKey: true,
    isUnique: true,
    columns: ['id'],
    fillFactor: 90,
    isPadded: false,
    ignoreDupKey: false,
    allowRowLocks: true,
    allowPageLocks: false,
    optimizeForSequentialKey: false,
    statisticsNoRecompute: false,
    fileGroup: 'SECONDARY',
  },
  { name: 'UQ_Ordini_Cliente', isPrimaryKey: false, isUnique: true, columns: ['cliente_id'] },
  { name: 'IX_Ordini_Importo', isPrimaryKey: false, isUnique: false, columns: ['importo'] },
]
tabella.extendedProperties = [{ name: 'MS_Description', value: "Ordini d'esempio" }]
tabella.columns![0].extendedProperties = [{ name: 'MS_Description', value: 'Chiave' }]

const checks: CheckConstraintInfo[] = [
  { schema: 'dbo', tableName: 'Ordini', name: 'CK_Ordini_Importo', definition: '([importo]>=(0))' },
  { schema: 'dbo', tableName: 'Altro', name: 'CK_Altro', definition: '([x]>(0))' },
]
const fk: ForeignKeyInfo[] = [
  { name: 'FK_Ordini_Clienti', schema: 'dbo', table: 'Ordini', column: 'cliente_id', refSchema: 'dbo', refTable: 'Clienti', refColumn: 'id' },
]
const triggers: TriggerInfo[] = [
  { schema: 'dbo', tableName: 'Ordini', name: 'TR_Ordini_Ins' },
  { schema: 'dbo', tableName: 'Altro', name: 'TR_Altro' },
]

describe('scriptCreateTable: colonne, chiavi, vincoli, proprietà estese, trigger', () => {
  const sql = scriptCreateTable(tabella, { checks, foreignKeys: fk, triggers })

  it('l indice porta le OPZIONI e il FILEGROUP (WITH (… FILLFACTOR = 90 …) ON [SECONDARY])', () => {
    expect(sql).toContain('WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = OFF, FILLFACTOR = 90, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF)')
    expect(sql).toContain('ON [SECONDARY]')
    // e la TABELLA stessa finisce sul filegroup
    expect(sql).toContain(') ON [SECONDARY];')
  })

  it('crea la tabella con le colonne (identità e nullabilità)', () => {
    expect(sql).toContain('CREATE TABLE Ordini (')
    expect(sql).toContain('id int IDENTITY(1,1) NOT NULL')
    expect(sql).toContain('importo decimal')
  })

  it('include la PRIMARY KEY e i vincoli UNIQUE', () => {
    expect(sql).toContain('CONSTRAINT PK_Ordini PRIMARY KEY (id)')
    expect(sql).toContain('CONSTRAINT UQ_Ordini_Cliente UNIQUE (cliente_id)')
    // un indice NON unico non è un vincolo: non deve comparire
    expect(sql).not.toContain('IX_Ordini_Importo')
  })

  it('include i vincoli CHECK della tabella (e solo quelli)', () => {
    expect(sql).toContain('CONSTRAINT CK_Ordini_Importo CHECK ([importo]>=(0))')
    expect(sql).not.toContain('CK_Altro')
  })

  it('include le chiavi esterne USCENTI', () => {
    expect(sql).toContain('CONSTRAINT FK_Ordini_Clienti FOREIGN KEY (cliente_id) REFERENCES Clienti (id)')
  })

  it('include le PROPRIETÀ ESTESE di tabella e colonne', () => {
    expect(sql).toContain("sp_addextendedproperty @name = N'MS_Description', @value = N'Ordini d''esempio'")
    expect(sql).toMatch(/@level1name = Ordini;\n/)
    expect(sql).toContain("sp_addextendedproperty @name = N'MS_Description', @value = N'Chiave'")
    expect(sql).toMatch(/@level2type = N'COLUMN', @level2name = id;/)
  })

  it('elenca i trigger della tabella (il corpo si prende con "Apri definizione")', () => {
    expect(sql).toContain('-- TRIGGER della tabella')
    expect(sql).toContain('--   TR_Ordini_Ins')
    expect(sql).not.toContain('TR_Altro')
  })

  it('regge i metadati mancanti (nessun vincolo, nessuna proprietà)', () => {
    const minimo = scriptCreateTable(mkTbl('dbo', 'Vuota', [mkCol('a', 'int')]))
    expect(minimo).toContain('CREATE TABLE Vuota (')
    expect(minimo).not.toContain('CONSTRAINT')
    expect(minimo).not.toContain('sp_addextendedproperty')
  })
})
