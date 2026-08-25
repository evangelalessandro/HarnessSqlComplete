import { describe, expect, it } from 'vitest'
import {
  buildFormatProfile,
  flattenFormatOptions,
  formatProfileApi,
  parseFormatProfileXml,
  serializeFormatProfile,
  setFormatOption,
} from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'
import { formatSqlWithProfile, tokenizeSqlText } from '../tsqlFormatter'

describe('formatProfile: parser/serializer XML', () => {
  it('parsa il profilo di default e legge opzioni note', () => {
    const nodes = parseFormatProfileXml(DEFAULT_FORMAT_PROFILE_XML)
    const flat = flattenFormatOptions(nodes)
    expect(flat.get('Select_From_LineBreakBeforeFrom')).toBe('true')
    expect(flat.get('Select_From_Join_LineBreakBeforeJoin')).toBe('true')
    expect(flat.get('TextCase_Keyword')).toBe('1')
    // SubOptions annidati
    expect(flat.get('Select_Where_IndentWhereCondition_Size')).toBe('6')
    expect(flat.get('Select_SelectList_IndentColumnList_Size')).toBe('3')
  })

  it('round-trip: serialize(parse(x)) conserva le opzioni', () => {
    const nodes = parseFormatProfileXml(DEFAULT_FORMAT_PROFILE_XML)
    const xml = serializeFormatProfile(nodes)
    const flat2 = flattenFormatOptions(parseFormatProfileXml(xml))
    expect(flat2.get('Select_From_LineBreakBeforeFrom')).toBe('true')
    expect(flat2.get('TextCase_Keyword')).toBe('1')
  })

  it('setFormatOption modifica un valore esistente', () => {
    const nodes = parseFormatProfileXml(DEFAULT_FORMAT_PROFILE_XML)
    setFormatOption(nodes, 'Select_From_LineBreakBeforeFrom', 'false')
    expect(flattenFormatOptions(nodes).get('Select_From_LineBreakBeforeFrom')).toBe('false')
  })

  it('buildFormatProfile produce la configurazione tipizzata', () => {
    const p = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)
    expect(p.breakBeforeFrom).toBe(true)
    expect(p.breakBeforeJoin).toBe(true)
    expect(p.breakBeforeWhere).toBe(true)
    expect(p.breakBeforeInto).toBe(true)
    expect(p.breakBeforeAnd).toBe(true)
    expect(p.breakBeforeOr).toBe(true)
    expect(p.keywordUpper).toBe(true)
    expect(p.selectColumnIndent).toBe(3)
    expect(p.whereConditionIndent).toBe(6)
    expect(p.singleLineShort).toBe(true)
  })

  it('api di convenienza esposte', () => {
    expect(formatProfileApi.defaultXml).toContain('<FormatProfile>')
    expect(typeof formatProfileApi.parse).toBe('function')
  })
})

describe('tsqlFormatter: formatta secondo il profilo', () => {
  const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)

  it('tokenizza rispettando stringhe e commenti', () => {
    const toks = tokenizeSqlText("SELECT * FROM T WHERE a = 'it''s' -- ciao\nAND b = 2")
    expect(toks.some(t => t.type === 'string' && t.text.includes("'it''s'"))).toBe(true)
    expect(toks.some(t => t.type === 'comment' && t.text.startsWith('--'))).toBe(true)
  })

  it('query corta resta su una riga', () => {
    const out = formatSqlWithProfile('select id, nome from clienti where id = 1', profile)
    expect(out.includes('\n')).toBe(false)
    expect(out).toContain('SELECT')
    expect(out).toContain('FROM')
  })

  it('query lunga: FROM, JOIN, WHERE e colonne su righe separate', () => {
    const out = formatSqlWithProfile(
      'select a.id, a.nome, b.totale from clienti a inner join ordini b on a.id = b.cliente_id where a.nome like \'%x%\' and b.totale > 100 order by a.id',
      profile,
    )
    expect(out).toMatch(/SELECT a\.id/)
    // colonne impilate con indentazione
    expect(out).toMatch(/\n\s+a\.nome, b\.totale/)
    expect(out).toMatch(/\nFROM clienti a/)
    expect(out).toMatch(/\n\s+INNER JOIN ordini b/)
    expect(out).toMatch(/\nWHERE a\.nome LIKE/)
    expect(out).toMatch(/\n\s+ORDER BY a\.id/)
  })

  it('keyword in maiuscolo e variabili invariati', () => {
    const out = formatSqlWithProfile('select @x from t where @x = 1', profile)
    expect(out).toContain('SELECT')
    expect(out).toContain('@x')
  })

  it('INSERT INTO breve resta su una riga con spazi corretti', () => {
    const out = formatSqlWithProfile('insert into ordini (id, cliente_id) values (1, 2)', profile)
    expect(out).toBe('INSERT INTO ordini (id, cliente_id) VALUES (1, 2)')
  })

  it('INSERT lungo: VALUES su riga propria', () => {
    const out = formatSqlWithProfile(
      "insert into ordini (id, cliente_id, codice, descrizione, data) values (1, 2, 'ABC', 'una descrizione molto lunga per superare la soglia', getdate())",
      profile,
    )
    expect(out).toMatch(/INSERT INTO ordini \(id, cliente_id, codice, descrizione, data\)\nVALUES \(1, 2/)
  })

  it('UPDATE breve resta su una riga', () => {
    const out = formatSqlWithProfile('update ordini set totale = 10 where id = 1', profile)
    expect(out).toBe('UPDATE ordini SET totale = 10 WHERE id = 1')
  })

  it('UPDATE lungo: SET su riga propria', () => {
    const out = formatSqlWithProfile(
      'update ordini set totale = 10, note = \'aggiornamento manuale del totale della riga selezionata con valori lunghi\' where id = 1',
      profile,
    )
    expect(out).toMatch(/UPDATE ordini\n\s+SET totale = 10, note =/)
    expect(out).toMatch(/\nWHERE id = 1/)
  })

  it('commenti preservati', () => {
    const out = formatSqlWithProfile('select * -- commento\nfrom t', profile)
    expect(out).toContain('-- commento')
  })
})
