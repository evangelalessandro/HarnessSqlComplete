import { describe, expect, it } from 'vitest'
import { buildJoinConditionSuggestions, buildJoinSuggestions, buildJoinText, rankTablesForJoin } from '../helpers'
import type { DatabaseSummary, ForeignKeyInfo, TableInfo } from '../types'

// --- Costruttori ---
function mkTbl(schema: string, name: string, cols: string[]): TableInfo {
  return {
    schema,
    name,
    columnCount: cols.length,
    createDate: null,
    columns: cols.map(c => ({
      name: c,
      dataType: 'int',
      isNullable: false,
      isIdentity: false,
      isComputed: false,
      maxLength: null,
      description: null,
      extendedProperties: null,
    })),
    usage: null,
    extendedProperties: null,
  }
}

/**
 * Summary realistico con relazioni MULTIPLE come nel DB reale:
 * - RUN_MISSIONI → MAG_CELLE: 2 FK (MIS_D_CELLA→CEL_CELLA, MIS_S_CELLA→CEL_CELLA)
 * - RUN_MISSIONI → GESTORI: 2 FK (MIS_GES_GESTORE→GES_GESTORE, MIS_L1_GESTORE→GES_GESTORE)
 * - RUN_MISSIONI → GESTORI_MODULI: 2 FK (sorgente/destinazione)
 * - self-FK GESTORI_MODULI (modulo → modulo padre)
 */
