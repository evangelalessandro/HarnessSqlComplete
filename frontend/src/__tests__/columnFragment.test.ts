// Ricerca DENTRO i nomi delle colonne: scrivendo "fefo" deve uscire RIG_REVFEFO_VNA.
// Segnalazione utente: "SELECT fefo FROM DAT_ORDINI_RIGHE" non proponeva la colonna.
// Causa: il filtro di Monaco accettava solo i match a INIZIO PAROLA ("REVFEFO" non inizia per
// "fefo"), quindi la colonna c'era nella lista ma veniva nascosta; e senza FROM non si cercava
// affatto fra le colonne.
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import * as monaco from 'monaco-editor'
import { columnsByFragment } from '../helpers'
import { provideSqlCompletions } from '../sqlCompletions'
import type { DatabaseSummary, TableInfo } from '../types'
import { demoStoreLikeSummary } from './schema'

const base = demoStoreLikeSummary()

const mkCol = (name: string, dataType = 'nvarchar'): NonNullable<TableInfo['columns']>[number] => ({
  name,
  dataType,
  isNullable: true,
  isIdentity: false,
  isComputed: false,
  maxLength: 50,
  description: null,
  extendedProperties: null,
})

const ordiniRighe: TableInfo = {
  schema: 'dbo',
  name: 'DAT_ORDINI_RIGHE',
  columnCount: 4,
  createDate: null,
  usage: null,
  extendedProperties: null,
  columns: [mkCol('RIG_RIGA', 'int'), mkCol('RIG_REVFEFO_VNA'), mkCol('RIG_ARTICOLO'), mkCol('RIG_QTAR', 'decimal')],
}

const summary: DatabaseSummary = { ...base, tables: [ordiniRighe, ...base.tables] }

function suggest(sql: string, offset: number, sum: DatabaseSummary = summary) {
  const model = monaco.editor.createModel(sql, 'sql')
  try {
    return provideSqlCompletions({
      model,
      position: model.getPositionAt(offset),
      state: { connectionId: 'test', summary: sum, aiEnabled: false, onExecute: () => {} },
    })
  } finally {
    model.dispose()
  }
}

const nomi = (sql: string, offset: number, sum?: DatabaseSummary) =>
  (suggest(sql, offset, sum)?.suggestions ?? []).map(s => String(s.label))

describe('columnsByFragment: colonne che CONTENGONO il frammento', () => {
  it('trova la colonna con la parola in mezzo e dice di che tabella è', () => {
    const trovate = columnsByFragment(summary, 'fefo')
    expect(trovate.map(c => c.name)).toEqual(['RIG_REVFEFO_VNA'])
    expect(trovate[0].tableLabel).toBe('dbo.DAT_ORDINI_RIGHE')
  })

  it('senza distinzione di maiuscole e con frammenti corti ignorati', () => {
    expect(columnsByFragment(summary, 'FEFO').map(c => c.name)).toEqual(['RIG_REVFEFO_VNA'])
    expect(columnsByFragment(summary, 'f')).toEqual([]) // meno di 2 caratteri: nessuna ricerca
  })

  it('rispetta il tetto massimo di risultati', () => {
    expect(columnsByFragment(summary, 'i', 3)).toEqual([]) // corto: niente
    expect(columnsByFragment(summary, 'rig', 2).length).toBeLessThanOrEqual(2)
  })
})

describe('provider: "fefo" trova RIG_REVFEFO_VNA', () => {
  it('con la FROM dopo il cursore (caso segnalato)', () => {
    const sql = 'SELECT fefo FROM DAT_ORDINI_RIGHE'
    expect(nomi(sql, 'SELECT fefo'.length)).toContain('RIG_REVFEFO_VNA')
  })

  it('anche con la FROM scritta prima del cursore', () => {
    const sql = 'SELECT fefo FROM DAT_ORDINI_RIGHE WHERE RIG_RIGA > 0'
    expect(nomi(sql, 'SELECT fefo'.length)).toContain('RIG_REVFEFO_VNA')
  })

  it('senza alcuna FROM: ripiego su tutte le colonne dello schema', () => {
    const sql = 'SELECT fefo '
    const voci = nomi(sql, 'SELECT fefo'.length)
    expect(voci).toContain('RIG_REVFEFO_VNA')
    // la voce dice da quale tabella arriva
    const voce = suggest(sql, 'SELECT fefo'.length)!.suggestions.find(s => String(s.label) === 'RIG_REVFEFO_VNA')!
    expect(String(voce.detail)).toContain('colonna di dbo.DAT_ORDINI_RIGHE')
  })

  it('il ripiego non duplica i campi della tabella già proposti', () => {
    const sql = 'SELECT rig FROM DAT_ORDINI_RIGHE'
    const voci = nomi(sql, 'SELECT rig'.length)
    expect(voci.filter(v => v === 'RIG_RIGA')).toHaveLength(1)
  })
})
