// Alias delle tabelle nell'intellisense: scrivendo "alias." devono comparire i campi.
//
// Segnalato dall'utente: "se do un alias (esempio pippo) ad una tabella, mi aspetto che quando
// scrivo pippo. mi faccia comparire i campi della tabella". Funzionava per le tabelle dello
// schema, NON per: alias con parentesi quadre ([pippo].), tabelle temporanee (#tmp.) e CTE
// (with c as (…) select * from c pippo where pippo.).
// Secondo caso segnalato: nella SELECT-list l'alias non veniva considerato affatto (il ramo
// della select-list ritornava prima del controllo "alias.").
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import * as monaco from 'monaco-editor'
import { buildQualifiedColumnSuggestions, qualifierBeforeDot } from '../helpers'
import { provideSqlCompletions } from '../sqlCompletions'
import { extractCteTables, extractLocalTables } from '../localTables'
import type { DatabaseSummary } from '../types'
import { wsbritvicLikeSummary } from './schema'
import kittingReturn from './fixtures/routine_ws_CUSTOM_Handheld_KittingReturn_St1_GetList.sql?raw'

const base = wsbritvicLikeSummary()

/** Esegue il provider vero (quello dell'editor) alla posizione indicata. */
function suggest(sql: string, offset: number, summary: DatabaseSummary = base) {
  const model = monaco.editor.createModel(sql, 'sql')
  try {
    return provideSqlCompletions({
      model,
      position: model.getPositionAt(offset),
      state: { connectionId: 'test', summary, aiEnabled: true, onExecute: () => {} },
    })
  } finally {
    model.dispose()
  }
}

/** Come fa il provider: temporanee e CTE del testo entrano nel sommario (le CTE per prime). */
function conLocali(stmt: string, full = stmt): DatabaseSummary {
  const note = base.tables
  return {
    ...base,
    tables: [...extractCteTables(full, note), ...base.tables, ...extractLocalTables(full, note)],
  }
}

/** Colonne proposte per "alias." (il prefisso è il testo fino al punto). */
function campi(stmt: string, summary = conLocali(stmt)): string[] {
  return buildQualifiedColumnSuggestions(stmt, stmt, summary).map(s => s.name)
}

describe('qualifierBeforeDot', () => {
  it('accetta alias normale, con parentesi quadre, temporanee e variabili tabella', () => {
    expect(qualifierBeforeDot('where pippo.')).toBe('pippo')
    expect(qualifierBeforeDot('where [pippo].')).toBe('pippo')
    expect(qualifierBeforeDot('from #tmpMission where #tmpMission.')).toBe('#tmpMission')
    expect(qualifierBeforeDot('from @tab where @tab.')).toBe('@tab')
    expect(qualifierBeforeDot('where dbo.')).toBe('dbo')
    expect(qualifierBeforeDot('where pippo')).toBeNull()
    expect(qualifierBeforeDot('where 1 = ')).toBeNull()
  })

  it('riconosce il qualificatore anche mentre si digita il campo (pippo.X)', () => {
    expect(qualifierBeforeDot('where pippo.X')).toBe('pippo')
    expect(qualifierBeforeDot('select #t.X_SCO')).toBe('#t')
    expect(qualifierBeforeDot('select 1.5')).toBeNull()
  })
})

