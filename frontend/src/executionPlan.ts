// PIANO DI ESECUZIONE: legge l'XML di showplan di SQL Server, ne ricava gli operatori e gli INDICI
// SUGGERITI (MissingIndexes) con lo script CREATE INDEX pronto.
//
// Richiesta utente: "piano di esecuzione + indice suggerito".
//
// L'analisi sta qui (e non nel backend) perché è pura e testabile: il backend restituisce l'XML così
// com'è. Il piano mostrato è quello STIMATO (SET SHOWPLAN_XML ON): la query non viene eseguita.

export interface PianoNodo {
  /** Operatore fisico (Index Seek, Clustered Index Scan, Hash Match…). */
  operatore: string
  /** Operatore logico (Inner Join, Table Scan…). */
  logico: string | null
  /** Righe stimate per questo operatore. */
  righe: number | null
  /** Costo del sottoalbero (unità di costo di SQL Server). */
  costo: number
  /** Profondità nell'albero (0 = radice). */
  profondita: number
  /** Tabella/indice coinvolto, se c'è. */
  oggetto: string | null
}

export interface IndiceSuggerito {
  schema: string
  tabella: string
  /** Impatto stimato (%) secondo SQL Server. */
  impatto: number
  /** Colonne di uguaglianza (=, IN) — vanno per prime nella chiave. */
  uguaglianza: string[]
  /** Colonne di disuguaglianza (>, <, LIKE, BETWEEN). */
  disuguaglianza: string[]
  /** Colonne da mettere in INCLUDE. */
  include: string[]
  /** Script CREATE INDEX pronto (con commento di avviso). */
  script: string
}

export interface PianoEsecuzione {
  /** Testo dello statement a cui si riferisce il piano. */
  statement: string | null
  /** Costo stimato dello statement (unità di costo). */
  costo: number
  /** Operatori dell'albero (dal più profondo al più alto, come li mostra SQL Server). */
  nodi: PianoNodo[]
  indici: IndiceSuggerito[]
}

/** Nome di indice leggibile e valido (max 128 caratteri, come SQL Server). */
export function nomeIndice(tabella: string, colonne: string[]): string {
  const pulito = (s: string) => s.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  const parti = [pulito(tabella), ...colonne.map(pulito)].filter(Boolean)
  const nome = `IX_${parti.join('_')}`
  return nome.length > 128 ? nome.slice(0, 128) : nome
}

/**
 * Toglie le parentesi quadre che SQL Server mette nei nomi dello showplan.
 * Gestisce anche i nomi composti: "[dbo].[MAG_CELLE]" → "dbo.MAG_CELLE".
 */
function senzaQuadre(s: string): string {
  return s
    .split('.')
    .map(parte => parte.trim().replace(/^\[+/, '').replace(/\]+$/, '').replace(/]]/g, ']'))
    .join('.')
}

/** Identificatore fra parentesi quadre, con le quadre interne raddoppiate. */
function q(s: string): string {
  return `[${s.replace(/]/g, ']]')}]`
}

/**
 * Script CREATE INDEX per un indice suggerito da SQL Server: chiave = uguaglianza + disuguaglianza,
 * INCLUDE per le colonne di copertura. Il commento in testa ricorda che l'indice va valutato (pesa
 * sulle scritture e sullo spazio).
 */
export function scriptIndiceSuggerito(i: IndiceSuggerito): string {
  const chiave = [...i.uguaglianza, ...i.disuguaglianza]
  const nome = nomeIndice(i.tabella, chiave)
  const righe = [
    `-- Indice suggerito dal piano di esecuzione (impatto stimato ${i.impatto.toFixed(1)}%)`,
    '-- Valutalo prima di crearlo: pesa su INSERT/UPDATE/DELETE e sullo spazio occupato.',
    `CREATE NONCLUSTERED INDEX ${q(nome)} ON ${q(i.schema)}.${q(i.tabella)} (${chiave.map(q).join(', ')})`,
  ]
  if (i.include.length > 0) righe[2] += ` INCLUDE (${i.include.map(q).join(', ')})`
  return righe.join('\n') + ';\n'
}

