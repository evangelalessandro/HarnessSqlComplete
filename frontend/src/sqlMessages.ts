// Visualizzazione dei messaggi di SQL Server come nella finestra "Messaggi" di SSMS.
//
// Il problema risolto: quando una query richiama più stored procedure e una fallisce, il
// messaggio di SQL Server contiene la PROCEDURA che ha eseguito il RAISERROR e la riga
// (es. "Msg 50000, Livello 16, Stato 1, Procedura ws_X, Riga 42"). Il backend ora manda sia
// il testo già composto sia i campi separati: qui si evidenzia il pezzo che serve — il nome
// della procedura — invece di mostrare tutto uguale.
import type { DatabaseSummary, QueryMessage } from './types'

/** Oggetto del database citato in un messaggio di errore. */
export interface ErrorObjectRef {
  kind: 'table' | 'view' | 'procedure' | 'function' | 'trigger'
  schema: string
  name: string
  /**
   * Riga da mostrare aprendo l'oggetto: è la riga DELLA PROCEDURA che ha sollevato l'errore
   * (SQL Server la conta dall'inizio della sua definizione), quindi vale solo per quell'oggetto.
   */
  line?: number
}

/** true se il risultato contiene un errore (campo error oppure un messaggio marcato come errore). */
export function hasQueryError(result: {
  error?: string | null
  errors?: QueryMessage[] | null
}): boolean {
  return !!result.error || (result.errors ?? []).some(m => m.isError)
}

/** Primo messaggio di errore strutturato del risultato (procedura/riga per il salto alla riga). */
export function firstErrorMessage(result: {
  errors?: QueryMessage[] | null
}): QueryMessage | null {
  return (result.errors ?? []).find(m => m.isError) ?? null
}

/**
 * Intervallo di righe (1-based, estremi inclusi) della definizione della routine `name` nel
 * testo: dalla CREATE fino alla riga prima del `GO` successivo (o alla fine del testo), che è
 * il batch in cui la routine viene creata. Null se la definizione non c'è.
 */
export function routineDefinitionRange(text: string, name: string): { start: number; end: number } | null {
  if (!text || !name) return null
  const righe = text.split(/\r?\n/)
  const IDENT = '(?:\\[[^\\]]+\\]|[A-Za-z_#@][\\w#@$]*)'
  const re = new RegExp(
    `\\b(?:CREATE|ALTER)\\s+(?:OR\\s+ALTER\\s+)?(?:PROCEDURE|PROC|FUNCTION|TRIGGER|VIEW)\\s+` +
      `(?:${IDENT}\\s*\\.\\s*)?(${IDENT})`,
    'i',
  )
  const atteso = name.replace(/^\[|\]$/g, '').toLowerCase()
  for (let i = 0; i < righe.length; i++) {
    const m = re.exec(righe[i])
    if (!m) continue
    const trovato = (m[1] ?? '').replace(/^\[|\]$/g, '').toLowerCase()
    if (trovato !== atteso) continue
    // fine del batch: la riga del prossimo "GO" (o la fine del testo)
    let fine = righe.length
    for (let k = i + 1; k < righe.length; k++) {
      if (/^\s*GO\s*;?\s*$/i.test(righe[k])) {
        fine = k
        break
      }
    }
    return { start: i + 1, end: fine }
  }
  return null
}

/** Riga (1-based) in cui inizia la definizione della routine `name` nel testo, o null. */
export function routineStartLine(text: string, name: string): number | null {
  return routineDefinitionRange(text, name)?.start ?? null
}

/**
 * Riga dell'editor su cui portare il cursore per un messaggio di errore.
 *
 * SQL Server numera le righe in due modi diversi:
 *  - procedura creata in un ALTRO momento (nel database) e chiamata da un batch → la riga è
 *    quella DENTRO la definizione: con la CREATE alla riga 101 della tab, "Riga 64" è la 164;
 *  - procedura creata NELLO STESSO batch → la riga è già quella dello script, quindi va usata
 *    così com'è (è dentro l'intervallo della definizione presente nella tab).
 * Negli altri casi (errori di script, batch) la riga è quella del testo.
 */
