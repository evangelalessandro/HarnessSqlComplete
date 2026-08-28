import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, Database as DbIcon, FilePlus2, Pin, StickyNote, Table2, TerminalSquare, Unplug, X } from 'lucide-react'
import type { ReactNode } from 'react'
import monaco from './monacoSetup'
import { api } from './api'
import { dbTabColor, nextDragonLevel, toCreateOrAlterStatement } from './helpers'
import { openSqlFiles, saveSqlFile } from './fileSave'
import { loadDbColors, saveDbColors } from './dbColors'
import { loadSettings, saveSettings } from './settings'
import type { EditorSettings } from './settings'
import { loadPersistedTabs, persistTabs } from './tabStorage'
import type { AutocompleteStatus, ConnectResponse, DatabaseSummary, EditorTab, QueryResult } from './types'
import { chooseResultTab } from './queryTabs'
import LoginScreen from './components/LoginScreen'
import Sidebar from './components/Sidebar'
import SqlEditor, { DEFAULT_SQL } from './components/SqlEditor'
import ResultsPanel from './components/ResultsPanel'
import PrintPanel from './components/PrintPanel'
import HelpPage from './components/HelpPage'
import { FileDropZone } from './components/FileDropZone'
import DragonBackground from './components/DragonBackground'
import { Badge, Button } from './components/ui'

type Tab = 'results' | 'print'

const firstTab = (): EditorTab => ({ id: 'tab-1', title: 'Query 1', sql: DEFAULT_SQL })

