// GENERATORE SQL dai risultati (INSERT/UPDATE/MERGE/DELETE/INSERT INTO #):
// caselle di selezione su righe e colonne, tabella target editabile e anteprima dello
// statement. Il disegno della griglia sta in ResultDataTable, condiviso con la vista
// normale dei risultati (numero di riga, linee delle colonne, tre colori alternati,
// colonne spostabili).
import { useEffect, useMemo, useState } from 'react'
import { ClipboardCopy } from 'lucide-react'
import {
  buildDeleteSql,
  buildInsertIntoTempSql,
  buildInsertSql,
  buildMergeSql,
  buildUpdateSql,
  chiaveTabella,
  chiaviDellaTabella,
  parseTargetTable,
} from '../sqlGen'
import type { GenColumn } from '../sqlGen'
import type { CellValue, DatabaseSummary } from '../types'
import { Button } from './ui'
import ResultDataTable from './ResultDataTable'
import type { ResultColumnSpec } from './ResultDataTable'

export type { ResultColumnSpec }

type GenKind = 'INSERT' | 'UPDATE' | 'MERGE' | 'DELETE' | 'INSERT#'

interface Props {
  columns: ResultColumnSpec[]
  rows: CellValue[][]
  /** Tabella target iniziale ("schema.tabella") per gli statement; editabile. */
  initialTarget?: string
  /** Nomi delle colonne identity (chiave del MERGE/DELETE). */
  identityColumns?: string[]
  /**
   * Colonne CHIAVE della tabella (primary key, anche COMPOSITA): sono quelle della condizione ON
   * della MERGE e non finiscono MAI nell'UPDATE SET. Se assenti si usano le identity.
   */
  keyColumns?: string[]
  /**
   * Schema caricato: se c'è, la chiave e le identity si ricavano dalla tabella target SCRITTA NEL
   * GENERATORE (anche se l'utente la cambia a mano), così la MERGE usa TUTTE le colonne della
   * primary key composita — richiesta utente: "quando fai la merge, la chiave potrebbe essere
   * multipla".
   */
  summary?: DatabaseSummary | null
  /** Numero della prima riga mostrata (paginazione). Default 1. */
  firstRowNumber?: number
}