export function messageRevealLine(message: Pick<QueryMessage, 'procedure' | 'line'>, tabText: string): number | null {
  const line = message.line ?? null
  if (!line || line < 1) return null
  if (!message.procedure) return line
  const range = routineDefinitionRange(tabText, message.procedure)
  if (!range) return line
  // già dentro la definizione della tab → SQL Server conta dallo script
  if (line >= range.start && line <= range.end) return line
  return range.start + line - 1
}

/** Ordine di preferenza quando lo stesso nome esiste come più tipi di oggetto. */
const KIND_PRIORITY: ErrorObjectRef['kind'][] = ['procedure', 'function', 'view', 'trigger', 'table']

/**
 * Trova gli oggetti del database CITATI NEL TESTO di un errore, fra quelli che esistono
 * davvero nello schema caricato.
 *
 * Serve perché SQL Server nomina gli oggetti nei messaggi ("Invalid object name 'dbo.X'",
 * "conflicted with the FOREIGN KEY constraint ... table 'dbo.Y'", "in procedure dbo.ws_Z"):
 * solo gli oggetti esistenti possono essere aperti in una tab, gli altri (es. una tabella che
 * non c'è) vengono ignorati — il pulsante non avrebbe senso.
 *
 * Riconosce i nomi qualificati (`dbo.X`, `[dbo].[X]`) e quelli semplici (`X`, `[X]`).
 */
export function objectsInErrorText(
  text: string,
  summary: DatabaseSummary | null | undefined,
): ErrorObjectRef[] {
  if (!text || !summary) return []
  // identificatori: [nome] oppure parola; eventualmente qualificati con lo schema
  const IDENT = '(?:\\[[^\\]]+\\]|[A-Za-z_#@][\\w#@$]*)'
  const re = new RegExp(`(${IDENT})(?:\\s*\\.\\s*(${IDENT}))?`, 'g')
  const found: ErrorObjectRef[] = []
  const seen = new Set<string>()

  const clean = (s: string) => s.replace(/^\[|\]$/g, '').trim()
  const known = (kind: ErrorObjectRef['kind'], name: string, schema: string | null): ErrorObjectRef | null => {
    const lower = name.toLowerCase()
    const sameSchema = (s: string) => !schema || s.toLowerCase() === schema.toLowerCase()
    switch (kind) {
      case 'table': {
        const t = summary.tables.find(x => x.name.toLowerCase() === lower && sameSchema(x.schema))
        return t ? { kind, schema: t.schema, name: t.name } : null
      }
      case 'view': {
        const v = summary.views.find(x => x.name.toLowerCase() === lower && sameSchema(x.schema))
        return v ? { kind, schema: v.schema, name: v.name } : null
      }
      case 'procedure': {
        const p = summary.procedures.find(x => x.name.toLowerCase() === lower && sameSchema(x.schema))
        return p ? { kind, schema: p.schema, name: p.name } : null
      }
      case 'function': {
        const f = summary.functions.find(x => x.name.toLowerCase() === lower && sameSchema(x.schema))
        return f ? { kind, schema: f.schema, name: f.name } : null
      }
      case 'trigger': {
        const t = summary.triggers.find(x => x.name.toLowerCase() === lower && sameSchema(x.schema))
        return t ? { kind, schema: t.schema, name: t.name } : null
      }
    }
  }

  for (const match of text.matchAll(re)) {
    const name = clean(match[2] ?? match[1])
    const schema = match[2] ? clean(match[1]) : null
    if (!name) continue
    for (const kind of KIND_PRIORITY) {
      const hit = known(kind, name, schema)
      if (!hit) continue
      const key = `${hit.kind}:${hit.schema}.${hit.name}`.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        found.push(hit)
      }
      break // un solo tipo per nome (il primo in ordine di preferenza)
    }
  }
  return found
}

/**
 * Oggetti da proporre per un errore: quelli citati NEL TESTO più la procedura che l'ha
 * sollevato (se lo schema la conosce). Oggetti sconosciuti non compaiono: aprire una tab per
 * un oggetto che non esiste darebbe solo un errore.
 */
