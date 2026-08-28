import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  DatabaseBackup,
  FileCode2,
  FolderOpen,
  KeyRound,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react'
import { api } from '../api'
import type {
  BackupRequest,
  BackupSetInfo,
  DbFileEntry,
  FileMove,
  RestoreRequest,
} from '../types'
import { Badge, Button } from './ui'

interface Props {
  connectionId: string
  activeDatabase: string
  initialTab: 'backup' | 'restore'
  /** Percorso precompilato (dal menu contestuale). */
  initialPath?: string
  onClose: () => void
}

function typeLabel(t: number): string {
  if (t === 1) return 'Completo'
  if (t === 2) return 'Log transazioni'
  if (t === 5) return 'Differenziale'
  return `Tipo ${t}`
}

function fmtBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(2)} GB`
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KB`
  return `${n} B`
}

function nowStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** Normalizza un punto nel tempo ISO con millisecondi (default .000). */
export function normalizeStopAt(input: string): string {
  const t = input.trim()
  if (!t) return ''
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/.exec(t)
  if (!m) return t
  const ms = (m[2] ?? '0').padEnd(3, '0')
  return `${m[1]}.${ms}`
}

const inputCls =
  'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none'
const labelCls = 'mb-1 block text-xs font-medium text-zinc-400'
const sectionCls = 'rounded-lg border border-zinc-800 bg-zinc-900/50 p-3'

