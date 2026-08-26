import { describe, expect, it } from 'vitest'
import { buildSelfJoinSuggestions } from '../helpers'
import type { DatabaseSummary } from '../types'
import { mkCol, mkTbl } from './schema'

/** Schema con FK autoreferenziale (Employees.manager_id → Employees.employee_id). */
function summaryWithSelfFk(): DatabaseSummary {
  const employees = mkTbl('dbo', 'Employees', [
    mkCol('employee_id'),
    mkCol('manager_id'),
    mkCol('name', 'nvarchar'),
  ])
  const departments = mkTbl('dbo', 'Departments', [mkCol('dept_id'), mkCol('dept_name', 'nvarchar')])
  return {
    tables: [employees, departments],
    views: [],
    procedures: [],
    triggers: [],
    functions: [],
    foreignKeys: [
      {
        name: 'FK_EMP_MGR',
        schema: 'dbo',
        table: 'Employees',
        column: 'manager_id',
        refSchema: 'dbo',
        refTable: 'Employees',
        refColumn: 'employee_id',
      },
    ],
    databases: [],
  }
}

describe('buildSelfJoinSuggestions: riunire una tabella con sé stessa (corso "Self Joins")', () => {
  const summary = summaryWithSelfFk()

  it('in posizione JOIN propone la tabella con alias e ON dalla FK autoreferenziale', () => {
    const sql = 'SELECT e.name FROM dbo.Employees e JOIN '
    const items = buildSelfJoinSuggestions(sql, summary)
    expect(items.length).toBe(1)
    expect(items[0].label).toContain('Employees AS em')
    expect(items[0].insertText).toBe('Employees AS em ON (em.manager_id = e.employee_id)')
    expect(items[0].filterText).toBe('Employees')
  })

  it('senza alias esistente il lato contesto usa il nome tabella', () => {
    const sql = 'SELECT * FROM dbo.Employees JOIN '
    const items = buildSelfJoinSuggestions(sql, summary)
    expect(items[0].insertText).toBe('Employees AS em ON (em.manager_id = Employees.employee_id)')
  })

  it('l\'alias nuovo non collide con quelli già scritti (em → em2)', () => {
    const sql = 'SELECT * FROM dbo.Employees em JOIN '
    const items = buildSelfJoinSuggestions(sql, summary)
    expect(items[0].insertText).toContain('AS em2 ON (em2.manager_id = em.employee_id)')
  })

  it('senza FK autoreferenziale: solo alias, l\'ON lo scrive l\'utente', () => {
    const sql = 'SELECT * FROM dbo.Departments d JOIN '
    const items = buildSelfJoinSuggestions(sql, summary)
    expect(items[0].insertText).toBe('Departments AS de')
    expect(items[0].detail).toContain('scrivi')
  })

  it('deduplica le tabelle referenziate più volte', () => {
    const sql = 'SELECT * FROM dbo.Employees e JOIN dbo.Employees e2 ON e.employee_id = e2.manager_id JOIN '
    const items = buildSelfJoinSuggestions(sql, summary)
    // Employees compare una sola volta tra i suggerimenti self-join
    expect(items.filter(i => i.filterText === 'Employees').length).toBe(1)
  })
})
