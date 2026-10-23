import { describe, expect, it } from 'vitest'
import { buildDeleteSql, buildInsertIntoTempSql, buildInsertSql, buildMergeSql, buildUpdateSql, chiaveTabella, chiaviDellaTabella, parseTargetTable, sqlLiteral, trovaTabella } from '../sqlGen'
import type { GenColumn } from '../sqlGen'
import { mkCol, mkTbl } from './schema'

describe('parseTargetTable: "schema.tabella" → coppia', () => {
  it('con schema e senza schema (default dbo)', () => {
    expect(parseTargetTable('dbo.Clienti')).toEqual({ schema: 'dbo', table: 'Clienti' })
    expect(parseTargetTable('Clienti')).toEqual({ schema: 'dbo', table: 'Clienti' })
    expect(parseTargetTable('  MAG.CORRIDOI ')).toEqual({ schema: 'MAG', table: 'CORRIDOI' })
    expect(parseTargetTable('')).toEqual({ schema: 'dbo', table: '' })
  })
})

const cols: GenColumn[] = [
  { name: 'id', dataType: 'int', isIdentity: true },
  { name: 'nome', dataType: 'nvarchar' },
  { name: 'attivo', dataType: 'bit' },
  { name: 'data_ins', dataType: 'datetime' },
]

describe('sqlLiteral: valori → literal SQL', () => {
  it('NULL, numeri, booleani e stringhe', () => {
    expect(sqlLiteral(null)).toBe('NULL')
    expect(sqlLiteral(undefined)).toBe('NULL')
    expect(sqlLiteral(42)).toBe('42')
    expect(sqlLiteral(12.5)).toBe('12.5')
    expect(sqlLiteral(true)).toBe('1')
    expect(sqlLiteral(false)).toBe('0')
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'")
    expect(sqlLiteral('2024-01-15T10:00:00.000')).toBe("'2024-01-15T10:00:00.000'")
    expect(sqlLiteral(Number.NaN)).toBe('NULL')
  })
})

describe('buildInsertSql', () => {
  it('INSERT con più righe e colonne selezionate', () => {
    const sql = buildInsertSql('dbo', 'Clienti', [cols[0], cols[1]], [
      [1, 'Mario'],
      [2, 'Anna'],
    ])
    expect(sql).toBe(
      "INSERT INTO Clienti\n  ([id], [nome])\nVALUES\n  (1, 'Mario'),\n  (2, 'Anna');",
    )
  })

  it('senza righe selezionate lancia errore', () => {
    expect(() => buildInsertSql('dbo', 'Clienti', cols, [])).toThrow(/Nessuna riga/)
  })
})

describe('buildUpdateSql', () => {
  it('SET sulle colonne selezionate, WHERE sulle NON selezionate', () => {
    const sql = buildUpdateSql('dbo', 'Clienti', cols, [1, 3], [7, 'Mario', 1, '2024-01-15T10:00:00.000'])
    expect(sql).toContain('UPDATE Clienti')
    expect(sql).toContain('[nome] = \'Mario\'')
    expect(sql).toContain('[data_ins] = \'2024-01-15T10:00:00.000\'')
    // WHERE: id e attivo (non nel SET)
    expect(sql).toContain('[id] = 7')
    expect(sql).toContain('[attivo] = 1')
    expect(sql).toContain('WHERE')
  })

  it('con tutte le colonne selezionate il WHERE usa tutte (no-op segnalato)', () => {
    const sql = buildUpdateSql('dbo', 'Clienti', cols, [0, 1, 2, 3], [7, 'Mario', 1, '2024-01-15T10:00:00.000'])
    expect(sql).toContain('[id] = 7')
    expect(sql).toContain('[nome] = \'Mario\'')
  })
})

describe('buildMergeSql', () => {
  it('MERGE con chiave = colonna identity, matched/not matched', () => {
    const sql = buildMergeSql('dbo', 'Clienti', cols, [[1, 'Mario', 1, '2024-01-15T10:00:00.000']])
    expect(sql).toContain('MERGE INTO Clienti AS tgt')
    expect(sql).toContain('USING (VALUES\n    (1, \'Mario\', 1, \'2024-01-15T10:00:00.000\')) AS src ([id], [nome], [attivo], [data_ins])')
    expect(sql).toContain('ON tgt.[id] = src.[id]')
    expect(sql).toContain('WHEN MATCHED THEN UPDATE SET')
    expect(sql).toContain('WHEN NOT MATCHED THEN INSERT ([id], [nome], [attivo], [data_ins])')
    expect(sql).toContain('VALUES (src.[id], src.[nome], src.[attivo], src.[data_ins]);')
  })

  it('senza identity la chiave dell\'ON è la prima colonna', () => {
    const noKey = cols.map(c => ({ ...c, isIdentity: false }))
    const sql = buildMergeSql('dbo', 'Clienti', noKey, [[1, 'Mario', 1, '2024-01-15T10:00:00.000']])
    expect(sql).toContain('ON tgt.[id] = src.[id]')
  })

  it('keyColumns esplicite hanno la precedenza', () => {
    const sql = buildMergeSql('dbo', 'Clienti', cols, [[1, 'Mario', 1, '2024-01-15T10:00:00.000']], ['nome'])
    expect(sql).toContain('ON tgt.[nome] = src.[nome]')
  })
})