export default function MaintenanceDialog({
  connectionId,
  activeDatabase,
  initialTab,
  initialPath,
  onClose,
}: Props) {
  const [tab, setTab] = useState<'backup' | 'restore'>(initialTab)

  // ---------- Backup ----------
  const [bType, setBType] = useState<'full' | 'differential' | 'log'>('full')
  const [bComponent, setBComponent] = useState<'database' | 'files'>('database')
  const [bPath, setBPath] = useState(initialPath ?? `C:\\Backup\\${activeDatabase}.bak`)
  const [bName, setBName] = useState(`${activeDatabase}_${nowStamp()}`)
  const [bDesc, setBDesc] = useState('')
  const [bOverwrite, setBOverwrite] = useState<'append' | 'overwrite' | 'format'>('append')
  const [bMediaName, setBMediaName] = useState('')
  const [bMediaDesc, setBMediaDesc] = useState('')
  const [bVerify, setBVerify] = useState(true)
  const [bChecksum, setBChecksum] = useState(true)
  const [bContinue, setBContinue] = useState(false)
  const [bCompression, setBCompression] = useState<'default' | 'on' | 'off'>('default')
  const [bCopyOnly, setBCopyOnly] = useState(false)
  const [bLogMode, setBLogMode] = useState<'truncate' | 'noTruncate' | 'noRecovery'>('truncate')
  const [bExpiry, setBExpiry] = useState<'none' | 'days' | 'date'>('none')
  const [bExpiryDays, setBExpiryDays] = useState(7)
  const [bExpiryDate, setBExpiryDate] = useState('')
  const [bEnc, setBEnc] = useState<'none' | 'AES_128' | 'AES_192' | 'AES_256'>('none')
  const [bCert, setBCert] = useState('')
  const [bFiles, setBFiles] = useState<DbFileEntry[]>([])
  const [selFiles, setSelFiles] = useState<Set<string>>(new Set())
  const [selGroups, setSelGroups] = useState<Set<string>>(new Set())
  const [bCerts, setBCerts] = useState<{ name: string }[]>([])
  const [bBusy, setBBusy] = useState(false)

  // ---------- Restore ----------
  const [rPath, setRPath] = useState(initialPath ?? '')
  const [rSets, setRSets] = useState<BackupSetInfo[] | null>(null)
  const [rInfoErr, setRInfoErr] = useState<string | null>(null)
  const [rLoadingSets, setRLoadingSets] = useState(false)
  const [rSel, setRSel] = useState<BackupSetInfo | null>(null)
  const [rDest, setRDest] = useState(activeDatabase)
  const [rReplace, setRReplace] = useState(false)
  const [rLeaveRestoring, setRLeaveRestoring] = useState(false)
  const [rPit, setRPit] = useState(false)
  const [rStopAt, setRStopAt] = useState('')
  const [rTailLog, setRTailLog] = useState(false)
  const [rTailPath, setRTailPath] = useState(`C:\\Backup\\${activeDatabase}_tail.bak`)
  const [rMoves, setRMoves] = useState<FileMove[] | null>(null)
  const [rBusy, setRBusy] = useState(false)
  const [result, setResult] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setBFiles(await api.maintenanceFiles(connectionId))
      } catch {
        setBFiles([])
      }
      try {
        setBCerts(await api.maintenanceCertificates(connectionId))
      } catch {
        setBCerts([])
      }
    })()
  }, [connectionId])

  const groups = useMemo(() => {
    const map = new Map<string, DbFileEntry[]>()
    for (const f of bFiles) {
      if (f.type === 'LOG') continue
      const g = f.filegroup ?? '(nessun filegroup)'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(f)
    }
    return [...map.entries()]
  }, [bFiles])

  const logFiles = useMemo(() => bFiles.filter(f => f.type === 'LOG'), [bFiles])

  const toggleSet = (set: Set<string>, v: string, add: boolean): Set<string> => {
    const next = new Set(set)
    if (add) next.add(v)
    else next.delete(v)
    return next
  }

  const runBackup = async () => {
    if (!bPath.trim()) {
      setResult({ kind: 'err', text: 'Specifica il percorso del file .bak.' })
      return
    }
    if (bComponent === 'files' && selFiles.size === 0 && selGroups.size === 0) {
      setResult({ kind: 'err', text: 'Seleziona almeno un file o filegroup.' })
      return
    }
    setBBusy(true)
    setResult(null)
    const req: BackupRequest = {
      path: bPath.trim(),
      type: bType,
      component: bComponent,
      database: activeDatabase,
      name: bName.trim() || undefined,
      description: bDesc.trim() || undefined,
      overwriteMode: bOverwrite,
      mediaName: bOverwrite === 'format' && bMediaName.trim() ? bMediaName.trim() : undefined,
      mediaDescription:
        bOverwrite === 'format' && bMediaDesc.trim() ? bMediaDesc.trim() : undefined,
      verify: bVerify,
      checksum: bChecksum,
      continueOnError: bContinue,
      compression: bCompression,
      copyOnly: bCopyOnly,
      logMode: bType === 'log' ? bLogMode : undefined,
      expiryDays: bExpiry === 'days' ? bExpiryDays : undefined,
      expiryDate: bExpiry === 'date' ? bExpiryDate : undefined,
      encryptionAlgorithm: bEnc === 'none' ? undefined : bEnc,
      encryptionCertificate: bEnc === 'none' ? undefined : bCert,
      files: bComponent === 'files' ? [...selFiles] : undefined,
      filegroups: bComponent === 'files' ? [...selGroups] : undefined,
    }
    try {
      const res = await api.backupDb(connectionId, req)
      const lines = res.error
        ? [`Errore: ${res.error}`, ...res.messages]
        : res.messages.length
          ? res.messages
          : ['Backup completato.']
      setResult({ kind: res.error ? 'err' : 'ok', text: lines.join('\n') })
    } catch (e) {
      setResult({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBBusy(false)
    }
  }

  const loadBackupInfo = async () => {
    if (!rPath.trim()) {
      setRInfoErr('Specifica il percorso del file .bak.')
      return
    }
    setRLoadingSets(true)
    setRInfoErr(null)
    setRSets(null)
    setRSel(null)
    setRMoves(null)
    try {
      const res = await api.backupInfo(connectionId, rPath.trim())
      if (res.error) setRInfoErr(res.error)
      else setRSets(res.sets)
    } catch (e) {
      setRInfoErr(e instanceof Error ? e.message : String(e))
    } finally {
      setRLoadingSets(false)
    }
  }

  const selectSet = async (s: BackupSetInfo) => {
    setRSel(s)
    setRMoves(null)
    setRStopAt('')
    setRPit(false)
    try {
      const res = await api.restoreFileList(connectionId, rPath.trim(), s.position)
      if (res.error) setRInfoErr(res.error)
      else setRMoves(res.files.map(f => ({ logicalName: f.logicalName, physicalPath: f.physicalName })))
    } catch (e) {
      setRInfoErr(e instanceof Error ? e.message : String(e))
    }
  }

  const runRestore = async () => {
    if (!rSel) {
      setResult({ kind: 'err', text: 'Leggi il backup e seleziona un set da ripristinare.' })
      return
    }
    const isLog = rSel.type === 2
    const stopAt = rPit && isLog ? normalizeStopAt(rStopAt) : undefined
    if (rPit && isLog && !stopAt) {
      setResult({ kind: 'err', text: 'Indica il punto nel tempo (es. 2026-08-28T08:04:38.000).' })
      return
    }
    const msg = `Ripristino del set ${rSel.position} (${typeLabel(rSel.type)}) di "${rSel.databaseName}" in "${rDest}".${
      rReplace ? ' \nATTENZIONE: REPLACE sovrascriverà il database esistente!' : ''
    } Continuare?`
    if (!window.confirm(msg)) return
    setRBusy(true)
    setResult(null)
    const req: RestoreRequest = {
      path: rPath.trim(),
      filePosition: rSel.position,
      databaseName: rDest.trim() || undefined,
      sourceDatabase: rSel.databaseName ?? undefined,
      setType: isLog ? 'log' : 'database',
      replace: rReplace,
      leaveRestoring: rLeaveRestoring,
      stopAt,
      moveFiles: rMoves && rMoves.length > 0 ? rMoves : undefined,
      tailLogPath: rTailLog && rTailPath.trim() ? rTailPath.trim() : undefined,
    }
    try {
      const res = await api.restoreDb(connectionId, req)
      const lines = res.error
        ? [`Errore: ${res.error}`, ...res.messages]
        : res.messages.length
          ? res.messages
          : ['Ripristino completato.']
      setResult({ kind: res.error ? 'err' : 'ok', text: lines.join('\n') })
    } catch (e) {
      setResult({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setRBusy(false)
    }
  }

  const setChecked = (set: Set<string>, v: string, add: boolean) => {
    if (add) {
      const n = new Set(set)
      n.add(v)
      if (set === selGroups) setSelGroups(n)
      else setSelFiles(n)
    } else {
      if (set === selGroups) setSelGroups(toggleSet(set, v, false))
      else setSelFiles(toggleSet(set, v, false))
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-[min(860px,96vw)] flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Intestazione + tab */}
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
          <DatabaseBackup className="h-5 w-5 text-sky-400" />
          <h2 className="text-sm font-semibold text-zinc-100">Backup / Ripristina database</h2>
          <span className="ml-2 truncate font-mono text-xs text-zinc-500">{activeDatabase}</span>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            title="Chiudi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex shrink-0 gap-1 border-b border-zinc-800 px-4 pt-2">
          {(
            [
              ['backup', 'Backup', <DatabaseBackup key="b" className="h-3.5 w-3.5" />],
              ['restore', 'Ripristina', <RotateCcw key="r" className="h-3.5 w-3.5" />],
            ] as const
          ).map(([k, lbl, icon]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex items-center gap-1.5 rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === k
                  ? 'border border-b-0 border-zinc-700 bg-zinc-800/70 text-sky-300'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {icon} {lbl}
            </button>
          ))}
        </div>

        {/* Contenuto scrollabile */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {tab === 'backup' ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className={sectionCls}>
                  <label className={labelCls}>Tipo di backup</label>
                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        ['full', 'Completo'],
                        ['differential', 'Differenziale'],
                        ['log', 'Log transazioni'],
                      ] as const
                    ).map(([v, lbl]) => (
                      <button
                        key={v}
                        onClick={() => setBType(v)}
                        className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${
                          bType === v
                            ? 'border-sky-600 bg-sky-950/60 text-sky-200'
                            : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600'
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                  <label className={`${labelCls} mt-3`}>Componente</label>
                  <div className="grid grid-cols-2 gap-1">
                    {(
                      [
                        ['database', 'Database'],
                        ['files', 'File e filegroup'],
                      ] as const
                    ).map(([v, lbl]) => (
                      <button
                        key={v}
                        onClick={() => setBComponent(v)}
                        className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${
                          bComponent === v
                            ? 'border-sky-600 bg-sky-950/60 text-sky-200'
                            : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600'
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                  {bComponent === 'files' && (
                    <div className="mt-2 max-h-36 space-y-1 overflow-y-auto rounded border border-zinc-800 p-2 text-xs">
                      {groups.map(([g, files]) => (
                        <div key={g}>
                          <label className="flex items-center gap-1.5 font-medium text-zinc-300">
                            <input
                              type="checkbox"
                              className="accent-sky-600"
                              checked={selGroups.has(g)}
                              onChange={e => setChecked(selGroups, g, e.target.checked)}
                            />
                            <FolderOpen className="h-3 w-3 text-amber-400/80" /> {g}
                          </label>
                          <div className="ml-4 space-y-0.5">
                            {files.map(f => (
                              <label key={f.logicalName} className="flex items-center gap-1.5 text-zinc-400">
                                <input
                                  type="checkbox"
                                  className="accent-sky-600"
                                  checked={selFiles.has(f.logicalName)}
                                  onChange={e => setChecked(selFiles, f.logicalName, e.target.checked)}
                                />
                                <span className="font-mono">{f.logicalName}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                      {logFiles.map(f => (
                        <label key={f.logicalName} className="flex items-center gap-1.5 text-zinc-400">
                          <input
                            type="checkbox"
                            className="accent-sky-600"
                            checked={selFiles.has(f.logicalName)}
                            onChange={e => setChecked(selFiles, f.logicalName, e.target.checked)}
                          />
                          <span className="font-mono">{f.logicalName}</span>
                          <span className="text-[10px] text-zinc-600">(log)</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className={sectionCls}>
                  <label className={labelCls}>Percorso del file (.bak)</label>
                  <input value={bPath} onChange={e => setBPath(e.target.value)} className={inputCls} placeholder="C:\Backup\db.bak" />
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={labelCls}>Nome del backup set</label>
                      <input value={bName} onChange={e => setBName(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Descrizione</label>
                      <input value={bDesc} onChange={e => setBDesc(e.target.value)} className={inputCls} />
                    </div>
                  </div>
                  <label className={`${labelCls} mt-3`}>Scadenza</label>
                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        ['none', 'Mai'],
                        ['days', 'Dopo N giorni'],
                        ['date', 'Data'],
                      ] as const
                    ).map(([v, lbl]) => (
                      <button
                        key={v}
                        onClick={() => setBExpiry(v)}
                        className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                          bExpiry === v
                            ? 'border-sky-600 bg-sky-950/60 text-sky-200'
                            : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600'
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                  {bExpiry === 'days' && (
                    <input
                      type="number"
                      min={0}
                      value={bExpiryDays}
                      onChange={e => setBExpiryDays(Number(e.target.value))}
                      className={`${inputCls} mt-1 w-24`}
                    />
                  )}
                  {bExpiry === 'date' && (
                    <input
                      type="date"
                      value={bExpiryDate}
                      onChange={e => setBExpiryDate(e.target.value)}
                      className={`${inputCls} mt-1 w-44`}
                    />
                  )}
                </div>
              </div>

              <div className={sectionCls}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Supporto di destinazione</div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="flex items-center gap-2 text-xs text-zinc-300">
                    <input
                      type="radio"
                      name="media"
                      checked={bOverwrite === 'append'}
                      onChange={() => setBOverwrite('append')}
                      className="accent-sky-600"
                    />
                    Aggiungi al set esistente (append)
                  </label>
                  <label className="flex items-center gap-2 text-xs text-zinc-300">
                    <input
                      type="radio"
                      name="media"
                      checked={bOverwrite === 'overwrite'}
                      onChange={() => setBOverwrite('overwrite')}
                      className="accent-sky-600"
                    />
                    Sovrascrivi i set esistenti (INIT)
                  </label>
                  <label className="flex items-center gap-2 text-xs text-zinc-300">
                    <input
                      type="radio"
                      name="media"
                      checked={bOverwrite === 'format'}
                      onChange={() => setBOverwrite('format')}
                      className="accent-sky-600"
                    />
                    Nuovo set di supporti (FORMAT)
                  </label>
                </div>
                {bOverwrite === 'format' && (
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={labelCls}>Nome del media set</label>
                      <input value={bMediaName} onChange={e => setBMediaName(e.target.value)} className={inputCls} placeholder="MediaBackup" />
                    </div>
                    <div>
                      <label className={labelCls}>Descrizione del media set</label>
                      <input value={bMediaDesc} onChange={e => setBMediaDesc(e.target.value)} className={inputCls} />
                    </div>
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className={sectionCls}>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Affidabilità</div>
                  <label className="flex items-center gap-2 py-0.5 text-xs text-zinc-300">
                    <input type="checkbox" checked={bVerify} onChange={e => setBVerify(e.target.checked)} className="accent-sky-600" />
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Verifica il backup al termine (VERIFYONLY)
                  </label>
                  <label className="flex items-center gap-2 py-0.5 text-xs text-zinc-300">
                    <input type="checkbox" checked={bChecksum} onChange={e => setBChecksum(e.target.checked)} className="accent-sky-600" />
                    Esegui checksum prima di scrivere sui supporti
                  </label>
                  <label className="flex items-center gap-2 py-0.5 text-xs text-zinc-300">
                    <input type="checkbox" checked={bContinue} onChange={e => setBContinue(e.target.checked)} className="accent-sky-600" />
                    Continua in caso di errore (CONTINUE_AFTER_ERROR)
                  </label>
                  <label className="flex items-center gap-2 py-0.5 text-xs text-zinc-300">
                    <input type="checkbox" checked={bCopyOnly} onChange={e => setBCopyOnly(e.target.checked)} className="accent-sky-600" />
                    Backup copy-only (non rompe la catena LSN)
                  </label>
                </div>
                <div className={sectionCls}>
                  {bType === 'log' ? (
                    <>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Log transazioni</div>
                      <label className="flex items-center gap-2 py-0.5 text-xs text-zinc-300">
                        <input
                          type="radio"
                          name="logmode"
                          checked={bLogMode === 'truncate'}
                          onChange={() => setBLogMode('truncate')}
                          className="accent-sky-600"
                        />
                        Tronca il log transazionale
                      </label>
                      <label className="flex items-center gap-2 py-0.5 text-xs text-zinc-300">
                        <input
                          type="radio"
                          name="logmode"
                          checked={bLogMode === 'noTruncate'}
                          onChange={() => setBLogMode('noTruncate')}
                          className="accent-sky-600"
                        />
                        Non troncare il log (NO_TRUNCATE)
                      </label>
                      <label className="flex items-center gap-2 py-0.5 text-xs text-zinc-300">
                        <input
                          type="radio"
                          name="logmode"
                          checked={bLogMode === 'noRecovery'}
                          onChange={() => setBLogMode('noRecovery')}
                          className="accent-sky-600"
                        />
                        Backup della coda, DB in restoring (NORECOVERY)
                      </label>
                    </>
                  ) : (
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Compressione</div>
                  )}
                  <div className={bType === 'log' ? 'mt-2' : ''}>
                    <label className={labelCls}>Compressione backup</label>
                    <div className="grid grid-cols-3 gap-1">
                      {(
                        [
                          ['default', 'Default server'],
                          ['on', 'Comprimi'],
                          ['off', 'Non comprimere'],
                        ] as const
                      ).map(([v, lbl]) => (
                        <button
                          key={v}
                          onClick={() => setBCompression(v)}
                          className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                            bCompression === v
                              ? 'border-sky-600 bg-sky-950/60 text-sky-200'
                              : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2">
                    <label className={labelCls}>Crittografia</label>
                    <div className="grid grid-cols-4 gap-1">
                      {(
                        [
                          ['none', 'Nessuna'],
                          ['AES_128', 'AES 128'],
                          ['AES_192', 'AES 192'],
                          ['AES_256', 'AES 256'],
                        ] as const
                      ).map(([v, lbl]) => (
                        <button
                          key={v}
                          onClick={() => setBEnc(v)}
                          className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                            bEnc === v
                              ? 'border-sky-600 bg-sky-950/60 text-sky-200'
                              : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                    {bEnc !== 'none' && (
                      <select
                        value={bCert}
                        onChange={e => setBCert(e.target.value)}
                        className={`${inputCls} mt-1`}
                      >
                        <option value="">— certificato —</option>
                        {bCerts.map(c => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button onClick={() => void runBackup()} loading={bBusy}>
                  <DatabaseBackup className="h-4 w-4" /> Esegui backup
                </Button>
                <span className="text-xs text-zinc-500">Verranno mostrati i progressi (STATS 10%).</span>
              </div>
            </>
          ) : (
            <>
              <div className={sectionCls}>
                <label className={labelCls}>File di backup (.bak)</label>
                <div className="flex gap-2">
                  <input
                    value={rPath}
                    onChange={e => {
                      setRPath(e.target.value)
                      setRSets(null)
                      setRSel(null)
                    }}
                    className={inputCls}
                    placeholder="C:\Backup\db.bak"
                  />
                  <Button variant="secondary" onClick={() => void loadBackupInfo()} loading={rLoadingSets}>
                    <FileCode2 className="h-4 w-4" /> Leggi backup
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Legge i backup set contenuti nel file (RESTORE HEADERONLY): tipi, periodi coperti e LSN.
                </p>
              </div>

              {rInfoErr && (
                <div className="rounded-md border border-rose-800 bg-rose-950/40 p-2.5 text-xs text-rose-200">{rInfoErr}</div>
              )}

              {rSets && rSets.length === 0 && (
                <div className="rounded-md border border-zinc-800 p-3 text-xs text-zinc-500">Nessun backup set nel file.</div>
              )}

              {rSets && rSets.length > 0 && (
                <div className={sectionCls}>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Backup set trovati ({rSets.length}) — clicca per selezionare
                  </div>
                  <div className="max-h-52 space-y-1 overflow-y-auto">
                    {rSets.map(s => {
                      const active = rSel?.position === s.position
                      return (
                        <button
                          key={s.position}
                          onClick={() => void selectSet(s)}
                          className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${
                            active
                              ? 'border-sky-600 bg-sky-950/40 text-zinc-100'
                              : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-zinc-600'
                          }`}
                        >
                          <Check className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-sky-400' : 'text-transparent'}`} />
                          <span className="shrink-0">
                            <Badge tone={s.type === 2 ? 'violet' : s.type === 5 ? 'amber' : 'sky'}>
                              {typeLabel(s.type)}
                            </Badge>
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            <span className="font-semibold text-zinc-200">Pos. {s.position}</span>
                            <span className="text-zinc-500"> · {s.databaseName}</span>
                            {s.name && <span className="text-zinc-600"> · {s.name}</span>}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                            {s.startDate} → {s.finishDate}
                          </span>
                          <span className="shrink-0 text-right font-mono text-[10px] text-zinc-600">
                            {fmtBytes(s.sizeBytes)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  {rSel && (
                    <div className="mt-2 grid gap-2 border-t border-zinc-800 pt-2 text-[11px] text-zinc-500 sm:grid-cols-2">
                      <div>LSN: {rSel.firstLsn} … {rSel.lastLsn}</div>
                      <div>Server: {rSel.serverName} · Checksum: {rSel.hasChecksums ? 'sì' : 'no'}</div>
                      {rSel.type === 2 && (
                        <div className="text-sky-400/90">
                          Periodo coperto: {rSel.startDate} — {rSel.finishDate}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {rSel && (
                <div className={sectionCls}>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Opzioni di ripristino</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={labelCls}>Database di destinazione</label>
                      <input value={rDest} onChange={e => setRDest(e.target.value)} className={inputCls} />
                    </div>
                    <div className="flex flex-col justify-end gap-1.5 pb-0.5">
                      <label className="flex items-center gap-2 text-xs text-zinc-300">
                        <input type="checkbox" checked={rReplace} onChange={e => setRReplace(e.target.checked)} className="accent-sky-600" />
                        Sovrascrivi il database esistente (REPLACE)
                      </label>
                      <label className="flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={rLeaveRestoring}
                          onChange={e => setRLeaveRestoring(e.target.checked)}
                          className="accent-sky-600"
                        />
                        Lascia il DB in stato restoring (NORECOVERY, per la catena di log)
                      </label>
                    </div>
                  </div>

                  {rSel.type === 2 && (
                    <div className="mt-3 rounded-md border border-violet-900/50 bg-violet-950/20 p-2.5">
                      <label className="flex items-center gap-2 text-xs font-medium text-violet-200">
                        <input type="checkbox" checked={rPit} onChange={e => setRPit(e.target.checked)} className="accent-violet-500" />
                        <RotateCcw className="h-3.5 w-3.5" /> Ripristino fino a un punto nel tempo (al millisecondo)
                      </label>
                      {rPit && (
                        <>
                          <input
                            value={rStopAt}
                            onChange={e => setRStopAt(e.target.value)}
                            placeholder="es. 2026-08-28T08:04:38.000"
                            className={`${inputCls} mt-1.5 font-mono`}
                          />
                          <p className="mt-1 text-[11px] text-violet-300/70">
                            Formato ISO con millisecondi. Deve essere dentro il periodo coperto dal log
                            ({rSel.startDate} — {rSel.finishDate}).
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={rTailLog}
                          onChange={e => setRTailLog(e.target.checked)}
                          className="accent-sky-600"
                        />
                        Backup della coda del log prima del ripristino
                      </label>
                      {rTailLog && (
                        <input
                          value={rTailPath}
                          onChange={e => setRTailPath(e.target.value)}
                          className={`${inputCls} mt-1`}
                          placeholder="C:\Backup\db_tail.bak"
                        />
                      )}
                    </div>
                    <div className="flex items-end">
                      <button
                        onClick={() => {
                          if (!rSel) return
                          void (async () => {
                            try {
                              const res = await api.restoreFileList(connectionId, rPath.trim(), rSel.position)
                              if (res.error) setRInfoErr(res.error)
                              else
                                setRMoves(
                                  res.files.map(f => ({ logicalName: f.logicalName, physicalPath: f.physicalName })),
                                )
                            } catch (e) {
                              setRInfoErr(e instanceof Error ? e.message : String(e))
                            }
                          })()
                        }}
                        className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-sky-700 hover:text-sky-300"
                        title="Ricarica i file del backup (MOVE)"
                      >
                        <KeyRound className="h-3.5 w-3.5" /> File (MOVE)
                      </button>
                    </div>
                  </div>

                  {rMoves && rMoves.length > 0 && (
                    <div className="mt-2 space-y-1 rounded border border-zinc-800 p-2">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                        Percorsi fisici (modificabili per il MOVE)
                      </div>
                      {rMoves.map((m, i) => (
                        <div key={m.logicalName} className="flex items-center gap-2 text-xs">
                          <span className="w-40 shrink-0 truncate font-mono text-zinc-400" title={m.logicalName}>
                            {m.logicalName}
                          </span>
                          <span className="text-zinc-600">→</span>
                          <input
                            value={m.physicalPath}
                            onChange={e => {
                              setRMoves(prev =>
                                prev ? prev.map((x, j) => (j === i ? { ...x, physicalPath: e.target.value } : x)) : prev,
                              )
                            }}
                            className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[11px] text-zinc-200 focus:border-sky-600 focus:outline-none"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-3">
                    <Button onClick={() => void runRestore()} loading={rBusy} variant={rReplace ? 'danger' : 'primary'}>
                      <RotateCcw className="h-4 w-4" /> Ripristina set {rSel.position}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {result && (
            <pre
              className={`max-h-40 overflow-auto whitespace-pre-wrap rounded-md border p-2.5 text-[11px] leading-snug ${
                result.kind === 'err'
                  ? 'border-rose-800 bg-rose-950/40 text-rose-200'
                  : 'border-emerald-800 bg-emerald-950/40 text-emerald-200'
              }`}
            >
              {result.text}
            </pre>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-zinc-800 px-4 py-2">
          <span className="text-[11px] text-zinc-600">Le operazioni girano sul server SQL ({activeDatabase}).</span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Chiudi
          </Button>
        </div>
      </div>
    </div>
  )
}
