import { describe, expect, it } from 'vitest'
import { buildInsertSql, buildMergeSql, buildUpdateSql, sqlLiteral } from '../sqlGen'
import type { GenColumn } from '../sqlGen'

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
