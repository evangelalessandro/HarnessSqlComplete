// Griglia risultati SELEZIONABILE + generatore SQL (INSERT/UPDATE/MERGE/DELETE/INSERT INTO #):
// condivisa tra la finestra di anteprima dati (F4) e i risultati delle query.
// Le colonne si tolgono/mantengono con i checkbox nell'header; le righe con quelli a
// sinistra; la tabella target è editabile (per generare anche da query arbitrarie).
//
// Foglio dati: numero di riga nella prima colonna, linee verticali fra le colonne, righe
// alternate a gruppi di TRE colori e colonne che si possono spostare trascinando l'header.
// Numero di riga e casella di selezione restano fissi a sinistra mentre si scorre.
import { useEffect, useMemo, useState } from 'react'
import { ClipboardCopy, GripVertical } from 'lucide-react'
import {
  buildDeleteSql,
  buildInsertIntoTempSql,
  buildInsertSql,
  buildMergeSql,
  buildUpdateSql,
  parseTargetTable,
} from '../sqlGen'
import type { GenColumn } from '../sqlGen'
import { identityOrder, reorderColumns, rowBackgroundClass } from '../resultGrid'
import type { CellValue } from '../types'
import { Button } from './ui'

export interface ResultColumnSpec {
  name: string
  dataType: string
}

type GenKind = 'INSERT' | 'UPDATE' | 'MERGE' | 'DELETE' | 'INSERT#'

interface Props {
  columns: ResultColumnSpec[]
  rows: CellValue[][]
  /** Tabella target iniziale ("schema.tabella") per gli statement; editabile. */
  initialTarget?: string
  /** Nomi delle colonne identity (chiave del MERGE/DELETE). */
  identityColumns?: string[]
}