// Richiesta utente: "quando fai la merge, non mettere mai nell'update anche i campi chiave
// della tabella". I campi chiave restano solo nella condizione ON.
describe('buildMergeSql: i campi CHIAVE non entrano MAI nell\'UPDATE', () => {
  const riga: [number, string, number, string] = [1, 'Mario', 1, '2024-01-15T10:00:00.000']

  /** Solo la parte fra "UPDATE SET" e la clausola successiva. */
  const parteUpdate = (sql: string): string => {
    const inizio = sql.indexOf('UPDATE SET')
    if (inizio === -1) return ''
    const fine = sql.indexOf('WHEN NOT MATCHED', inizio)
    return sql.slice(inizio, fine === -1 ? undefined : fine)
  }

  it('con la chiave identity: la chiave NON è nel SET, gli altri campi sì', () => {
    const sql = buildMergeSql('dbo', 'Clienti', cols, [riga])
    const update = parteUpdate(sql)
    expect(update).not.toContain('[id]')
    expect(update).toContain('tgt.[nome] = src.[nome]')
    expect(update).toContain('tgt.[attivo] = src.[attivo]')
    expect(update).toContain('tgt.[data_ins] = src.[data_ins]')
    // la chiave resta nella condizione ON e nell'INSERT
    expect(sql).toContain('ON tgt.[id] = src.[id]')
    expect(sql).toContain('WHEN NOT MATCHED THEN INSERT ([id], [nome], [attivo], [data_ins])')
  })

  it('con chiave composita (più campi): nessuno dei due entra nel SET', () => {
    const sql = buildMergeSql('dbo', 'Clienti', cols, [riga], ['id', 'nome'])
    expect(sql).toContain('ON tgt.[id] = src.[id] AND\n    tgt.[nome] = src.[nome]')
    const update = parteUpdate(sql)
    expect(update).not.toContain('[id]')
    expect(update).not.toContain('[nome]')
    expect(update).toContain('tgt.[attivo] = src.[attivo]')
  })

  it('la chiave si riconosce anche con maiuscole/minuscole diverse', () => {
    const sql = buildMergeSql('dbo', 'Clienti', cols, [riga], ['ID'])
    expect(sql).toContain('ON tgt.[ID] = src.[ID]')
    expect(parteUpdate(sql)).not.toContain('tgt.[id] = src.[id]')
  })

  it('se la chiave copre TUTTE le colonne non si scrive la clausola UPDATE', () => {
    const sql = buildMergeSql('dbo', 'Clienti', cols, [riga], ['id', 'nome', 'attivo', 'data_ins'])
    expect(sql).not.toContain('WHEN MATCHED THEN UPDATE')
    expect(sql).toContain('-- chiave = tutte le colonne: nulla da aggiornare, si inserisce soltanto')
    // il resto della MERGE resta valido
    expect(sql).toContain('WHEN NOT MATCHED THEN INSERT ([id], [nome], [attivo], [data_ins])')
    expect(sql.trimEnd().endsWith('VALUES (src.[id], src.[nome], src.[attivo], src.[data_ins]);')).toBe(true)
  })

  it('senza chiave nota (nessuna identity) l\'ON usa la prima colonna, che non entra nel SET', () => {
    const senzaIdentity = cols.map(c => ({ ...c, isIdentity: false }))
    const sql = buildMergeSql('dbo', 'Clienti', senzaIdentity, [riga])
    expect(sql).toContain('ON tgt.[id] = src.[id]')
    expect(parteUpdate(sql)).not.toContain('[id]')
  })
})

describe('chiaveTabella: primary key, altrimenti identity', () => {
  it('usa le colonne della primary key (anche composita, nell\'ordine dato)', () => {
    expect(chiaveTabella(cols, ['nome', 'id'])).toEqual(['nome', 'id'])
  })

  it('senza primary key usa le identity', () => {
    expect(chiaveTabella(cols)).toEqual(['id'])
    expect(chiaveTabella(cols, [])).toEqual(['id'])
  })

  it('ignora chiavi che non sono fra le colonne e non è sensibile alle maiuscole', () => {
    expect(chiaveTabella(cols, ['NOME', 'inesistente'])).toEqual(['NOME'])
    expect(chiaveTabella([{ name: 'a' }, { name: 'b' }], ['a'])).toEqual(['a'])
    expect(chiaveTabella([{ name: 'a' }, { name: 'b' }])).toEqual([])
  })
})

