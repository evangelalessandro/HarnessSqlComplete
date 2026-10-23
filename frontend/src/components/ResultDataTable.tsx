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
import { useEffect, useMemo, useState } from "react";
import { ClipboardCopy, Copy, GripVertical, Maximize2, X } from "lucide-react";
import {
  identityOrder,
  reorderColumns,
  rowBackgroundClass,
} from "../resultGrid";
import { copiaTesto, rigaPerCopia, testoPerCopia } from "../clipboard";
import type { CellValue } from "../types";

export interface ResultColumnSpec {
  name: string;
  dataType: string;
}

interface Props {
  columns: ResultColumnSpec[];
  rows: CellValue[][];
  /** Numero della prima riga mostrata (per la paginazione: 51, 52, …). Default 1. */
  firstRowNumber?: number;
  /**
   * Intestazione fissa in alto mentre si scorre (default). Si disattiva nella vista
   * "tutti i result set in sequenza": lì più tabelle condividono lo stesso scorrimento e
   * le intestazioni fisse si sovrapporrebbero (resta fissa solo la barra del result set).
   */
  stickyHeader?: boolean;
  /** Caselle di selezione delle righe (usate dal generatore SQL). */
  rowSelection?: {
    selected: Set<number>;
    onToggle: (rowIndex: number) => void;
    onToggleAll: () => void;
  };
  /** Caselle di selezione delle colonne (usate dal generatore SQL). */
  colSelection?: {
    selected: Set<number>;
    onToggle: (originalIndex: number) => void;
  };
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
  const [colOrder, setColOrder] = useState<number[]>(() =>
    identityOrder(columns.length),
  );
  const [draggingCol, setDraggingCol] = useState<number | null>(null);
  const [dropCol, setDropCol] = useState<number | null>(null);
  /**
   * MENU DELLA CELLA (tasto destro): una cella con tanto testo è troncata a video, quindi serve un
   * modo per copiare il valore INTERO (richiesta utente). Il menu offre "Copia valore", "Copia riga"
   * e "Vedi valore intero".
   */
  const [menuCella, setMenuCella] = useState<{
    x: number;
    y: number;
    valore: unknown;
    riga: CellValue[];
    colonna: string;
  } | null>(null);
  /** Valore intero mostrato nella finestra "Vedi valore intero". */
  const [valoreIntero, setValoreIntero] = useState<{
    colonna: string;
    testo: string;
  } | null>(null);
  /** "Copiato ✓" per un attimo, dopo la copia. */
  const [copiato, setCopiato] = useState(false);

  // nuova query / nuove colonne → si riparte dall'ordine originale
  useEffect(() => {
    setColOrder(identityOrder(columns.length));
    setDraggingCol(null);
    setDropCol(null);
  }, [columns]);

  const order = useMemo(() => {
    // se le colonne cambiano mentre l'ordine è ancora quello vecchio, si ignorano gli indici fuori range
    const valid = colOrder.filter((i) => i >= 0 && i < columns.length);
    const missing = identityOrder(columns.length).filter(
      (i) => !valid.includes(i),
    );
    return [...valid, ...missing];
  }, [colOrder, columns.length]);

  const dropOn = (targetCol: number) => {
    if (draggingCol === null) return;
    setColOrder((current) => reorderColumns(current, draggingCol, targetCol));
    setDraggingCol(null);
    setDropCol(null);
  };

  const headBase = "border-b border-r border-zinc-600 bg-zinc-800 px-3 py-1.5";
  const cellBase = "border-b border-r border-zinc-700/70 px-3 py-1";
  // Con la selezione delle righe, la colonna delle check è la PRIMA: il numero di riga le sta
  // dietro e le due restano ferme a sinistra mentre si scorre (offset "sticky" coerenti con
  // la larghezza della colonna che le precede: check w-10 = 2.5rem = left-10).
  const sceltaLeft = rowSelection ? "left-10" : "left-0";

