/** Restituisce il nome qualificato: [schema].[name] (senza schema se dbo). */
export function qualified(schema: string, name: string): string {
  if (!schema || schema === 'dbo') return `[${name}]`
  return `[${schema}].[${name}]`
}

/** Estrae i riferimenti a tabelle (FROM/JOIN/UPDATE/INTO) dal testo SQL prima del cursore. */
export function findTableRefs(text: string): string[] {
  const re = /\b(?:from|join|update|into|table)\s+((?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*))?)/gi
  const refs = new Set<string>()
  for (const m of text.matchAll(re)) {
    const token = m[1].replace(/[\[\]\s]/g, '')
    const name = token.split('.').pop() ?? ''
    if (name) refs.add(name)
  }
  return [...refs]
}