// Richiesta utente: "quando fai la merge, la chiave potrebbe essere multipla" — la chiave della
// MERGE (condizione ON) si ricava dalla tabella target dello schema e sono TUTTE le colonne della
// primary key composita, non solo la prima.
describe('chiaviDellaTabella: chiave composita dal nome della tabella target', () => {
  const tabella = mkTbl('dbo', 'L1_AZIONI_PERCORSI', [mkCol('AZP_AZIONE', 'int'), mkCol('AZP_PERCORSO', 'int'), mkCol('AZP_NOTE', 'nvarchar')], {
    indexes: [
      {
        name: 'PK_L1_AZIONI_PERCORSI',
        isPrimaryKey: true,
        isUnique: true,
        columns: ['AZP_AZIONE', 'AZP_PERCORSO'],
      },
    ],
  })
  const conIdentity = mkTbl('dbo', 'Clienti', [mkCol('id', 'int', { isIdentity: true }), mkCol('nome', 'nvarchar')])
  const summary = { tables: [tabella, conIdentity], views: [], procedures: [], triggers: [], functions: [], foreignKeys: [], databases: [] }

  it('trova la tabella con o senza schema e con le parentesi quadre', () => {
    expect(trovaTabella(summary, 'L1_AZIONI_PERCORSI')?.name).toBe('L1_AZIONI_PERCORSI')
    expect(trovaTabella(summary, 'dbo.L1_AZIONI_PERCORSI')?.name).toBe('L1_AZIONI_PERCORSI')
    expect(trovaTabella(summary, '[dbo].[L1_AZIONI_PERCORSI]')?.name).toBe('L1_AZIONI_PERCORSI')
    expect(trovaTabella(summary, 'INESISTENTE')).toBeNull()
    expect(trovaTabella(null, 'Clienti')).toBeNull()
  })

  it('restituisce TUTTE le colonne della primary key composita', () => {
    expect(chiaviDellaTabella(summary, 'dbo.L1_AZIONI_PERCORSI').keyColumns).toEqual(['AZP_AZIONE', 'AZP_PERCORSO'])
  })

  it('dove non c\'è la primary key restituisce le identity (e le chiavi vuote)', () => {
    expect(chiaviDellaTabella(summary, 'Clienti')).toEqual({ keyColumns: [], identityColumns: ['id'] })
    expect(chiaviDellaTabella(summary, 'Sconosciuta')).toEqual({ keyColumns: [], identityColumns: [] })
  })

  it('la MERGE generata usa la chiave composita nella ON e non la mette nell\'UPDATE SET', () => {
    const sql = buildMergeSql(
      'dbo',
      'L1_AZIONI_PERCORSI',
      [
        { name: 'AZP_AZIONE' },
        { name: 'AZP_PERCORSO' },
        { name: 'AZP_NOTE' },
      ],
      [[1, 2, 'x']],
      chiaviDellaTabella(summary, 'dbo.L1_AZIONI_PERCORSI').keyColumns,
    )
    // la condizione ON porta ENTRAMBE le colonne della chiave (una per riga)
    expect(sql).toContain('ON tgt.[AZP_AZIONE] = src.[AZP_AZIONE] AND')
    expect(sql).toContain('tgt.[AZP_PERCORSO] = src.[AZP_PERCORSO]')
    const set = sql.split('UPDATE SET')[1].split('WHEN NOT MATCHED')[0]
    expect(set).not.toContain('AZP_AZIONE')
    expect(set).not.toContain('AZP_PERCORSO')
    expect(set).toContain('AZP_NOTE')
  })
})

describe('buildDeleteSql', () => {
  it('WHERE sulla chiave identity', () => {
    const sql = buildDeleteSql('dbo', 'Clienti', cols, ['id'], [7, 'Mario', 1, '2024-01-15T10:00:00.000'])
    expect(sql).toBe('DELETE FROM Clienti\nWHERE\n  [id] = 7;')
  })

  it('senza chiave esplicita usa l\'identity (o la prima colonna)', () => {
    const sql = buildDeleteSql('dbo', 'Clienti', cols, undefined, [7, 'Mario', 1, '2024-01-15T10:00:00.000'])
    expect(sql).toContain('[id] = 7')
    const noIdentity = buildDeleteSql('dbo', 'Clienti', cols.map(c => ({ ...c, isIdentity: false })), undefined, [7, 'Mario', 1, '2024-01-15T10:00:00.000'])
    expect(noIdentity).toContain('[id] = 7')
  })
})

describe('buildInsertIntoTempSql', () => {
  it('SELECT … INTO #tmp FROM (VALUES …) con alias colonne', () => {
    const sql = buildInsertIntoTempSql('#tmpClienti', [cols[0], cols[1]], [
      [1, 'Mario'],
      [2, 'Anna'],
    ])
    expect(sql).toBe(
      "SELECT *\nINTO [#tmpClienti]\nFROM (VALUES\n    (1, 'Mario'),\n    (2, 'Anna')) AS v ([id], [nome])\n;",
    )
  })

  it('senza righe lancia errore', () => {
    expect(() => buildInsertIntoTempSql('#tmp', cols, [])).toThrow(/Nessuna riga/)
  })
})