export default function SelectableResultGrid({
  columns,
  rows,
  initialTarget,
  identityColumns,
  keyColumns,
  summary,
  firstRowNumber = 1,
}: Props) {
  const [targetTable, setTargetTable] = useState(initialTarget ?? '')
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [selectedCols, setSelectedCols] = useState<Set<number>>(new Set())
  const [kind, setKind] = useState<GenKind>('INSERT')
  const [tempName, setTempName] = useState('')
  const [copied, setCopied] = useState(false)
  /** Menu del tasto destro sullo script generato (richiesta utente: "Copia" anche col tasto destro). */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  /** Chiave e identity della tabella target corrente (dallo schema, se disponibile). */
  const chiaviTarget = useMemo(() => {
    const dalSchema = chiaviDellaTabella(summary, targetTable)
    return {
      keyColumns: dalSchema.keyColumns.length > 0 ? dalSchema.keyColumns : (keyColumns ?? []),
      identityColumns:
        dalSchema.identityColumns.length > 0 ? dalSchema.identityColumns : (identityColumns ?? []),
    }
  }, [summary, targetTable, keyColumns, identityColumns])

  // quando cambiano le colonne (nuova query): tutte selezionate di default, righe vuote
  useEffect(() => {
    setSelectedCols(new Set(columns.map((_, i) => i)))
    setSelectedRows(new Set())
    setTempName(`#${initialTarget?.split('.').pop() ?? 'tmp'}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, initialTarget])

  const genColumns: GenColumn[] = useMemo(
    () =>
      columns.map(c => ({
        name: c.name,
        dataType: c.dataType,
        isIdentity: chiaviTarget.identityColumns.includes(c.name),
      })),
    [columns, chiaviTarget],
  )

  const selColIndexes = useMemo(() => [...selectedCols].sort((a, b) => a - b), [selectedCols])
  const selCols: GenColumn[] = selColIndexes.map(i => genColumns[i]).filter(Boolean)
  const selRows = useMemo(
    () => [...selectedRows].sort((a, b) => a - b).map(i => rows[i]).filter(Boolean),
    [selectedRows, rows],
  )
  const { schema, table } = parseTargetTable(targetTable)

  const output = useMemo(() => {
    if (!table || selCols.length === 0 || selRows.length === 0) return ''
    // chiave: TUTTE le colonne della primary key della tabella target (anche composita),
    // altrimenti le identity
    const keys = chiaveTabella(genColumns, chiaviTarget.keyColumns.length > 0 ? chiaviTarget.keyColumns : chiaviTarget.identityColumns)
    try {
      switch (kind) {
        case 'INSERT':
          return buildInsertSql(schema, table, selCols, selRows)
        case 'UPDATE':
          return selRows.map(r => buildUpdateSql(schema, table, genColumns, selColIndexes, r)).join('\n\n')
        case 'MERGE':
          return buildMergeSql(schema, table, selCols, selRows, keys.length ? keys : undefined)
        case 'DELETE':
          return selRows
            .map(r => buildDeleteSql(schema, table, genColumns, keys.length ? keys : undefined, r))
            .join('\n\n')
        case 'INSERT#': {
          const name = tempName.trim().startsWith('#') ? tempName.trim() : `#${tempName.trim()}`
          return buildInsertIntoTempSql(name, selCols, selRows)
        }
      }
    } catch {
      return ''
    }
    return ''
  }, [kind, table, schema, selCols, selRows, genColumns, selColIndexes, tempName])

  const toggleRow = (i: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }
  const toggleCol = (i: number) => {
    setSelectedCols(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }
  const toggleAllRows = () => {
    setSelectedRows(prev => (prev.size === rows.length ? new Set() : new Set(rows.map((_, i) => i))))
  }
  const copy = async () => {
    if (!output) return
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard non disponibile */
    }
  }

  // il menu del tasto destro si chiude cliccando altrove, con un altro tasto destro o con Esc
  useEffect(() => {
    if (!menu) return
    const chiudi = () => setMenu(null)
    const tasto = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('click', chiudi)
    window.addEventListener('contextmenu', chiudi)
    window.addEventListener('keydown', tasto)
    return () => {
      window.removeEventListener('click', chiudi)
      window.removeEventListener('contextmenu', chiudi)
      window.removeEventListener('keydown', tasto)
    }
  }, [menu])

  const selectedCount = selRows.length
  const canGenerate = table.trim() !== '' && selCols.length > 0 && selRows.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {columns.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">Nessun dato.</div>
        ) : (
          <ResultDataTable
            columns={columns}
            rows={rows}
            firstRowNumber={firstRowNumber}
            rowSelection={{ selected: selectedRows, onToggle: toggleRow, onToggleAll: toggleAllRows }}
            colSelection={{ selected: selectedCols, onToggle: toggleCol }}
          />
        )}
      </div>

      {/* Barra generatore */}
      <div
        data-generatore="barra"
        className="flex flex-wrap items-center gap-2 border-t border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm"
      >
        {/* COPIA a sinistra (richiesta utente): è il comando che si usa più spesso */}
        <Button
          variant="secondary"
          size="sm"
          onClick={copy}
          disabled={!output}
          data-copia="pulsante"
          title="Copia lo script generato (si può copiare anche col tasto destro sullo script)"
        >
          <ClipboardCopy className="h-3.5 w-3.5" /> {copied ? 'Copiato!' : 'Copia SQL'}
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400">
          Tabella
          <input
            value={targetTable}
            onChange={e => setTargetTable(e.target.value)}
            placeholder="schema.tabella"
            title="Tabella target degli statement: proposta automaticamente dal SQL eseguito, ma sempre modificabile"
            className="w-44 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-200 focus:border-sky-500 focus:outline-none"
          />
        </label>
        <span className="text-xs text-zinc-400">Genera:</span>
        {(['INSERT', 'UPDATE', 'MERGE', 'DELETE', 'INSERT#'] as const).map(k => (
          <Button
            key={k}
            variant={kind === k ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setKind(k)}
            disabled={!canGenerate}
            title={
              k === 'UPDATE'
                ? 'Un UPDATE per ogni riga selezionata (WHERE sulle colonne non aggiornate)'
                : k === 'DELETE'
                  ? 'Un DELETE per ogni riga selezionata (WHERE sulla chiave)'
                  : k === 'INSERT#'
                    ? 'Crea e popola una tabella temporanea (#tmp) con i dati selezionati'
                    : undefined
            }
          >
            {k === 'INSERT#' ? 'INSERT INTO #' : k}
          </Button>
        ))}
        {kind === 'INSERT#' && (
          <input
            value={tempName}
            onChange={e => setTempName(e.target.value)}
            placeholder="#tmpTable"
            className="w-40 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-200 focus:border-sky-500 focus:outline-none"
          />
        )}
        <span className="ml-auto text-xs text-zinc-500">
          {selCols.length} colonne · {selectedCount} righe selezionate
        </span>
      </div>
      <pre
        onContextMenu={e => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        title="Tasto destro per copiare lo script"
        className="max-h-52 min-h-20 flex-1 overflow-auto border-t border-zinc-300 bg-white p-3 font-mono text-xs text-black"
      >
        {output || 'Seleziona righe e colonne e imposta la tabella target per generare lo statement.'}
      </pre>

      {/* Menu del tasto destro sullo script: copia (come il pulsante in alto a sinistra) */}
      {menu && (
        <div
          className="fixed z-[75] w-44 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-2xl"
          style={{
            left: Math.max(4, Math.min(menu.x, window.innerWidth - 184)),
            top: Math.max(4, Math.min(menu.y, window.innerHeight - 48)),
          }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => {
              setMenu(null)
              void copy()
            }}
            disabled={!output}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:text-zinc-600"
          >
            <ClipboardCopy className="h-3.5 w-3.5 text-zinc-400" />
            <span>{copied ? 'Copiato!' : 'Copia SQL'}</span>
          </button>
        </div>
      )}
    </div>
  )
}
