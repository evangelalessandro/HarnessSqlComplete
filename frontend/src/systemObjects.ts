// Oggetti di catalogo di sistema di SQL Server suggeribili dall'intellisense:
// viste/tabelle sys.* e DMV (sys.dm_*). Il corso T-SQL dedica sezioni a
// "Querying System Catalog Views", "System Stored Procedures" e "Dynamic Management Objects".

/** Viste/tabelle di catalogo comuni (sys.*) e DMV (sys.dm_*). */
export const SYSTEM_CATALOG_OBJECTS = [
  // schema e oggetti
  'sys.tables', 'sys.columns', 'sys.all_columns', 'sys.objects', 'sys.schemas',
  'sys.views', 'sys.procedures', 'sys.functions', 'sys.triggers', 'sys.types',
  'sys.indexes', 'sys.index_columns', 'sys.foreign_keys', 'sys.foreign_key_columns',
  'sys.key_constraints', 'sys.check_constraints', 'sys.default_constraints',
  'sys.partitions', 'sys.sql_modules', 'sys.extended_properties', 'sys.databases',
  // DMV (Dynamic Management Views)
  'sys.dm_exec_requests', 'sys.dm_exec_sessions', 'sys.dm_exec_connections',
  'sys.dm_exec_query_stats', 'sys.dm_exec_cached_plans', 'sys.dm_exec_sql_text',
  'sys.dm_exec_query_plan', 'sys.dm_db_index_usage_stats', 'sys.dm_tran_locks',
  'sys.dm_os_wait_stats', 'sys.dm_os_performance_counters',
]

/** True se l'utente sta chiaramente cercando oggetti di sistema (sys./dm_…). */
export function shouldSuggestSystemObjects(prefix: string, word: string): boolean {
  const w = word.trim().toLowerCase()
  if (w.startsWith('sys') || w.startsWith('dm')) return true
  return /(?:^|\s|\.)sys\.\s*$/i.test(prefix) || /(?:^|\s)dm_/i.test(prefix)
}

/** Oggetti di sistema che corrispondono al testo digitato (per Monaco). */
export function systemObjectsFor(_prefix: string, word: string): string[] {
  const w = word.trim().toLowerCase()
  const list = SYSTEM_CATALOG_OBJECTS
  if (w.length === 0) return list
  return list.filter(o => o.toLowerCase().includes(w))
}
