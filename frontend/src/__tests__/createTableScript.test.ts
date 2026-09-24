// SCRIPT CREATE TABLE in stile SSMS (richiesta utente: "questo è lo script corretto preso da ssms…
// fallo identico a SSMS"): identificatori sempre fra parentesi quadre, colonne su righe proprie,
// "PRIMARY KEY NONCLUSTERED" con le colonne a capo + ASC, coda ")WITH (…) ON [filegroup]",
// DEFAULT/CHECK/FK come ALTER TABLE nei loro batch, proprietà estese e trigger in coda.
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

const OPZIONI_PK =
  'PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ' +
  'ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = OFF, FILLFACTOR = 90, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF'

describe('scriptCreateTable: stile SSMS (colonne, chiavi, vincoli, proprietà estese, trigger)', () => {
  const sql = scriptCreateTable(tabella, { checks, foreignKeys: fk, triggers })
  const righe = sql.split('\n')

  it('intestazione a banner e batch SET come SSMS', () => {
    expect(righe[0]).toBe('/****** Object:  Table [dbo].[Ordini] ******/')
    // SSMS non mette righe vuote fra un batch e l'altro
    expect(sql).toContain('SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\nCREATE TABLE [dbo].[Ordini](')
    const senzaCorpo = scriptCreateTable(mkTbl('dbo', 'Vuota', [mkCol('a', 'int')]))
    expect(senzaCorpo).not.toMatch(/\n\n/)
    // il banner resta la PRIMA riga anche quando c'è il USE (che lo precede)
    expect(scriptCreateTable(tabella, {}, 'DB').split('\n')[2]).toBe('/****** Object:  Table [dbo].[Ordini] ******/')
  })

  it('CREATE TABLE con identificatori fra parentesi quadre e senza punto e virgola', () => {
    expect(sql).toContain('CREATE TABLE [dbo].[Ordini](')
    expect(sql).toContain('\t[id] [int] IDENTITY(1,1) NOT NULL,')
    expect(sql).toContain('\t[importo] [decimal] NULL')
    expect(righe).toContain(') ON [SECONDARY]')
    // il CREATE TABLE di SSMS non chiude con ";"
    expect(sql).not.toContain(');')
  })

  it('apre lo script con USE [database], come SSMS', () => {
    const conDb = scriptCreateTable(tabella, {}, 'WSGSDMALTA')
    expect(conDb.startsWith('USE [WSGSDMALTA]\nGO\n/****** Object:  Table [dbo].[Ordini] ******/\n')).toBe(true)
    // senza database attivo il USE non compare (lo script resta comunque valido)
    expect(sql.startsWith('/****** Object:  Table [dbo].[Ordini] ******/\n')).toBe(true)
  })

  it('gli indici riportano CLUSTERED/NONCLUSTERED come nel database di origine', () => {
    expect(sql).toContain(' CONSTRAINT [PK_Ordini] PRIMARY KEY NONCLUSTERED \n(\n\t[id] ASC\n)WITH (')
    const cluster = mkTbl('dbo', 'Cluster', [mkCol('a', 'int')])
    cluster.indexes = [{ name: 'PK_Cluster', isPrimaryKey: true, isUnique: true, columns: ['a'], isClustered: true }]
    expect(scriptCreateTable(cluster)).toContain(' CONSTRAINT [PK_Cluster] PRIMARY KEY CLUSTERED \n(\n\t[a] ASC\n)WITH (')
  })

  it('le chiavi UNIQUE sono vincoli, gli indici non unici no', () => {
    expect(sql).toContain(' CONSTRAINT [UQ_Ordini_Cliente] UNIQUE NONCLUSTERED \n(\n\t[cliente_id] ASC\n)WITH (')
    expect(sql).not.toContain('IX_Ordini_Importo')
  })

  it('le colonne chiave in ordine DISCENDENTE si scrivono DESC, come nel database di origine', () => {
    const desc = mkTbl('dbo', 'ConDesc', [mkCol('a', 'int'), mkCol('b', 'int')])
    desc.indexes = [
      {
        name: 'PK_ConDesc',
        isPrimaryKey: true,
        isUnique: true,
        columns: ['a', 'b'],
        isClustered: true,
        descendingColumns: ['b'],
      },
    ]
    expect(scriptCreateTable(desc)).toContain(' CONSTRAINT [PK_ConDesc] PRIMARY KEY CLUSTERED \n(\n\t[a] ASC,\n\t[b] DESC\n)WITH (')
  })

  it('con colonne LOB la coda porta TEXTIMAGE_ON [filegroup], come SSMS', () => {
    const lob = mkTbl('dbo', 'ConXml', [mkCol('id', 'int'), mkCol('xml', 'varbinary', { maxLength: -1 })])
    lob.indexes = [{ name: 'PK_ConXml', isPrimaryKey: true, isUnique: true, columns: ['id'], isClustered: true, fileGroup: 'SECONDARY' }]
    lob.lobFileGroup = 'SECONDARY'
    expect(scriptCreateTable(lob)).toContain(') ON [SECONDARY] TEXTIMAGE_ON [SECONDARY]\nGO')
    // tabella SENZA dati LOB: nessun TEXTIMAGE_ON
    expect(scriptCreateTable(tabella, {})).not.toContain('TEXTIMAGE_ON')
  })

  it('la coda dell indice è ")WITH (… opzioni …) ON [filegroup]", come SSMS', () => {
    expect(sql).toContain(`)WITH (${OPZIONI_PK}) ON [SECONDARY]`)
    // l'ultimo vincolo non ha la virgola: subito dopo chiude la tabella
    expect(sql).toMatch(/OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF\)\n\) ON \[SECONDARY\]\nGO/)
    // la tabella stessa finisce sul filegroup del database di origine
    expect(sql).toContain(') ON [SECONDARY]\nGO')
  })

  it('include i vincoli CHECK della tabella (e solo quelli), in due batch', () => {
    expect(sql).toContain('ALTER TABLE [dbo].[Ordini]  WITH CHECK ADD  CONSTRAINT [CK_Ordini_Importo] CHECK  (([importo]>=(0)))')
    expect(sql).toContain('ALTER TABLE [dbo].[Ordini] CHECK CONSTRAINT [CK_Ordini_Importo]')
    expect(sql).not.toContain('CK_Altro')
  })

  it('un CHECK DISABILITATO nel database resta disabilitato (NOCHECK), come SSMS', () => {
    const disabilitato = scriptCreateTable(tabella, {
      checks: [{ schema: 'dbo', tableName: 'Ordini', name: 'CK_Ordini_Off', definition: '([importo]>=(0))', isDisabled: true }],
    })
    expect(disabilitato).toContain('ALTER TABLE [dbo].[Ordini]  WITH NOCHECK ADD  CONSTRAINT [CK_Ordini_Off] CHECK  (([importo]>=(0)))')
    expect(disabilitato).toContain('ALTER TABLE [dbo].[Ordini] NOCHECK CONSTRAINT [CK_Ordini_Off]')
  })

  it('include le chiavi esterne USCENTI con lo stesso schema dei CHECK', () => {
    expect(sql).toContain('ALTER TABLE [dbo].[Ordini]  WITH CHECK ADD  CONSTRAINT [FK_Ordini_Clienti] FOREIGN KEY([cliente_id])')
    expect(sql).toContain('REFERENCES [dbo].[Clienti] ([id])')
    expect(sql).toContain('ALTER TABLE [dbo].[Ordini] CHECK CONSTRAINT [FK_Ordini_Clienti]')
  })

  it('include le PROPRIETÀ ESTESE di tabella e colonne, su una riga come SSMS', () => {
    expect(sql).toContain(
      "EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N'Ordini d''esempio' , " +
        "@level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'Ordini'",
    )
    expect(sql).toContain(
      "EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N'Chiave' , " +
        "@level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'Ordini', " +
        "@level2type=N'COLUMN',@level2name=N'id'",
    )
    // una riga per proprietà, ognuna con il suo GO (nessuna riga spezzata a metà)
    expect(sql.split('\n').filter(r => r.startsWith('EXEC sys.sp_addextendedproperty'))).toHaveLength(2)
  })

  it('il DEFAULT della colonna e la colonna calcolata sono quelli del database di origine', () => {
    const t2 = mkTbl('dbo', 'ConDefault', [mkCol('a', 'int'), mkCol('b', 'int')])
    t2.columns![0].defaultDefinition = '((0))'
    t2.columns![0].defaultName = 'DF_ConDefault_a'
    t2.columns![1].isComputed = true
    t2.columns![1].computedDefinition = '([a]+(1))'
    const sql2 = scriptCreateTable(t2)
    // SSMS non mette il DEFAULT in colonna: lo aggiunge dopo, con il nome del vincolo
    expect(sql2).toContain('ALTER TABLE [dbo].[ConDefault] ADD  CONSTRAINT [DF_ConDefault_a]  DEFAULT ((0)) FOR [a]')
    expect(sql2).not.toMatch(/\[a\] \[int\][^\n]*DEFAULT/)
    expect(sql2).toContain('\t[b] AS ([a]+(1))')
  })

  it('il trigger viene emesso con il CORPO preso dal database di origine', () => {
    const conCorpo = scriptCreateTable(tabella, {
      triggers: [
        { schema: 'dbo', tableName: 'Ordini', name: 'TR_Ordini_Ins', definition: 'CREATE TRIGGER TR_Ordini_Ins ON Ordini AFTER INSERT AS SELECT 1' },
      ],
    })
    expect(conCorpo).toContain('CREATE TRIGGER TR_Ordini_Ins ON Ordini AFTER INSERT AS SELECT 1')
    expect(conCorpo).toContain('-- Trigger TR_Ordini_Ins')
  })

  it('senza corpo elenca i trigger della tabella ("Apri definizione" per il corpo)', () => {
    expect(sql).toContain('-- TRIGGER della tabella')
    expect(sql).toContain('--   TR_Ordini_Ins')
    expect(sql).not.toContain('TR_Altro')
  })

  it('regge i metadati mancanti (nessun vincolo, nessuna proprietà)', () => {
    const minimo = scriptCreateTable(mkTbl('dbo', 'Vuota', [mkCol('a', 'int')]))
    expect(minimo).toContain('CREATE TABLE [dbo].[Vuota](')
    expect(minimo).toContain('\t[a] [int] NOT NULL')
    expect(minimo).not.toContain('CONSTRAINT')
    expect(minimo).not.toContain('sp_addextendedproperty')
    // tabella vuota: nessuna colonna, ma lo script resta valido
    expect(scriptCreateTable(mkTbl('dbo', 'Vuota', []))).toContain('CREATE TABLE [dbo].[Vuota](')
  })
})