export default function App() {
  const [connection, setConnection] = useState<ConnectResponse | null>(null)
  const [summary, setSummary] = useState<DatabaseSummary | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  // Risultati LEGATI alla singola tab dell'editor (non condivisi tra le tab)
  const [tabResults, setTabResults] = useState<Record<string, QueryResult | null>>({})
  const [tabExecuting, setTabExecuting] = useState<Record<string, boolean>>({})
  const [tabResultTab, setTabResultTab] = useState<Record<string, Tab>>({})
  // descrizione libera della tab (nota utente): tab in modifica + bozza
  const [descEditingTab, setDescEditingTab] = useState<string | null>(null)
  const [descDraft, setDescDraft] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [aiEnabled, setAiEnabled] = useState(true)
  const [aiStatus, setAiStatus] = useState<AutocompleteStatus | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null)

  // Drago del fuoco: cresce a ogni query eseguita (0-100, persistito)
  const [dragonLevel, setDragonLevel] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem('sql-intelli:dragon') ?? 0)
      return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0
    } catch {
      return 0
    }
  })
  // Colpo di fuoco da mostrare all'esecuzione (incrementato a ogni query)
  const [fireTick, setFireTick] = useState(0)

  // Pagina di aiuto (apribile dal sito)
  const [helpOpen, setHelpOpen] = useState(false)

  // Colori personalizzati per database (persistiti in localStorage)
  const [dbColors, setDbColors] = useState<Record<string, string>>(() => loadDbColors())

  // Impostazioni editor (font e tema)
  const [settings, setSettings] = useState<EditorSettings>(() => loadSettings())

  // Layout dei pannelli: larghezza della sidebar e pannello agganciato a destra (persistiti)
  const [layout, setLayout] = useState<{
    sidebarWidth: number
    rightDock: { panel: 'db' | 'objects'; width: number } | null
  }>(() => {
    try {
      const raw = localStorage.getItem('sql-intelli:layout')
      if (raw) {
        const p = JSON.parse(raw)
        return {
          sidebarWidth: typeof p.sidebarWidth === 'number' ? Math.min(560, Math.max(220, p.sidebarWidth)) : 320,
          rightDock: p.rightDock ?? null,
        }
      }
    } catch {
      /* ignora */
    }
    return { sidebarWidth: 320, rightDock: null }
  })
  const setLayoutAndPersist = useCallback(
    (updater: (prev: typeof layout) => typeof layout) => {
      setLayout(prev => {
        const next = updater(prev)
        try {
          localStorage.setItem('sql-intelli:layout', JSON.stringify(next))
        } catch {
          /* ignora */
        }
        return next
      })
    },
    [],
  )
  /** Elemento della colonna destra: destinazione del portal dei pannelli agganciati a destra. */
  const [rightDockEl, setRightDockEl] = useState<HTMLElement | null>(null)
  const rightDockRefCb = useCallback((el: HTMLElement | null) => setRightDockEl(el), [])

  // Ridimensiona la larghezza della sidebar (trascina il bordo destro)
  const sidebarResizeRef = useRef(false)
  const onSidebarResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    sidebarResizeRef.current = true
    const startX = e.clientX
    const startW = layout.sidebarWidth
    const onMove = (ev: MouseEvent) => {
      if (!sidebarResizeRef.current) return
      const w = Math.min(560, Math.max(220, startW + (ev.clientX - startX)))
      setLayoutAndPersist(prev => ({ ...prev, sidebarWidth: Math.round(w) }))
    }
    const onUp = () => {
      sidebarResizeRef.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Ridimensiona la larghezza della colonna destra (trascina il bordo sinistro)
  const rightResizeRef = useRef(false)
  const onRightResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    rightResizeRef.current = true
    const startX = e.clientX
    const startW = layout.rightDock?.width ?? 300
    const onMove = (ev: MouseEvent) => {
      if (!rightResizeRef.current) return
      const w = Math.min(560, Math.max(200, startW + (startX - ev.clientX)))
      setLayoutAndPersist(prev =>
        prev.rightDock ? { ...prev, rightDock: { ...prev.rightDock, width: Math.round(w) } } : prev,
      )
    }
    const onUp = () => {
      rightResizeRef.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // La Sidebar notifica quale pannello è agganciato a destra → mostra/nasconde la colonna
  const handleRightDockChange = useCallback(
    (panel: 'db' | 'objects' | null) => {
      setLayoutAndPersist(prev => ({
        ...prev,
        rightDock: panel ? { panel, width: prev.rightDock?.width ?? 300 } : null,
      }))
    },
    [setLayoutAndPersist],
  )

  const zoomFont = useCallback((delta: number) => {
    setSettings(prev => {
      const next: EditorSettings = { ...prev, fontSize: Math.min(40, Math.max(8, prev.fontSize + delta)) }
      saveSettings(next)
      return next
    })
  }, [])

  const toggleTheme = useCallback(() => {
    setSettings(prev => {
      const next: EditorSettings = { ...prev, theme: prev.theme === 'vs-dark' ? 'vs' : 'vs-dark' }
      saveSettings(next)
      return next
    })
  }, [])

  // Applica il tema all'intera pagina (html.theme-light) e all'editor Monaco
  useEffect(() => {
    document.documentElement.classList.toggle('theme-light', settings.theme === 'vs')
  }, [settings.theme])

  const handleSetDbColor = useCallback((db: string, color: string | null) => {
    setDbColors(prev => {
      const next = { ...prev }
      if (color) next[db] = color
      else delete next[db]
      saveDbColors(next)
      return next
    })
  }, [])

  // --- Tab dell'editor (multi-tab): salvate in localStorage PER ISTANZA SQL ---
  // All'avvio non c'è ancora una connessione: le tab dell'istanza vengono caricate
  // in handleConnected quando ci si collega.
  const [tabsInstance, setTabsInstance] = useState<string | null>(null)
  const [editorTabs, setEditorTabs] = useState<EditorTab[]>(() => [firstTab()])
  const [activeEditorTab, setActiveEditorTab] = useState('tab-1')
  const tabCounter = useRef(2)
  for (const t of editorTabs) {
    const n = Number(t.id.replace(/^tab-/, ''))
    if (!Number.isNaN(n) && n >= tabCounter.current) tabCounter.current = n + 1
  }

  // Salva le tab (ultima query inclusa) a ogni modifica, nella chiave dell'istanza connessa
  useEffect(() => {
    if (tabsInstance) persistTabs(tabsInstance, editorTabs, activeEditorTab)
  }, [editorTabs, activeEditorTab, tabsInstance])

  // Alla chiusura/ricarica della pagina salva subito il contenuto corrente dell'editor
  useEffect(() => {
    const flush = () => {
      if (!tabsInstance) return
      const current = editor?.getValue()
      const tabs =
        current !== undefined
          ? editorTabs.map(t => (t.id === activeEditorTab ? { ...t, sql: current } : t))
          : editorTabs
      persistTabs(tabsInstance, tabs, activeEditorTab)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [editor, editorTabs, activeEditorTab, tabsInstance])

  // Sincronizza il contenuto della tab attiva mentre si digita (debounce 600 ms)
  const contentSyncTimer = useRef<number | null>(null)
  const handleContentChange = useCallback(
    (sql: string) => {
      if (contentSyncTimer.current !== null) window.clearTimeout(contentSyncTimer.current)
      contentSyncTimer.current = window.setTimeout(() => {
        setEditorTabs(prev => prev.map(t => (t.id === activeEditorTab ? { ...t, sql } : t)))
      }, 600)
    },
    [activeEditorTab],
  )
  useEffect(() => {
    return () => {
      if (contentSyncTimer.current !== null) window.clearTimeout(contentSyncTimer.current)
    }
  }, [])

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

  /** Cambia database della connessione (e lo lega alla tab indicata o a quella attiva). */
  const switchDatabase = useCallback(
    async (database: string, tabId?: string) => {
      if (!connection || database === connection.database) return
      setBanner(null)
      setLoadingSummary(true)
      try {
        const res = await api.switchDatabase(connection.connectionId, database)
        setConnection(res)
        // cambio database: i risultati delle tab si riferivano al DB precedente
        setTabResults({})
        setTabExecuting({})
        setTabResultTab({})
        setSummary(await api.getSummary(res.connectionId))
        const targetTab = tabId ?? activeEditorTab
        setEditorTabs(prev => prev.map(t => (t.id === targetTab ? { ...t, database: res.database } : t)))
      } catch (e) {
        setBanner(e instanceof Error ? e.message : String(e))
      } finally {
        setLoadingSummary(false)
      }
    },
    [connection, activeEditorTab],
  )

  const switchEditorTab = useCallback(
    (id: string) => {
      if (id === activeEditorTab) return
      const target = editorTabs.find(t => t.id === id)
      saveActiveEditor()
      setActiveEditorTab(id)
      // il DB è legato alla tab: cambia connessione al database di quella tab
      if (target?.database && target.database !== connection?.database) {
        void switchDatabase(target.database, id)
      }
    },
    [activeEditorTab, editorTabs, connection, saveActiveEditor, switchDatabase],
  )

  const newEditorTab = useCallback(
    (
      title?: string,
      sql: string = DEFAULT_SQL,
      database?: string,
      fromFile = false,
      fileHandle: FileSystemFileHandle | null = null,
      fileName?: string,
    ) => {
      // il progressivo si azzera quando non c'è nessuna tab
      if (editorTabs.length === 0) tabCounter.current = 1
      const n = tabCounter.current++
      const tab: EditorTab = {
        id: `tab-${n}`,
        title: title ?? `Query ${n}`,
        sql,
        pinned: false,
        database: database ?? connection?.database ?? '',
        fromFile,
        fileHandle,
        fileName: fileName ?? (fromFile ? title : undefined),
      }
      setEditorTabs(prev => [...prev, tab])
      setActiveEditorTab(tab.id)
    },
    [editorTabs.length, connection],
  )

  const closeEditorTab = useCallback(
    (id: string) => {
      setEditorTabs(prev => {
        const target = prev.find(t => t.id === id)
        if (!target || target.pinned) return prev // le tab appuntate non si chiudono
        const next = prev.filter(t => t.id !== id)
        // rimuove anche i risultati legati alla tab chiusa
        setTabResults(r => {
          const c = { ...r }
          delete c[id]
          return c
        })
        setTabExecuting(r => {
          const c = { ...r }
          delete c[id]
          return c
        })
        setTabResultTab(r => {
          const c = { ...r }
          delete c[id]
          return c
        })
        if (next.length === 0) {
          setActiveEditorTab('') // tutte chiuse: stato vuoto, il prossimo progressivo riparte da 1
          return []
        }
        if (id === activeEditorTab) {
          const idx = prev.findIndex(t => t.id === id)
          setActiveEditorTab(next[Math.min(idx, next.length - 1)].id)
        }
        return next
      })
    },
    [activeEditorTab],
  )

  /** Salva titolo e descrizione libera della tab in modifica. */
  const saveTabDescription = useCallback(() => {
    if (!descEditingTab) return
    const clean = descDraft.trim()
    const newTitle = titleDraft.trim()
    setEditorTabs(prev =>
      prev.map(t =>
        t.id === descEditingTab
          ? {
              ...t,
              // titolo vuoto → resta quello attuale
              title: newTitle || t.title,
              titleCustom: newTitle && newTitle !== t.title ? true : t.titleCustom,
              description: clean || undefined,
            }
          : t,
      ),
    )
    setDescEditingTab(null)
  }, [descEditingTab, descDraft, titleDraft])

  const togglePin = useCallback((id: string) => {
    setEditorTabs(prev => {
      const t = prev.find(x => x.id === id)
      if (!t) return prev
      const others = prev.filter(x => x.id !== id)
      const updated = { ...t, pinned: !t.pinned }
      if (updated.pinned) {
        // appunta: sposta in testa al gruppo delle appuntate
        const firstUnpinned = others.findIndex(x => !x.pinned)
        const insertAt = firstUnpinned === -1 ? others.length : firstUnpinned
        return [...others.slice(0, insertAt), updated, ...others.slice(insertAt)]
      }
      // togli il pin: va in fondo
      return [...others, updated]
    })
  }, [])

  const moveTab = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return
    setEditorTabs(prev => {
      const fromIdx = prev.findIndex(t => t.id === fromId)
      const toIdx = prev.findIndex(t => t.id === toId)
      if (fromIdx === -1 || toIdx === -1) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return next
    })
  }, [])

  const handleConnected = useCallback(
    async (res: ConnectResponse) => {
      setConnection(res)
      // tab e query sono salvate PER ISTANZA SQL: carica quelle dell'istanza appena connessa
      setTabsInstance(res.server)
      const persisted = loadPersistedTabs(res.server)
      setEditorTabs(persisted?.tabs ?? [firstTab()])
      setActiveEditorTab(persisted?.tabs.some(t => t.id === persisted.active) ? persisted.active : 'tab-1')
      // nuova connessione: i risultati delle tab appartenevano al DB precedente
      setTabResults({})
      setTabExecuting({})
      setTabResultTab({})
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
    [],
  )

  const handleExecute = useCallback(
    async (sql: string) => {
      if (!connection) return
      // il drago cresce a ogni query eseguita (max 100, persistito in localStorage)
      setDragonLevel(prev => {
        const next = nextDragonLevel(prev)
        try {
          localStorage.setItem('sql-intelli:dragon', String(next))
        } catch {
          /* ignora */
        }
        return next
      })
      setFireTick(t => t + 1)
      // il risultato va alla tab ATTIVA al momento dell'esecuzione
      const tabId = activeEditorTab
      if (!tabId) return
      setTabExecuting(prev => ({ ...prev, [tabId]: true }))
      setBanner(null)
      try {
        const r = await api.execute(connection.connectionId, sql)
        setTabResults(prev => ({ ...prev, [tabId]: r }))
        // senza SELECT (solo PRINT/messaggi) si apre la schermata dei print
        setTabResultTab(prev => ({ ...prev, [tabId]: chooseResultTab(r) }))
      } catch (e) {
        setBanner(e instanceof Error ? e.message : String(e))
      } finally {
        setTabExecuting(prev => ({ ...prev, [tabId]: false }))
      }
    },
    [connection, activeEditorTab],
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
    setTabResults({})
    setTabExecuting({})
    setTabResultTab({})
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

  /** Cambia database dalla combo/treeview: lega il db alla tab attiva. */
  const handleSwitchDatabase = useCallback(
    (database: string) => {
      void switchDatabase(database)
    },
    [switchDatabase],
  )

  /** Apre la preview (SELECT TOP 100 *) in una nuova tab dell'editor. */
  const handlePreviewInEditor = useCallback(
    (sql: string) => {
      newEditorTab(undefined, sql)
    },
    [newEditorTab],
  )

  /** Apre uno script generato (CREATE/MERGE) in una nuova tab con titolo. */
  const handleOpenScript = useCallback(
    (title: string, sql: string) => {
      newEditorTab(title, sql, connection?.database)
    },
    [newEditorTab, connection],
  )

  /** Apre una stored procedure / funzione / vista / trigger: 'alter' genera CREATE OR ALTER, 'open' la definizione CREATE. */
  const handleOpenObject = useCallback(
    async (_kind: 'procedure' | 'function' | 'view' | 'trigger', schema: string, name: string, mode: 'alter' | 'open') => {
      if (!connection) return
      setBanner(null)
      try {
        const { definition } = await api.getObjectDefinition(connection.connectionId, schema, name)
        const sql = mode === 'alter' ? toCreateOrAlterStatement(definition) : definition
        const title = `${mode === 'alter' ? 'CREATE OR ALTER ' : ''}${schema === 'dbo' ? name : `${schema}.${name}`}`
        newEditorTab(title, sql, connection?.database)
      } catch (e) {
        setBanner(e instanceof Error ? e.message : String(e))
      }
    },
    [connection, newEditorTab],
  )

  /** Apre i file SQL trascinati (drag & drop) in nuove tab (nome = file, sovrascrittura via picker). */
  const handleOpenFiles = useCallback(
    (files: { name: string; content: string }[]) => {
      for (const f of files) {
        newEditorTab(f.name.replace(/\.sql$/i, ''), f.content, connection?.database, true)
      }
    },
    [newEditorTab, connection],
  )

  /** Salva la tab attiva: sovrascrive l'originale se la tab ha l'handle, altrimenti apre il picker. */
  const saveActiveTab = useCallback(
    async (saveAs = false) => {
      if (!editor) return
      const tab = editorTabs.find(t => t.id === activeEditorTab)
      if (!tab) return
      const sql = editor.getValue()
      setBanner(null)
      const suggestedName = /\.sql$/i.test(tab.fileName ?? tab.title)
        ? (tab.fileName ?? tab.title)
        : `${tab.fileName ?? tab.title}.sql`
      // l'handle potrebbe essere stato perso dopo un reload (JSON): verifica che sia reale
      const handle =
        !saveAs && tab.fileHandle && typeof tab.fileHandle.createWritable === 'function'
          ? tab.fileHandle
          : null
      try {
        const savedHandle = await saveSqlFile(suggestedName, sql, handle)
        let newTitle: string | undefined
        if (savedHandle) {
          const file = await savedHandle.getFile()
          newTitle = file.name.replace(/\.sql$/i, '')
        }
        setEditorTabs(prev =>
          prev.map(t => {
            if (t.id !== activeEditorTab) return t
            return {
              ...t,
              sql,
              fileHandle: savedHandle ?? t.fileHandle,
              fromFile: savedHandle ? true : t.fromFile,
              fileName: newTitle ?? t.fileName,
              // titolo rinominato a mano: resta com'è al salvataggio
              title: newTitle && !saveAs && !t.titleCustom ? newTitle : t.title,
            }
          }),
        )
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          setBanner(e instanceof Error ? e.message : String(e))
        }
      }
    },
    [editor, editorTabs, activeEditorTab],
  )

  /** Apre file .sql con il picker: la tab conserva l'handle per sovrascrivere l'originale. */
  const handleOpenFilePicker = useCallback(async () => {
    setBanner(null)
    try {
      const files = await openSqlFiles()
      for (const f of files) {
        const base = f.name.replace(/\.sql$/i, '')
        newEditorTab(base, f.content, connection?.database, true, f.handle, base)
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setBanner(e instanceof Error ? e.message : String(e))
      }
    }
  }, [newEditorTab, connection])

  if (!connection) {
    return (
      <FileDropZone onFiles={handleOpenFiles}>
        <LoginScreen onConnected={handleConnected} />
      </FileDropZone>
    )
  }

  const aiConfigured = aiStatus?.configured ?? false
  const aiStatusText = aiStatus
    ? aiConfigured
      ? `DeepSeek ${aiStatus.model}`
      : 'DeepSeek: chiave non configurata'
    : 'IA: stato sconosciuto'
  const dbNames = summary?.databases.map(d => d.name) ?? []
  const dbOptions = dbNames.includes(connection.database) ? dbNames : [connection.database, ...dbNames]
  const activeTabInfo = editorTabs.find(t => t.id === activeEditorTab)
  const activeDbName = activeTabInfo?.database || connection.database
  const activeDbColor = dbTabColor(activeDbName, dbColors)
  // risultati/esecuzione/sottotab legati alla tab attiva
  const activeResult = activeEditorTab ? (tabResults[activeEditorTab] ?? null) : null
  const activeExecuting = activeEditorTab ? (tabExecuting[activeEditorTab] ?? false) : false
  const activeResultTab: Tab = activeEditorTab ? (tabResultTab[activeEditorTab] ?? 'results') : 'results'
  const setActiveResultTab = (t: Tab) => {
    if (!activeEditorTab) return
    setTabResultTab(prev => ({ ...prev, [activeEditorTab]: t }))
  }

  return (
    <FileDropZone onFiles={handleOpenFiles}>
      <div className="flex h-full flex-col">
        <DragonBackground level={dragonLevel} />
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
          onClick={() => setHelpOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          title="Apri la guida con tutte le funzioni"
        >
          <BookOpen className="h-4 w-4" /> Aiuto
        </button>
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
        <aside
          className="relative flex shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/60"
          style={{ width: layout.sidebarWidth }}
        >
          <div className="min-h-0 flex-1">
            <Sidebar
              summary={summary}
              loading={loadingSummary && !summary}
              activeDatabase={connection.database}
              connectionId={connection.connectionId}
              onInsertText={handleInsertText}
              onPreviewInEditor={handlePreviewInEditor}
              onOpenScript={handleOpenScript}
              onOpenObject={handleOpenObject}
              onSwitchDatabase={handleSwitchDatabase}
              dbColors={dbColors}
              onSetDbColor={handleSetDbColor}
              rightDockEl={rightDockEl}
              onRightDockChange={handleRightDockChange}
            />
          </div>
          {/* Trascina per allargare/stringere la sidebar (e i pannelli ancorati a sinistra) */}
          <div
            onMouseDown={onSidebarResizeMouseDown}
            className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize"
            title="Trascina per allargare/stringere la sidebar"
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {/* Barra delle tab dell'editor */}
          <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-800 bg-zinc-900/60 px-1">
            <select
              value={connection.database}
              onChange={e => void handleSwitchDatabase(e.target.value)}
              className="mr-1 shrink-0 rounded border bg-zinc-900 px-1.5 py-1 text-xs font-semibold hover:border-sky-700 focus:outline-none"
              style={{ borderColor: activeDbColor, color: activeDbColor }}
              title="Database attivo — seleziona per cambiare"
            >
              {(dbOptions).map(d => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            {editorTabs.map(t => (
              <div
                key={t.id}
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData('text/tab-id', t.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={e => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                }}
                onDrop={e => {
                  e.preventDefault()
                  const fromId = e.dataTransfer.getData('text/tab-id')
                  if (fromId) moveTab(fromId, t.id)
                }}
                className={`group flex shrink-0 cursor-grab items-center gap-1 border-t-2 border-r border-zinc-800 px-2 py-1 text-xs active:cursor-grabbing ${
                  t.id === activeEditorTab
                    ? 'bg-zinc-800/80 text-zinc-100'
                    : 'text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300'
                }`}
                style={{ borderTopColor: dbTabColor(t.database ?? connection.database, dbColors) }}
                title={`${t.title} · db: ${t.database || connection.database}${t.description ? ` — ${t.description}` : ''}${t.pinned ? ' (appuntata)' : ''}${t.id === activeEditorTab ? ' — trascina per riordinare' : ''}`}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: dbTabColor(t.database ?? connection.database, dbColors) }} />
                <button
                  onClick={() => switchEditorTab(t.id)}
                  className="max-w-40 truncate font-medium"
                  title={t.title}
                >
                  {t.title}
                </button>
                <button
                  onClick={() => {
                    setTitleDraft(t.title)
                    setDescDraft(t.description ?? '')
                    setDescEditingTab(t.id)
                  }}
                  className={`rounded p-0.5 opacity-0 transition-opacity hover:bg-zinc-700 group-hover:opacity-100 ${
                    t.description ? '!opacity-100 text-amber-400' : 'text-zinc-400'
                  }`}
                  title={t.description ? `Titolo: ${t.title} — Descrizione: ${t.description} (modifica)` : 'Modifica titolo e descrizione della tab'}
                >
                  <StickyNote className="h-3 w-3" />
                </button>
                <button
                  onClick={() => togglePin(t.id)}
                  className={`rounded p-0.5 opacity-0 transition-opacity hover:bg-zinc-700 group-hover:opacity-100 ${
                    t.pinned ? '!opacity-100 text-amber-400' : 'text-zinc-400'
                  }`}
                  title={t.pinned ? 'Togli il pin' : 'Appunta la tab'}
                >
                  <Pin className="h-3 w-3" />
                </button>
                {!t.pinned && (
                  <button
                    onClick={() => closeEditorTab(t.id)}
                    className="rounded p-0.5 opacity-0 transition-opacity hover:bg-zinc-700 group-hover:opacity-100"
                    title="Chiudi tab"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
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

          {/* descrizione della tab attiva (nota libera) */}
          {activeTabInfo?.description && (
            <div className="flex items-center gap-1.5 border-b border-zinc-800 bg-zinc-900/30 px-3 py-1 text-xs italic text-zinc-400">
              <StickyNote className="h-3 w-3 shrink-0 text-amber-400" />
              <span className="truncate" title={activeTabInfo.description}>
                {activeTabInfo.description}
              </span>
            </div>
          )}

          <div
            className="h-[52%] min-h-44 shrink-0"
            style={{ border: `2px solid ${activeDbColor}` }}
            title={`Query su database: ${activeDbName}`}
          >
            {activeEditorTab ? (
              <SqlEditor
                connectionId={connection.connectionId}
                summary={summary}
                executing={activeExecuting}
                aiEnabled={aiEnabled}
                onAiEnabledChange={setAiEnabled}
                aiConfigured={aiConfigured}
                aiStatusText={aiStatusText}
                dragonLevel={dragonLevel}
                fireTick={fireTick}
                onExecute={(sql: string) => void handleExecute(sql)}
                onContentChange={handleContentChange}
                onSave={() => saveActiveTab(false)}
                onSaveAs={() => saveActiveTab(true)}
                onOpenFile={handleOpenFilePicker}
                fontSize={settings.fontSize}
                theme={settings.theme}
                onZoomFont={zoomFont}
                onToggleTheme={toggleTheme}
                registerEditor={setEditor}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-zinc-600">
                <FilePlus2 className="h-8 w-8 text-zinc-700" />
                <p>Nessuna query aperta.</p>
                <button
                  onClick={() => newEditorTab()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sky-500"
                >
                  <FilePlus2 className="h-4 w-4" /> Nuova query
                </button>
                <p className="text-xs text-zinc-700">…oppure trascina un file .sql qui</p>
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-1 border-b border-zinc-800 bg-zinc-900/40 px-2">
              <TabButton
                active={activeResultTab === 'results'}
                onClick={() => setActiveResultTab('results')}
                icon={<Table2 className="h-4 w-4" />}
                label="Risultati"
                count={activeResult?.resultSets.length}
              />
              <TabButton
                active={activeResultTab === 'print'}
                onClick={() => setActiveResultTab('print')}
                icon={<TerminalSquare className="h-4 w-4" />}
                label="Messaggi / PRINT"
                count={activeResult?.messages.length}
              />
            </div>
            <div className="min-h-0 flex-1">
              {activeResultTab === 'results' ? (
                <ResultsPanel result={activeResult} executing={activeExecuting} />
              ) : (
                <PrintPanel result={activeResult} />
              )}
            </div>
          </div>
        </main>

        {/* Colonna destra: ospita il pannello agganciato a destra (contenuto portato dalla Sidebar) */}
        {layout.rightDock && (
          <aside
            ref={rightDockRefCb}
            className="relative flex h-full shrink-0 flex-col border-l border-zinc-800 bg-zinc-900/60"
            style={{ width: layout.rightDock.width }}
          >
            <div
              onMouseDown={onRightResizeMouseDown}
              className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize"
              title="Trascina per allargare/stringere la colonna"
            />
          </aside>
        )}
      </div>
      </div>
      {helpOpen && <HelpPage onClose={() => setHelpOpen(false)} />}

      {/* Popover: titolo e descrizione libera della tab */}
      {descEditingTab && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDescEditingTab(null)}
        >
          <div
            className="w-[min(480px,92vw)] rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <StickyNote className="h-4 w-4 text-amber-400" /> Titolo e descrizione della tab
            </h3>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Titolo</label>
            <input
              autoFocus
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  saveTabDescription()
                }
                if (e.key === 'Escape') setDescEditingTab(null)
              }}
              placeholder="Nome della tab (es. 'Report clienti Q3')"
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none"
            />
            <label className="mb-1 mt-3 block text-xs font-medium text-zinc-400">Descrizione (nota libera)</label>
            <textarea
              value={descDraft}
              onChange={e => setDescDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  saveTabDescription()
                }
                if (e.key === 'Escape') setDescEditingTab(null)
              }}
              placeholder="Scrivi una nota libera per questa tab (es. 'Report mensile clienti', 'Da controllare', …)"
              rows={3}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 p-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none"
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDescEditingTab(null)}>
                Annulla
              </Button>
              <Button size="sm" onClick={saveTabDescription}>
                Salva
              </Button>
            </div>
          </div>
        </div>
      )}
    </FileDropZone>
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