  return (
    <>
      <table className="w-full border-collapse text-left text-[13px]">
        <thead className={stickyHeader ? "sticky top-0 z-10" : ""}>
          <tr>
            {rowSelection && (
              <th className="sticky left-0 z-20 w-10 border-b border-r border-zinc-600 bg-zinc-800 px-2 py-1.5">
                <input
                  type="checkbox"
                  checked={
                    rows.length > 0 &&
                    rowSelection.selected.size === rows.length
                  }
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
            {order.map((ci) => {
              const c = columns[ci];
              if (!c) return null;
              const isDragging = draggingCol === ci;
              const isDropTarget =
                dropCol === ci && draggingCol !== null && draggingCol !== ci;
              return (
                <th
                  key={`${c.name}-${ci}`}
                  draggable
                  onDragStart={(e) => {
                    setDraggingCol(ci);
                    e.dataTransfer.effectAllowed = "move";
                    // alcuni browser non avviano il trascinamento senza dati impostati
                    e.dataTransfer.setData("text/plain", String(ci));
                  }}
                  onDragOver={(e) => {
                    if (draggingCol === null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDropCol(ci);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropOn(ci);
                  }}
                  onDragEnd={() => {
                    setDraggingCol(null);
                    setDropCol(null);
                  }}
                  title={`${c.name} ${c.dataType} — trascina per spostare la colonna`}
                  className={`group ${headBase} cursor-grab active:cursor-grabbing ${isDragging ? "opacity-40" : ""} ${
                    isDropTarget ? "border-l-2 border-l-sky-400" : ""
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
                    <span className="font-normal text-zinc-500">
                      {c.dataType}
                    </span>
                  </label>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            // sfondo (3 colori alternati) usato anche dalle celle fisse, che sono opache
            const selected = rowSelection?.selected.has(ri) ?? false;
            const bg = rowBackgroundClass(ri, selected);
            return (
              <tr
                key={ri}
                className={`${bg} ${rowSelection ? "cursor-pointer transition-colors" : ""}`}
                onClick={
                  rowSelection ? () => rowSelection.onToggle(ri) : undefined
                }
              >
                {rowSelection && (
                  <td
                    className={`sticky left-0 z-10 border-b border-r border-zinc-700/70 px-2 py-1 ${bg}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => rowSelection.onToggle(ri)}
                      onClick={(e) => e.stopPropagation()}
                      className="accent-sky-500"
                    />
                  </td>
                )}
                <td
                  className={`sticky ${sceltaLeft} z-10 border-b border-r border-zinc-700/70 px-2 py-1 text-right font-mono text-xs tabular-nums text-zinc-500 ${bg}`}
                >
                  {firstRowNumber + ri}
                </td>
                {order.map((ci) =>
                  ci < row.length ? (
                    <Cell
                      key={ci}
                      value={row[ci]}
                      onMenu={(e) => {
                        e.preventDefault();
                        setCopiato(false);
                        setMenuCella({
                          x: e.clientX,
                          y: e.clientY,
                          valore: row[ci],
                          riga: row,
                          colonna: columns[ci]?.name ?? "",
                        });
                      }}
                    />
                  ) : (
                    // riga più corta delle colonne (dato inatteso): cella vuota, non "NULL"
                    <td key={ci} className={cellBase} />
                  ),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* MENU DELLA CELLA (tasto destro): copia del valore INTERO (la cella a video è troncata) */}
      {menuCella && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenuCella(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenuCella(null);
            }}
          />
          <div
            className="fixed z-50 min-w-[210px] overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-2xl"
            style={{
              left: Math.min(menuCella.x, window.innerWidth - 230),
              top: Math.min(menuCella.y, window.innerHeight - 170),
            }}
            data-menu-cella=""
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="flex items-center gap-1.5 border-b border-zinc-800 px-2.5 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
              {menuCella.colonna}
              <span className="ml-auto normal-case tracking-normal text-zinc-600">
                {testoPerCopia(menuCella.valore).length} car.
              </span>
            </div>
            <button
              onClick={() => {
                void copiaTesto(testoPerCopia(menuCella.valore)).then((ok) => {
                  setCopiato(ok);
                  if (ok) setTimeout(() => setMenuCella(null), 1200);
                });
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-sky-900/60"
              data-copia="valore"
            >
              {copiato ? (
                <ClipboardCopy className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-sky-400" />
              )}
              {copiato ? "Copiato ✓" : "Copia valore"}
              <span className="ml-auto text-[10px] text-zinc-500">Ctrl+C</span>
            </button>
            <button
              onClick={() => {
                void copiaTesto(rigaPerCopia(menuCella.riga)).then((ok) => {
                  setCopiato(ok);
                  if (ok) setTimeout(() => setMenuCella(null), 1200);
                });
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-sky-900/60"
              data-copia="riga"
            >
              <Copy className="h-3.5 w-3.5 text-zinc-400" /> Copia riga
              <span className="ml-auto text-[10px] text-zinc-500">TAB</span>
            </button>
            <button
              onClick={() => {
                setValoreIntero({
                  colonna: menuCella.colonna,
                  testo: testoPerCopia(menuCella.valore),
                });
                setMenuCella(null);
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-sky-900/60"
              data-copia="intero"
            >
              <Maximize2 className="h-3.5 w-3.5 text-amber-400" /> Vedi valore
              intero
            </button>
          </div>
        </>
      )}

      {/* VEDO IL VALORE INTERO: finestra con il testo selezionabile e copiabile */}
      {valoreIntero && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-6"
          data-valore-intero=""
        >
          <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
              <Maximize2 className="h-4 w-4 text-amber-400" />
              <span className="text-xs font-semibold text-zinc-100">
                {valoreIntero.colonna}
              </span>
              <span className="text-[11px] text-zinc-500">
                {valoreIntero.testo.length} caratteri
              </span>
              <button
                onClick={() => setValoreIntero(null)}
                className="ml-auto rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                title="Chiudi (Esc)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <textarea
              readOnly
              value={valoreIntero.testo}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              className="h-64 w-full resize-none bg-zinc-950 p-2 font-mono text-xs text-zinc-200 outline-none"
              data-valore-testo=""
            />
            <div className="flex items-center gap-2 border-t border-zinc-800 px-3 py-2 text-[11px] text-zinc-500">
              <span>Seleziona con il mouse oppure copia tutto:</span>
              <button
                onClick={() => void copiaTesto(valoreIntero.testo)}
                className="ml-auto inline-flex items-center gap-1 rounded bg-sky-700 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-sky-600"
                data-copia="intero-conferma"
              >
                <Copy className="h-3.5 w-3.5" /> Copia tutto
              </button>
              <button
                onClick={() => setValoreIntero(null)}
                className="rounded bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
              >
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Cell({
  value,
  onMenu,
}: {
  value: CellValue;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const base = "border-b border-r border-zinc-700/70 px-3 py-1";
  if (value === null || value === undefined) {
    return (
      <td className={`${base} italic text-zinc-600`} onContextMenu={onMenu}>
        NULL
      </td>
    );
  }
  let text: string;
  if (typeof value === "boolean") text = String(value);
  else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);
  return (
    <td
      className={`${base} max-w-[440px] truncate font-mono text-zinc-200`}
      title={text}
      onContextMenu={onMenu}
    >
      {text}
    </td>
  );
}
