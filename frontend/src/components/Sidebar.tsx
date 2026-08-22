import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Database as DbIcon,
  Eye,
  ExternalLink,
  FileCode2,
  Flame,
  FolderOpen,
  Search,
  SquarePen,
  Table2,
  Zap,
} from 'lucide-react'
import type { ColumnInfo, DatabaseSummary, TableInfo } from '../types'
import { groupTablesByPrefix, qualified, sqlIdent, usageDetail } from '../helpers'
import { useDebounce } from '../hooks/useDebounce'
import { Badge, Spinner } from './ui'
import { ColumnHoverCard, TableHoverCard } from './HoverCards'
import type { HoverRect, HoverTarget } from './HoverCards'

interface Props {
  summary: DatabaseSummary | null
  loading: boolean
  activeDatabase: string
  onInsertText: (text: string) => void
  /** Apre la preview (SELECT TOP 100 *) in una nuova tab dell'editor. */
  onPreviewInEditor?: (sql: string) => void
  /** Apre una stored procedure / funzione: 'alter' genera ALTER, 'open' la definizione CREATE. */
  onOpenObject?: (kind: 'procedure' | 'function', schema: string, name: string, mode: 'alter' | 'open') => void
}

interface SearchHit {
  kind: string
  schema: string
  name: string
  detail?: string
}