/** Numero da attributo (null se assente o non numerico). */
function num(el: Element | null, nome: string): number | null {
  const v = el?.getAttribute(nome)
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Analizza l'XML di showplan. Restituisce null se non è un piano leggibile.
 * Prende lo statement di costo maggiore (un piano può contenere più statement).
 */
export function analizzaPiano(xml: string): PianoEsecuzione | null {
  if (!xml || typeof xml !== 'string') return null
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml')
  } catch {
    return null
  }
  if (doc.querySelector('parsererror')) return null
  const statements = [...doc.querySelectorAll('StmtSimple')]
  if (statements.length === 0) return null
  // lo statement che pesa di più è quello che interessa
  const principale = statements.reduce((peggiore, s) => {
    const a = num(s, 'StatementSubTreeCost') ?? 0
    const b = num(peggiore, 'StatementSubTreeCost') ?? 0
    return a > b ? s : peggiore
  })

  const nodi: PianoNodo[] = []
  for (const rel of [...principale.querySelectorAll('RelOp')]) {
    let profondita = 0
    for (let p = rel.parentElement; p; p = p.parentElement) if (p.tagName === 'RelOp') profondita++
    const conTabella = rel.querySelector('[Table]')
    const tabellaGrezza = conTabella?.getAttribute('Table')
    const schemaGrezzo = conTabella?.getAttribute('Schema')
    const tabella = tabellaGrezza ? senzaQuadre(tabellaGrezza) : null
    const schema = schemaGrezzo ? senzaQuadre(schemaGrezzo) : null
    nodi.push({
      operatore: rel.getAttribute('PhysicalOp') ?? rel.getAttribute('LogicalOp') ?? '?',
      logico: rel.getAttribute('LogicalOp'),
      righe: num(rel, 'EstimateRows'),
      costo: num(rel, 'EstimatedTotalSubtreeCost') ?? 0,
      profondita,
      oggetto: tabella ? (schema ? `${schema}.${tabella}` : tabella) : null,
    })
  }
  nodi.sort((a, b) => a.profondita - b.profondita || b.costo - a.costo)

  const indici: IndiceSuggerito[] = []
  for (const gruppo of [...principale.querySelectorAll('MissingIndexGroup')]) {
    const impatto = num(gruppo, 'Impact') ?? 0
    for (const mi of [...gruppo.querySelectorAll('MissingIndex')]) {
      const uguaglianza: string[] = []
      const disuguaglianza: string[] = []
      const include: string[] = []
      for (const cg of [...mi.querySelectorAll('ColumnGroup')]) {
        const uso = (cg.getAttribute('Usage') ?? '').toUpperCase()
        const colonne = [...cg.querySelectorAll('Column')]
          .map(c => senzaQuadre(c.getAttribute('Name') ?? ''))
          .filter(Boolean)
        if (uso === 'EQUALITY') uguaglianza.push(...colonne)
        else if (uso === 'INEQUALITY') disuguaglianza.push(...colonne)
        else if (uso === 'INCLUDE') include.push(...colonne)
      }
      const tabella = senzaQuadre(mi.getAttribute('Table') ?? '')
      if (!tabella || (uguaglianza.length === 0 && disuguaglianza.length === 0)) continue
      const indice: IndiceSuggerito = {
        schema: senzaQuadre(mi.getAttribute('Schema') || 'dbo'),
        tabella,
        impatto,
        uguaglianza,
        disuguaglianza,
        include,
        script: '',
      }
      indice.script = scriptIndiceSuggerito(indice)
      indici.push(indice)
    }
  }
  indici.sort((a, b) => b.impatto - a.impatto)

  return {
    statement: principale.getAttribute('StatementText'),
    costo: num(principale, 'StatementSubTreeCost') ?? 0,
    nodi,
    indici,
  }
}