export default function SelectableResultGrid({ columns, rows, initialTarget, identityColumns }: Props) {
  const [targetTable, setTargetTable] = useState(initialTarget ?? '')
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [selectedCols, setSelectedCols] = useState<Set<number>>(new Set())
  const [kind, setKind] = useState<GenKind>('INSERT')
  const [tempName, setTempName] = useState('')
  const [copied, setCopied] = useState(false)
  // Ordine di VISUALIZZAZIONE delle colonne (indici originali): si cambia trascinando l'header.
  // Gli indici originali restano la chiave di tutto il resto (selezione e SQL generato),
  // quindi spostare una colonna è solo un fatto di come la si guarda.
  const [colOrder, setColOrder] = useState<number[]>(() => identityOrder(columns.length))
  const [draggingCol, setDraggingCol] = useState<number | null>(null)
  const [dropCol, setDropCol] = useState<number | null>(null)

  // quando cambiano le colonne (nuova query): tutte selezionate di default, righe vuote
  useEffect(() => {
    setSelectedCols(new Set(columns.map((_, i) => i)))
    setSelectedRows(new Set())
    setColOrder(identityOrder(columns.length))
    setTempName(`#${initialTarget?.split('.').pop() ?? 'tmp'}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, initialTarget])

  const genColumns: GenColumn[] = useMemo(
    () =>
      columns.map(c => ({
        name: c.name,
        dataType: c.dataType,
        isIdentity: identityColumns?.includes(c.name) ?? false,
      })),
    [columns, identityColumns],
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
    const keys = genColumns.filter(c => c.isIdentity).map(c => c.name)
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

  const selectedCount = selRows.length
  const canGenerate = table.trim() !== '' && selCols.length > 0 && selRows.length > 0

  /** Sposta la colonna trascinata al posto di quella su cui è stata rilasciata. */
  const dropOn = (targetCol: number) => {
    if (draggingCol === null) return
    setColOrder(order => reorderColumns(order, draggingCol, targetCol))
    setDraggingCol(null)
    setDropCol(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {columns.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">Nessun dato.</div>
        ) : (
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="sticky top-0 z-10">
              <tr>
                {/* Numero di riga: prima colonna, resta fermo durante lo scorrimento orizzontale */}
                <th
                  className="sticky left-0 z-20 w-12 border-b border-r border-zinc-700 bg-zinc-800 px-2 py-1.5 text-right font-semibold text-zinc-400"
                  title="Numero di riga"
                >
                  #
                </th>
                <th className="sticky left-12 z-20 w-10 border-b border-r border-zinc-700 bg-zinc-800 px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={selectedRows.size === rows.length && rows.length > 0}
                    onChange={toggleAllRows}
                    className="accent-sky-500"
                  />
                </th>
                {colOrder.map(ci => {
                  const c = columns[ci]
                  if (!c) return null
                  const isDragging = draggingCol === ci
                  const isDropTarget = dropCol === ci && draggingCol !== null && draggingCol !== ci
                  return (
                    <th
                      key={`${c.name}-${ci}`}
                      draggable
                      onDragStart={e => {
                        setDraggingCol(ci)
                        e.dataTransfer.effectAllowed = 'move'
                        // alcuni browser non avviano il trascinamento senza dati impostati
                        e.dataTransfer.setData('text/plain', String(ci))
                      }}
                      onDragOver={e => {
                        if (draggingCol === null) return
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        setDropCol(ci)
                      }}
                      onDrop={e => {
                        e.preventDefault()
                        dropOn(ci)
                      }}
                      onDragEnd={() => {
                        setDraggingCol(null)
                        setDropCol(null)
                      }}
                      title={`${c.name} ${c.dataType} — trascina per spostare la colonna`}
                      className={`group cursor-grab border-b border-r border-zinc-700 bg-zinc-800 px-3 py-1.5 active:cursor-grabbing ${
                        isDragging ? 'opacity-40' : ''
                      } ${isDropTarget ? 'border-l-2 border-l-sky-400' : ''}`}
                    >
                      <label className="flex cursor-pointer items-center gap-1.5 font-semibold text-zinc-100">
                        <GripVertical className="h-3.5 w-3.5 shrink-0 text-zinc-600 group-hover:text-sky-400" />
                        <input
                          type="checkbox"
                          checked={selectedCols.has(ci)}
                          onChange={() => toggleCol(ci)}
                          className="accent-sky-500"
                        />
                        {c.name}
                        <span className="font-normal text-zinc-500">{c.dataType}</span>
                      </label>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                // sfondo (3 colori alternati) usato anche dalle celle fisse, che sono opache
                const bg = rowBackgroundClass(ri, selectedRows.has(ri))
                return (
                  <tr key={ri} className={`cursor-pointer transition-colors ${bg}`} onClick={() => toggleRow(ri)}>
                    <td
                      className={`sticky left-0 z-10 border-b border-r border-zinc-800/60 px-2 py-1 text-right font-mono text-xs tabular-nums text-zinc-500 ${bg}`}
                    >
                      {ri + 1}
                    </td>
                    <td className={`sticky left-12 z-10 border-b border-r border-zinc-800/60 px-2 py-1 ${bg}`}>
                      <input
                        type="checkbox"
                        checked={selectedRows.has(ri)}
                        onChange={() => toggleRow(ri)}
                        onClick={e => e.stopPropagation()}
                        className="accent-sky-500"
                      />
                    </td>
                    {colOrder.map(ci =>
                      ci < row.length ? (
                        <Cell key={ci} value={row[ci]} />
                      ) : (
                        // riga più corta delle colonne (dato inatteso): cella vuota, non "NULL"
                        <td key={ci} className="border-b border-r border-zinc-800/60 px-3 py-1" />
                      ),
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Barra generatore */}
      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm">
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
        <Button variant="secondary" size="sm" onClick={copy} disabled={!output}>
          <ClipboardCopy className="h-3.5 w-3.5" /> {copied ? 'Copiato!' : 'Copia SQL'}
        </Button>
      </div>
      <pre className="max-h-52 min-h-20 flex-1 overflow-auto border-t border-zinc-300 bg-white p-3 font-mono text-xs text-black">
        {output || 'Seleziona righe e colonne e imposta la tabella target per generare lo statement.'}
      </pre>
    </div>
  )
}

function Cell({ value }: { value: CellValue }) {
  // linea verticale fra le colonne: rende leggibile una griglia con molte colonne
  const base = 'border-b border-r border-zinc-800/60 px-3 py-1'
  if (value === null || value === undefined) {
    return <td className={`${base} italic text-zinc-600`}>NULL</td>
  }
  let text: string
  if (typeof value === 'boolean') text = String(value)
  else if (typeof value === 'object') text = JSON.stringify(value)
  else text = String(value)
  return (
    <td className={`${base} max-w-[380px] truncate font-mono text-zinc-200`} title={text}>
      {text}
    </td>
  )
}