export default function Sidebar({
  summary,
  loading,
  activeDatabase,
  onInsertText,
  onPreviewInEditor,
  onOpenObject,
}: Props) {
  const [query, setQuery] = useState('')
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    tables: true,
    views: true,
    procedures: true,
  })
  const [hover, setHover] = useState<HoverTarget | null>(null)
  const closeTimer = useRef<number | null>(null)
  // Tabelle: gruppi di prefisso e campi delle tabelle chiusi di default
  const [expandedTables, setExpandedTables] = useState<Set<string>>(() => new Set())
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set())

  const tableGroups = useMemo(
    () => (summary ? groupTablesByPrefix(summary.tables) : []),
    [summary],
  )

  const toggleTable = (key: string) =>
    setExpandedTables(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const toggleGroup = (key: string) =>
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    }
  }, [])

  const q = useDebounce(query.trim().toLowerCase(), 200)

  const clearCloseTimer = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const scheduleClose = () => {
    clearCloseTimer()
    closeTimer.current = window.setTimeout(() => setHover(null), 250)
  }

  const rectOf = (e: MouseEvent<HTMLElement>): HoverRect => {
    const r = e.currentTarget.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  }

  const hoverTable = (e: MouseEvent<HTMLElement>, table: TableInfo) => {
    clearCloseTimer()
    setHover({ kind: 'table', table, rect: rectOf(e) })
  }

  const hoverColumn = (e: MouseEvent<HTMLElement>, tableName: string, column: ColumnInfo) => {
    clearCloseTimer()
    setHover({ kind: 'column', tableName, column, rect: rectOf(e) })
  }

  const quickPreviewSql = (t: TableInfo) => `SELECT TOP 100 * FROM ${qualified(t.schema, t.name)};\n`

  const hits = useMemo<SearchHit[]>(() => {
    if (!summary || !q) return []
    const match = (schema: string, name: string) =>
      name.toLowerCase().includes(q) || schema.toLowerCase().includes(q)
    const out: SearchHit[] = []
    for (const t of summary.tables) if (match(t.schema, t.name)) out.push({ kind: 'tabella', schema: t.schema, name: t.name, detail: `${t.columnCount} col.` })
    for (const v of summary.views) if (match(v.schema, v.name)) out.push({ kind: 'vista', schema: v.schema, name: v.name })
    for (const p of summary.procedures) if (match(p.schema, p.name)) out.push({ kind: 'procedura', schema: p.schema, name: p.name })
    for (const f of summary.functions) if (match(f.schema, f.name)) out.push({ kind: 'funzione', schema: f.schema, name: f.name })
    for (const t of summary.triggers) if (match(t.schema, t.name)) out.push({ kind: 'trigger', schema: t.schema, name: t.name, detail: t.tableName })
    return out.slice(0, 100)
  }, [summary, q])

  const toggle = (key: string) => setOpenSections(s => ({ ...s, [key]: !s[key] }))

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500">
        <Spinner /> Caricamento metadati…
      </div>
    )
  }

  if (!summary) {
    return <div className="p-4 text-sm text-zinc-600">Metadati non disponibili.</div>
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-800 p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Cerca tabella, proc, vista…"
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 py-1.5 pl-8 pr-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-sky-500 focus:outline-none"
          />
        </div>
        {!q && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500">
            <DbIcon className="h-3.5 w-3.5 text-sky-500" />
            <span className="truncate">{activeDatabase}</span>
            <span className="ml-auto">{summary.databases.length} db</span>
          </div>
        )}
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto p-2"
        onScroll={() => {
          clearCloseTimer()
          setHover(null)
        }}
      >
        {q ? (
          <div className="space-y-0.5">
            {hits.length === 0 && <p className="p-3 text-sm text-zinc-600">Nessun oggetto trovato.</p>}
            {hits.map((h, i) => (
              <button
                key={`${h.kind}-${h.schema}-${h.name}-${i}`}
                onClick={() => onInsertText(qualified(h.schema, h.name))}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px] text-zinc-200 transition-colors hover:bg-zinc-800"
                title="Clicca per inserire nel editor"
              >
                <KindIcon kind={h.kind} />
                <span className="truncate font-mono">{h.name}</span>
                {h.schema !== 'dbo' && <span className="text-zinc-500">· {h.schema}</span>}
                <span className="ml-auto">
                  <Badge tone="zinc">{h.kind}</Badge>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            <Section
              title="Tabelle"
              icon={<Table2 className="h-4 w-4 text-sky-400" />}
              count={summary.tables.length}
              open={!!openSections.tables}
              onToggle={() => toggle('tables')}
            >
              {tableGroups.map(g => {
                const groupOpen = openGroups.has(g.key)
                return (
                  <div key={g.key}>
                    <button
                      onClick={() => toggleGroup(g.key)}
                      className="flex w-full items-center gap-1.5 rounded px-2 py-1 pl-2 text-left text-xs font-semibold text-zinc-400 transition-colors hover:bg-zinc-800/70 hover:text-zinc-200"
                    >
                      {groupOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      <span>{g.label}</span>
                      <span className="ml-auto rounded-full bg-zinc-800 px-1.5 text-[10px] text-zinc-400">
                        {g.tables.length}
                      </span>
                    </button>
                    {groupOpen && (
                      <div className="mt-0.5 space-y-0.5">
                        {g.tables.map(t => {
                          const tKey = `${t.schema}.${t.name}`
                          const expanded = expandedTables.has(tKey)
                          return (
                            <TableRow
                              key={tKey}
                              label={t.schema !== 'dbo' ? `${t.schema}.${t.name}` : t.name}
                              badge={`${t.columnCount}`}
                              usageText={usageDetail(t.usage)}
                              expanded={expanded}
                              onToggleExpand={() => toggleTable(tKey)}
                              onInsert={() => onInsertText(qualified(t.schema, t.name))}
                              onHover={e => hoverTable(e, t)}
                              onHoverLeave={scheduleClose}
                              onQuickPreview={onPreviewInEditor ? () => onPreviewInEditor(quickPreviewSql(t)) : undefined}
                            >
                              {expanded &&
                                t.columns?.map(c => (
                                  <button
                                    key={c.name}
                                    onClick={() => onInsertText(sqlIdent(c.name))}
                                    onMouseEnter={e => hoverColumn(e, t.name, c)}
                                    onMouseLeave={scheduleClose}
                                    className="flex w-full items-center gap-2 rounded px-2 py-0.5 pl-10 text-left text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                                    title={`${c.dataType}${c.isNullable ? ' NULL' : ''}${c.isIdentity ? ' IDENTITY' : ''}`}
                                  >
                                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.isIdentity ? 'bg-amber-400' : c.isNullable ? 'bg-zinc-600' : 'bg-emerald-500'}`} />
                                    <span className="truncate font-mono">{c.name}</span>
                                    <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-600">{c.dataType}</span>
                                  </button>
                                ))}
                            </TableRow>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </Section>

            <Section
              title="Viste"
              icon={<Eye className="h-4 w-4 text-violet-400" />}
              count={summary.views.length}
              open={!!openSections.views}
              onToggle={() => toggle('views')}
            >
              {summary.views.map(v => (
                <ObjectRow
                  key={`${v.schema}.${v.name}`}
                  label={v.schema !== 'dbo' ? `${v.schema}.${v.name}` : v.name}
                  onInsert={() => onInsertText(qualified(v.schema, v.name))}
                />
              ))}
            </Section>

            <Section
              title="Stored Procedure"
              icon={<FileCode2 className="h-4 w-4 text-emerald-400" />}
              count={summary.procedures.length}
              open={!!openSections.procedures}
              onToggle={() => toggle('procedures')}
            >
              {summary.procedures.map(p => (
                <ObjectRow
                  key={`${p.schema}.${p.name}`}
                  label={p.schema !== 'dbo' ? `${p.schema}.${p.name}` : p.name}
                  onInsert={() => onInsertText(qualified(p.schema, p.name))}
                >
                  {p.parameters?.map(par => (
                    <div key={par.name} className="flex items-center gap-2 py-0.5 pl-7 text-xs text-zinc-500">
                      <span className="font-mono text-zinc-400">@{par.name}</span>
                      <span className="font-mono text-[10px] text-zinc-600">
                        {par.dataType} {par.mode}
                      </span>
                    </div>
                  ))}
                  <ObjectActions
                    onAlter={() => onOpenObject?.('procedure', p.schema, p.name, 'alter')}
                    onOpen={() => onOpenObject?.('procedure', p.schema, p.name, 'open')}
                  />
                </ObjectRow>
              ))}
            </Section>

            <Section
              title="Funzioni"
              icon={<Zap className="h-4 w-4 text-amber-400" />}
              count={summary.functions.length}
              open={!!openSections.functions}
              onToggle={() => toggle('functions')}
            >
              {summary.functions.map(f => (
                <ObjectRow
                  key={`${f.schema}.${f.name}`}
                  label={f.schema !== 'dbo' ? `${f.schema}.${f.name}` : f.name}
                  onInsert={() => onInsertText(qualified(f.schema, f.name))}
                >
                  <ObjectActions
                    onAlter={() => onOpenObject?.('function', f.schema, f.name, 'alter')}
                    onOpen={() => onOpenObject?.('function', f.schema, f.name, 'open')}
                  />
                </ObjectRow>
              ))}
            </Section>

            <Section
              title="Trigger"
              icon={<Flame className="h-4 w-4 text-rose-400" />}
              count={summary.triggers.length}
              open={!!openSections.triggers}
              onToggle={() => toggle('triggers')}
            >
              {summary.triggers.map(t => (
                <ObjectRow
                  key={`${t.schema}.${t.tableName}.${t.name}`}
                  label={t.name}
                  detail={t.schema !== 'dbo' ? `${t.schema}.${t.tableName}` : t.tableName}
                  onInsert={() => onInsertText(qualified(t.schema, t.name))}
                />
              ))}
            </Section>

            <Section
              title="Database"
              icon={<DbIcon className="h-4 w-4 text-zinc-400" />}
              count={summary.databases.length}
              open={!!openSections.databases}
              onToggle={() => toggle('databases')}
            >
              {summary.databases.map(d => (
                <div
                  key={d.name}
                  className={`flex items-center gap-2 px-2 py-0.5 pl-7 text-xs ${
                    d.name === activeDatabase ? 'text-sky-300' : 'text-zinc-500'
                  }`}
                >
                  <span className="truncate font-mono">{d.name}</span>
                  {d.name === activeDatabase && <Badge tone="sky">attivo</Badge>}
                </div>
              ))}
            </Section>
          </div>
        )}
      </div>

      {hover?.kind === 'table' && (
        <TableHoverCard
          table={hover.table}
          rect={hover.rect}
          onHoverEnter={clearCloseTimer}
          onHoverLeave={scheduleClose}
          onOpenInEditor={onPreviewInEditor}
        />
      )}
      {hover?.kind === 'column' && (
        <ColumnHoverCard
          tableName={hover.tableName}
          column={hover.column}
          rect={hover.rect}
          onHoverEnter={clearCloseTimer}
          onHoverLeave={scheduleClose}
        />
      )}
    </div>
  )
}

function Section({
  title,
  icon,
  count,
  open,
  onToggle,
  children,
}: {
  title: string
  icon: ReactNode
  count: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-400 transition-colors hover:bg-zinc-800/70 hover:text-zinc-200"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        {icon}
        <span>{title}</span>
        <span className="ml-auto rounded-full bg-zinc-800 px-1.5 text-[10px] text-zinc-400">{count}</span>
      </button>
      {open && <div className="mt-0.5 space-y-0.5">{children}</div>}
    </div>
  )
}

function ObjectRow({
  label,
  detail,
  onInsert,
  children,
}: {
  label: string
  detail?: string
  onInsert: () => void
  children?: ReactNode
}) {
  return (
    <div>
      <button
        onClick={onInsert}
        className="flex w-full items-center gap-2 rounded px-2 py-1 pl-7 text-left text-[13px] text-zinc-200 transition-colors hover:bg-zinc-800"
        title="Clicca per inserire nel editor"
      >
        <span className="truncate font-mono">{label}</span>
        {detail && <span className="truncate text-[11px] text-zinc-500">{detail}</span>}
      </button>
      {children}
    </div>
  )
}

function TableRow({
  label,
  badge,
  usageText,
  expanded,
  onToggleExpand,
  onInsert,
  onHover,
  onHoverLeave,
  onQuickPreview,
  children,
}: {
  label: string
  badge?: string
  usageText?: string
  expanded: boolean
  onToggleExpand: () => void
  onInsert: () => void
  onHover: (e: MouseEvent<HTMLElement>) => void
  onHoverLeave: () => void
  onQuickPreview?: () => void
  children?: ReactNode
}) {
  return (
    <div className="group">
      <div className="flex items-center">
        <button
          onClick={onToggleExpand}
          className="shrink-0 rounded p-1 pl-4 text-zinc-500 transition-colors hover:text-zinc-300"
          title={expanded ? 'Chiudi i campi' : 'Mostra i campi'}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={onInsert}
          onMouseEnter={onHover}
          onMouseLeave={onHoverLeave}
          className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-[13px] text-zinc-200 transition-colors hover:bg-zinc-800"
          title={usageText ? `${usageText} — clicca per inserire, passa sopra per l'anteprima` : 'Passa sopra per l\'anteprima dati, clicca per inserire'}
        >
          <span className="truncate font-mono">{label}</span>
          {badge && <span className="ml-auto shrink-0 rounded bg-zinc-800 px-1 text-[10px] text-zinc-500">{badge}</span>}
        </button>
        {onQuickPreview && (
          <button
            onClick={onQuickPreview}
            onMouseEnter={onHover}
            onMouseLeave={onHoverLeave}
            className="mr-1 shrink-0 rounded p-1 text-zinc-600 opacity-0 transition-all hover:bg-sky-950 hover:text-sky-300 group-hover:opacity-100"
            title="Esegui SELECT TOP 100 * (griglia risultati)"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {expanded && children}
    </div>
  )
}

/** Azioni su stored procedure e funzioni: Alter (genera ALTER) e Apri (definizione in nuova tab). */
function ObjectActions({ onAlter, onOpen }: { onAlter: () => void; onOpen: () => void }) {
  return (
    <div className="flex items-center justify-end gap-1 px-2 pb-1">
      <button
        onClick={onAlter}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-amber-300/90 transition-colors hover:bg-amber-950/60 hover:text-amber-200"
        title="Genera ALTER PROCEDURE/FUNCTION in una nuova tab"
      >
        <SquarePen className="h-3 w-3" /> Alter
      </button>
      <button
        onClick={onOpen}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-sky-300/90 transition-colors hover:bg-sky-950/60 hover:text-sky-200"
        title="Apri la definizione in una nuova tab"
      >
        <ExternalLink className="h-3 w-3" /> Apri
      </button>
    </div>
  )
}

function KindIcon({ kind }: { kind: string }) {
  switch (kind) {
    case 'tabella':
      return <Table2 className="h-3.5 w-3.5 shrink-0 text-sky-400" />
    case 'vista':
      return <Eye className="h-3.5 w-3.5 shrink-0 text-violet-400" />
    case 'procedura':
      return <FileCode2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
    case 'funzione':
      return <Zap className="h-3.5 w-3.5 shrink-0 text-amber-400" />
    default:
      return <Flame className="h-3.5 w-3.5 shrink-0 text-rose-400" />
  }
}