describe('alias → campi della tabella', () => {
  it('alias normale, con e senza AS, e in maiuscolo', () => {
    for (const stmt of [
      'select * from dbo.DAT_UDC as pippo where pippo.',
      'select * from dbo.DAT_UDC pippo where pippo.',
      'select * from dbo.DAT_UDC AS Pippo where pippo.',
      'select *\nfrom dbo.DAT_UDC\n  as pippo\nwhere pippo.',
    ]) {
      expect(campi(stmt), stmt).toContain('UDC_UDC')
    }
  })

  it('alias con parentesi quadre', () => {
    expect(campi('select * from dbo.DAT_UDC as pippo where [pippo].')).toContain('UDC_CORRIDOIO')
  })

  it('alias nella ON di un JOIN', () => {
    const stmt = 'select * from dbo.Ordini o inner join dbo.Clienti pippo on pippo.'
    expect(campi(stmt)).toEqual(['id', 'nome'])
  })

  it('alias di una tabella TEMPORANEA, con e senza alias', () => {
    const stmt = `select UDC_UDC, UDC_CORRIDOIO into #tmpMission from dbo.DAT_UDC
select * from #tmpMission t where t.`
    expect(campi(stmt)).toEqual(['UDC_UDC', 'UDC_CORRIDOIO'])
    const senzaAlias = `select UDC_UDC, UDC_CORRIDOIO into #tmpMission from dbo.DAT_UDC
select * from #tmpMission where #tmpMission.`
    expect(campi(senzaAlias)).toEqual(['UDC_UDC', 'UDC_CORRIDOIO'])
  })

  it('alias di una CTE (nome della CTE o suo alias)', () => {
    const sql = 'with c as (select UDC_UDC, UDC_CORRIDOIO from dbo.DAT_UDC) select * from c pippo where pippo.'
    expect(campi(sql)).toEqual(['UDC_UDC', 'UDC_CORRIDOIO'])
    const sql2 = 'with c as (select UDC_UDC from dbo.DAT_UDC) select * from c where c.'
    expect(campi(sql2)).toEqual(['UDC_UDC'])
  })

  it('una CTE con il nome di una tabella reale NON viene scavalcata', () => {
    const sql = 'with DAT_UDC as (select 1 as SOLO_CTE) select * from DAT_UDC d where d.'
    expect(campi(sql)).toEqual(['SOLO_CTE'])
  })

  it('qualificatore sconosciuto → nessun campo', () => {
    expect(campi('select * from dbo.DAT_UDC pippo where zzz.', base)).toEqual([])
  })
})

describe('alias nella SELECT-list (caso segnalato)', () => {
  const SQL = `select X_SCO, X_UDC_SOURCE into #tmpMission from dbo.DAT_UDC
select top 1
   UDC_UDC
  ,dd.
into #tmpNewDest
from #tmpMission dd
  inner join DAT_UDC on UDC_ARTICOLO = X_SKU`

  it('scrivendo "dd." nella select-list propone i campi della TEMPORANEA (non tutte le colonne)', () => {
    const res = suggest(SQL, SQL.indexOf(',dd.') + ',dd.'.length)
    const nomi = res!.suggestions.map(s => String(s.label))
    expect(nomi).toEqual(['X_SCO', 'X_UDC_SOURCE'])
  })

  it('anche a metà parola ("dd.X") restano i campi della temporanea', () => {
    const sql = SQL.replace('dd.', 'dd.X')
    const res = suggest(sql, sql.indexOf('dd.X') + 'dd.X'.length)
    const nomi = res!.suggestions.map(s => String(s.label))
    expect(nomi).toEqual(['X_SCO', 'X_UDC_SOURCE'])
  })

  it('confermando un suggerimento NON si ottiene "p.p.campo"', () => {
    // il qualificatore è già nel testo: insertText deve essere il solo nome della colonna
    const sql = 'select * from dbo.DAT_UDC p where p.'
    const res = suggest(sql, sql.length)
    const voce = res!.suggestions.find(s => s.label === 'UDC_UDC')
    expect(voce).toBeDefined()
    expect(String(voce!.insertText)).toBe('UDC_UDC')
    const dopoInserimento = sql + String(voce!.insertText)
    expect(dopoInserimento).toContain('p.UDC_UDC')
    expect(dopoInserimento).not.toContain('p.p.')
  })

  it('alias di una tabella dello schema: stessi campi della tabella', () => {
    const sql = 'select * from dbo.DAT_UDC pippo\nselect top 1\n  pip.\ninto #x\nfrom dbo.DAT_UDC pippo'
    const res = suggest(sql, sql.indexOf('pip.') + 'pip.'.length)
    const nomi = res!.suggestions.map(s => String(s.label))
    expect(nomi).toContain('UDC_UDC')
    expect(nomi).not.toContain('UDC_SSCC_DEST')
  })
})

describe('store reale: alias della #tmpMission', () => {  it('scrivendo "t." compaiono le colonne della temporanea (comprese quelle della CTE)', () => {
    const locali = extractLocalTables(kittingReturn)
    const merged: DatabaseSummary = { ...base, tables: [...extractCteTables(kittingReturn), ...base.tables, ...locali] }
    const stmt = 'select * from #tmpMission t where t.'
    const nomi = buildQualifiedColumnSuggestions(stmt, stmt, merged).map(s => s.name)
    expect(nomi).toContain('X_UDC_SOURCE')
    expect(nomi).toContain('X_CORRIDOIO')
    expect(nomi).toContain('UDC_USER_TASK')
  })
})
