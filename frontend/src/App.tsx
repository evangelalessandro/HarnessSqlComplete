import { useCallback, useState } from 'react'
import { Database as DbIcon, Table2, TerminalSquare, Unplug } from 'lucide-react'
import type { ReactNode } from 'react'
import monaco from './monacoSetup'
import { api } from './api'
import type { AutocompleteStatus, ConnectResponse, DatabaseSummary, QueryResult } from './types'
import LoginScreen from './components/LoginScreen'
import Sidebar from './components/Sidebar'
import SqlEditor from './components/SqlEditor'
import ResultsPanel from './components/ResultsPanel'
import PrintPanel from './components/PrintPanel'
import { Badge } from './components/ui'

type Tab = 'results' | 'print'

export default function App() {
  const [connection, setConnection] = useState<ConnectResponse | null>(null)
  const [summary, setSummary] = useState<DatabaseSummary | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [executing, setExecuting] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('results')
  const [aiEnabled, setAiEnabled] = useState(true)
  const [aiStatus, setAiStatus] = useState<AutocompleteStatus | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null)

  const handleConnected = useCallback(async (res: ConnectResponse) => {
    setConnection(res)
    setResult(null)
    setActiveTab('results')
    setLoadingSummary(true)
    try {
      setSummary(await api.getSummary(res.connectionId))
    } catch (e) {
      setBanner(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingSummary(false)
    }
    try {
      setAiStatus(await api.autocompleteStatus(res.connectionId))
    } catch {
      setAiStatus(null)
    }
  }, [])

  const handleExecute = useCallback(
    async (sql: string) => {
      if (!connection) return
      setExecuting(true)
      setBanner(null)
      try {
        const r = await api.execute(connection.connectionId, sql)
        setResult(r)
        setActiveTab(r.error || r.resultSets.length > 0 ? 'results' : 'print')
      } catch (e) {
        setBanner(e instanceof Error ? e.message : String(e))
      } finally {
        setExecuting(false)
      }
    },
    [connection],
  )

  const handleDisconnect = useCallback(async () => {
    if (connection) {
      try {
        await api.disconnect(connection.connectionId)
      } catch {
        /* ignora */
      }
    }
    setConnection(null)
    setSummary(null)
    setResult(null)
    setBanner(null)
    setAiStatus(null)
    setEditor(null)
  }, [connection])

  const handleInsertText = useCallback(
    (text: string) => {
      if (!editor) return
      editor.focus()
      const sel = editor.getSelection()
      if (sel) {
        editor.executeEdits('insert-object', [{ range: sel, text }])
        const pos = editor.getPosition()
        if (pos) editor.setPosition(pos)
      }
    },
    [editor],
  )

  if (!connection) {
    return <LoginScreen onConnected={handleConnected} />
  }

  const aiConfigured = aiStatus?.configured ?? false
  const aiStatusText = aiStatus
    ? aiConfigured
      ? `DeepSeek ${aiStatus.model}`
      : 'DeepSeek: chiave non configurata'
    : 'IA: stato sconosciuto'

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/70 px-4 py-2">
        <div className="flex items-center gap-2 font-semibold text-zinc-100">
          <DbIcon className="h-5 w-5 text-sky-400" />
          SQL Intelligence Assistant
        </div>
        <Badge tone="sky">
          {connection.server} · {connection.database}
        </Badge>
        <Badge tone={aiConfigured ? 'emerald' : 'amber'}>{aiStatusText}</Badge>
        <button
          onClick={() => void handleDisconnect()}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
        >
          <Unplug className="h-4 w-4" /> Disconnetti
        </button>
      </header>

      {banner && (
        <div className="shrink-0 border-b border-rose-900 bg-rose-950/60 px-4 py-2 text-sm text-rose-200">{banner}</div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="w-80 shrink-0 border-r border-zinc-800 bg-zinc-900/60">
          <Sidebar
            summary={summary}
            loading={loadingSummary && !summary}
            activeDatabase={connection.database}
            onInsertText={handleInsertText}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="h-[52%] min-h-44 shrink-0 border-b border-zinc-800">
            <SqlEditor
              connectionId={connection.connectionId}
              summary={summary}
              executing={executing}
              aiEnabled={aiEnabled}
              onAiEnabledChange={setAiEnabled}
              aiConfigured={aiConfigured}
              aiStatusText={aiStatusText}
              onExecute={(sql: string) => void handleExecute(sql)}
              registerEditor={setEditor}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-1 border-b border-zinc-800 bg-zinc-900/40 px-2">
              <TabButton
                active={activeTab === 'results'}
                onClick={() => setActiveTab('results')}
                icon={<Table2 className="h-4 w-4" />}
                label="Risultati"
                count={result?.resultSets.length}
              />
              <TabButton
                active={activeTab === 'print'}
                onClick={() => setActiveTab('print')}
                icon={<TerminalSquare className="h-4 w-4" />}
                label="Messaggi / PRINT"
                count={result?.messages.length}
              />
            </div>
            <div className="min-h-0 flex-1">
              {activeTab === 'results' ? (
                <ResultsPanel result={result} executing={executing} />
              ) : (
                <PrintPanel result={result} />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  count?: number
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
        active
          ? 'border-sky-500 text-zinc-100'
          : 'border-transparent text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
      }`}
    >
      {icon}
      {label}
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-zinc-800 px-1.5 text-[10px] text-zinc-400">{count}</span>
      )}
    </button>
  )
}
