// XML IN UNA SCHEDA: formattazione (indentata) e tokenizzazione per i colori.
//
// RICHIESTA UTENTE: "se il campo è un xml aprimi una scheda che me lo faccia vedere in modo che possa
// capire, che sia indentato ed ogni nodo abbia un colore, e che ci possa fare delle ricerche sopra".
//
// Qui c'è solo la LOGICA pura (testabile): il componente XmlViewerTab disegna i token e fa la ricerca.

/** Tipi di pezzo di XML, per il colore. */
export type TipoTokenXml =
  | 'tag' // <, </, >, /> e punteggiatura del tag
  | 'nome' // nome dell'elemento
  | 'attributo' // nome dell'attributo
  | 'valore' // "valore" dell'attributo
  | 'testo' // testo fra i tag
  | 'commento' // <!-- … -->
  | 'cdata' // <![CDATA[ … ]]>
  | 'prologo' // <?xml … ?>
  | 'dichiarazione' // <!DOCTYPE …>

export interface TokenXml {
  tipo: TipoTokenXml
  testo: string
}

/**
 * Il valore sembra XML? Basta un valore che, senza spazi iniziali, comincia con '<' e contiene '>'.
 * (Una cella con "< 5" non ha '>' e non passa; un frammento XML senza prologo sì.)
 */
export function eXml(valore: unknown): boolean {
  if (typeof valore !== 'string') return false
  const t = valore.trim()
  if (t.length < 3 || !t.startsWith('<')) return false
  if (!t.includes('>')) return false
  // almeno un tag plausibile: <nome, </nome, <?, <!
  return /^<(?:[A-Za-z_!?/]|$)/.test(t)
}

/** Token XML "grezzi" (senza indentazione): serve sia al formatter sia al coloratore. */
export function tokenizzaXml(xml: string): TokenXml[] {
  const out: TokenXml[] = []
  let i = 0
  const n = xml.length
  const push = (tipo: TipoTokenXml, testo: string) => {
    if (testo) out.push({ tipo, testo })
  }
  while (i < n) {
    const resta = xml.slice(i)
    // commento
    if (resta.startsWith('<!--')) {
      const fine = xml.indexOf('-->', i + 4)
      const stop = fine < 0 ? n : fine + 3
      push('commento', xml.slice(i, stop))
      i = stop
      continue
    }
    // CDATA
    if (resta.startsWith('<![CDATA[')) {
      const fine = xml.indexOf(']]>', i + 9)
      const stop = fine < 0 ? n : fine + 3
      push('cdata', xml.slice(i, stop))
      i = stop
      continue
    }
    // prologo <?xml … ?> o istruzione di processing
    if (resta.startsWith('<?')) {
      const fine = xml.indexOf('?>', i + 2)
      const stop = fine < 0 ? n : fine + 2
      push('prologo', xml.slice(i, stop))
      i = stop
      continue
    }
    // <!DOCTYPE …>
    if (resta.startsWith('<!')) {
      const fine = xml.indexOf('>', i + 2)
      const stop = fine < 0 ? n : fine + 1
      push('dichiarazione', xml.slice(i, stop))
      i = stop
      continue
    }
    // tag (apertura, chiusura, auto-chiusura)
    if (resta.startsWith('<')) {
      const fine = fineTag(xml, i)
      const grezzo = xml.slice(i, fine)
      tokenizzaTag(grezzo, push)
      i = fine
      continue
    }
    // testo fino al prossimo '<'
    const prossimo = xml.indexOf('<', i)
    const stop = prossimo < 0 ? n : prossimo
    push('testo', xml.slice(i, stop))
    i = stop
  }
  return out
}

/** True se il token è la punteggiatura che chiude un tag: `>` oppure `/>` (è un solo token). */
function chiudeTag(tok: TokenXml): boolean {
  return tok.tipo === 'tag' && (tok.testo === '>' || tok.testo === '/>')
}

/** Fine di un tag: la prima '>' che NON è dentro un valore fra apici. */
function fineTag(xml: string, inizio: number): number {
  let apice: string | null = null
  for (let i = inizio + 1; i < xml.length; i++) {
    const c = xml[i]
    if (apice) {
      if (c === apice) apice = null
      continue
    }
    if (c === '"' || c === "'") {
      apice = c
      continue
    }
    if (c === '>') return i + 1
  }
  return xml.length
}

