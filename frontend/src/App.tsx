import { useCallback, useEffect, useRef, useState } from 'react'
import { Database as DbIcon, FilePlus2, Table2, TerminalSquare, Unplug, X } from 'lucide-react'
import type { ReactNode } from 'react'
import monaco from './monacoSetup'
import { api } from './api'
import { toAlterStatement } from './helpers'
import type { AutocompleteStatus, ConnectResponse, DatabaseSummary, QueryResult } from './types'
import LoginScreen from './components/LoginScreen'
import Sidebar from './components/Sidebar'
import SqlEditor, { DEFAULT_SQL } from './components/SqlEditor'
import ResultsPanel from './components/ResultsPanel'
import PrintPanel from './components/PrintPanel'
import { Badge } from './components/ui'

type Tab = 'results' | 'print'

interface EditorTab {
  id: string
  title: string
  sql: string
}

const firstTab = (): EditorTab => ({ id: 'tab-1', title: 'Query 1', sql: DEFAULT_SQL })

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

  // --- Tab dell'editor (multi-tab) ---
  const [editorTabs, setEditorTabs] = useState<EditorTab[]>([firstTab()])
  const [activeEditorTab, setActiveEditorTab] = useState('tab-1')
  const tabCounter = useRef(2)

  // Quando cambia la tab attiva (o arriva l'editor), mostra il contenuto della tab
  useEffect(() => {
    if (!editor) return
    const tab = editorTabs.find(t => t.id === activeEditorTab)
    if (tab && editor.getValue() !== tab.sql) editor.setValue(tab.sql)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, activeEditorTab])

  const saveActiveEditor = useCallback(() => {
    if (!editor) return
    setEditorTabs(prev => prev.map(t => (t.id === activeEditorTab ? { ...t, sql: editor.getValue() } : t)))
  }, [editor, activeEditorTab])

  const switchEditorTab = useCallback(
    (id: string) => {
      if (id === activeEditorTab) return
      saveActiveEditor()
      setActiveEditorTab(id)
    },
    [activeEditorTab, saveActiveEditor],
  )

  const newEditorTab = useCallback((title?: string, sql: string = DEFAULT_SQL) => {
    const n = tabCounter.current++
    const tab: EditorTab = { id: `tab-${n}`, title: title ?? `Query ${n}`, sql }
    setEditorTabs(prev => [...prev, tab])
    setActiveEditorTab(tab.id)
  }, [])

  const closeEditorTab = useCallback(
    (id: string) => {
      setEditorTabs(prev => {
        const idx = prev.findIndex(t => t.id === id)
        if (idx === -1) return prev
        const next = prev.filter(t => t.id !== id)
        if (next.length === 0) {
          const fresh = { id: `tab-${tabCounter.current++}`, title: 'Query 1', sql: DEFAULT_SQL }
          setActiveEditorTab(fresh.id)
          return [fresh]
        }
        if (id === activeEditorTab) {
          setActiveEditorTab(next[Math.min(idx, next.length - 1)].id)
        }
        return next
      })
    },
    [activeEditorTab],
  )

  const resetTabs = useCallback(() => {
    tabCounter.current = 2
    setEditorTabs([firstTab()])
    setActiveEditorTab('tab-1')
  }, [])

  const handleConnected = useCallback(
    async (res: ConnectResponse) => {
      setConnection(res)
      setResult(null)
      setActiveTab('results')
      resetTabs()
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
    },
    [resetTabs],
  )

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
    resetTabs()
  }, [connection, resetTabs])

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

  /** Apre la preview (SELECT TOP 100 *) in una nuova tab dell'editor. */
  const handlePreviewInEditor = useCallback(
    (sql: string) => {
      newEditorTab(undefined, sql)
    },
    [newEditorTab],
  )

  /** Apre una stored procedure / funzione: 'alter' genera ALTER, 'open' la definizione CREATE. */
  const handleOpenObject = useCallback(
    async (_kind: 'procedure' | 'function', schema: string, name: string, mode: 'alter' | 'open') => {
      if (!connection) return
      setBanner(null)
      try {
        const { definition } = await api.getObjectDefinition(connection.connectionId, schema, name)
        const sql = mode === 'alter' ? toAlterStatement(definition) : definition
        const title = `${mode === 'alter' ? 'ALTER ' : ''}${schema === 'dbo' ? name : `${schema}.${name}`}`
        newEditorTab(title, sql)
      } catch (e) {
        setBanner(e instanceof Error ? e.message : String(e))
      }
    },
    [connection, newEditorTab],
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
            onPreviewInEditor={handlePreviewInEditor}
            onOpenObject={handleOpenObject}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {/* Barra delle tab dell'editor */}
          <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-zinc-800 bg-zinc-900/60 px-1">
            {editorTabs.map(t => (
              <div
                key={t.id}
                className={`group flex shrink-0 items-center gap-1 border-r border-zinc-800 px-2 py-1.5 text-xs ${
                  t.id === activeEditorTab
                    ? 'bg-zinc-800/80 text-zinc-100'
                    : 'text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300'
                }`}
              >
                <button
                  onClick={() => switchEditorTab(t.id)}
                  className="max-w-44 truncate font-medium"
                  title={t.title}
                >
                  {t.title}
                </button>
                <button
                  onClick={() => closeEditorTab(t.id)}
                  className="rounded p-0.5 opacity-0 transition-opacity hover:bg-zinc-700 group-hover:opacity-100"
                  title="Chiudi tab"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button
              onClick={() => newEditorTab()}
              className="ml-1 inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              title="Nuova query"
            >
              <FilePlus2 className="h-3.5 w-3.5" /> Nuova
            </button>
          </div>

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
