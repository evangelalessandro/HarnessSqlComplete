import { useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'

export interface DroppedFile {
  name: string
  content: string
}

/**
 * Zona di drag & drop: trascinando un file (es. .sql) sull'app lo apre in una
 * nuova tab. Mostra un overlay di conferma durante il trascinamento.
 */
export function FileDropZone({
  onFiles,
  children,
}: {
  onFiles: (files: DroppedFile[]) => void
  children: ReactNode
}) {
  const [dragging, setDragging] = useState(false)
  const dragCounter = useRef(0)

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  const handleDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragCounter.current += 1
    setDragging(true)
  }

  const handleDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
  }

  const handleDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) setDragging(false)
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    dragCounter.current = 0
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    Promise.all(
      files.map(async f => ({ name: f.name, content: await f.text() })),
    )
      .then(onFiles)
      .catch(() => {
        /* file non leggibile: ignora */
      })
  }

  return (
    <div
      className="relative h-full w-full"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center border-2 border-dashed border-sky-500 bg-sky-950/40">
          <span className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-sky-300 shadow-xl">
            Rilascia per aprire il file SQL in una nuova tab
          </span>
        </div>
      )}
    </div>
  )
}
