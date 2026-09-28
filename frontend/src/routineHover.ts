// TOOLTIP DI UNA STORED PROCEDURE / FUNZIONE nell'editor: parametri della firma e COMMENTO di
// testata (richiesta utente: "nella tooltip di una store mi puoi fare vedere commento e parametri?").
// Logica PURA e testabile: il testo della definizione (sys.sql_modules) e i parametri del sommario
// arrivano da fuori, qui si estrae il commento, si uniscono i parametri e si compone il markdown.
import { extractRoutineParameters } from './tsqlSnippets'
import type { ProcParamInfo } from './types'

/** Lunghezza massima del commento mostrato nella tooltip. */
export const MAX_COMMENTO_HOVER = 700

/**
 * COMMENTO DI TESTATA di una routine: il primo blocco `/* … *\/` della definizione, altrimenti le
 * righe di commento `--` in testa. Nelle store di questo database il commento sta in testa (spesso
 * PRIMA della CREATE), con dentro la descrizione e l'elenco dei parametri.
 * Restituisce null se non c'è nessun commento; i marcatori vengono tolti e il testo è ripulito.
 */
export function estraiCommentoRoutine(definition: string | null | undefined): string | null {
  if (!definition) return null
  const testo = definition.replace(/\r\n/g, '\n')

  // 1) blocco /* … */ (anche multi-riga), il primo della definizione
  const blocco = /\/\*([\s\S]*?)\*\//.exec(testo)
  if (blocco) {
    const pulito = pulisci(blocco[1])
    if (pulito) return pulito
  }

  // 2) righe di commento "--" consecutive (l'header CREATE viene saltato)
  const commenti: string[] = []
  for (const riga of testo.split('\n')) {
    const m = /^\s*--[ \t]?(.*)$/.exec(riga)
    if (m) {
      commenti.push(m[1])
      continue
    }
    if (commenti.length === 0) {
      // ancora nell'header (o in una riga vuota): si continua a cercare
      if (/^\s*(?:CREATE|ALTER|SET|USE|$)/i.test(riga)) continue
      break
    }
    if (riga.trim() === '') continue
    break
  }
  return pulisci(commenti.join('\n')) || null
}

/** Ripulisce il testo di un commento: toglie gli asterischi di apertura riga e compatta gli spazi. */
function pulisci(testo: string): string {
  const righe = testo
    .split('\n')
    .map(r => r.replace(/^\s*\*[ \t]?/, '').trimEnd())
    .join('\n')
    .trim()
  if (righe === '') return ''
  const compatto = righe.replace(/\n{3,}/g, '\n\n')
  return compatto.length > MAX_COMMENTO_HOVER ? compatto.slice(0, MAX_COMMENTO_HOVER - 1).trimEnd() + '…' : compatto
}

/** Parametro come si mostra nella tooltip. */
export interface ParametroTooltip {
  /** Nome come si scrive nel codice: con la chiocciola (@id). */
  nome: string
  /** Tipo di dato, con la lunghezza quando si conosce (nvarchar(255)). */
  tipo: string
  output?: boolean
  predefinito?: string
}

/** Nome di parametro confrontabile: senza chiocciola e senza parentesi quadre. */
function chiaveParametro(nome: string | null | undefined): string {
  return (nome ?? '').replace(/[[\]]/g, '').replace(/^@/, '').trim().toLowerCase()
}

/**
 * PARAMETRI della tooltip. I tipi precisi (con lunghezza e precisione) si leggono dalla
 * DEFINIZIONE con l'analizzatore già usato dall'intellisense; dal SOMMARIO si prendono OUTPUT e
 * valore di default. Se dalla definizione non si ricava nulla (definizione nascosta, testo non
 * standard) si usano i parametri del sommario.
 */
export function unisciParametri(
  definition: string | null | undefined,
  dalSommario: ProcParamInfo[] | null | undefined,
): ParametroTooltip[] {
  // il valore di ritorno di una funzione scalare è una riga di sys.parameters con nome NULL:
  // non è un parametro e non deve comparire nella tooltip
  const sommario = (dalSommario ?? []).filter(p => chiaveParametro(p.name) !== '')
  const perChiave = new Map(sommario.map(p => [chiaveParametro(p.name), p]))
  const dallaDefinizione = definition ? extractRoutineParameters(definition) : []

  if (dallaDefinizione.length > 0) {
    return dallaDefinizione.map(p => {
      const s = perChiave.get(chiaveParametro(p.name))
      return {
        nome: p.name.startsWith('@') ? p.name : `@${p.name}`,
        tipo: p.dataType,
        output: s ? s.mode.toUpperCase() === 'OUTPUT' : undefined,
        predefinito: s?.defaultValue ?? undefined,
      }
    })
  }

  return sommario.map(p => ({
    nome: p.name.startsWith('@') ? p.name : `@${p.name}`,
    tipo: p.dataType,
    output: p.mode.toUpperCase() === 'OUTPUT',
    predefinito: p.defaultValue ?? undefined,
  }))
}

/** Riga di un parametro: `@id` · `int` · **OUTPUT** · default `0`. */
export function descrizioneParametro(p: ParametroTooltip): string {
  const parti = [`\`${p.nome}\``, `\`${p.tipo}\``]
  if (p.output) parti.push('**OUTPUT**')
  if (p.predefinito != null && p.predefinito !== '') parti.push(`default \`${p.predefinito}\``)
  return parti.join(' · ')
}

/**
 * MARKDOWN della tooltip di una routine: nome, tipo (stored procedure / funzione), firma con i
 * parametri e commento di testata.
 */
export function routineHoverMarkdown(
  rif: { schema: string; name: string; kind: 'procedure' | 'function' },
  parametri: ParametroTooltip[] | null | undefined,
  commento: string | null,
): string {
  const qualificato = rif.schema === 'dbo' ? rif.name : `${rif.schema}.${rif.name}`
  const tipo = rif.kind === 'procedure' ? 'stored procedure' : 'funzione'
  const params = parametri ?? []
  const righe: string[] = [`**${qualificato}** · ${tipo}`]

  if (params.length > 0) {
    righe.push(
      '',
      `### Parametri (${params.length})`,
      '',
      // elenco puntato: nella tooltip si legge meglio di una tabella quando i parametri sono tanti
      ...params.map(p => `- ${descrizioneParametro(p)}`),
    )
  } else {
    righe.push('', '_Nessun parametro._')
  }

  if (commento && commento.trim() !== '') {
    const citazione = commento
      .split('\n')
      .map(r => `> ${r.trim()}`)
      .join('\n')
    righe.push('', '---', '', '### Commento', '', citazione)
  }

  return righe.join('\n')
}