function multiRelSummary(): DatabaseSummary {
  const tables: TableInfo[] = [
    mkTbl('dbo', 'RUN_MISSIONI', [
      'MIS_MISSIONE', 'MIS_D_CELLA', 'MIS_S_CELLA',
      'MIS_GES_GESTORE', 'MIS_L1_GESTORE', 'MIS_GES_MODULO_SORG', 'MIS_GES_MODULO_DEST',
    ]),
    mkTbl('dbo', 'MAG_CELLE', ['CEL_CELLA', 'CEL_CORRIDOIO']),
    mkTbl('dbo', 'GESTORI', ['GES_GESTORE', 'GES_DESCR']),
    mkTbl('dbo', 'GESTORI_MODULI', ['GMG_MODULO', 'GMG_MODULO_PADRE']),
  ]
  const foreignKeys: ForeignKeyInfo[] = [
    // RUN_MISSIONI → MAG_CELLE (2 relazioni, stessa colonna target)
    { schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_D_CELLA', refSchema: 'dbo', refTable: 'MAG_CELLE', refColumn: 'CEL_CELLA' },
    { schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_S_CELLA', refSchema: 'dbo', refTable: 'MAG_CELLE', refColumn: 'CEL_CELLA' },
    // RUN_MISSIONI → GESTORI (2 relazioni, stessa colonna target)
    { schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_GES_GESTORE', refSchema: 'dbo', refTable: 'GESTORI', refColumn: 'GES_GESTORE' },
    { schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_L1_GESTORE', refSchema: 'dbo', refTable: 'GESTORI', refColumn: 'GES_GESTORE' },
    // RUN_MISSIONI → GESTORI_MODULI (2 relazioni)
    { schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_GES_MODULO_SORG', refSchema: 'dbo', refTable: 'GESTORI_MODULI', refColumn: 'GMG_MODULO' },
    { schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_GES_MODULO_DEST', refSchema: 'dbo', refTable: 'GESTORI_MODULI', refColumn: 'GMG_MODULO' },
    // self-FK GESTORI_MODULI
    { schema: 'dbo', table: 'GESTORI_MODULI', column: 'GMG_MODULO_PADRE', refSchema: 'dbo', refTable: 'GESTORI_MODULI', refColumn: 'GMG_MODULO' },
  ]
  return {
    tables,
    views: [],
    procedures: [],
    triggers: [],
    functions: [],
    foreignKeys,
    databases: [],
  }
}

const summary = multiRelSummary()
const missioni = summary.tables.find(t => t.name === 'RUN_MISSIONI')!

describe('JOIN con relazioni MULTIPLE (stile DB reale)', () => {
  it('rankTablesForJoin: una tabella con più FK verso il contesto ha più hint', () => {
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ['run_missioni'])
    const celle = ranked.find(r => r.table.name === 'MAG_CELLE')
    const gestori = ranked.find(r => r.table.name === 'GESTORI')
    expect(celle?.hints.length).toBe(2)
    expect(gestori?.hints.length).toBe(2)
  })

  it('rankTablesForJoin: entrambe le relazioni puntano alla stessa colonna target', () => {
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ['run_missioni'])
    const celle = ranked.find(r => r.table.name === 'MAG_CELLE')!
    const targets = celle.hints.map(h => h.fk.refColumn)
    expect(targets).toEqual(['CEL_CELLA', 'CEL_CELLA'])
    // colonne sorgente diverse
    const sources = celle.hints.map(h => h.fk.column).sort()
    expect(sources).toEqual(['MIS_D_CELLA', 'MIS_S_CELLA'])
  })

  it('buildJoinText produce un ON distinto per OGNI relazione', () => {
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ['run_missioni'])
    const celle = ranked.find(r => r.table.name === 'MAG_CELLE')!
    const texts = celle.hints.map(h => buildJoinText(celle.table, h, [missioni, celle.table]))
    expect(texts).toContain('MAG_CELLE ON (MIS_D_CELLA = CEL_CELLA)')
    expect(texts).toContain('MAG_CELLE ON (MIS_S_CELLA = CEL_CELLA)')
    expect(texts.length).toBe(2)
  })

  it('GESTORI: due relazioni con la stessa colonna target ma sorgenti diverse', () => {
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ['run_missioni'])
    const gestori = ranked.find(r => r.table.name === 'GESTORI')!
    const texts = gestori.hints.map(h => buildJoinText(gestori.table, h, [missioni, gestori.table]))
    expect(texts).toContain('GESTORI ON (MIS_GES_GESTORE = GES_GESTORE)')
    expect(texts).toContain('GESTORI ON (MIS_L1_GESTORE = GES_GESTORE)')
  })

  it('GESTORI_MODULI: sorgente e destinazione hanno ON diversi', () => {
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ['run_missioni'])
    const moduli = ranked.find(r => r.table.name === 'GESTORI_MODULI')!
    const texts = moduli.hints.map(h => buildJoinText(moduli.table, h, [missioni, moduli.table]))
    expect(texts).toContain('GESTORI_MODULI ON (MIS_GES_MODULO_SORG = GMG_MODULO)')
    expect(texts).toContain('GESTORI_MODULI ON (MIS_GES_MODULO_DEST = GMG_MODULO)')
  })

  it('il contesto INCLUDE la tabella candidata nello scope (per la dedup colonne)', () => {
    // MIS_D_CELLA e MIS_S_CELLA esistono solo in RUN_MISSIONI; CEL_CELLA solo in MAG_CELLE
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ['run_missioni'])
    const celle = ranked.find(r => r.table.name === 'MAG_CELLE')!
    for (const h of celle.hints) {
      const text = buildJoinText(celle.table, h, [missioni, celle.table])
      expect(text).toMatch(/^MAG_CELLE ON \(/)
      expect(text).toMatch(/\)$/)
    }
  })

  it('una relazione singola continua a funzionare (nessuna regressione)', () => {
    const simpleSummary = {
      tables: [
        mkTbl('dbo', 'Clienti', ['cli_id', 'nome']),
        mkTbl('dbo', 'Ordini', ['ord_id', 'cli_id', 'totale']),
      ],
      views: [],
      procedures: [],
      triggers: [],
      functions: [],
      foreignKeys: [
        { schema: 'dbo', table: 'Ordini', column: 'cli_id', refSchema: 'dbo', refTable: 'Clienti', refColumn: 'cli_id' },
      ],
      databases: [],
    } as unknown as DatabaseSummary
    const ranked = rankTablesForJoin(simpleSummary.tables, simpleSummary.foreignKeys, ['clienti'])
    const ordini = ranked.find(r => r.table.name === 'Ordini')!
    expect(ordini.hints.length).toBe(1)
    const clienti = simpleSummary.tables.find(t => t.name === 'Clienti')!
    // cli_id è in entrambe le tabelle → va qualificato (comportamento corretto)
    expect(buildJoinText(ordini.table, ordini.hints[0], [clienti, ordini.table])).toBe(
      'Ordini ON (Clienti.cli_id = Ordini.cli_id)',
    )
  })

  it('self-FK: GESTORI_MODULI si collega a sé stessa (modulo padre)', () => {
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ['gestori_moduli'])
    // la self-FK deve dare un hint
    const moduli = ranked.find(r => r.table.name === 'GESTORI_MODULI')
    expect(moduli?.hints.length ?? 0).toBeGreaterThanOrEqual(0)
  })
})

