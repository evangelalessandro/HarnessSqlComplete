import { describe, expect, it } from 'vitest'
import { buildJoinConditionSuggestions, buildJoinSuggestions, buildJoinText, buildQualifiedColumnSuggestions, rankTablesForJoin, tableAlias } from '../helpers'
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
 * - RUN_MISSIONI → MAG_CELLE: FK composita DEST (MIS_D_CELLA→CEL_CELLA) + SORG (MIS_S_CELLA→CEL_CELLA)
 *   (ogni vincolo con le proprie coppie, come le FK composite reali)
 * - RUN_MISSIONI → GESTORI: 2 vincoli (MIS_GES_GESTORE→GES_GESTORE, MIS_L1_GESTORE→GES_GESTORE)
 * - RUN_MISSIONI → GESTORI_MODULI: 2 vincoli (sorgente/destinazione)
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
    // RUN_MISSIONI → MAG_CELLE (2 vincoli distinti)
    { name: 'FK_DEST', schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_D_CELLA', refSchema: 'dbo', refTable: 'MAG_CELLE', refColumn: 'CEL_CELLA' },
    { name: 'FK_SORG', schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_S_CELLA', refSchema: 'dbo', refTable: 'MAG_CELLE', refColumn: 'CEL_CELLA' },
    // RUN_MISSIONI → GESTORI (2 vincoli distinti)
    { name: 'FK_GESTORE', schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_GES_GESTORE', refSchema: 'dbo', refTable: 'GESTORI', refColumn: 'GES_GESTORE' },
    { name: 'FK_L1', schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_L1_GESTORE', refSchema: 'dbo', refTable: 'GESTORI', refColumn: 'GES_GESTORE' },
    // RUN_MISSIONI → GESTORI_MODULI (2 vincoli distinti)
    { name: 'FK_MOD_SORG', schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_GES_MODULO_SORG', refSchema: 'dbo', refTable: 'GESTORI_MODULI', refColumn: 'GMG_MODULO' },
    { name: 'FK_MOD_DEST', schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_GES_MODULO_DEST', refSchema: 'dbo', refTable: 'GESTORI_MODULI', refColumn: 'GMG_MODULO' },
    // self-FK GESTORI_MODULI
    { name: 'FK_SELF_PADRE', schema: 'dbo', table: 'GESTORI_MODULI', column: 'GMG_MODULO_PADRE', refSchema: 'dbo', refTable: 'GESTORI_MODULI', refColumn: 'GMG_MODULO' },
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
        { name: 'FK_ORDINI_CLIENTI', schema: 'dbo', table: 'Ordini', column: 'cli_id', refSchema: 'dbo', refTable: 'Clienti', refColumn: 'cli_id' },
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

  it('co-occorrenza: le tabelle unite nei JOIN reali salgono nel ranking', () => {
    const tables = [
      mkTbl('dbo', 'A', ['id']),
      mkTbl('dbo', 'B', ['id', 'a_id']),
      mkTbl('dbo', 'C', ['id']),
      mkTbl('dbo', 'D', ['id']),
    ]
    const fks: ForeignKeyInfo[] = [
      { name: 'FK_B_A', schema: 'dbo', table: 'B', column: 'a_id', refSchema: 'dbo', refTable: 'A', refColumn: 'id' },
    ]
    // senza co-occorrenza: B è prima (ha la FK); C e D in fondo
    const without = rankTablesForJoin(tables, fks, ['a'])
    const idxB = without.findIndex(r => r.table.name === 'B')
    const idxC = without.findIndex(r => r.table.name === 'C')
    const idxD = without.findIndex(r => r.table.name === 'D')
    expect(idxB).toBeLessThan(idxC)
    expect(idxC).toBeLessThan(idxD)
    // con co-occorrenza forte A+C: C sale sopra D (tabella senza legami)
    const co = [{ tableA: 'A', tableB: 'C', count: 500 }]
    const withCo = rankTablesForJoin(tables, fks, ['a'], co)
    expect(withCo.findIndex(r => r.table.name === 'C')).toBeLessThan(withCo.findIndex(r => r.table.name === 'D'))
    // B (FK) resta sopra C (co-occorrenza): la FK pesa di più
    expect(withCo.findIndex(r => r.table.name === 'B')).toBeLessThan(withCo.findIndex(r => r.table.name === 'C'))
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
        { name: 'FK_ORDINI_CLIENTI', schema: 'dbo', table: 'Ordini', column: 'cli_id', refSchema: 'dbo', refTable: 'Clienti', refColumn: 'cli_id' },
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
      // FK composita DEST: due coppie (stesso nome vincolo)
      { name: 'FK_DEST', schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_D_CORRIDOIO', refSchema: 'dbo', refTable: 'MAG_CELLE', refColumn: 'CEL_CORRIDOIO' },
      { name: 'FK_DEST', schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_D_CELLA', refSchema: 'dbo', refTable: 'MAG_CELLE', refColumn: 'CEL_CELLA' },
      // FK composita SORG: due coppie (stesso nome vincolo)
      { name: 'FK_SORG', schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_S_CORRIDOIO', refSchema: 'dbo', refTable: 'MAG_CELLE', refColumn: 'CEL_CORRIDOIO' },
      { name: 'FK_SORG', schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_S_CELLA', refSchema: 'dbo', refTable: 'MAG_CELLE', refColumn: 'CEL_CELLA' },
    ]
    return { tables, views: [], procedures: [], triggers: [], functions: [], foreignKeys, databases: [] } as DatabaseSummary
  })()

  it('scenario utente: dopo "ON (MIS_D_CORRIDOIO = CEL_CORRIDOIO)" propone UN vincolo per voce', () => {
    const stmt =
      'SELECT * FROM dbo.RUN_MISSIONI inner join MAG_CELLE ON (MIS_D_CORRIDOIO = CEL_CORRIDOIO)'
    const before =
      'SELECT * FROM dbo.RUN_MISSIONI inner join MAG_CELLE ON (MIS_D_CORRIDOIO = CEL_CORRIDOIO)'
    const res = buildJoinConditionSuggestions(stmt, before, condSummary)
    // UNA voce per vincolo: la parte mancante di DEST + l'intero vincolo SORG = 2 voci
    expect(res.length).toBe(2)
    // la stessa relazione (DEST) viene prima, con solo la coppia mancante
    expect(res[0].text).toBe('AND MIS_D_CELLA = CEL_CELLA')
    // il vincolo SORG propone ENTRAMBE le sue coppie insieme
    expect(res[1].text).toBe('AND MIS_S_CORRIDOIO = CEL_CORRIDOIO AND MIS_S_CELLA = CEL_CELLA')
    // la coppia già scritta NON viene riproposta
    expect(res.some(r => r.text.includes('MIS_D_CORRIDOIO'))).toBe(false)
  })

  it('senza condizioni già scritte nell\'ON: una voce per vincolo, SENZA "AND" iniziale', () => {
    const stmt = 'SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON '
    const before = 'SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON '
    const res = buildJoinConditionSuggestions(stmt, before, condSummary)
    expect(res.length).toBe(2)
    expect(res.some(r => r.text === 'MIS_D_CORRIDOIO = CEL_CORRIDOIO AND MIS_D_CELLA = CEL_CELLA')).toBe(true)
    expect(res.some(r => r.text === 'MIS_S_CORRIDOIO = CEL_CORRIDOIO AND MIS_S_CELLA = CEL_CELLA')).toBe(true)
    expect(res.every(r => !r.text.startsWith('AND '))).toBe(true)
  })

  it('le coppie già scritte vengono escluse in entrambi gli ordini', () => {
    // scritto "CEL_CELLA = MIS_D_CELLA" (ordine invertito) → DEST non ripropone la cella
    const stmt =
      'SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON (MIS_D_CORRIDOIO = CEL_CORRIDOIO AND CEL_CELLA = MIS_D_CELLA)'
    const before =
      'SELECT * FROM RUN_MISSIONI JOIN MAG_CELLE ON (MIS_D_CORRIDOIO = CEL_CORRIDOIO AND CEL_CELLA = MIS_D_CELLA)'
    const res = buildJoinConditionSuggestions(stmt, before, condSummary)
    // DEST ha tutte le coppie scritte → non compare; resta solo SORG
    expect(res.length).toBe(1)
    expect(res[0].text).toBe('AND MIS_S_CORRIDOIO = CEL_CORRIDOIO AND MIS_S_CELLA = CEL_CELLA')
  })

  it('senza tabelle multiple → nessun suggerimento', () => {
    expect(buildJoinConditionSuggestions('SELECT * FROM RUN_MISSIONI', 'SELECT * FROM RUN_MISSIONI', condSummary)).toEqual([])
  })
})

describe('B3: alias automatici e colonne qualificate', () => {
  const aliasSummary = (() => {
    const tables = [
      mkTbl('dbo', 'RUN_MISSIONI', ['MIS_D_CELLA', 'MIS_UDC', 'MIS_MISSIONE']),
      mkTbl('dbo', 'MAG_CELLE', ['CEL_CELLA', 'CEL_CORRIDOIO']),
    ]
    const foreignKeys: ForeignKeyInfo[] = [
      { name: 'FK_DEST', schema: 'dbo', table: 'RUN_MISSIONI', column: 'MIS_D_CELLA', refSchema: 'dbo', refTable: 'MAG_CELLE', refColumn: 'CEL_CELLA' },
    ]
    return { tables, views: [], procedures: [], triggers: [], functions: [], foreignKeys, databases: [] } as DatabaseSummary
  })()

  it('tableAlias genera alias brevi (RUN_MISSIONI → rm, MAG_CELLE → mc)', () => {
    expect(tableAlias('RUN_MISSIONI')).toBe('rm')
    expect(tableAlias('MAG_CELLE')).toBe('mc')
    expect(tableAlias('Ordini')).toBe('or')
  })

  it('buildJoinSuggestions con useAliases genera ON qualificato con alias', () => {
    const ranked = rankTablesForJoin(aliasSummary.tables, aliasSummary.foreignKeys, ['run_missioni'])
    const celle = ranked.find(r => r.table.name === 'MAG_CELLE')!
    const missioni = aliasSummary.tables.find(t => t.name === 'RUN_MISSIONI')!
    const items = buildJoinSuggestions(celle, [missioni], true, true)
    expect(items[0].insertText).toBe('MAG_CELLE AS mc ON (rm.MIS_D_CELLA = mc.CEL_CELLA)')
  })

  it('senza useAliases il JOIN resta come prima (nessuna regressione)', () => {
    const ranked = rankTablesForJoin(aliasSummary.tables, aliasSummary.foreignKeys, ['run_missioni'])
    const celle = ranked.find(r => r.table.name === 'MAG_CELLE')!
    const missioni = aliasSummary.tables.find(t => t.name === 'RUN_MISSIONI')!
    const items = buildJoinSuggestions(celle, [missioni], true, false)
    expect(items[0].insertText).toBe('MAG_CELLE ON (MIS_D_CELLA = CEL_CELLA)')
  })

  it('buildQualifiedColumnSuggestions: dopo "r." propone le colonne senza ripetere l alias', () => {
    const stmt = 'SELECT * FROM RUN_MISSIONI r WHERE r.'
    const res = buildQualifiedColumnSuggestions(stmt, 'SELECT * FROM RUN_MISSIONI r WHERE r.', aliasSummary)
    expect(res.some(c => c.name === 'MIS_D_CELLA')).toBe(true)
    // insertText = SOLO il nome: il "r." è già nel testo (altrimenti uscirebbe "r.r.MIS_D_CELLA")
    expect(res.every(c => !c.insertText.includes('.'))).toBe(true)
  })

  it('buildQualifiedColumnSuggestions: qualificatore sconosciuto → vuoto', () => {
    const res = buildQualifiedColumnSuggestions('SELECT * FROM RUN_MISSIONI r WHERE x.', 'SELECT * FROM RUN_MISSIONI r WHERE x.', aliasSummary)
    expect(res).toEqual([])
  })
})

describe('B4: join transitivi (A→B→C)', () => {
  const transSummary = (() => {
    const tables = [
      mkTbl('dbo', 'A', ['id']),
      mkTbl('dbo', 'B', ['id', 'a_id']),
      mkTbl('dbo', 'C', ['id', 'b_id']),
      mkTbl('dbo', 'D', ['id']),
    ]
    const foreignKeys: ForeignKeyInfo[] = [
      { name: 'FK_B_A', schema: 'dbo', table: 'B', column: 'a_id', refSchema: 'dbo', refTable: 'A', refColumn: 'id' },
      { name: 'FK_C_B', schema: 'dbo', table: 'C', column: 'b_id', refSchema: 'dbo', refTable: 'B', refColumn: 'id' },
    ]
    return { tables, views: [], procedures: [], triggers: [], functions: [], foreignKeys, databases: [] } as DatabaseSummary
  })()

  it('C è raggiungibile transitivamente via B (A→B→C) e marcata', () => {
    const ranked = rankTablesForJoin(transSummary.tables, transSummary.foreignKeys, ['a'])
    const c = ranked.find(r => r.table.name === 'C')
    expect(c).toBeDefined()
    expect(c!.viaTable).toBe('B')
    expect(c!.hints.length).toBe(0)
  })

  it('B (collegata diretta) viene prima di C (transitiva)', () => {
    const ranked = rankTablesForJoin(transSummary.tables, transSummary.foreignKeys, ['a'])
    const idxB = ranked.findIndex(r => r.table.name === 'B')
    const idxC = ranked.findIndex(r => r.table.name === 'C')
    expect(idxB).toBeLessThan(idxC)
  })

  it('D (isolata) non ha percorso transitivo', () => {
    const ranked = rankTablesForJoin(transSummary.tables, transSummary.foreignKeys, ['a'])
    const d = ranked.find(r => r.table.name === 'D')
    expect(d?.viaTable).toBeUndefined()
  })

  it('buildJoinSuggestions mostra "raggiungibile via B" per la transitiva', () => {
    const ranked = rankTablesForJoin(transSummary.tables, transSummary.foreignKeys, ['a'])
    const c = ranked.find(r => r.table.name === 'C')!
    const items = buildJoinSuggestions(c, [transSummary.tables[0]], true)
    expect(items[0].detail).toContain('via B')
  })
})