export function errorObjectsFor(
  m: QueryMessage,
  summary: DatabaseSummary | null | undefined,
): ErrorObjectRef[] {
  const refs = objectsInErrorText(`${m.procedure ?? ''} ${m.text}`, summary)
  if (!m.procedure) return refs
  const parts = m.procedure.split('.')
  const name = parts[parts.length - 1]
  const schema = parts.length > 1 ? parts[0] : 'dbo'
  // la riga dell'errore vale SOLO per chi l'ha sollevato: si associa a quell'oggetto e lo si
  // porta in testa (esiste già nell'elenco quando il suo nome compare nel testo)
  const line = m.line > 0 ? m.line : undefined
  const stesso = (r: ErrorObjectRef) => r.name.toLowerCase() === name.toLowerCase()
  const idx = refs.findIndex(stesso)
  if (idx >= 0) return [{ ...refs[idx], line }, ...refs.filter((_, i) => i !== idx)]
  // se lo schema lo conosce, la procedura che ha fallito va comunque proposta per prima
  const esistente = objectsInErrorText(`${schema}.${name}`, summary)[0]
  return esistente ? [{ ...esistente, line }, ...refs] : refs
}

/** Etichetta del pulsante che apre un oggetto citato nell'errore. */
export function errorObjectAction(o: ErrorObjectRef): string {
  switch (o.kind) {
    case 'table':
      return 'Apri CREATE'
    case 'view':
    case 'procedure':
    case 'function':
    case 'trigger':
      return 'Modifica'
  }
}

/** Descrizione del pulsante, con la riga quando si sa (es. "Modifica dbo.ws_X (riga 42)"). */
export function errorObjectButtonLabel(o: ErrorObjectRef): string {
  const nome = `${o.schema}.${o.name}`
  return o.line && o.line > 0 ? `${errorObjectAction(o)} ${nome} (riga ${o.line})` : `${errorObjectAction(o)} ${nome}`
}

/** Nome del tipo di oggetto, per il testo del pulsante. */
export function errorObjectKindLabel(kind: ErrorObjectRef['kind']): string {
  switch (kind) {
    case 'table':
      return 'tabella'
    case 'view':
      return 'vista'
    case 'procedure':
      return 'stored procedure'
    case 'function':
      return 'funzione'
    case 'trigger':
      return 'trigger'
  }
}

/** Intestazione in stile SSMS: "Msg 50000, Livello 16, Stato 1 · Procedura ws_X · Riga 42". */
export function messageHeader(m: QueryMessage): string {
  if (m.number === 0) return ''
  const proc = m.procedure ? ` · Procedura ${m.procedure}` : ''
  return `Msg ${m.number}, Livello ${m.severity}, Stato ${m.state}${proc} · Riga ${m.line}`
}

/**
 * Indice dei messaggi che sono errori, per la chiave `display`: permette di colorare in
 * rosso le righe giuste nell'elenco senza duplicare la logica di formattazione (che sta nel
 * backend). Si tiene il primo che compare per ogni testo.
 */
export function errorMessagesByDisplay(messages: QueryMessage[] | null | undefined): Map<string, QueryMessage> {
  const map = new Map<string, QueryMessage>()
  for (const m of messages ?? []) {
    if (!m.isError) continue
    if (!map.has(m.display)) map.set(m.display, m)
  }
  return map
}

/** true se c'è almeno un errore fra i messaggi (per evidenziare la tab dei messaggi). */
export function hasErrorMessage(messages: QueryMessage[] | null | undefined): boolean {
  return (messages ?? []).some(m => m.isError)
}

/** Riepilogo compatto per la barra di errore: errori raggruppati per procedura. */
export function errorProcedureNames(messages: QueryMessage[] | null | undefined): string[] {
  const names = new Set<string>()
  for (const m of messages ?? []) {
    if (m.isError && m.procedure) names.add(m.procedure)
  }
  return [...names]
}