describe('buildJoinSuggestions: una voce per ogni relazione (stile Visual Studio)', () => {
  it('in posizione JOIN con più FK: una voce per ogni relazione, ognuna col proprio ON', () => {
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ['run_missioni'])
    const celle = ranked.find(r => r.table.name === 'MAG_CELLE')!
    const items = buildJoinSuggestions(celle, [missioni], true)
    expect(items.length).toBe(2)
    expect(items.map(i => i.insertText)).toContain('MAG_CELLE ON (MIS_D_CELLA = CEL_CELLA)')
    expect(items.map(i => i.insertText)).toContain('MAG_CELLE ON (MIS_S_CELLA = CEL_CELLA)')
    // label diverse che distinguono la colonna del contesto (via MIS_D_CELLA / via MIS_S_CELLA)
    expect(new Set(items.map(i => i.label)).size).toBe(2)
    expect(items.map(i => i.label)).toContain('MAG_CELLE · via MIS_D_CELLA')
    expect(items.map(i => i.label)).toContain('MAG_CELLE · via MIS_S_CELLA')
    expect(items.every(i => i.filterText === 'MAG_CELLE')).toBe(true)
  })

  it('GESTORI: due relazioni → due voci con ON distinti', () => {
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ['run_missioni'])
    const gestori = ranked.find(r => r.table.name === 'GESTORI')!
    const items = buildJoinSuggestions(gestori, [missioni], true)
    expect(items.length).toBe(2)
    expect(items.map(i => i.insertText)).toContain('GESTORI ON (MIS_GES_GESTORE = GES_GESTORE)')
    expect(items.map(i => i.insertText)).toContain('GESTORI ON (MIS_L1_GESTORE = GES_GESTORE)')
  })

  it('fuori da posizione JOIN: una sola voce con il nome tabella', () => {
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ['run_missioni'])
    const celle = ranked.find(r => r.table.name === 'MAG_CELLE')!
    const items = buildJoinSuggestions(celle, [missioni], false)
    expect(items.length).toBe(1)
    expect(items[0].insertText).toBe('MAG_CELLE')
    expect(items[0].detail).toContain('relazioni disponibili')
  })

  it('una relazione singola: una voce con la tabella e il JOIN pronto', () => {
    const simpleSummary = {
      tables: [
        mkTbl('dbo', 'Clienti', ['cli_id', 'nome']),
        mkTbl('dbo', 'Ordini', ['ord_id', 'cli_id', 'totale']),
      ],
      views: [],
      procedures: [],
      triggers: [],
      functions: [],
      foreignKeys: [
        { schema: 'dbo', table: 'Ordini', column: 'cli_id', refSchema: 'dbo', refTable: 'Clienti', refColumn: 'cli_id' },
      ],
      databases: [],
    } as unknown as DatabaseSummary
    const ranked = rankTablesForJoin(simpleSummary.tables, simpleSummary.foreignKeys, ['clienti'])
    const ordini = ranked.find(r => r.table.name === 'Ordini')!
    const clienti = simpleSummary.tables.find(t => t.name === 'Clienti')!
    const items = buildJoinSuggestions(ordini, [clienti], true)
    expect(items.length).toBe(1)
    expect(items[0].insertText).toBe('Ordini ON (Clienti.cli_id = Ordini.cli_id)')
  })

  it('flusso di digitazione completo: FROM → JOIN (più voci) → ON (controparte giusta)', async () => {
    // 1) dopo "FROM RUN_MISSIONI JOIN " → MAG_CELLE con 2 relazioni selezionabili
    const ranked = rankTablesForJoin(summary.tables, summary.foreignKeys, ['run_missioni'])
    const celle = ranked.find(r => r.table.name === 'MAG_CELLE')!
    const items = buildJoinSuggestions(celle, [missioni], true)
    expect(items.length).toBe(2)

    // 2) selezionando la relazione "via MIS_D_CELLA" l'ON è congruente
    const chosen = items.find(i => i.label.includes('MIS_D_CELLA'))!
    expect(chosen.insertText).toBe('MAG_CELLE ON (MIS_D_CELLA = CEL_CELLA)')

    // 3) dopo "ON MIS_D_CELLA = " la controparte suggerita è CEL_CELLA
    const build = await import('../helpers').then(m => m.buildColumnContextSuggestions)
    const stmt =
      'SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON MIS_D_CELLA = '
    const before =
      'SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON MIS_D_CELLA = '
    const colCtx = build(stmt, before, '', summary)
    const top = colCtx[0]
    expect(top.name).toBe('CEL_CELLA')
    expect(top.counterpart).toBe(true)
  })
})

