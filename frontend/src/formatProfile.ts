// Parser e serializer del profilo di formattazione T-SQL (formato Redgate FormatProfile).
// L'albero generico permette round-trip fedele: si può editare un'opzione, importare
// un file XML ed esportarlo di nuovo senza perdere le opzioni non gestite dalla UI.

import { DEFAULT_FORMAT_PROFILE_XML } from './formatProfileDefault'

/** Nodo generico dell'albero XML (PropertyValue / SubOptions). */
export interface FormatProfileNode {
  name: string
  attrs: Record<string, string>
  /** Testo per i PropertyValue (o per i SubOptions vuoti). */
  text?: string
  children?: FormatProfileNode[]
}

const STORAGE_KEY = 'sql-intelli:format-profile'

// ---------- Parser XML minimale (niente DOMParser: funziona anche in node) ----------

const TAG_RE = /^([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z][A-Za-z0-9]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/)?$/
const ATTR_RE = /([A-Za-z][A-Za-z0-9]*)\s*=\s*("([^"]*)"|'([^']*)')/g

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of raw.matchAll(ATTR_RE)) out[m[1]] = m[3] ?? m[4] ?? ''
  return out
}

/** Parsa l'XML FormatProfile in un albero di nodi. */
export function parseFormatProfileXml(xml: string): FormatProfileNode[] {
  // normalizza e rimuove la dichiarazione xml
  const clean = xml.replace(/^\s*<\?xml[^>]*\?>\s*/, '')
  const stack: FormatProfileNode[] = []
  const roots: FormatProfileNode[] = []
  let pos = 0
  const n = clean.length
  while (pos < n) {
    const tagStart = clean.indexOf('<', pos)
    if (tagStart === -1) break
    // testo prima del tag (solo se dentro un nodo che accetta testo)
    if (tagStart > pos && stack.length > 0) {
      const text = clean.slice(pos, tagStart).trim()
      if (text && !stack[stack.length - 1].text) stack[stack.length - 1].text = text
    }
    const tagEnd = clean.indexOf('>', tagStart)
    if (tagEnd === -1) break
    const rawTag = clean.slice(tagStart + 1, tagEnd)
    if (rawTag.startsWith('/')) {
      // chiusura
      stack.pop()
      pos = tagEnd + 1
      continue
    }
    if (rawTag.startsWith('!') || rawTag.startsWith('?')) {
      pos = tagEnd + 1
      continue
    }
    TAG_RE.lastIndex = 0
    const m = TAG_RE.exec(rawTag)
    if (!m) {
      pos = tagEnd + 1
      continue
    }
    const node: FormatProfileNode = { name: m[1], attrs: parseAttrs(m[2]) }
    if (m[3] === '/') {
      // self-closing
      if (stack.length > 0) (stack[stack.length - 1].children ??= []).push(node)
      else roots.push(node)
      pos = tagEnd + 1
      continue
    }
    if (stack.length > 0) (stack[stack.length - 1].children ??= []).push(node)
    else roots.push(node)
    stack.push(node)
    pos = tagEnd + 1
  }
  return roots
}

/** Serializza l'albero in XML con indentazione a 2 spazi (stile Redgate). */
export function serializeFormatProfile(nodes: FormatProfileNode[]): string {
  const lines: string[] = ['<?xml version="1.0" encoding="utf-8"?>', '<FormatProfile>', '  <FormatOptions>']
  const walk = (list: FormatProfileNode[], depth: number) => {
    for (const node of list) {
      const pad = '  '.repeat(depth)
      const attrs = Object.entries(node.attrs)
        .map(([k, v]) => ` ${k}="${v.replace(/"/g, '&quot;')}"`)
        .join('')
      if (node.children?.length) {
        lines.push(`${pad}<${node.name}${attrs}>`)
        walk(node.children, depth + 1)
        lines.push(`${pad}</${node.name}>`)
      } else if (node.text !== undefined) {
        lines.push(`${pad}<${node.name}${attrs}>${node.text}</${node.name}>`)
      } else {
        lines.push(`${pad}<${node.name}${attrs} />`)
      }
    }
  }
  walk(nodes, 2)
  lines.push('  </FormatOptions>', '</FormatProfile>')
  return lines.join('\n')
}

// ---------- Accesso piatto alle opzioni (path.Name → valore) ----------

/** Estrae la mappa piatta "NomeOpzione" → valore testo (i SubOptions annidati diventano "SubName_Name"). */
export function flattenFormatOptions(nodes: FormatProfileNode[]): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (list: FormatProfileNode[], prefix: string) => {
    for (const node of list) {
      // la chiave è l'attributo Name (es. "Select_From_LineBreakBeforeFrom");
      // i nodi senza Name (FormatProfile/FormatOptions) non aggiungono prefisso
      const key = node.attrs.Name ?? node.name
      const fullKey = prefix ? `${prefix}_${key}` : key
      if (node.text !== undefined) out.set(fullKey, node.text.trim())
      if (node.children) walk(node.children, node.attrs.Name ? fullKey : prefix)
    }
  }
  walk(nodes, '')
  return out
}

/** Imposta un'opzione (path) nell'albero: crea il PropertyValue se manca. */
export function setFormatOption(nodes: FormatProfileNode[], path: string, value: string): void {
  const parts = path.split('_')
  let list = nodes
  for (let i = 0; i < parts.length; i++) {
    const name = parts[i]
    const isLast = i === parts.length - 1
    let node = list.find(x => x.attrs.Name === name)
    if (!node) {
      node = { name: isLast ? 'PropertyValue' : 'SubOptions', attrs: { Name: name } }
      list.push(node)
    }
    if (isLast) {
      node.text = value
      node.children = undefined
      return
    }
    node.children ??= []
    list = node.children
  }
}

