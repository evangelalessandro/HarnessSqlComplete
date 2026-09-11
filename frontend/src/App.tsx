import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookOpen, Database as DbIcon, FilePlus2, Pin, RefreshCw, StickyNote, Table2, TerminalSquare, Unplug, X } from 'lucide-react'
import type { ReactNode } from 'react'
import monaco from './monacoSetup'
import { api } from './api'
import { dbTabColor, detectPrintMagic, nextDragonLevel, normalizeTabIcon, TAB_ICON_PRESETS, toCreateOrAlterStatement } from './helpers'
import { openSqlFiles, saveSqlFile } from './fileSave'
import { loadDbColors, saveDbColors } from './dbColors'
import { loadSettings, saveSettings } from './settings'
import type { EditorSettings } from './settings'
import { loadPersistedTabs, persistTabs } from './tabStorage'
import { buildTabClosePlan, countClosableTabs, insertTabAfterActive } from './tabOps'
import type { TabCloseMode } from './tabOps'
import type { AutocompleteStatus, ConnectResponse, DatabaseSummary, EditorTab, QueryResult, RoutineCallGraph } from './types'
import { chooseResultTab } from './queryTabs'
import {
  clearQueryStats,
  emptyQueryStats,
  loadQueryStats,
  recordEdit,
  recordExecution,
  saveQueryStats,
  type QueryStats,
} from './gamification'
import { QueryStatsBadge, QueryStatsModal } from './components/QueryStatsPanel'
import CallGraphModal from './components/CallGraphModal'
import type { CallGraphTarget } from './components/CallGraphModal'
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
  // DIAGRAMMA CHIAMATE: legami fra routine (chi chiama chi) di tutto il database,
  // caricati alla prima apertura del diagramma e riusati; routine analizzata + stato.
  const [callGraph, setCallGraph] = useState<RoutineCallGraph | null>(null)
  const [callGraphTarget, setCallGraphTarget] = useState<CallGraphTarget | null>(null)
  const [callGraphLoading, setCallGraphLoading] = useState(false)
  const [callGraphError, setCallGraphError] = useState<string | null>(null)
  // Risultati LEGATI alla singola tab dell'editor (non condivisi tra le tab)
  const [tabResults, setTabResults] = useState<Record<string, QueryResult | null>>({})
  const [tabExecuting, setTabExecuting] = useState<Record<string, boolean>>({})
  const [tabResultTab, setTabResultTab] = useState<Record<string, Tab>>({})
  // SQL eseguito per tab: propone la tabella target del generatore della griglia risultati
  const [tabSql, setTabSql] = useState<Record<string, string>>({})
  // GAMIFICATION: statistiche di lavoro per tab (tempo, esecuzioni ok/errore, XP)
  const [tabStats, setTabStats] = useState<Record<string, QueryStats>>({})
  const [statsOpen, setStatsOpen] = useState(false)
  // descrizione libera della tab (nota utente): tab in modifica + bozza
  const [descEditingTab, setDescEditingTab] = useState<string | null>(null)
  const [descDraft, setDescDraft] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  // icona/emoji della tab in modifica (nel popover titolo & descrizione)
  const [iconDraft, setIconDraft] = useState('')
  // Menu contestuale della tab (tasto destro): chiusure multiple in stile SSMS
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  // Overflow delle tab: a capo su 2 righe; oltre compare il pulsante "Â»" con l'elenco
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [tabOverflow, setTabOverflow] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(true)
  const [aiStatus, setAiStatus] = useState<AutocompleteStatus | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null)

  // Drago e fuoco: compaiono SOLO se la query eseguita contiene PRINT 'drago' / PRINT 'fuoco'.
  // Il drago si "nutre" (livello 0-100 persistito) a ogni invocazione e resta visibile ~8s.
  const [dragonLevel, setDragonLevel] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem('sql-intelli:dragon') ?? 0)
      return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0
    } catch {
      return 0
    }
  })
  const [dragonShow, setDragonShow] = useState(false)
  const dragonTimer = useRef<number | null>(null)
  // Colpo di fuoco: incrementato SOLO quando la query contiene PRINT 'fuoco'
  const [fireTick, setFireTick] = useState(0)

  /** Evoca il drago per ~8 secondi. */
  const summonDragon = () => {
    setDragonShow(true)
    if (dragonTimer.current !== null) window.clearTimeout(dragonTimer.current)
    dragonTimer.current = window.setTimeout(() => setDragonShow(false), 8000)
  }

  // Pagina di aiuto (apribile dal sito)
  const [helpOpen, setHelpOpen] = useState(false)

  // Colori personalizzati per database (persistiti in localStorage)
  const [dbColors, setDbColors] = useState<Record<string, string>>(() => loadDbColors())

  // Impostazioni editor (font e tema)
  const [settings, setSettings] = useState<EditorSettings>(() => loadSettings())

  // --- Split editor/risultati: percentuale dell'editor (divider trascinabile) e visibilitÃ  risultati (Ctrl+R) ---
  const [editorPct, setEditorPct] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem('sql-intelli:split-pct') ?? 52)
      return Number.isFinite(v) ? Math.min(85, Math.max(15, v)) : 52
    } catch {
      return 52
    }
  })
  const [resultsVisible, setResultsVisible] = useState<boolean>(() => {
    try {
      return (localStorage.getItem('sql-intelli:split-results') ?? '1') !== '0'
    } catch {
      return true
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('sql-intelli:split-pct', String(editorPct))
    } catch {
      /* ignora */
    }
  }, [editorPct])
  useEffect(() => {
    try {
      localStorage.setItem('sql-intelli:split-results', resultsVisible ? '1' : '0')
    } catch {
      /* ignora */
    }
  }, [resultsVisible])

  const editorPaneRef = useRef<HTMLDivElement | null>(null)
  const resultsPaneRef = useRef<HTMLDivElement | null>(null)
  const splitDrag = useRef<{ startY: number; startPct: number; totalH: number } | null>(null)

  const startSplitDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const totalH =
      (editorPaneRef.current?.offsetHeight ?? 0) + (resultsPaneRef.current?.offsetHeight ?? 0)
    if (totalH <= 0) return
    splitDrag.current = { startY: e.clientY, startPct: editorPct, totalH }
    const onMove = (ev: MouseEvent) => {
      const d = splitDrag.current
      if (!d) return
      const next = Math.min(85, Math.max(15, d.startPct + ((ev.clientY - d.startY) / d.totalH) * 100))
      setEditorPct(next)
    }
    const onUp = () => {
      splitDrag.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Ctrl+R (o Cmd+R): nasconde/mostra il pannello dei risultati (evita il refresh del browser)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault()
        setResultsVisible(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  // La Sidebar notifica quale pannello Ã¨ agganciato a destra â†’ mostra/nasconde la colonna
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
  // All'avvio non c'Ã¨ ancora una connessione: le tab dell'istanza vengono caricate
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

  /** GAMIFICATION: aggiorna le statistiche di lavoro della tab (e le persiste). */
  const updateTabStats = useCallback(
    (tabId: string, fn: (s: QueryStats) => QueryStats) => {
      setTabStats(prev => {
        const current = prev[tabId] ?? loadQueryStats(tabsInstance ?? '', tabId) ?? emptyQueryStats()
        const next = fn(current)
        if (tabsInstance) saveQueryStats(tabsInstance, tabId, next)
        return { ...prev, [tabId]: next }
      })
    },
    [tabsInstance],
  )

  // Sincronizza il contenuto della tab attiva mentre si digita (debounce 600 ms)
  const contentSyncTimer = useRef<number | null>(null)
  const handleContentChange = useCallback(
    (sql: string) => {
      // GAMIFICATION: una modifica = attivitÃ  (fa crescere tempo e XP della tab)
      updateTabStats(activeEditorTab, s => recordEdit(s, Date.now()))
      if (contentSyncTimer.current !== null) window.clearTimeout(contentSyncTimer.current)
      contentSyncTimer.current = window.setTimeout(() => {
        setEditorTabs(prev => prev.map(t => (t.id === activeEditorTab ? { ...t, sql } : t)))
      }, 600)
    },
    [activeEditorTab, updateTabStats],
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
        setTabSql({})
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
      // il DB Ã¨ legato alla tab: cambia connessione al database di quella tab
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
      // il progressivo si azzera quando non c'Ã¨ nessuna tab
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
      setEditorTabs(prev => insertTabAfterActive(prev, tab, activeEditorTab))
      setActiveEditorTab(tab.id)
    },
    [editorTabs.length, activeEditorTab, connection],
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
        setTabSql(r => {
          const c = { ...r }
          delete c[id]
          return c
        })
        forgetTabStats([id])
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

  /** GAMIFICATION: dimentica le statistiche delle tab chiuse. */
  const forgetTabStats = useCallback(
    (ids: string[]) => {
      if (tabsInstance) for (const id of ids) clearQueryStats(tabsInstance, id)
      setTabStats(prev => {
        const c = { ...prev }
        for (const id of ids) delete c[id]
        return c
      })
    },
    [tabsInstance],
  )

  /** Rimuove i dati laterali (risultati, esecuzione, sqlâ€¦) delle tab chiuse in massa. */
  const dropTabSideData = useCallback((ids: string[]) => {
    const gone = new Set(ids)
    const without = <T,>(m: Record<string, T>): Record<string, T> => {
      const c = { ...m }
      for (const id of gone) delete c[id]
      return c
    }
    setTabResults(without)
    setTabExecuting(without)
    setTabResultTab(without)
    setTabSql(without)
  }, [])

  /** Applica un'azione di chiusura multipla (menu tasto destro) della tab `anchorId`. */
  const applyTabClosePlan = useCallback(
    (anchorId: string, mode: TabCloseMode) => {
      if (!editorTabs.some(t => t.id === anchorId)) {
        setTabMenu(null)
        return
      }
      const plan = buildTabClosePlan(editorTabs, anchorId, mode)
      setTabMenu(null)
      if (plan.removedIds.length === 0) return
      dropTabSideData(plan.removedIds)
      forgetTabStats(plan.removedIds)
      setEditorTabs(plan.kept)
      setActiveEditorTab(prev => (prev && plan.removedIds.includes(prev) ? plan.focusId : prev))
    },
    [editorTabs, dropTabSideData, forgetTabStats],
  )

  // Tab in overflow: a capo automatico fino a 2 righe; oltre compare "Â»" con l'elenco.
  const measureTabOverflow = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const probe = el.querySelector<HTMLElement>('.sql-tab')
    if (!probe) {
      setTabOverflow(false)
      setOverflowOpen(false)
      return
    }
    const twoRows = probe.offsetHeight * 2 + 4 // gap-1 tra le righe
    const top = el.getBoundingClientRect().top
    const clipped = [...el.children].some(
      c => c.getBoundingClientRect().bottom > top + twoRows + 1,
    )
    el.style.maxHeight = clipped ? `${twoRows}px` : ''
    setTabOverflow(clipped)
    if (!clipped) setOverflowOpen(false)
  }, [])
  useLayoutEffect(() => {
    measureTabOverflow()
  }, [measureTabOverflow, editorTabs])
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(measureTabOverflow)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measureTabOverflow])

  /** Salva titolo, descrizione e icona della tab in modifica. */
  const saveTabDescription = useCallback(() => {
    if (!descEditingTab) return
    const clean = descDraft.trim()
    const newTitle = titleDraft.trim()
    const icon = normalizeTabIcon(iconDraft)
    setEditorTabs(prev =>
      prev.map(t =>
        t.id === descEditingTab
          ? {
              ...t,
              // titolo vuoto â†’ resta quello attuale
              title: newTitle || t.title,
              titleCustom: newTitle && newTitle !== t.title ? true : t.titleCustom,
              description: clean || undefined,
              icon,
            }
          : t,
      ),
    )
    setDescEditingTab(null)
  }, [descEditingTab, descDraft, titleDraft, iconDraft])

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
        setTabSql({})
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
      // drago e fuoco compaiono SOLO con PRINT 'drago' / PRINT 'fuoco' nella query
      const magic = detectPrintMagic(sql)
      if (magic === 'drago') {
        // il drago si nutre a ogni evocazione (max 100, persistito)
        setDragonLevel(prev => {
          const next = nextDragonLevel(prev)
          try {
            localStorage.setItem('sql-intelli:dragon', String(next))
          } catch {
            /* ignora */
          }
          return next
        })
        summonDragon()
      } else if (magic === 'fuoco') {
        setFireTick(t => t + 1)
      }
      // eseguendo una query i risultati compaiono sempre, anche se nascosti con Ctrl+R
      setResultsVisible(true)
      // il risultato va alla tab ATTIVA al momento dell'esecuzione
      const tabId = activeEditorTab
      if (!tabId) return
      setTabSql(prev => ({ ...prev, [tabId]: sql }))
      setTabExecuting(prev => ({ ...prev, [tabId]: true }))
      setBanner(null)
      try {
        const r = await api.execute(connection.connectionId, sql)
        setTabResults(prev => ({ ...prev, [tabId]: r }))
        // GAMIFICATION: esecuzione riuscita o con errore (+ durata)
        updateTabStats(tabId, s => recordExecution(s, r.elapsedMs, !r.error, Date.now()))
        // senza SELECT (solo PRINT/messaggi) si apre la schermata dei print
        setTabResultTab(prev => ({ ...prev, [tabId]: chooseResultTab(r) }))
      } catch (e) {
        // errore di trasporto/API: conta come esecuzione fallita
        updateTabStats(tabId, s => recordExecution(s, 0, false, Date.now()))
        setBanner(e instanceof Error ? e.message : String(e))
      } finally {
        setTabExecuting(prev => ({ ...prev, [tabId]: false }))
      }
    },
    [connection, activeEditorTab, updateTabStats],
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
    setCallGraph(null)
    setTabResults({})
    setTabExecuting({})
    setTabResultTab({})
    setTabSql({})
    setBanner(null)
    setAiStatus(null)
    setEditor(null)
  }, [connection])

  /**
   * Auto-riparazione dello schema: se i metadati non sono disponibili (es. backend
   * riavviato â†’ sessione scaduta) l'intellisense resta senza tabelle/colonne.
   * Si riprova a caricarli alcune volte; poi si mostra l'errore e si smette.
   *
   * NOTA: l'effetto NON deve dipendere da `loadingSummary` (che lui stesso cambia):
   * altrimenti il cleanup annulla la richiesta in corso e lo stato resta "in
   * caricamento" per sempre, lasciando l'editor senza schema (bug introdotto e
   * corretto). Il ri-tentativo Ã¨ pilotato da `summaryRetryTick`.
   */
  const summaryRetries = useRef(0)
  const [summaryRetryTick, setSummaryRetryTick] = useState(0)
  const [summaryReloading, setSummaryReloading] = useState(false)

  /** Ricarica manuale dei metadati (pulsante nell'header quando lo schema manca). */
  const reloadSummary = useCallback(async () => {
    if (!connection) return
    setSummaryReloading(true)
    setBanner(null)
    try {
      const s = await api.getSummary(connection.connectionId)
      setSummary(s)
      summaryRetries.current = 0
    } catch (e) {
      setBanner(`Schema non caricato: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSummaryReloading(false)
    }
  }, [connection])

  useEffect(() => {
    if (!connection || summary) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      if (cancelled) return
      setLoadingSummary(true)
      try {
        const s = await api.getSummary(connection.connectionId)
        if (cancelled) return
        setSummary(s)
        summaryRetries.current = 0
      } catch (e) {
        if (cancelled) return
        summaryRetries.current += 1
        const msg = e instanceof Error ? e.message : String(e)
        if (summaryRetries.current < 3) {
          setBanner(`Schema non caricato (${msg}). Nuovo tentativoâ€¦`)
          setSummaryRetryTick(t => t + 1) // pianifica il prossimo tentativo
        } else {
          summaryRetries.current = 0
          setBanner(`Schema non caricato: ${msg}. Riconnettiti per i suggerimenti su tabelle e colonne.`)
        }
      } finally {
        setLoadingSummary(false)
      }
    }, 2500)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [connection, summary, summaryRetryTick])

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

  /**
   * DIAGRAMMA CHIAMATE: apre la finestra con i legami della routine indicata.
   * I legami di tutto il database si leggono una volta sola (sono ~1700 in WSBRITVIC) e
   * restano in memoria: ricentrare il diagramma o cambiare direzione non richiede il backend.
   */
  const loadCallGraph = useCallback(
    async (force = false) => {
      if (!connection) return
      if (!force && callGraph) return
      setCallGraphLoading(true)
      setCallGraphError(null)
      try {
        setCallGraph(await api.getRoutineCallGraph(connection.connectionId))
      } catch (e) {
        setCallGraphError(e instanceof Error ? e.message : String(e))
      } finally {
        setCallGraphLoading(false)
      }
    },
    [connection, callGraph],
  )

  const openCallGraph = useCallback(
    (schema: string, name: string, kind: 'procedure' | 'function') => {
      setCallGraphTarget({ schema, name, kind })
      void loadCallGraph()
    },
    [loadCallGraph],
  )

  /** Apre i file SQL trascinati (drag & drop) in nuove tab (nome = file, sovrascrittura via picker). */  const handleOpenFiles = useCallback(
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
              // titolo rinominato a mano: resta com'Ã¨ al salvataggio
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
  const activeSql = activeEditorTab ? (tabSql[activeEditorTab] ?? '') : ''
  // GAMIFICATION: statistiche della tab attiva (dai dati salvati se non ancora in memoria)
  const activeStats: QueryStats | null = activeEditorTab
    ? (tabStats[activeEditorTab] ?? loadQueryStats(tabsInstance ?? '', activeEditorTab) ?? emptyQueryStats())
    : null
  const activeResultTab: Tab = activeEditorTab ? (tabResultTab[activeEditorTab] ?? 'results') : 'results'
  const setActiveResultTab = (t: Tab) => {
    if (!activeEditorTab) return
    setTabResultTab(prev => ({ ...prev, [activeEditorTab]: t }))
  }

  return (
    <FileDropZone onFiles={handleOpenFiles}>
      <div className="flex h-full flex-col">
        <DragonBackground level={dragonLevel} visible={dragonShow} />
        <header className="flex shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/70 px-4 py-2">
        <div className="flex items-center gap-2 font-semibold text-zinc-100">
          <DbIcon className="h-5 w-5 text-sky-400" />
          SQL Intelligence Assistant
        </div>
        <Badge tone="sky">
          {connection.server} Â· {connection.database}
        </Badge>
        <Badge tone={aiConfigured ? 'emerald' : 'amber'}>{aiStatusText}</Badge>
        {summary ? (
          <Badge tone="emerald">Schema: {summary.tables.length} tabelle</Badge>
        ) : (
          <span className="flex items-center gap-1">
            <Badge tone="rose">Schema non caricato</Badge>
            <button
              onClick={() => void reloadSummary()}
              disabled={summaryReloading}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rose-200 transition-colors hover:bg-rose-950/60 disabled:opacity-50"
              title="Ricarica i metadati (tabelle, colonne, visteâ€¦) dal database"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${summaryReloading ? 'animate-spin' : ''}`} /> Ricarica schema
            </button>
          </span>
        )}
        <button
          onClick={() => setHelpOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          title="Apri la guida con tutte le funzioni"
        >
          <BookOpen className="h-4 w-4" /> Aiuto
        </button>
        {activeStats && <QueryStatsBadge stats={activeStats} onClick={() => setStatsOpen(true)} />}
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
              onShowCallGraph={openCallGraph}
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
          {/* Barra delle tab dell'editor: a capo su 2 righe, poi elenco "Â»" */}
          <div className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-900/60 px-1">
            <select
              value={connection.database}
              onChange={e => void handleSwitchDatabase(e.target.value)}
              className="mr-1 shrink-0 rounded border bg-zinc-900 px-1.5 py-1 text-xs font-semibold hover:border-sky-700 focus:outline-none"
              style={{ borderColor: activeDbColor, color: activeDbColor }}
              title="Database attivo â€” seleziona per cambiare"
            >
              {(dbOptions).map(d => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <div
              ref={wrapRef}
              className="flex min-w-0 flex-1 flex-wrap items-center gap-1 overflow-hidden"
            >
            {editorTabs.map(t => (
              <div
                key={t.id}
                onContextMenu={e => {
                  e.preventDefault()
                  setTabMenu({
                    id: t.id,
                    x: Math.min(e.clientX, window.innerWidth - 230),
                    y: Math.min(e.clientY, window.innerHeight - 280),
                  })
                }}
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
                className={`group sql-tab relative flex h-7 shrink-0 cursor-grab items-center gap-1 border-t-2 border-r px-3 text-xs active:cursor-grabbing ${
                  t.id === activeEditorTab
                    ? 'border-x border-x-zinc-700 border-b-2 border-b-zinc-900 bg-zinc-700/90 font-semibold text-white shadow-[0_-2px_10px_rgba(56,189,248,0.12)]'
                    : 'border-r-zinc-800 text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300'
                }`}
                style={{ borderTopColor: dbTabColor(t.database ?? connection.database, dbColors) }}
                title={`${t.title} Â· db: ${t.database || connection.database}${t.description ? ` â€” ${t.description}` : ''}${t.pinned ? ' (appuntata)' : ''}${t.id === activeEditorTab ? ' â€” SCHEDA ATTIVA â€” trascina per riordinare' : ''} â€” tasto destro: chiudi le altre / a destra / a sinistra / le non appuntate`}
              >
                {t.id === activeEditorTab && (
                  <span
                    className="absolute inset-x-0 -bottom-0.5 h-0.5"
                    style={{ backgroundColor: dbTabColor(t.database ?? connection.database, dbColors) }}
                  />
                )}
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: dbTabColor(t.database ?? connection.database, dbColors) }} />
                {t.icon && (
                  <span className="shrink-0 text-[13px] leading-none" title="Icona della tab">
                    {t.icon}
                  </span>
                )}
                <button
                  onClick={() => switchEditorTab(t.id)}
                  className={`max-w-40 truncate ${t.id === activeEditorTab ? 'font-bold' : 'font-medium'}`}
                  title={t.title}
                >
                  {t.title}
                </button>
                <button
                  onClick={() => {
                    setTitleDraft(t.title)
                    setDescDraft(t.description ?? '')
                    setIconDraft(t.icon ?? '')
                    setDescEditingTab(t.id)
                  }}
                  className={`rounded p-0.5 opacity-0 transition-opacity hover:bg-zinc-700 group-hover:opacity-100 ${
                    t.description ? '!opacity-100 text-amber-400' : 'text-zinc-400'
                  }`}
                  title={t.description ? `Titolo: ${t.title} â€” Descrizione: ${t.description} (modifica)` : 'Modifica titolo e descrizione della tab'}
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
            </div>
            {tabOverflow && (
              <div className="relative shrink-0">
                <button
                  onClick={() => setOverflowOpen(v => !v)}
                  className={`inline-flex h-7 items-center rounded px-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 ${
                    overflowOpen ? 'bg-zinc-800 text-zinc-200' : ''
                  }`}
                  title={`${editorTabs.length} tab aperte: mostra l'elenco`}
                >
                  <span className="leading-none">Â»</span>
                </button>
                {overflowOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setOverflowOpen(false)} />
                    <div className="absolute right-0 top-full z-50 mt-1 max-h-80 w-72 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
                      <div className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        {editorTabs.length} tab aperte
                      </div>
                      {editorTabs.map(t => (
                        <button
                          key={t.id}
                          onClick={() => {
                            switchEditorTab(t.id)
                            setOverflowOpen(false)
                          }}
                          className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-zinc-800 ${
                            t.id === activeEditorTab ? 'bg-zinc-800/70 text-white' : 'text-zinc-300'
                          }`}
                          title={t.title}
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: dbTabColor(t.database ?? connection.database, dbColors) }}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {t.icon ? `${t.icon} ` : ''}
                            {t.title}
                          </span>
                          {t.pinned && <Pin className="h-3 w-3 shrink-0 text-amber-400" />}
                          {t.id === activeEditorTab && <span className="shrink-0 text-sky-400">â—</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
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
            ref={editorPaneRef}
            className="shrink-0"
            style={{
              flexGrow: resultsVisible ? editorPct : 1,
              flexBasis: 0,
              border: `2px solid ${activeDbColor}`,
              minHeight: 0,
            }}
            title={`Query su database: ${activeDbName} â€” trascina il divisore sotto per ridimensionare`}
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
                onOpenObject={handleOpenObject}
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
                <p className="text-xs text-zinc-700">â€¦oppure trascina un file .sql qui</p>
              </div>
            )}
          </div>

          {resultsVisible && (
            <div
              onMouseDown={startSplitDrag}
              className="group relative z-10 flex h-1.5 shrink-0 cursor-row-resize items-center justify-center border-y border-zinc-800 bg-zinc-900/80 hover:bg-sky-950/60"
              title="Trascina per ridimensionare editor/risultati"
            >
              <div className="h-0.5 w-10 rounded bg-zinc-700 group-hover:bg-sky-400" />
            </div>
          )}

          {resultsVisible && (
            <div
              ref={resultsPaneRef}
              className="flex min-h-0 flex-col"
              style={{ flexGrow: 100 - editorPct, flexBasis: 0 }}
            >
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
                  <ResultsPanel result={activeResult} executing={activeExecuting} sourceSql={activeSql} />
                ) : (
                  <PrintPanel result={activeResult} />
                )}
              </div>
            </div>
          )}
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
      {statsOpen && activeStats && <QueryStatsModal stats={activeStats} onClose={() => setStatsOpen(false)} />}

      {/* Diagramma delle chiamate: chi chiama una routine, fino al chiamante più lontano */}
      {callGraphTarget && (
        <CallGraphModal
          target={callGraphTarget}
          graph={callGraph}
          loading={callGraphLoading}
          error={callGraphError}
          onClose={() => setCallGraphTarget(null)}
          onReload={() => void loadCallGraph(true)}
          onOpenObject={(kind, schema, name) => handleOpenObject(kind, schema, name, 'alter')}
        />
      )}

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
              <StickyNote className="h-4 w-4 text-amber-400" /> Titolo, icona e descrizione della tab
            </h3>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Icona / simbolo / emoji (facoltativa)
            </label>
            <div className="flex items-center gap-2">
              <input
                value={iconDraft}
                onChange={e => setIconDraft(e.target.value)}
                placeholder="es. â­  âœ…  ðŸž  âš ï¸  (anche un simbolo come â˜…  â—†  â†’)"
                maxLength={8}
                className="w-24 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-center text-lg text-zinc-100 placeholder:text-xs placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none"
              />
              <div className="flex flex-1 flex-wrap gap-1">
                {TAB_ICON_PRESETS.map(ic => (
                  <button
                    key={ic}
                    onClick={() => setIconDraft(ic)}
                    title={`Usa ${ic}`}
                    className={`rounded px-1.5 py-0.5 text-base transition-colors hover:bg-zinc-700 ${
                      iconDraft === ic ? 'bg-zinc-700 ring-1 ring-sky-500' : 'bg-zinc-800/60'
                    }`}
                  >
                    {ic}
                  </button>
                ))}
                <button
                  onClick={() => setIconDraft('')}
                  title="Nessuna icona"
                  className="rounded bg-zinc-800/60 px-1.5 py-0.5 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
                >
                  nessuna
                </button>
              </div>
            </div>
            <label className="mb-1 mt-3 block text-xs font-medium text-zinc-400">Titolo</label>
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
              placeholder="Scrivi una nota libera per questa tab (es. 'Report mensile clienti', 'Da controllare', â€¦)"
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
      {/* Menu contestuale della tab (tasto destro): chiusure multiple in stile SSMS */}
      {tabMenu &&
        (() => {
          const anchor = editorTabs.find(t => t.id === tabMenu.id)
          const pinned = !!anchor?.pinned
          const n = (mode: TabCloseMode) => countClosableTabs(editorTabs, tabMenu.id, mode)
          const run = (mode: TabCloseMode) => applyTabClosePlan(tabMenu.id, mode)
          const itemCls =
            'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-600'
          const item = (label: string, count: number, mode: TabCloseMode) => (
            <button className={itemCls} disabled={count === 0} onClick={() => run(mode)}>
              <span className="flex-1">{label}</span>
              <span className="tabular-nums text-zinc-500">{count}</span>
            </button>
          )
          return (
            <>
              <div
                className="fixed inset-0 z-50"
                onClick={() => setTabMenu(null)}
                onContextMenu={e => {
                  e.preventDefault()
                  setTabMenu(null)
                }}
              />
              <div
                className="fixed z-50 min-w-56 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-2xl"
                style={{ left: tabMenu.x, top: tabMenu.y }}
              >
                <div className="flex items-center gap-2 border-b border-zinc-800 px-3 pb-1.5 pt-1">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: dbTabColor(anchor?.database ?? connection.database, dbColors) }}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-100">
                    {anchor?.title ?? 'Tab'}
                  </span>
                  {pinned && (
                    <span className="flex items-center gap-1 text-[10px] text-amber-400">
                      <Pin className="h-3 w-3" /> appuntata
                    </span>
                  )}
                </div>
                <button
                  className={itemCls}
                  disabled={pinned}
                  onClick={() => {
                    const id = tabMenu.id
                    setTabMenu(null)
                    closeEditorTab(id)
                  }}
                  title={pinned ? 'Le tab appuntate non si chiudono: togli prima il pin' : undefined}
                >
                  Chiudi
                </button>
                <button
                  className={itemCls}
                  onClick={() => {
                    const tab = editorTabs.find(t => t.id === tabMenu.id)
                    if (!tab) {
                      setTabMenu(null)
                      return
                    }
                    setTitleDraft(tab.title)
                    setDescDraft(tab.description ?? '')
                    setIconDraft(tab.icon ?? '')
                    setDescEditingTab(tab.id)
                    setTabMenu(null)
                  }}
                >
                  Icona / titolo / descrizioneâ€¦
                </button>
                <div className="my-1 h-px bg-zinc-800" />
                {item('Chiudi tutte le altre', n('others'), 'others')}
                {item('Chiudi quelle a destra', n('right'), 'right')}
                {item('Chiudi quelle a sinistra', n('left'), 'left')}
                <div className="my-1 h-px bg-zinc-800" />
                {item('Chiudi le non appuntate', n('unpinned'), 'unpinned')}
              </div>
            </>
          )
        })()}
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
