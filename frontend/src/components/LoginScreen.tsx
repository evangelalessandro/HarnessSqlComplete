import { useEffect, useState } from 'react'
import {
  CircleCheck,
  CircleX,
  Database as DbIcon,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Plug,
  RefreshCw,
  Server,
  Trash2,
} from 'lucide-react'
import { api } from '../api'
import type { ConnectResponse, ConnectionTestResult, SavedConnectionDto } from '../types'
import { Badge, Button, Spinner, inputClass } from './ui'
import MatrixRain from './MatrixRain'
import ConnectAnimation from './ConnectAnimation'

interface Props {
  onConnected: (res: ConnectResponse) => void
}

interface FormState {
  name: string
  server: string
  port: number
  database: string
  useWindowsAuth: boolean
  username: string
  password: string
  save: boolean
}

const emptyForm: FormState = {
  name: '',
  server: '',
  port: 1433,
  database: '',
  useWindowsAuth: true,
  username: '',
  password: '',
  save: false,
}

export default function LoginScreen({ onConnected }: Props) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saved, setSaved] = useState<SavedConnectionDto[]>([])
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectingId, setConnectingId] = useState<number | null>(null)
  // Destinazione della connessione in corso: mostrata nell'animazione scenica
  const [connectTarget, setConnectTarget] = useState<{ server: string; database?: string } | null>(null)
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSaved = async () => {
    try {
      setSaved(await api.listConnections())
    } catch {
      setSaved([])
    }
  }

  useEffect(() => {
    void loadSaved()
  }, [])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }))

  const toRequest = () => ({
    name: form.name || undefined,
    server: form.server,
    port: form.port || 1433,
    database: form.database || undefined,
    useWindowsAuth: form.useWindowsAuth,
    username: form.useWindowsAuth ? undefined : form.username,
    password: form.useWindowsAuth ? undefined : form.password,
    save: form.save,
    trustServerCertificate: true,
    encrypt: false,
  })

  const handleTest = async () => {
    if (!form.server.trim()) {
      setTestResult({ success: false, message: 'Inserisci il nome del server.', databases: null })
      return
    }
    setTesting(true)
    setError(null)
    setTestResult(null)
    try {
      setTestResult(await api.testConnection(toRequest()))
    } catch (e) {
      setTestResult({ success: false, message: e instanceof Error ? e.message : String(e), databases: null })
    } finally {
      setTesting(false)
    }
  }

  const handleConnect = async (req: ReturnType<typeof toRequest>) => {
    setConnectTarget({ server: req.server, database: req.database || undefined })
    setConnecting(true)
    setError(null)
    try {
      const res = await api.connect(req)
      if (res.connectionId) {
        await loadSaved()
        onConnected(res)
      } else {
        setError(res.message)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setConnecting(false)
      setConnectTarget(null)
    }
  }

  const handleConnectSaved = async (id: number, target?: { server: string; database?: string }) => {
    setConnectTarget(target ?? null)
    setConnectingId(id)
    setError(null)
    try {
      const res = await api.connectSaved(id)
      if (res.connectionId) {
        await loadSaved()
        onConnected(res)
      } else {
        setError(res.message)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setConnectingId(null)
      setConnectTarget(null)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await api.deleteConnection(id)
      await loadSaved()
    } catch {
      /* ignora */
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-zinc-950 p-6">
      <MatrixRain />
      <div className="relative z-10 grid w-full max-w-5xl gap-6 lg:grid-cols-[1fr_380px]">
        {/* Form di connessione */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-xl">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-sky-600/15 text-sky-400">
              <DbIcon className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold">SQL Intelligence Assistant</h1>
              <p className="text-sm text-zinc-400">Client SQL intelligente per SQL Server</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_110px]">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Server / Istanza</label>
              <input
                className={inputClass}
                placeholder="localhost, SQLEXPRESS, 192.168.1.10"
                value={form.server}
                onChange={e => set('server', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Porta</label>
              <input
                className={inputClass}
                type="number"
                value={form.port}
                onChange={e => set('port', Number(e.target.value) || 1433)}
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-xs font-medium text-zinc-400">Database (opzionale)</label>
            <input
              className={inputClass}
              list="db-list"
              placeholder="Lascia vuoto per master"
              value={form.database}
              onChange={e => set('database', e.target.value)}
            />
            <datalist id="db-list">
              {(testResult?.databases ?? []).map(d => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-xs font-medium text-zinc-400">Autenticazione</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => set('useWindowsAuth', true)}
                className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                  form.useWindowsAuth
                    ? 'border-sky-600 bg-sky-950/60 text-sky-200'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600'
                }`}
              >
                Windows Auth
              </button>
              <button
                type="button"
                onClick={() => set('useWindowsAuth', false)}
                className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                  !form.useWindowsAuth
                    ? 'border-sky-600 bg-sky-950/60 text-sky-200'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600'
                }`}
              >
                SQL Auth
              </button>
            </div>
          </div>

          {!form.useWindowsAuth && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Utente</label>
                <input
                  className={inputClass}
                  placeholder="sa"
                  value={form.username}
                  onChange={e => set('username', e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Password</label>
                <div className="relative">
                  <input
                    className={inputClass}
                    type={showPwd ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => set('password', e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    title={showPwd ? 'Nascondi password' : 'Mostra password'}
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.save}
              onChange={e => set('save', e.target.checked)}
              className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 accent-sky-600"
            />
            <KeyRound className="h-4 w-4 text-zinc-500" />
            Salva questa login (cifrata localmente)
          </label>

          {form.save && (
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-zinc-400">Nome della login salvata</label>
              <input
                className={inputClass}
                placeholder="Es. Produzione locale"
                value={form.name}
                onChange={e => set('name', e.target.value)}
              />
            </div>
          )}

          <div className="mt-5 flex items-center gap-2">
            <Button variant="secondary" onClick={() => void handleTest()} loading={testing}>
              <RefreshCw className="h-4 w-4" /> Test connessione
            </Button>
            <Button onClick={() => void handleConnect(toRequest())} loading={connecting}>
              <Plug className="h-4 w-4" /> Connetti
            </Button>
          </div>

          {testResult && (
            <div
              className={`mt-4 flex items-start gap-2 rounded-md border p-3 text-sm ${
                testResult.success
                  ? 'border-emerald-800 bg-emerald-950/40 text-emerald-200'
                  : 'border-rose-800 bg-rose-950/40 text-rose-200'
              }`}
            >
              {testResult.success ? (
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <CircleX className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <div>
                <div>{testResult.message}</div>
                {testResult.databases && testResult.databases.length > 0 && (
                  <div className="mt-1 text-xs opacity-80">
                    Database disponibili: {testResult.databases.slice(0, 12).join(', ')}
                    {testResult.databases.length > 12 ? '…' : ''}
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-md border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</div>
          )}
        </div>

        {/* Login salvate */}
        <div className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
              <HardDrive className="h-4 w-4 text-zinc-500" /> Login salvate
            </h2>
            <button
              type="button"
              onClick={() => void loadSaved()}
              className="text-zinc-500 transition-colors hover:text-zinc-300"
              title="Aggiorna"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {saved.length === 0 && (
              <p className="rounded-md border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-600">
                Nessuna login salvata. Compila il form e spunta "Salva questa login".
              </p>
            )}
            {saved.map(c => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => void handleConnectSaved(c.id, { server: c.server, database: c.database || undefined })}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    void handleConnectSaved(c.id, { server: c.server, database: c.database || undefined })
                  }
                }}
                className="group flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 transition-colors hover:border-sky-600 hover:bg-sky-950/20"
                title="Clicca per connetterti con questa login"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold text-zinc-100">{c.name}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500">
                    <Server className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      {c.server}
                      {c.port !== 1433 ? `,${c.port}` : ''}
                      {c.database ? ` · ${c.database}` : ''}
                    </span>
                  </div>
                  <div className="mt-1.5 flex gap-1.5">
                    <Badge tone={c.useWindowsAuth ? 'sky' : 'violet'}>
                      {c.useWindowsAuth ? 'Windows' : c.username ?? 'SQL'}
                    </Badge>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation()
                    void handleConnectSaved(c.id, { server: c.server, database: c.database || undefined })
                  }}
                  className="flex shrink-0 items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white shadow-md transition-colors hover:bg-sky-500"
                  title="Connetti con questa login"
                >
                  {connectingId === c.id ? (
                    <Spinner className="h-4 w-4 !text-white" />
                  ) : (
                    <>
                      <Plug className="h-4 w-4" /> Connetti
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation()
                    void handleDelete(c.id)
                  }}
                  className="shrink-0 rounded-md p-2 text-zinc-500 transition-colors hover:bg-rose-950 hover:text-rose-300"
                  title="Elimina login"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      {connectTarget && <ConnectAnimation server={connectTarget.server} database={connectTarget.database} />}
    </div>
  )
}
