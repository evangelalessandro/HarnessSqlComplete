// TABELLA DEI RISULTATI (foglio dati), condivisa da:
// - pannello risultati (vista normale),
// - generatore SQL ("Genera SQL", che aggiunge le caselle di selezione).
//
// Una sola implementazione apposta: prima la vista normale aveva una tabella scritta a
// parte, così le migliorie (numero di riga, linee delle colonne, tre colori alternati,
// colonne spostabili) si vedevano solo attivando il generatore.
//
// Caratteristiche:
// - numero di riga nella PRIMA colonna, con la casella di selezione subito dopo: entrambe
//   restano FISSE mentre si scorre in orizzontale (le celle sono opache);
// - linea verticale fra le colonne (testata e corpo);
// - righe alternate a gruppi di TRE colori;
// - colonne spostabili trascinando l'intestazione: cambia solo la vista, l'ordine dei dati
//   resta quello originale (selezione e SQL generato continuano a usare l'ordine vero).
import { useEffect, useMemo, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { identityOrder, reorderColumns, rowBackgroundClass } from '../resultGrid'
import type { CellValue } from '../types'

export interface ResultColumnSpec {
  name: string
  dataType: string
}

interface Props {
  columns: ResultColumnSpec[]
  rows: CellValue[][]
  /** Numero della prima riga mostrata (per la paginazione: 51, 52, …). Default 1. */
  firstRowNumber?: number
  /**
   * Intestazione fissa in alto mentre si scorre (default). Si disattiva nella vista
   * "tutti i result set in sequenza": lì più tabelle condividono lo stesso scorrimento e
   * le intestazioni fisse si sovrapporrebbero (resta fissa solo la barra del result set).
   */
  stickyHeader?: boolean
  /** Caselle di selezione delle righe (usate dal generatore SQL). */
  rowSelection?: {
    selected: Set<number>
    onToggle: (rowIndex: number) => void
    onToggleAll: () => void
  }
  /** Caselle di selezione delle colonne (usate dal generatore SQL). */
  colSelection?: {
    selected: Set<number>
    onToggle: (originalIndex: number) => void
  }
}

export default function ResultDataTable({
  columns,
  rows,
  firstRowNumber = 1,
  stickyHeader = true,
  rowSelection,
  colSelection,
}: Props) {
  // Ordine di VISUALIZZAZIONE delle colonne (indici originali): si cambia trascinando l'header.
  const [colOrder, setColOrder] = useState<number[]>(() => identityOrder(columns.length))
  const [draggingCol, setDraggingCol] = useState<number | null>(null)
  const [dropCol, setDropCol] = useState<number | null>(null)

  // nuova query / nuove colonne → si riparte dall'ordine originale
  useEffect(() => {
    setColOrder(identityOrder(columns.length))
    setDraggingCol(null)
    setDropCol(null)
  }, [columns])

  const order = useMemo(() => {
    // se le colonne cambiano mentre l'ordine è ancora quello vecchio, si ignorano gli indici fuori range
    const valid = colOrder.filter(i => i >= 0 && i < columns.length)
    const missing = identityOrder(columns.length).filter(i => !valid.includes(i))
    return [...valid, ...missing]
  }, [colOrder, columns.length])

  const dropOn = (targetCol: number) => {
    if (draggingCol === null) return
    setColOrder(current => reorderColumns(current, draggingCol, targetCol))
    setDraggingCol(null)
    setDropCol(null)
  }

  const headBase = 'border-b border-r border-zinc-600 bg-zinc-800 px-3 py-1.5'
  const cellBase = 'border-b border-r border-zinc-700/70 px-3 py-1'
  // Con la selezione delle righe, la colonna delle check è la PRIMA: il numero di riga le sta
  // dietro e le due restano ferme a sinistra mentre si scorre (offset "sticky" coerenti con
  // la larghezza della colonna che le precede: check w-10 = 2.5rem = left-10).
  const sceltaLeft = rowSelection ? 'left-10' : 'left-0'

  return (
    <table className="w-full border-collapse text-left text-[13px]">
      <thead className={stickyHeader ? 'sticky top-0 z-10' : ''}>
        <tr>
          {rowSelection && (
            <th className="sticky left-0 z-20 w-10 border-b border-r border-zinc-600 bg-zinc-800 px-2 py-1.5">
              <input
                type="checkbox"
                checked={rows.length > 0 && rowSelection.selected.size === rows.length}
                onChange={rowSelection.onToggleAll}
                className="accent-sky-500"
                title="Seleziona tutte le righe"
              />
            </th>
          )}
          {/* Numero di riga: resta fermo durante lo scorrimento orizzontale */}
          <th
            className={`sticky ${sceltaLeft} z-20 w-12 border-b border-r border-zinc-600 bg-zinc-800 px-2 py-1.5 text-right font-semibold text-zinc-400`}
            title="Numero di riga"
          >
            #
          </th>
          {order.map(ci => {
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
                className={`group ${headBase} cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-40' : ''} ${
                  isDropTarget ? 'border-l-2 border-l-sky-400' : ''
                }`}
              >
                <label className="flex cursor-pointer items-center gap-1.5 font-semibold text-zinc-100">
                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-zinc-600 group-hover:text-sky-400" />
                  {colSelection && (
                    <input
                      type="checkbox"
                      checked={colSelection.selected.has(ci)}
                      onChange={() => colSelection.onToggle(ci)}
                      className="accent-sky-500"
                    />
                  )}
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
          const selected = rowSelection?.selected.has(ri) ?? false
          const bg = rowBackgroundClass(ri, selected)
          return (
            <tr
              key={ri}
              className={`${bg} ${rowSelection ? 'cursor-pointer transition-colors' : ''}`}
              onClick={rowSelection ? () => rowSelection.onToggle(ri) : undefined}
            >
              {rowSelection && (
                <td className={`sticky left-0 z-10 border-b border-r border-zinc-700/70 px-2 py-1 ${bg}`}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => rowSelection.onToggle(ri)}
                    onClick={e => e.stopPropagation()}
                    className="accent-sky-500"
                  />
                </td>
              )}
              <td
                className={`sticky ${sceltaLeft} z-10 border-b border-r border-zinc-700/70 px-2 py-1 text-right font-mono text-xs tabular-nums text-zinc-500 ${bg}`}
              >
                {firstRowNumber + ri}
              </td>
              {order.map(ci =>
                ci < row.length ? (
                  <Cell key={ci} value={row[ci]} />
                ) : (
                  // riga più corta delle colonne (dato inatteso): cella vuota, non "NULL"
                  <td key={ci} className={cellBase} />
                ),
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Cell({ value }: { value: CellValue }) {
  const base = 'border-b border-r border-zinc-700/70 px-3 py-1'
  if (value === null || value === undefined) {
    return <td className={`${base} italic text-zinc-600`}>NULL</td>
  }
  let text: string
  if (typeof value === 'boolean') text = String(value)
  else if (typeof value === 'object') text = JSON.stringify(value)
  else text = String(value)
  return (
    <td className={`${base} max-w-[440px] truncate font-mono text-zinc-200`} title={text}>
      {text}
    </td>
  )
}
