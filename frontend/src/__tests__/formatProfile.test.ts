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

  it('query corta: le opzioni del profilo VINCONO (FROM/WHERE a capo anche se corta)', () => {
    const out = formatSqlWithProfile('select id, nome from clienti where id = 1', profile)
    expect(out).toBe('SELECT id\n   ,nome\nFROM clienti\nWHERE id = 1\n')
  })

  it('con l\'opzione a capo DISATTIVATA la query corta resta su una riga', () => {
    const nodes = parseFormatProfileXml(DEFAULT_FORMAT_PROFILE_XML)
    setFormatOption(nodes, 'Select_From_LineBreakBeforeFrom', 'false')
    setFormatOption(nodes, 'Select_Where_LineBreakBeforeWhere', 'false')
    const p = buildFormatProfile(serializeFormatProfile(nodes))
    const out = formatSqlWithProfile('select id, nome from clienti where id = 1', p)
    expect(out.includes('\n')).toBe(false)
    expect(out).toBe('SELECT id, nome FROM clienti WHERE id = 1')
  })

  it('query lunga: FROM, JOIN, WHERE e colonne su righe separate', () => {
    const out = formatSqlWithProfile(
      'select a.id, a.nome, b.totale from clienti a inner join ordini b on a.id = b.cliente_id where a.nome like \'%x%\' and b.totale > 100 order by a.id',
      profile,
    )
    expect(out).toMatch(/SELECT a\.id/)
    // colonne impilate con indentazione e VIRGOLA IN TESTA (idempotente: ",a.nome")
    expect(out).toMatch(/\n\s+,a\.nome\n\s+,b\.totale/)
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

  it('UPDATE: SET e WHERE a capo (anche se l\'UPDATE è corto)', () => {
    const out = formatSqlWithProfile('update ordini set totale = 10 where id = 1', profile)
    expect(out).toBe('UPDATE ordini\n  SET totale = 10\nWHERE id = 1\n')
  })

  it('UPDATE: OGNI campo della SET va a capo (virgola allineata sotto il primo campo)', () => {
    const out = formatSqlWithProfile(
      'update ordini set totale = 10, note = \'aggiornamento manuale del totale della riga selezionata con valori lunghi\' where id = 1',
      profile,
    )
    expect(out).toMatch(/UPDATE ordini\n {2}SET totale = 10\n {6},note = 'aggiornamento/)
    expect(out).toMatch(/\nWHERE id = 1\n$/)
  })

  it('UPDATE: lo stesso vale dentro una stored procedure (SET/WHERE a capo)', () => {
    const out = formatSqlWithProfile(
      'alter procedure [dbo].[x]\nas\nbegin\n    update t\n        set a = 1\n        , b = 2\n    where id = 1\nend',
      profile,
    )
    expect(out).toContain('UPDATE t\n      SET a = 1\n          ,b = 2\n    WHERE id = 1')
  })

  it('commenti preservati', () => {
    const out = formatSqlWithProfile('select * -- commento\nfrom t', profile)
    expect(out).toContain('-- commento')
  })

  it('CREATE TABLE: OGNI colonna (col tipo di dato) su riga propria indentata', () => {
    const out = formatSqlWithProfile('CREATE TABLE #tbl (A INT, B NVARCHAR(50))', profile)
    expect(out).toBe('CREATE TABLE #tbl (\n  A INT\n  ,B NVARCHAR(50)\n)\n')
  })

  it('CREATE TABLE dentro una routine: colonne indentate nel blocco', () => {
    const out = formatSqlWithProfile(
      'alter procedure [dbo].[x]\nas\nbegin\n  CREATE TABLE #tbl (A INT, B NVARCHAR(50))\nend',
      profile,
    )
    expect(out).toContain('    CREATE TABLE #tbl (\n      A INT\n      ,B NVARCHAR(50)\n    )')
  })

  it('tabella temporanea "#nome" resta attaccata (niente "# tbl")', () => {
    const out = formatSqlWithProfile('select X from #tbl_InventoryKitting_St1', profile)
    expect(out).toContain('#tbl_InventoryKitting_St1')
    expect(out).not.toContain('# tbl')
  })

  it('EXEC: parametri e valori incolonnati sotto il primo parametro', () => {
    const out = formatSqlWithProfile(
      'EXEC ws_CUSTOM_Handheld_InventoryKitting_St1_GetList @user = @user, @udc = @pUDC',
      profile,
    )
    expect(out).toBe(
      'EXEC ws_CUSTOM_Handheld_InventoryKitting_St1_GetList @user = @user\n' +
        '                                                    ,@udc  = @pUDC\n',
    )
  })

  it('EXEC dentro una routine: incolonnato con l\'indentazione del blocco', () => {
    const out = formatSqlWithProfile(
      'alter procedure [dbo].[x]\nas\nbegin\n  EXEC ws_p @user = @user, @udc = @pUDC, @flag = 1 OUTPUT\nend',
      profile,
    )
    expect(out).toContain('    EXEC ws_p @user = @user\n             ,@udc  = @pUDC\n             ,@flag = 1 OUTPUT')
  })

  it('EXEC con un solo parametro resta su una riga', () => {
    const out = formatSqlWithProfile('EXEC ws_p @udc = @pUDC', profile)
    expect(out).toBe('EXEC ws_p @udc = @pUDC\n')
  })

  it('SELECT con CASE nella testata: dopo END la FROM va a capo (bug utente)', () => {
    const out = formatSqlWithProfile(
      "SELECT @txtError = CASE WHEN ISNULL(@ssccLu, '') = '' THEN dbo.fn_td('SSCC not set !') ELSE '' END, @modulo = X_MODULO FROM (SELECT 1 TT) a LEFT JOIN #tbl_InventoryKitting_St1 ON 1 = 1",
      profile,
    )
    // il CASE è espanso
    expect(out).toMatch(/SELECT @txtError =\n\s+CASE\n\s+WHEN/)
    expect(out).toContain('END')
    // la coda non resta attaccata a END: campo residuo, FROM a margine, JOIN indentato
    expect(out).toMatch(/\n\s+,@modulo = X_MODULO\n/)
    expect(out).toMatch(/\nFROM \(SELECT 1 TT\) a\n/)
    expect(out).toMatch(/\n\s+LEFT JOIN #tbl_InventoryKitting_St1 ON 1 = 1/)
    expect(out).not.toContain('END, @modulo')
    expect(out).not.toContain('# tbl')
  })

  it('SELECT con CASE nella testata dentro una routine: coda con FROM/JOIN a capo', () => {
    const out = formatSqlWithProfile(
      "alter procedure [dbo].[x]\nas\nbegin\n  SELECT @e = CASE WHEN a = 1 THEN 'x' ELSE 'y' END, @m = B FROM dbo.T t LEFT JOIN #tmp z ON 1 = 1\nend",
      profile,
    )
    expect(out).toMatch(/\n {6},@m = B\n {4}FROM dbo\.T t\n {6}LEFT JOIN #tmp z ON 1 = 1/)
  })
})