// ---------- Persistenza localStorage ----------

/** Profilo XML salvato (o quello di default). */
export function loadFormatProfileXml(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved || DEFAULT_FORMAT_PROFILE_XML
  } catch {
    return DEFAULT_FORMAT_PROFILE_XML
  }
}

export function saveFormatProfileXml(xml: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, xml)
  } catch {
    /* storage non disponibile */
  }
}

export function resetFormatProfileXml(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignora */
  }
}

// ---------- Helper tipizzati per il formattatore ----------

export interface FormatProfile {
  /** true se la query corta va lasciata su una riga. */
  singleLineShort: boolean
  singleLineMaxChars: number
  singleLineMaxWords: number
  /** A capo prima delle clausole principali. */
  breakBeforeFrom: boolean
  breakBeforeJoin: boolean
  breakBeforeOn: boolean
  breakBeforeWhere: boolean
  breakBeforeGroupBy: boolean
  breakBeforeHaving: boolean
  breakBeforeOrderBy: boolean
  breakBeforeUnion: boolean
  /** A capo prima di INTO (SELECT ... INTO) e prima di AND/OR nelle condizioni. */
  breakBeforeInto: boolean
  breakBeforeAnd: boolean
  breakBeforeOr: boolean
  /** Select list su righe separate (stack) con indentazione. */
  stackSelectColumns: boolean
  selectColumnIndent: number
  /** Indentazioni delle clausole. */
  joinIndent: number
  whereConditionIndent: number
  orderByIndent: number
  /** INSERT. */
  insertBraceLines: boolean
  insertValuesLines: boolean
  /** UPDATE. */
  breakBeforeSet: boolean
  setIndent: number
  /** Case. */
  keywordUpper: boolean
  dataTypeUpper: boolean
  /** Spaziatura. */
  spaceAfterComma: boolean
  /** Dimensioni indentazione (spazi per livello). */
  tabSize: number
}

/** Costruisce la configurazione tipizzata del formattatore dalla mappa piatta del profilo. */
export function buildFormatProfile(xml: string): FormatProfile {
  const opt = flattenFormatOptions(parseFormatProfileXml(xml))
  const bool = (key: string, def = false) => {
    const v = opt.get(key)
    if (v === undefined) return def
    return v.toLowerCase() === 'true'
  }
  const num = (key: string, def: number) => {
    const v = opt.get(key)
    const parsed = v === undefined ? NaN : Number(v)
    return Number.isFinite(parsed) ? parsed : def
  }
  const caseNum = (key: string, def: number) => {
    const v = opt.get(key)
    return v === undefined ? def : Number(v)
  }
  return {
    singleLineShort: bool('Select_SingleLine_WhenRightMarginIsNotExceeded', true),
    singleLineMaxChars: num('Select_SingleLine_WhenQueryIsShorterThanXCharacters_Value', 50),
    singleLineMaxWords: num('Select_SingleLine_WhenQueryContainsLessThanXWords_Value', 30),
    breakBeforeFrom: bool('Select_From_LineBreakBeforeFrom', true),
    breakBeforeJoin: bool('Select_From_Join_LineBreakBeforeJoin', true),
    breakBeforeOn: bool('Select_From_Join_LineBreakBeforeOn', false),
    breakBeforeWhere: bool('Select_Where_LineBreakBeforeWhere', true),
    breakBeforeGroupBy: bool('Select_GroupBy_LineBreakBeforeGroup', true),
    breakBeforeHaving: bool('Select_Having_LineBreakBeforeHaving', true),
    breakBeforeOrderBy: bool('Select_OrderBy_LineBreakBeforeOrder', true),
    breakBeforeUnion: bool('UnionExceptIntersect_LineBreakBeforeUnion', true),
    breakBeforeInto: bool('Select_Into_LineBreakBeforeInto', true),
    breakBeforeAnd: bool('Select_Where_LineBreakBeforeAnd', true),
    breakBeforeOr: bool('Select_Where_LineBreakBeforeOr', true),
    stackSelectColumns: bool('Select_SelectList_StackColumns', true),
    selectColumnIndent: num('Select_SelectList_IndentColumnList_Size', 3),
    joinIndent: num('Select_From_Join_IndentJoinKeyword_Size', 2),
    whereConditionIndent: num('Select_Where_IndentWhereCondition_Size', 6),
    orderByIndent: num('Select_OrderBy_IndentOrderByPhrase_Size', 1),
    insertBraceLines: bool('Insert_ColumnList_LineBreakBeforeOpenBrace', true),
    insertValuesLines: bool('Insert_Values_LineBreakBeforeValues', true),
    breakBeforeSet: bool('Update_SetClause_LineBreakBeforeSet', true),
    setIndent: num('Update_SetClause_IndentSetKeyword_Size', 2),
    keywordUpper: caseNum('TextCase_Keyword', 1) === 1,
    dataTypeUpper: caseNum('TextCase_DataType', 1) === 1,
    spaceAfterComma: bool('Spacing_Delimiters_InsertSpaceAfterComma', true),
    tabSize: 2,
  }
}

/** API pubbliche di convenienza (per la UI e i test). */
export const formatProfileApi = {
  parse: parseFormatProfileXml,
  serialize: serializeFormatProfile,
  flatten: flattenFormatOptions,
  set: setFormatOption,
  build: buildFormatProfile,
  load: loadFormatProfileXml,
  save: saveFormatProfileXml,
  reset: resetFormatProfileXml,
  defaultXml: DEFAULT_FORMAT_PROFILE_XML,
}