/** Spezza un tag nei pezzi colorabili: punteggiatura, nome, attributi e valori. */
function tokenizzaTag(tag: string, push: (tipo: TipoTokenXml, testo: string) => void): void {
  // punteggiatura iniziale
  const mInizio = /^<\/?/.exec(tag)
  if (mInizio) {
    push('tag', mInizio[0])
    tag = tag.slice(mInizio[0].length)
  }
  // nome dell'elemento
  const mNome = /^[^\s/>]+/.exec(tag)
  if (mNome) {
    push('nome', mNome[0])
    tag = tag.slice(mNome[0].length)
  }
  // attributi + chiusura
  while (tag.length > 0) {
    const mSpazio = /^\s+/.exec(tag)
    if (mSpazio) {
      push('tag', mSpazio[0])
      tag = tag.slice(mSpazio[0].length)
      continue
    }
    const mChiusura = /^\/?>$/.exec(tag)
    if (mChiusura) {
      push('tag', mChiusura[0])
      tag = ''
      continue
    }
    const mAttr = /^([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/.exec(tag)
    if (mAttr) {
      push('attributo', mAttr[1])
      push('tag', '=')
      const valore = mAttr[3] ?? mAttr[4] ?? ''
      push('valore', '"' + valore + '"')
      tag = tag.slice(mAttr[0].length)
      continue
    }
    // resto imprevisto (tag malformato): lo si mostra così com'è
    push('tag', tag)
    tag = ''
  }
}

/**
 * Formatta (indenta) un XML: un elemento per riga, rientri di `passo` spazi.
 * - i tag che si chiudono da soli (`<x/>`) restano su una riga;
 * - il testo con contenuto va su una riga sua;
 * - commenti, CDATA e prologo su righe proprie;
 * - l'operazione è IDEMPOTENTE: riformattare un XML già formattato non cambia nulla.
 */
export function formattaXml(xml: string, passo = 2): string {
  const token = tokenizzaXml(xml.trim())
  const righe: string[] = []
  let livello = 0
  const rientro = () => ' '.repeat(Math.max(0, livello) * passo)

  for (let i = 0; i < token.length; i++) {
    const t = token[i]
    if (t.tipo === 'testo') {
      const pulito = t.testo.replace(/\s+/g, ' ').trim()
      if (pulito) righe.push(rientro() + pulito)
      continue
    }
    if (t.tipo !== 'tag' && t.tipo !== 'nome' && t.tipo !== 'attributo' && t.tipo !== 'valore') {
      // commento / cdata / prologo / dichiarazione: riga propria
      righe.push(rientro() + t.testo.trim())
      continue
    }
    // raccogli il tag intero (dai suoi token, che partono dalla '<')
    if (!(t.tipo === 'tag' && (t.testo === '<' || t.testo === '</'))) continue
    const pezzi: TokenXml[] = []
    let j = i
    while (j < token.length) {
      pezzi.push(token[j])
      if (chiudeTag(token[j])) break
      j++
    }
    const testoTag = pezzi.map(p => p.testo).join('').replace(/\s+/g, ' ').trim()
    const autoChiuso = testoTag.endsWith('/>')
    // elemento con SOLO TESTO (nessun figlio): resta su una riga, "«Nome»Mario Rossi«/Nome»" — è il
    // caso più comune nei dati XML e su due righe sarebbe molto meno leggibile
    if (!autoChiuso && t.testo === '<' && j + 2 < token.length) {
      const dopoTesto = token[j + 1]
      const dopoChiusura = token[j + 2]
      if (
        dopoTesto?.tipo === 'testo' &&
        dopoTesto.testo.trim() !== '' &&
        dopoChiusura?.tipo === 'tag' &&
        dopoChiusura.testo === '</'
      ) {
        const pezziChiusura: TokenXml[] = []
        let k = j + 2
        while (k < token.length) {
          pezziChiusura.push(token[k])
          if (chiudeTag(token[k])) break
          k++
        }
        const chiusura = pezziChiusura.map(x => x.testo).join('').replace(/\s+/g, ' ').trim()
        const testoPulito = dopoTesto.testo.replace(/\s+/g, ' ').trim()
        righe.push(rientro() + testoTag + testoPulito + chiusura)
        i = k
        continue
      }
    }
    if (t.testo === '</') {
      livello = Math.max(0, livello - 1)
      righe.push(rientro() + testoTag)
    } else {
      righe.push(rientro() + testoTag)
      if (!autoChiuso) livello++
    }
    i = j
  }
  return righe.join('\n')
}

/** Una riga di XML formattato spezzata nei pezzi colorabili. */
export function tokenPerRiga(riga: string): TokenXml[] {
  return tokenizzaXml(riga)
}

/** Quante volte `query` compare in `testo` (senza distinzione maiuscole/minuscole). */
export function contaOccorrenze(testo: string, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const t = testo.toLowerCase()
  let n = 0
  let i = t.indexOf(q)
  while (i >= 0) {
    n++
    i = t.indexOf(q, i + q.length)
  }
  return n
}

/**
 * Posizioni (numero di riga 1-based) delle righe che contengono la query: servono a "vai al
 * risultato successivo" dentro la scheda XML.
 */
export function righeConMatch(testo: string, query: string): number[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return testo
    .split('\n')
    .map((riga, i) => (riga.toLowerCase().includes(q) ? i + 1 : 0))
    .filter(r => r > 0)
}
