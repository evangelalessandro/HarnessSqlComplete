import { describe, expect, it } from 'vitest'
import { columnInfoMarkdown, resolveTokenAt, rowsToMarkdown } from '../helpers'
import { demoStoreLikeSummary } from './schema'

const summary = demoStoreLikeSummary()

describe('resolveTokenAt: hover sui campi della query', () => {
  it('colonna qualificata con alias → tabella + colonna con proprietà estese', () => {
    const sql = 'SELECT r.MIS_UDC FROM dbo.RUN_MISSIONI r'
    const resolved = resolveTokenAt(sql, sql.indexOf('MIS_UDC') + 2, summary)
    expect(resolved?.kind).toBe('column')
    expect(resolved?.table.name).toBe('RUN_MISSIONI')
    expect(resolved?.column?.name).toBe('MIS_UDC')
    expect(resolved?.column?.description).toBe('Codice UDC di destinazione')
    expect(resolved?.column?.extendedProperties?.length).toBe(2)
  })

  it('nome tabella → kind table con proprietà estese della tabella', () => {
    const sql = 'SELECT * FROM dbo.DAT_UDC'
    const resolved = resolveTokenAt(sql, sql.indexOf('DAT_UDC') + 2, summary)
    expect(resolved?.kind).toBe('table')
    expect(resolved?.table.extendedProperties?.[0].name).toBe('MS_Description')
  })

  it('colonna univoca non qualificata → tabella proprietaria', () => {
    const sql = 'SELECT UDC_UDCPRED FROM dbo.DAT_UDC'
    const resolved = resolveTokenAt(sql, sql.indexOf('UDC_UDCPRED') + 2, summary)
    expect(resolved?.kind).toBe('column')
    expect(resolved?.table.name).toBe('DAT_UDC')
  })

  it('colonna ambigua (id in Ordini e Clienti) → colonna con più proprietari', () => {
    const sql = 'SELECT id FROM dbo.Ordini o JOIN dbo.Clienti c ON o.customer_id = c.id'
    const resolved = resolveTokenAt(sql, sql.indexOf('SELECT id') + 7, summary)
    expect(resolved?.kind).toBe('column')
    expect(resolved?.owners.length).toBeGreaterThan(1)
  })

  it('parola chiave → null', () => {
    const sql = 'SELECT * FROM dbo.DAT_UDC'
    expect(resolveTokenAt(sql, sql.indexOf('SELECT') + 1, summary)).toBeNull()
  })
})

describe('columnInfoMarkdown: documentazione a sezioni (tooltip/autocompletamento)', () => {
  it('include tipo, tabella, descrizione e proprietà estese della colonna', () => {
    const table = summary.tables.find(t => t.name === 'RUN_MISSIONI')!
    const col = table.columns!.find(c => c.name === 'MIS_UDC')!
    const md = columnInfoMarkdown(table, col)
    expect(md).toContain('📄')
    expect(md).toContain('**📄 MIS_UDC**')
    expect(md).toContain('nvarchar')
    expect(md).toContain('| **Tabella** | `dbo.RUN_MISSIONI` |')
    expect(md).toContain('Codice UDC di destinazione')
    expect(md).toContain('**Proprietà estese:**')
    expect(md).toContain('BusinessKey')
    expect(md).toContain('UDC')
  })

  it('variante tabella: conteggio colonne, utilizzo e descrizione separata', () => {
    const table = summary.tables.find(t => t.name === 'DAT_UDC')!
    const md = columnInfoMarkdown(table, null)
    expect(md).toContain('🗄️')
    expect(md).toContain('dbo.DAT_UDC')
    expect(md).toContain('5 colonne')
    // la descrizione (MS_Description) ha una sezione dedicata, non è duplicata nelle proprietà
    expect(md).toContain('**Descrizione:** Tabella degli UDC')
    expect(md).not.toContain('- **MS_Description:**')
  })
})

describe('rowsToMarkdown: anteprima dati curata nell hover', () => {
  it('genera una tabella markdown con header in grassetto, separatore e righe', () => {
    const md = rowsToMarkdown(['id', 'nome'], [[1, 'Mario'], [2, 'Anna']])
    expect(md).toContain('| **id** | **nome** |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| 1 | Mario |')
    expect(md).toContain('| 2 | Anna |')
  })

  it('sfugge pipe e newline nei valori e limita le righe', () => {
    const rows = Array.from({ length: 15 }, (_, i) => [i, `a|b\nc`])
    const md = rowsToMarkdown(['n', 'v'], rows, 10)
    expect(md).toContain('a\\|b c')
    expect(md).toContain('_… altre 5 righe (prime 10)_')
    expect((md.match(/\| \d+ \|/g) ?? []).length).toBe(10)
  })

  it('NULL in corsivo e booleani resi leggibili', () => {
    const md = rowsToMarkdown(['a', 'b'], [[null, true]])
    expect(md).toContain('| *NULL* | true |')
  })

  it('valori lunghi troncati con … e backtick sfuggiti', () => {
    const lungo = 'x'.repeat(60)
    const md = rowsToMarkdown(['v'], [[`parola \`con\` ${lungo}`]])
    expect(md).toContain('\\`')
    expect(md).toContain('…')
    expect(md).not.toContain('x'.repeat(28))
  })

  it('colonne in eccesso nascoste con nota (anteprima leggibile)', () => {
    const cols = Array.from({ length: 15 }, (_, i) => `col_${i}`)
    const row = cols.map((_, i) => i)
    const md = rowsToMarkdown(cols, [row])
    expect(md).toContain('| **col_0** |')
    expect(md).not.toContain('col_14')
    expect(md).toContain('_… e altre 5 colonne_')
  })
})