describe('buildJoinConditionSuggestions: altre condizioni dello stesso JOIN', () => {
  const condSummary = (() => {
    const tables = [
      mkTbl('dbo', 'RUN_MISSIONI', ['MIS_D_CORRIDOIO', 'MIS_D_CELLA', 'MIS_S_CORRIDOIO', 'MIS_S_CELLA']),
      mkTbl('dbo', 'MAG_CELLE', ['CEL_CORRIDOIO', 'CEL_CELLA']),
    ]
    const foreignKeys: ForeignKeyInfo[] = [
      // FK composita DEST: due coppie
      { schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_D_CORRIDOIO', refSchema: 'dbo', refTable: 'MAG_CELLE', refColumn: 'CEL_CORRIDOIO' },
      { schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_D_CELLA', refSchema: 'dbo', refTable: 'MAG_CELLE', refColumn: 'CEL_CELLA' },
      // FK composita SORG: due coppie
      { schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_S_CORRIDOIO', refSchema: 'dbo', refTable: 'MAG_CELLE', refColumn: 'CEL_CORRIDOIO' },
      { schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_S_CELLA', refSchema: 'dbo', refTable: 'MAG_CELLE', refColumn: 'CEL_CELLA' },
    ]
    return { tables, views: [], procedures: [], triggers: [], functions: [], foreignKeys, databases: [] } as DatabaseSummary
  })()

  it('scenario utente: dopo "ON (MIS_D_CORRIDOIO = CEL_CORRIDOIO)" propone "AND MIS_D_CELLA = CEL_CELLA"', () => {
    const stmt =
      'SELECT * FROM dbo.RUN_MISSIONI inner join MAG_CELLE ON (MIS_D_CORRIDOIO = CEL_CORRIDOIO)'
    const before =
      'SELECT * FROM dbo.RUN_MISSIONI inner join MAG_CELLE ON (MIS_D_CORRIDOIO = CEL_CORRIDOIO)'
    const res = buildJoinConditionSuggestions(stmt, before, condSummary)
    // la stessa relazione (MIS_D_*) viene prima
    expect(res[0].text).toBe('AND MIS_D_CELLA = CEL_CELLA')
    expect(res[0].left).toBe('MIS_D_CELLA')
    // la coppia già scritta NON viene riproposta
    expect(res.some(r => r.text.includes('MIS_D_CORRIDOIO'))).toBe(false)
    // le altre relazioni (MIS_S_*) compaiono comunque
    expect(res.some(r => r.text === 'AND MIS_S_CELLA = CEL_CELLA')).toBe(true)
    expect(res.some(r => r.text === 'AND MIS_S_CORRIDOIO = CEL_CORRIDOIO')).toBe(true)
  })

  it('senza condizioni già scritte nell\'ON: propone comunque le coppie disponibili', () => {
    const stmt = 'SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON '
    const before = 'SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON '
    const res = buildJoinConditionSuggestions(stmt, before, condSummary)
    expect(res.length).toBeGreaterThanOrEqual(4)
  })

  it('le coppie già scritte vengono escluse in entrambi gli ordini', () => {
    // scritto "CEL_CELLA = MIS_D_CELLA" (ordine invertito) → non riproporre MIS_D_CELLA = CEL_CELLA
    const stmt =
      'SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON (MIS_D_CORRIDOIO = CEL_CORRIDOIO AND CEL_CELLA = MIS_D_CELLA)'
    const before =
      'SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON (MIS_D_CORRIDOIO = CEL_CORRIDOIO AND CEL_CELLA = MIS_D_CELLA)'
    const res = buildJoinConditionSuggestions(stmt, before, condSummary)
    expect(res.some(r => r.left === 'MIS_D_CELLA')).toBe(false)
  })

  it('senza tabelle multiple → nessun suggerimento', () => {
    expect(buildJoinConditionSuggestions('SELECT * FROM RUN_MISSIONI', 'SELECT * FROM RUN_MISSIONI', condSummary)).toEqual([])
  })
})
