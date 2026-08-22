// Salvataggio/lettura file SQL con la File System Access API (Chromium/Edge).
// - Un file aperto con showOpenFilePicker ha un handle: save sovrascrive l'originale senza chiedere nulla.
// - Un file trascinato (drag&drop) non espone il percorso: save apre il picker (scegli l'originale) con
//   fallback al download su browser senza supporto (Firefox/Safari).

export interface OpenedSqlFile {
  name: string
  content: string
  handle: FileSystemFileHandle | null
}

type SaveFilePicker = (opts: {
  suggestedName?: string
  types?: { description?: string; accept: Record<string, string[]> }[]
}) => Promise<FileSystemFileHandle>

type OpenFilePicker = (opts: {
  multiple?: boolean
  types?: { description?: string; accept: Record<string, string[]> }[]
}) => Promise<FileSystemFileHandle[]>

function picker<T extends 'save' | 'open'>(kind: T): T extends 'save' ? SaveFilePicker : OpenFilePicker {
  const name = kind === 'save' ? 'showSaveFilePicker' : 'showOpenFilePicker'
  const fn = (window as unknown as Record<string, unknown>)[name]
  return (typeof fn === 'function' ? fn : undefined) as T extends 'save' ? SaveFilePicker : OpenFilePicker
}

const SQL_TYPES = [{ description: 'File SQL', accept: { 'text/plain': ['.sql', '.txt'] } }]

/** Salva il contenuto: sovrascrive l'handle se disponibile, altrimenti apre il picker; fallback download. */
export async function saveSqlFile(suggestedName: string, content: string, handle: FileSystemFileHandle | null = null): Promise<void> {
  if (handle) {
    await writeFileHandle(handle, content)
    return
  }
  const savePicker = picker('save')
  if (savePicker) {
    const target = await savePicker({ suggestedName, types: SQL_TYPES })
    await writeFileHandle(target, content)
    return
  }
  // fallback: download
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  a.click()
  URL.revokeObjectURL(url)
}

export async function writeFileHandle(handle: FileSystemFileHandle, content: string): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
}

/** Apre uno o più file .sql con il picker, restituendo anche l'handle per la sovrascrittura diretta. */
export async function openSqlFiles(): Promise<OpenedSqlFile[]> {
  const openPicker = picker('open')
  if (!openPicker) throw new Error('Apertura file non supportata da questo browser (serve Edge/Chrome).')
  const handles = await openPicker({ multiple: true, types: SQL_TYPES })
  const files: OpenedSqlFile[] = []
  for (const handle of handles) {
    const file = await handle.getFile()
    files.push({ name: file.name, content: await file.text(), handle })
  }
  return files
}
