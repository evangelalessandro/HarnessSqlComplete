// Hover nell'editor: passando il mouse su un campo mostra tipo, flag, descrizione
// e proprietà estese; su un NOME TABELLA mostra anche l'anteprima dei dati (TOP 10),
// caricata in modo asincrono (cache con TTL breve).
import * as monaco from 'monaco-editor'
import { api } from './api'
import { columnInfoMarkdown, resolveTokenAt, rowsToMarkdown, tokenizeSql } from './helpers'
import type { DatabaseSummary } from './types'

export interface HoverContext {
  summary: DatabaseSummary | null
  connectionId: string | null
  /** Chiamato quando l'hover risolve un NOME TABELLA (per il pulsante "apri anteprima"). */
  onTableHover?: (schema: string, table: string) => void
}

// Cache delle anteprime per tabella (TTL 30 s) per non interrogare il DB a ogni movimento
const previewCache = new Map<string, { at: number; md: string | null }>()
const PREVIEW_TTL_MS = 30_000

export function registerSqlHover(getContext: () => HoverContext): monaco.IDisposable {
  return monaco.languages.registerHoverProvider('sql', {
    provideHover: async (model, position) => {
      const ctx = getContext()
      const summary = ctx?.summary
      if (!summary) return null

      const offset = model.getOffsetAt(position)
      const text = model.getValue()
      const resolved = resolveTokenAt(text, offset, summary)
      if (!resolved) return null

      const md = columnInfoMarkdown(resolved.table, resolved.column, resolved.owners)
      const contents: monaco.IMarkdownString[] = [{ value: md }]

      // Anteprima dati solo sui NOMI TABELLA (non sulle colonne)
      if (resolved.kind === 'table' && ctx.connectionId) {
        // per il pulsante cliccabile nella tooltip (azione sqlIntelli.openPreview)
        ctx.onTableHover?.(resolved.table.schema, resolved.table.name)
        const key = `${resolved.table.schema}.${resolved.table.name}`
        const cached = previewCache.get(key)
        if (cached && Date.now() - cached.at < PREVIEW_TTL_MS) {
          if (cached.md) contents.push({ value: cached.md, isTrusted: true })
        } else {
          try {
            const preview = await api.previewTable(ctx.connectionId, resolved.table.schema, resolved.table.name, 10)
            const set = preview.resultSets?.[0]
            let mdTable: string | null = null
            if (preview.error) {
              mdTable = `_Anteprima non disponibile: ${preview.error}_`
            } else if (set && set.columns.length > 0) {
              mdTable = `---\n\n### 🔍 Anteprima dati\n\n${rowsToMarkdown(
                set.columns.map(c => c.name),
                set.rows,
                10,
              )}\n\n[🔍 Apri anteprima completa](command:sqlIntelli.openPreview) · _oppure premi **F4**_`
            }
            previewCache.set(key, { at: Date.now(), md: mdTable })
            // isTrusted: true → i link command: nella tooltip sono cliccabili
            if (mdTable) contents.push({ value: mdTable, isTrusted: true })
          } catch {
            /* hover senza anteprima */
          }
        }
      }

      const token = tokenizeSql(text).find(t => t.start <= offset && offset < t.end)
      const range = token
        ? new monaco.Range(
            model.getPositionAt(token.start).lineNumber,
            model.getPositionAt(token.start).column,
            model.getPositionAt(Math.max(token.start, token.end - 1)).lineNumber,
            model.getPositionAt(Math.max(token.start, token.end - 1)).column + 1,
          )
        : undefined

      return { contents, range }
    },
  })
}
