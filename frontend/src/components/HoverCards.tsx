import { Play, X } from 'lucide-react'
import { qualified, sqlIdent, usageDetail } from '../helpers'
import type { ColumnInfo, ExtendedProperty, TableInfo } from '../types'
import { Badge } from './ui'

export interface HoverRect {
  left: number
  top: number
  width: number
  height: number
}

export type HoverTarget =
  | { kind: 'table'; table: TableInfo; rect: HoverRect }
  | { kind: 'column'; tableName: string; column: ColumnInfo; rect: HoverRect }

const POPUP_WIDTH = 460
const POPUP_HEIGHT = 420

function cardStyle(rect: HoverRect) {
  let left = rect.left + rect.width + 10
  if (left + POPUP_WIDTH > window.innerWidth - 8) left = Math.max(8, rect.left - POPUP_WIDTH - 10)
  const top = Math.min(Math.max(8, rect.top), Math.max(8, window.innerHeight - POPUP_HEIGHT - 8))
  return { left, top } as const
}

export function TableHoverCard({
  table,
  rect,
  onHoverEnter,
  onHoverLeave,
  onOpenInEditor,
}: {
  table: TableInfo
  rect: HoverRect
  onHoverEnter: () => void
  onHoverLeave: () => void
  /** Apre la query di anteprima (SELECT TOP 100 *) in una nuova tab dell'editor. */
  onOpenInEditor?: (sql: string) => void
}) {
  const pos = cardStyle(rect)
  const tableProps: ExtendedProperty[] = table.extendedProperties ?? []

  return (
    <div
      className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
      style={{ left: pos.left, top: pos.top, width: POPUP_WIDTH, maxHeight: POPUP_HEIGHT }}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-3 py-2">
        <span className="truncate font-mono text-sm font-semibold text-sky-300">
          {qualified(table.schema, table.name)}
        </span>
        {table.usage && (
          <span className="shrink-0 text-[11px] text-zinc-500">{usageDetail(table.usage)}</span>
        )}
        <Badge tone="zinc" className="shrink-0">
          {table.columnCount} col.
        </Badge>
        <button
          onClick={onHoverLeave}
          className="ml-auto shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          title="Chiudi"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {tableProps.length === 0 ? (
          <div className="py-2 text-xs text-zinc-600">Nessuna proprietà estesa definita per la tabella.</div>
        ) : (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Proprietà estese ({tableProps.length})
            </div>
            {tableProps.map(p => (
              <div key={p.name} className="border-b border-zinc-800/60 py-1.5">
                <div className="text-xs font-semibold text-amber-300/90">{p.name}</div>
                <div className="mt-0.5 text-xs whitespace-pre-wrap text-zinc-300">{p.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-zinc-800 bg-zinc-900 px-3 py-2">
        <span className="text-[11px] text-zinc-500">Anteprima dati nell'editor</span>
        <button
          onClick={() => {
            onHoverLeave()
            onOpenInEditor?.(`SELECT TOP 100 * FROM ${qualified(table.schema, table.name)};\n`)
          }}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-sky-500"
          title="Apre SELECT TOP 100 * in una nuova tab dell'editor"
        >
          <Play className="h-3.5 w-3.5" /> Apri nell'editor
        </button>
      </div>
    </div>
  )
}

export function ColumnHoverCard({
  tableName,
  column,
  rect,
  onHoverEnter,
  onHoverLeave,
}: {
  tableName: string
  column: ColumnInfo
  rect: HoverRect
  onHoverEnter: () => void
  onHoverLeave: () => void
}) {
  const pos = cardStyle(rect)
  const props: ExtendedProperty[] = column.extendedProperties ?? []

  return (
    <div
      className="fixed z-50 flex w-96 flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
      style={{ left: pos.left, top: pos.top, maxHeight: POPUP_HEIGHT }}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <span className="truncate font-mono text-sm font-semibold text-emerald-300">
          {sqlIdent(tableName)}.{sqlIdent(column.name)}
        </span>
        <Badge tone="sky" className="shrink-0">
          {column.dataType}
          {column.maxLength !== null && column.maxLength > 0 ? `(${column.maxLength})` : ''}
        </Badge>
        <button
          onClick={onHoverLeave}
          className="ml-auto shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          title="Chiudi"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-zinc-800 px-3 py-2">
        {column.isIdentity && <Badge tone="amber">IDENTITY</Badge>}
        {column.isComputed && <Badge tone="violet">COMPUTED</Badge>}
        {column.isNullable ? <Badge tone="zinc">NULL</Badge> : <Badge tone="emerald">NOT NULL</Badge>}
      </div>

      {column.description && (
        <div className="border-b border-zinc-800 bg-zinc-950/60 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Descrizione</div>
          <div className="mt-0.5 text-xs whitespace-pre-wrap text-zinc-300">{column.description}</div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {props.length === 0 ? (
          <div className="py-2 text-xs text-zinc-600">
            Nessuna proprietà estesa definita per questa colonna.
          </div>
        ) : (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Proprietà estese ({props.length})
            </div>
            {props.map(p => (
              <div key={p.name} className="border-b border-zinc-800/60 py-1.5">
                <div className="text-xs font-semibold text-amber-300/90">{p.name}</div>
                <div className="mt-0.5 text-xs whitespace-pre-wrap text-zinc-300">{p.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
