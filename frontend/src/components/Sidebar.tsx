import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DragEvent, MouseEvent, ReactNode } from 'react'
import {
  BadgeCheck,
  Braces,
  Boxes,
  ChevronDown,
  ChevronRight,
  Database as DbIcon,
  Eye,
  FileCode2,
  Flame,
  FolderOpen,
  GitMerge,
  History,
  KeyRound,
  Play,
  Plus,
  Rows3,
  Search,
  Share2,
  SquarePen,
  Table2,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import type {
  CheckConstraintInfo,
  ColumnInfo,
  DatabaseSummary,
  ForeignKeyInfo,
  IndexInfo,
  ProcedureInfo,
  TableInfo,
  TriggerInfo,
  ViewInfo,
} from '../types'
import {
  dbColorPalette,
  dbTabColor,
  groupTablesByPrefix,
  indiceVincolo,
  qualified,
  scriptAddConstraint,
  scriptCreateIndex,
  scriptCreateTable,
  scriptDeleteTable,
  scriptDropConstraint,
  scriptDropIndex,
  scriptDropObject,
  scriptCheckConstraint,
  scriptExecProcedure,
  scriptForeignKey,
  scriptInsertTable,
  scriptMergeTable,
  scriptSelectTable,
  scriptUpdateTable,
  searchMatches,
  sqlIdent,
  usageDetail,
} from '../helpers'
import { useDebounce } from '../hooks/useDebounce'
import { Badge, Spinner } from './ui'
import DockPanel from './DockPanel'
import type { PanelPosition } from './DockPanel'
import { DEFAULT_PANEL_STATE, dockSideFromDrop, normalizePanelState, resolveRightDock } from '../panelLayout'
import type { PanelSize, PanelState } from '../panelLayout'
import { ColumnHoverCard, TableHoverCard } from './HoverCards'
import type { HoverRect, HoverTarget } from './HoverCards'
import ChangesModal from './ChangesModal'
import { CLASSE_NODO_ATTIVO, chiaveNodo } from '../treeSelection'

interface Props {
  summary: DatabaseSummary | null
  loading: boolean
  activeDatabase: string
  /** Id della connessione attiva (per backup/ripristino del database). */
  connectionId?: string
  onInsertText: (text: string) => void
  /** Apre la preview (SELECT TOP 100 *) in una nuova tab dell'editor. */
  onPreviewInEditor?: (sql: string) => void
  /** Apre uno script generato (CREATE/MERGE) in una nuova tab con titolo. */
  onOpenScript?: (title: string, sql: string, asChild?: boolean) => void
  /**
   * Apre il REPORT utilizzo tabelle: vive in una TAB (come la Ricerca), non in una finestra
   * (richiesta utente: "la form si apre come le tab").
   */
  onOpenReport?: () => void
  /** Cambia il database attivo (nuova connessione con lo stesso server). */
  onSwitchDatabase?: (database: string) => void
  /** Colori personalizzati per database. */
  dbColors?: Record<string, string>
  /** Imposta/rimuove (null) il colore personalizzato di un database. */
  onSetDbColor?: (database: string, color: string | null) => void
  /** Elemento della colonna destra (in App): qui viene portato il pannello agganciato a destra. */
  rightDockEl: HTMLElement | null
  /** Notifica quale pannello è agganciato a destra (null = nessuno) per mostrare/nascondere la colonna. */
  onRightDockChange: (panel: 'db' | 'objects' | null) => void
  /** Apre una stored procedure / funzione / vista / trigger: 'alter' genera ALTER, 'open' la definizione CREATE.
   *  `asChild`: la tab nasce FIGLIA di quella attiva (voci del tasto destro). */
  onOpenObject?: (
    kind: 'procedure' | 'function' | 'view' | 'trigger',
    schema: string,
    name: string,
    mode: 'alter' | 'open',
    asChild?: boolean,
  ) => void
  /** Apre il DIAGRAMMA delle chiamate di una routine (chi la chiama / cosa chiama). */
  onShowCallGraph?: (schema: string, name: string, kind: 'procedure' | 'function') => void
}

type HitKind = 'tabella' | 'vista' | 'procedura' | 'funzione' | 'trigger' | 'check' | 'indice' | 'vincolo'

/** Voce della sezione "Vincoli" della treeview: chiave primaria, unique, chiave esterna o check. */
interface VoceVincolo {
  nome: string
  tipo: 'PRIMARY KEY' | 'UNIQUE' | 'FOREIGN KEY' | 'CHECK'
  /** Riga di dettaglio (colonne del vincolo, tabella riferita, testo del CHECK). */
  dettaglio: string
  /** Script per (ri)creare il vincolo. */
  sqlCreate: string
  /** Script di cancellazione (ALTER TABLE … DROP CONSTRAINT). */
  sqlDrop: string
  disabilitato?: boolean
}

interface SearchHit {
  kind: HitKind
  schema: string
  name: string
  detail?: string
  /** Oggetto completo quando disponibile (per generare script CREATE/MERGE/EXEC). */
  table?: TableInfo
  proc?: ProcedureInfo
  view?: ViewInfo
  trigger?: TriggerInfo
  check?: CheckConstraintInfo
  /** Indice della tabella (per lo script CREATE/DROP INDEX). */
  index?: IndexInfo
  /** Vincolo della tabella (per gli script ADD/DROP CONSTRAINT). */
  vincolo?: VoceVincolo
}

/** Voce del menu contestuale (SSMS): azione foglia oppure sottomenu "Script ...". */
interface ObjectAction {
  id: string
  label: string
  icon?: ReactNode
  hint?: string
  danger?: boolean
  run?: () => void
  submenu?: ObjectAction[]
}

export default function Sidebar({
  summary,
  loading,
  activeDatabase,
  connectionId,
  onInsertText,
  onPreviewInEditor,
  onOpenScript,
  onOpenReport,
  onOpenObject,
  onShowCallGraph,
  onSwitchDatabase,
  dbColors,
  onSetDbColor,
  rightDockEl,
  onRightDockChange,
}: Props) {
  /**
   * GERARCHIA DELLE TAB: le voci del tasto destro aprono la nuova tab come FIGLIA di quella
   * attiva (richiesta utente: "una tab sotto quella corrente, in senso di gerarchia").
   */
  const apriScriptFiglia = (title: string, sql: string) => onOpenScript?.(title, sql, true)
  const apriOggettoFiglio = (
    kind: 'procedure' | 'function' | 'view' | 'trigger',
    schema: string,
    name: string,
    mode: 'alter' | 'open',
  ) => onOpenObject?.(kind, schema, name, mode, true)

  const [query, setQuery] = useState('')
  /**
   * VOCE SELEZIONATA NELL'ALBERO (richiesta utente: "rendi le voci della treeview selezionabili,
   * adesso non si capisce cosa è selezionato"). Si tiene la CHIAVE della riga cliccata (o cliccata
   * col tasto destro), non l'elemento: sopravvive a espansioni, filtri e nuovi dati.
   */
  const [nodoSel, setNodoSel] = useState<string | null>(() => {
    try {
      return localStorage.getItem('sql-intelli:nodoSel.v1')
    } catch {
      return null
    }
  })
  /** Registra il clic (o il tasto destro) sulla riga dell'albero: `data-nodo` dice quale. */
  const selezionaDaClic = (e: React.MouseEvent | React.FocusEvent) => {
    const riga = (e.target as HTMLElement).closest?.('[data-nodo]')
    if (!riga) return
    const chiave = riga.getAttribute('data-nodo') || null
    if (!chiave || chiave === nodoSel) return
    setNodoSel(chiave)
    try {
      localStorage.setItem('sql-intelli:nodoSel.v1', chiave)
    } catch {
      /* ignora */
    }
  }
  /**
   * La classe dell'evidenziazione si applica DOPO il render, su tutte le righe che dichiarano
   * `data-nodo`: così non serve calcolare la classe in ognuno dei punti in cui si disegna una
   * voce dell'albero (ce ne sono una dozzina) e la riga resta evidenziata anche quando l'albero
   * si ridisegna (espansione di una tabella, ricerca, aggiornamento dello schema).
   */
  useEffect(() => {
    // Si guarda l'intero documento, non solo il ref: un pannello STACCATO (floating) viene
    // disegnato in un portale fuori dalla sidebar, e le sue righe devono evidenziarsi uguale.
    for (const el of document.querySelectorAll('[data-nodo]')) {
      el.classList.toggle(CLASSE_NODO_ATTIVO, el.getAttribute('data-nodo') === nodoSel)
    }
  })
  // Filtro per nome nella lista dei database
  const [dbFilter, setDbFilter] = useState('')
  // Pannelli (stile Visual Studio): database in alto, oggetti+ricerca sotto.
  // Ogni pannello è chiudibile, staccabile (floating), ridimensionabile e agganciabile
  // a sinistra (sidebar) o a destra (colonna laterale); il divider tra i due è spostabile.
  const [panels, setPanels] = useState<PanelState>(() => {
    try {
      const raw = localStorage.getItem('sql-intelli:panels')
      if (raw) return normalizePanelState(JSON.parse(raw))
    } catch {
      /* ignora */
    }
    return DEFAULT_PANEL_STATE
  })
  const persistPanels = (next: PanelState) => {
    setPanels(next)
    try {
      localStorage.setItem('sql-intelli:panels', JSON.stringify(next))
    } catch {
      /* ignora */
    }
  }

  // Pannello attualmente agganciato a destra (al massimo uno)
  const rightPanelId: 'db' | 'objects' | null =
    panels.db.open && !panels.db.floating && panels.db.dockSide === 'right'
      ? 'db'
      : panels.objects.open && !panels.objects.floating && panels.objects.dockSide === 'right'
        ? 'objects'
        : null

  // Mostra/nasconde la colonna destra in App quando cambia l'aggancio
  useEffect(() => {
    onRightDockChange(rightPanelId)
  }, [rightPanelId, onRightDockChange])

  // Trascinamento del divider tra Database e Oggetti (regola l'altezza del pannello DB)
  const sidebarRef = useRef<HTMLDivElement | null>(null)
  const dragDivider = useRef(false)
  const onDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    dragDivider.current = true
    const onMove = (ev: globalThis.MouseEvent) => {
      if (!dragDivider.current) return
      const rect = sidebarRef.current?.getBoundingClientRect()
      if (!rect) return
      const h = Math.min(rect.height - 60, Math.max(60, ev.clientY - rect.top))
      persistPanels({ ...panels, db: { ...panels.db, dockHeight: Math.round(h) } })
    }
    const onUp = () => {
      dragDivider.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const moveDbPanel = (pos: PanelPosition) => persistPanels({ ...panels, db: { ...panels.db, ...pos } })
  const moveObjectsPanel = (pos: PanelPosition) => persistPanels({ ...panels, objects: { ...panels.objects, ...pos } })
  const resizeDbPanel = (size: PanelSize) => persistPanels({ ...panels, db: { ...panels.db, ...size } })
  const resizeObjectsPanel = (size: PanelSize) => persistPanels({ ...panels, objects: { ...panels.objects, ...size } })
  const setDbOpen = (open: boolean) => persistPanels({ ...panels, db: { ...panels.db, open } })
  const setObjectsOpen = (open: boolean) => persistPanels({ ...panels, objects: { ...panels.objects, open } })

  const dockDbLeft = () => persistPanels({ ...panels, db: { ...panels.db, floating: false, dockSide: 'left' } })
  const dockObjectsLeft = () => persistPanels({ ...panels, objects: { ...panels.objects, floating: false, dockSide: 'left' } })

  const floatDb = () => persistPanels({ ...panels, db: { ...panels.db, floating: true } })
  const floatObjects = () => persistPanels({ ...panels, objects: { ...panels.objects, floating: true } })

  // Aggancia a destra: un solo pannello per volta (l'altro, se c'era, torna a sinistra)
  const dockDbRight = () => {
    const { movedToLeft } = resolveRightDock('db', rightPanelId)
    persistPanels({
      ...panels,
      db: { ...panels.db, floating: false, dockSide: 'right' },
      objects: movedToLeft === 'objects' ? { ...panels.objects, floating: false, dockSide: 'left' } : panels.objects,
    })
  }
  const dockObjectsRight = () => {
    const { movedToLeft } = resolveRightDock('objects', rightPanelId)
    persistPanels({
      ...panels,
      objects: { ...panels.objects, floating: false, dockSide: 'right' },
      db: movedToLeft === 'db' ? { ...panels.db, floating: false, dockSide: 'left' } : panels.db,
    })
  }

  // Rilascio del drag di un pannello flottante: sopra la sidebar → sinistra;
  // sul bordo destro dello schermo → destra; altrimenti resta flottante.
  const dbDragEnd = (point: { x: number; y: number }) => {
    const side = dockSideFromDrop(
      point,
      { width: window.innerWidth, height: window.innerHeight },
      sidebarRef.current?.getBoundingClientRect() ?? null,
    )
    if (side === 'left') dockDbLeft()
    else if (side === 'right') dockDbRight()
  }
  const objectsDragEnd = (point: { x: number; y: number }) => {
    const side = dockSideFromDrop(
      point,
      { width: window.innerWidth, height: window.innerHeight },
      sidebarRef.current?.getBoundingClientRect() ?? null,
    )
    if (side === 'left') dockObjectsLeft()
    else if (side === 'right') dockObjectsRight()
  }
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    tables: true,
    views: true,
    programmability: true,
    procedures: true,
    functions: true,
    triggers: true,
  })
  const [hover, setHover] = useState<HoverTarget | null>(null)
  const closeTimer = useRef<number | null>(null)
  // Menu contestuale colore database (tasto destro)
  const [colorMenu, setColorMenu] = useState<{ db: string; x: number; y: number } | null>(null)
  // Menu contestuale oggetti (tasto destro su risultati di ricerca e nodi della tree view)
  const [objectMenu, setObjectMenu] = useState<{ hit: SearchHit; x: number; y: number } | null>(null)
  // Nodo del database attivo: true = oggetti nascosti (nodo chiuso)
  const [collapsedDb, setCollapsedDb] = useState(false)

  // Modifiche agli oggetti (modale): griglia con giorno e ora dell'ultima modifica
  const [changesOpen, setChangesOpen] = useState(false)

  const toggleDbNode = (name: string) => {
    if (name === activeDatabase) {
      setCollapsedDb(v => !v)
    } else {
      setCollapsedDb(false)
      onSwitchDatabase?.(name)
    }
  }
  // Tabelle: gruppi di prefisso e campi delle tabelle chiusi di default
  const [expandedTables, setExpandedTables] = useState<Set<string>>(() => new Set())
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set())

  const tableGroups = useMemo(
    () => (summary ? groupTablesByPrefix(summary.tables) : []),
    [summary],
  )

  // Trigger annidati sotto la loro tabella (stile SSMS); i trigger senza tabella restano "orfani".
  const triggersByTable = useMemo(() => {
    const map = new Map<string, TriggerInfo[]>()
    const orphans: TriggerInfo[] = []
    if (!summary) return { map, orphans }
    const tableByKey = new Map(summary.tables.map(t => [`${t.schema}.${t.name}`.toLowerCase(), t]))
    for (const trg of summary.triggers) {
      const t = tableByKey.get(`${trg.schema}.${trg.tableName}`.toLowerCase())
      if (t) {
        const key = `${t.schema}.${t.name}`
        const arr = map.get(key) ?? []
        arr.push(trg)
        map.set(key, arr)
      } else {
        orphans.push(trg)
      }
    }
    return { map, orphans }
  }, [summary])

  // Vincoli CHECK annidati sotto la loro tabella (stile SSMS), con testo per la modifica
  const checksByTable = useMemo(() => {
    const map = new Map<string, CheckConstraintInfo[]>()
    if (!summary) return map
    const tableByKey = new Map(summary.tables.map(t => [`${t.schema}.${t.name}`.toLowerCase(), t]))
    for (const cc of summary.checkConstraints ?? []) {
      const t = tableByKey.get(`${cc.schema}.${cc.tableName}`.toLowerCase())
      if (!t) continue
      const key = `${t.schema}.${t.name}`
      const arr = map.get(key) ?? []
      arr.push(cc)
      map.set(key, arr)
    }
    return map
  }, [summary])

  /**
   * CHIAVI ESTERNE uscenti raggruppate per tabella (e per nome del vincolo: le FK composite hanno
   * una riga per colonna). Servono alla sezione "Vincoli" della treeview, dove prima le chiavi
   * esterne non comparivano affatto (richiesta utente: "metti nella treeview anche i constraint").
   */
  const foreignKeysByTable = useMemo(() => {
    const map = new Map<string, Map<string, ForeignKeyInfo[]>>()
    if (!summary) return map
    for (const fk of summary.foreignKeys) {
      const key = `${fk.schema}.${fk.table}`
      const perNome = map.get(key) ?? new Map<string, ForeignKeyInfo[]>()
      const gruppo = perNome.get(fk.name) ?? []
      gruppo.push(fk)
      perNome.set(fk.name, gruppo)
      map.set(key, perNome)
    }
    return map
  }, [summary])

  /**
   * VINCOLI di una tabella visti come voci pronte: PRIMARY KEY e UNIQUE (dagli indici),
   * FOREIGN KEY uscenti e CHECK. Ognuna porta gli script CREATE/DROP, così dalla treeview si
   * può generare sia la creazione sia la cancellazione del vincolo.
   */
  const vincoliDiTabella = (t: TableInfo): VoceVincolo[] => {
    const voci: VoceVincolo[] = []
    for (const ix of (t.indexes ?? []).filter(i => indiceVincolo(i))) {
      const tipo = ix.isPrimaryKey ? 'PRIMARY KEY' : 'UNIQUE'
      voci.push({
        nome: ix.name,
        tipo,
        dettaglio: `${tipo}${ix.isClustered ? ' CLUSTERED' : ' NONCLUSTERED'}${(ix.columns ?? []).length > 0 ? ` (${(ix.columns ?? []).join(', ')})` : ''}`,
        sqlCreate: scriptAddConstraint(t, ix),
        sqlDrop: scriptDropConstraint(t.schema, t.name, ix.name),
      })
    }
    const tKey = `${t.schema}.${t.name}`
    for (const [nome, gruppo] of foreignKeysByTable.get(tKey) ?? []) {
      const primi = gruppo[0]
      voci.push({
        nome,
        tipo: 'FOREIGN KEY',
        dettaglio: `(${gruppo.map(g => g.column).join(', ')}) → ${primi.refSchema}.${primi.refTable} (${gruppo.map(g => g.refColumn).join(', ')})`,
        sqlCreate: scriptForeignKey(t.schema, t.name, nome, gruppo),
        sqlDrop: scriptDropConstraint(t.schema, t.name, nome),
      })
    }
    for (const cc of checksByTable.get(tKey) ?? []) {
      voci.push({
        nome: cc.name,
        tipo: 'CHECK',
        dettaglio: cc.definition,
        sqlCreate: scriptCheckConstraint(cc.schema, cc.tableName, cc.name, cc.definition, cc.isDisabled),
        sqlDrop: scriptDropConstraint(cc.schema, cc.tableName, cc.name),
        disabilitato: cc.isDisabled,
      })
    }
    return voci
  }

  const toggleTable = (key: string) =>
    setExpandedTables(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const toggleGroup = (key: string) =>
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    }
  }, [])

  const q = useDebounce(query.trim(), 200)

  const clearCloseTimer = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const scheduleClose = () => {
    clearCloseTimer()
    closeTimer.current = window.setTimeout(() => setHover(null), 250)
  }

  const rectOf = (e: MouseEvent<HTMLElement>): HoverRect => {
    const r = e.currentTarget.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  }

  const hoverTable = (e: MouseEvent<HTMLElement>, table: TableInfo) => {
    clearCloseTimer()
    setHover({ kind: 'table', table, rect: rectOf(e) })
  }

  const hoverColumn = (e: MouseEvent<HTMLElement>, tableName: string, column: ColumnInfo) => {
    clearCloseTimer()
    setHover({ kind: 'column', tableName, column, rect: rectOf(e) })
  }

  const quickPreviewSql = (t: TableInfo) => `SELECT TOP 100 * FROM ${qualified(t.schema, t.name)};\n`
  const select1000 = (schema: string, name: string) => `SELECT TOP (1000) * FROM ${qualified(schema, name)};\n`

  const openObjectMenu = (e: MouseEvent<HTMLElement>, hit: SearchHit) => {
    e.preventDefault()
    setObjectMenu({ hit, x: e.clientX, y: e.clientY })
  }

  /** Azioni contestuali in stile SSMS per il tipo di oggetto. */
  const objectActions = (hit: SearchHit): ObjectAction[] => {
    const qname = qualified(hit.schema, hit.name)
    switch (hit.kind) {
      case 'tabella': {
        const t = hit.table!
        return [
          {
            id: 'select',
            label: 'Seleziona le prime 1000 righe',
            icon: <Rows3 className="h-3.5 w-3.5" />,
            hint: 'SELECT TOP (1000) in una nuova tab',
            run: () => apriScriptFiglia(`SELECT ${qname}`, scriptSelectTable(t)),
          },
          {
            id: 'script',
            label: 'Script tabella',
            icon: <FileCode2 className="h-3.5 w-3.5" />,
            hint: 'Genera lo script della tabella',
            submenu: [
              { id: 'create', label: 'CREATE', icon: <FileCode2 className="h-3.5 w-3.5" />, run: () => apriScriptFiglia(`CREATE ${qname}`, scriptCreateTable(t, { checks: summary?.checkConstraints, foreignKeys: summary?.foreignKeys, triggers: summary?.triggers }, activeDatabase)) },
              { id: 'drop', label: 'DROP', icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, run: () => apriScriptFiglia(`DROP ${qname}`, scriptDropObject('table', hit.schema, hit.name)) },
              { id: 'select', label: 'SELECT', icon: <Rows3 className="h-3.5 w-3.5" />, run: () => apriScriptFiglia(`SELECT ${qname}`, scriptSelectTable(t)) },
              { id: 'insert', label: 'INSERT', icon: <Plus className="h-3.5 w-3.5" />, run: () => apriScriptFiglia(`INSERT ${qname}`, scriptInsertTable(t)) },
              { id: 'update', label: 'UPDATE', icon: <SquarePen className="h-3.5 w-3.5" />, run: () => apriScriptFiglia(`UPDATE ${qname}`, scriptUpdateTable(t)) },
              { id: 'delete', label: 'DELETE', icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, run: () => apriScriptFiglia(`DELETE ${qname}`, scriptDeleteTable(t)) },
              { id: 'merge', label: 'MERGE', icon: <GitMerge className="h-3.5 w-3.5" />, run: () => apriScriptFiglia(`MERGE ${qname}`, scriptMergeTable(t)) },
            ],
          },
        ]
      }
      case 'vista':
        return [
          {
            id: 'select',
            label: 'Seleziona le prime 1000 righe',
            icon: <Rows3 className="h-3.5 w-3.5" />,
            hint: 'SELECT TOP (1000) in una nuova tab',
            run: () => apriScriptFiglia(`SELECT ${qname}`, select1000(hit.schema, hit.name)),
          },
          {
            id: 'script',
            label: 'Script vista',
            icon: <FileCode2 className="h-3.5 w-3.5" />,
            hint: 'Genera lo script della vista',
            submenu: [
              { id: 'create', label: 'CREATE', icon: <FileCode2 className="h-3.5 w-3.5" />, run: () => apriOggettoFiglio('view', hit.schema, hit.name, 'open') },
              { id: 'alter', label: 'CREATE OR ALTER', icon: <SquarePen className="h-3.5 w-3.5" />, run: () => apriOggettoFiglio('view', hit.schema, hit.name, 'alter') },
              { id: 'drop', label: 'DROP', icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, run: () => apriScriptFiglia(`DROP ${qname}`, scriptDropObject('view', hit.schema, hit.name)) },
              { id: 'select', label: 'SELECT', icon: <Rows3 className="h-3.5 w-3.5" />, run: () => apriScriptFiglia(`SELECT ${qname}`, select1000(hit.schema, hit.name)) },
            ],
          },
        ]
      case 'procedura': {
        const p = hit.proc!
        return [
          {
            id: 'exec',
            label: 'Esegui stored procedure',
            icon: <Play className="h-3.5 w-3.5" />,
            hint: 'Inserisci EXEC con i parametri',
            run: () => onInsertText(scriptExecProcedure(p)),
          },
          {
            id: 'modify',
            label: 'Modifica',
            icon: <SquarePen className="h-3.5 w-3.5" />,
            hint: 'Genera CREATE OR ALTER PROCEDURE in una nuova tab',
            run: () => apriOggettoFiglio('procedure', hit.schema, hit.name, 'alter'),
          },
          {
            id: 'callgraph',
            label: 'Diagramma chiamate',
            icon: <Share2 className="h-3.5 w-3.5" />,
            hint: 'Chi la chiama, fino al chiamante più lontano (cicli segnalati)',
            run: () => onShowCallGraph?.(hit.schema, hit.name, 'procedure'),
          },
          {
            id: 'script',
            label: 'Script stored procedure',
            icon: <FileCode2 className="h-3.5 w-3.5" />,
            hint: 'Genera lo script della stored procedure',
            submenu: [
              { id: 'create', label: 'CREATE', icon: <FileCode2 className="h-3.5 w-3.5" />, run: () => apriOggettoFiglio('procedure', hit.schema, hit.name, 'open') },
              { id: 'alter', label: 'CREATE OR ALTER', icon: <SquarePen className="h-3.5 w-3.5" />, run: () => apriOggettoFiglio('procedure', hit.schema, hit.name, 'alter') },
              { id: 'drop', label: 'DROP', icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, run: () => apriScriptFiglia(`DROP ${qname}`, scriptDropObject('procedure', hit.schema, hit.name)) },
              { id: 'execute', label: 'EXECUTE', icon: <Play className="h-3.5 w-3.5" />, run: () => onInsertText(scriptExecProcedure(p)) },
            ],
          },
        ]
      }
      case 'funzione':
        return [
          {
            id: 'modify',
            label: 'Modifica',
            icon: <SquarePen className="h-3.5 w-3.5" />,
            hint: 'Genera CREATE OR ALTER FUNCTION in una nuova tab',
            run: () => apriOggettoFiglio('function', hit.schema, hit.name, 'alter'),
          },
          {
            id: 'callgraph',
            label: 'Diagramma chiamate',
            icon: <Share2 className="h-3.5 w-3.5" />,
            hint: 'Chi la chiama, fino al chiamante più lontano (cicli segnalati)',
            run: () => onShowCallGraph?.(hit.schema, hit.name, 'function'),
          },
          {
            id: 'script',
            label: 'Script funzione',
            icon: <FileCode2 className="h-3.5 w-3.5" />,
            hint: 'Genera lo script della funzione',
            submenu: [
              { id: 'create', label: 'CREATE', icon: <FileCode2 className="h-3.5 w-3.5" />, run: () => apriOggettoFiglio('function', hit.schema, hit.name, 'open') },
              { id: 'alter', label: 'CREATE OR ALTER', icon: <SquarePen className="h-3.5 w-3.5" />, run: () => apriOggettoFiglio('function', hit.schema, hit.name, 'alter') },
              { id: 'drop', label: 'DROP', icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, run: () => apriScriptFiglia(`DROP ${qname}`, scriptDropObject('function', hit.schema, hit.name)) },
            ],
          },
        ]
      case 'trigger':
        return [
          {
            id: 'modify',
            label: 'Modifica',
            icon: <SquarePen className="h-3.5 w-3.5" />,
            hint: 'Genera CREATE OR ALTER TRIGGER in una nuova tab',
            run: () => apriOggettoFiglio('trigger', hit.schema, hit.name, 'alter'),
          },
          {
            id: 'script',
            label: 'Script trigger',
            icon: <FileCode2 className="h-3.5 w-3.5" />,
            hint: 'Genera lo script del trigger',
            submenu: [
              { id: 'create', label: 'CREATE', icon: <FileCode2 className="h-3.5 w-3.5" />, run: () => apriOggettoFiglio('trigger', hit.schema, hit.name, 'open') },
              { id: 'alter', label: 'CREATE OR ALTER', icon: <SquarePen className="h-3.5 w-3.5" />, run: () => apriOggettoFiglio('trigger', hit.schema, hit.name, 'alter') },
              { id: 'drop', label: 'DROP', icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, run: () => apriScriptFiglia(`DROP ${qname}`, scriptDropObject('trigger', hit.schema, hit.name)) },
            ],
          },
        ]
      case 'check': {
        const cc = hit.check!
        const label = `Vincolo CHECK ${cc.name}`
        return [
          {
            id: 'modify',
            label: 'Modifica (ALTER TABLE …)',
            icon: <SquarePen className="h-3.5 w-3.5" />,
            hint: 'Apre ALTER TABLE … ADD CONSTRAINT CHECK in una nuova tab per vedere/modificare il vincolo',
            run: () =>
              apriScriptFiglia(
                label,
                scriptCheckConstraint(cc.schema, cc.tableName, cc.name, cc.definition, cc.isDisabled),
              ),
          },
        ]
      }
      /**
       * INDICE: come in SSMS "Script Index as →", con CREATE e DROP. Per un indice che è in
       * realtà un vincolo (PK / UNIQUE CONSTRAINT) lo script di cancellazione è quello giusto
       * (ALTER TABLE … DROP CONSTRAINT): lo decide scriptDropIndex.
       */
      case 'indice': {
        const t = hit.table!
        const ix = hit.index!
        const label = `Indice ${ix.name}`
        const tipo = `${ix.isUnique ? 'UNIQUE ' : ''}${ix.isClustered ? 'CLUSTERED' : 'NONCLUSTERED'}`
        return [
          {
            id: 'script',
            label: 'Script indice',
            icon: <FileCode2 className="h-3.5 w-3.5" />,
            hint: `${tipo} INDEX ${ix.name}`,
            submenu: [
              {
                id: 'create',
                label: 'CREATE',
                icon: <FileCode2 className="h-3.5 w-3.5" />,
                run: () => apriScriptFiglia(`CREATE ${label}`, scriptCreateIndex(t, ix)),
              },
              {
                id: 'drop',
                label: 'DROP',
                icon: <Trash2 className="h-3.5 w-3.5" />,
                danger: true,
                run: () => apriScriptFiglia(`DROP ${label}`, scriptDropIndex(t, ix)),
              },
            ],
          },
          {
            id: 'copy',
            label: 'Copia nome',
            icon: <Braces className="h-3.5 w-3.5" />,
            run: () => void navigator.clipboard?.writeText(sqlIdent(ix.name)),
          },
        ]
      }
      /**
       * VINCOLO (PRIMARY KEY, UNIQUE, FOREIGN KEY, CHECK): gli script per ricrearlo e per
       * cancellarlo con ALTER TABLE … DROP CONSTRAINT.
       */
      case 'vincolo': {
        const v = hit.vincolo!
        const label = `${v.tipo} ${v.nome}`
        return [
          {
            id: 'script',
            label: 'Script vincolo',
            icon: <FileCode2 className="h-3.5 w-3.5" />,
            hint: v.dettaglio,
            submenu: [
              {
                id: 'create',
                label: v.tipo === 'FOREIGN KEY' ? 'ADD CONSTRAINT' : 'CREATE',
                icon: <FileCode2 className="h-3.5 w-3.5" />,
                run: () => apriScriptFiglia(label, v.sqlCreate),
              },
              {
                id: 'drop',
                label: 'DROP CONSTRAINT',
                icon: <Trash2 className="h-3.5 w-3.5" />,
                danger: true,
                run: () => apriScriptFiglia(`DROP ${label}`, v.sqlDrop),
              },
            ],
          },
          {
            id: 'copy',
            label: 'Copia nome',
            icon: <Braces className="h-3.5 w-3.5" />,
            run: () => void navigator.clipboard?.writeText(sqlIdent(v.nome)),
          },
        ]
      }
    }
  }

  const hits = useMemo<SearchHit[]>(() => {
    if (!summary || !q) return []
    const match = (schema: string, name: string) => searchMatches(q, name, schema)
    const out: SearchHit[] = []
    for (const t of summary.tables)
      if (match(t.schema, t.name))
        out.push({ kind: 'tabella', schema: t.schema, name: t.name, detail: `${t.columnCount} col.`, table: t })
    for (const v of summary.views)
      if (match(v.schema, v.name)) out.push({ kind: 'vista', schema: v.schema, name: v.name, view: v })
    for (const p of summary.procedures)
      if (match(p.schema, p.name)) out.push({ kind: 'procedura', schema: p.schema, name: p.name, proc: p })
    for (const f of summary.functions)
      if (match(f.schema, f.name)) out.push({ kind: 'funzione', schema: f.schema, name: f.name })
    for (const t of summary.triggers)
      if (match(t.schema, t.name))
        out.push({ kind: 'trigger', schema: t.schema, name: t.name, detail: t.tableName, trigger: t })
    return out.slice(0, 100)
  }, [summary, q])

  const toggle = (key: string) => setOpenSections(s => ({ ...s, [key]: !s[key] }))

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500">
        <Spinner /> Caricamento metadati…
      </div>
    )
  }

  if (!summary) {
    return <div className="p-4 text-sm text-zinc-600">Metadati non disponibili.</div>
  }

  const clearCloseTimerAndHover = () => {
    clearCloseTimer()
    setHover(null)
  }

  // Contenuti dei pannelli: riutilizzati in ogni posizione (ancorato a sinistra,
  // flottante o ancorato a destra via portal)
  const dbListContent = () => {
    const q = dbFilter.trim().toLowerCase()
    // il database attivo resta sempre visibile (anche se non corrisponde al filtro)
    const dbs = q
      ? summary.databases.filter(d => d.name.toLowerCase().includes(q) || d.name === activeDatabase)
      : summary.databases
    return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Filtro per nome database */}
      <div className="shrink-0 border-b border-zinc-800 p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            value={dbFilter}
            onChange={e => setDbFilter(e.target.value)}
            placeholder="Filtra database…"
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 py-1 pl-8 pr-7 text-xs text-zinc-100 placeholder-zinc-600 focus:border-sky-500 focus:outline-none"
            title="Filtra i database per nome"
          />
          {dbFilter && (
            <button
              onClick={() => setDbFilter('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              title="Cancella il filtro"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
      {dbs.length === 0 && q && (
        <p className="p-2 text-xs text-zinc-600">Nessun database corrisponde a "{dbFilter}".</p>
      )}
      {dbs.map(d => {
        const isActive = d.name === activeDatabase
        const isOpen = isActive && !collapsedDb
        const objectCount =
          isActive
            ? summary.tables.length +
              summary.views.length +
              summary.procedures.length +
              summary.functions.length +
              summary.triggers.length
            : 0
        return (
          <div key={d.name}>
            <button
              onClick={() => toggleDbNode(d.name)}
              data-nodo={chiaveNodo('db', d.name)}
              onContextMenu={e => {
                e.preventDefault()
                setColorMenu({ db: d.name, x: e.clientX, y: e.clientY })
              }}
              className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs font-semibold transition-colors ${
                isActive ? 'text-sky-300' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
              }`}
              title={`${d.name}${isActive ? ' (attivo)' : ''} — click per ${isActive ? 'aprire/chiudere gli oggetti' : 'attivare'}, tasto destro per il colore`}
            >
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              )}
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: dbTabColor(d.name, dbColors) }}
              />
              <span className="min-w-0 break-all font-mono">{d.name}</span>
              {isActive && <Badge tone="sky">attivo</Badge>}
              {isActive && objectCount > 0 && (
                <span className="ml-auto rounded-full bg-zinc-800 px-1.5 text-[10px] text-zinc-400">
                  {objectCount}
                </span>
              )}
            </button>
          </div>
        )
      })}
      </div>
      {/* Report utilizzo tabelle del database attivo + MODIFICHE agli oggetti (giorno e ora) */}
      {connectionId && (
        <div className="shrink-0 space-y-1 border-t border-zinc-800 p-2">
          <button
            onClick={() => onOpenReport?.()}
            className="flex w-full items-center justify-center gap-1.5 rounded border border-zinc-700 px-2 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-sky-700 hover:bg-sky-950/30 hover:text-sky-300"
            title="Report utilizzo tabelle: spazio riservato/usato, dati, indici, righe e accessi — si apre in una tab"
            data-report="apri"
          >
            <Rows3 className="h-3.5 w-3.5 text-sky-400" /> Report utilizzo tabelle
          </button>
          <button
            onClick={() => setChangesOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded border border-zinc-700 px-2 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-amber-700 hover:bg-amber-950/30 hover:text-amber-300"
            title="Modifiche agli oggetti: la griglia con store, funzioni, viste, tabelle e trigger e QUANDO sono stati modificati (giorno e ora) — ordinabile per colonna"
            data-modifiche="apri"
          >
            <History className="h-3.5 w-3.5 text-amber-400" /> Modifiche agli oggetti
          </button>
        </div>
      )}
    </div>
    )
  }

  const objectsContent = () => (
    <>
      <div className="shrink-0 border-b border-zinc-800 p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Cerca (spazio = %): tabella, proc…"
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 py-1.5 pl-8 pr-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-sky-500 focus:outline-none"
          />
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto p-2"
        onScroll={clearCloseTimerAndHover}
      >
        {q ? (
          <div className="space-y-0.5 border-t border-zinc-800 pt-2">
            {hits.length === 0 && <p className="p-3 text-sm text-zinc-600">Nessun oggetto trovato.</p>}
            {hits.map((h, i) => {
              const isProc = h.kind === 'procedura'
              return (
                <button
                  key={`${h.kind}-${h.schema}-${h.name}-${i}`}
                  data-nodo={chiaveNodo(h.kind, h.schema, h.name)}
                  onClick={isProc ? undefined : () => onInsertText(qualified(h.schema, h.name))}
                  onContextMenu={e => openObjectMenu(e, h)}
                  draggable={isProc}
                  onDragStart={
                    isProc && h.proc
                      ? e => {
                          e.dataTransfer.setData('text/plain', scriptExecProcedure(h.proc!))
                          e.dataTransfer.effectAllowed = 'copy'
                        }
                      : undefined
                  }
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px] text-zinc-200 transition-colors hover:bg-zinc-800 ${
                    isProc ? 'cursor-grab active:cursor-grabbing' : ''
                  }`}
                  title={
                    isProc
                      ? 'Trascina nel editor per generare EXEC con i parametri — tasto destro per le azioni'
                      : 'Clicca per inserire nel editor — tasto destro per le azioni'
                  }
                >
                  <KindIcon kind={h.kind} />
                  <span className="min-w-0 break-all font-mono">{h.name}</span>
                  {h.schema !== 'dbo' && <span className="text-zinc-500">· {h.schema}</span>}
                  <span className="ml-auto">
                    <Badge tone="zinc">{h.kind}</Badge>
                  </span>
                </button>
              )
            })}
          </div>
        ) : !collapsedDb ? (
          <div className="space-y-1 border-t border-zinc-800 pt-2 pl-2">
            <Section
              title="Tabelle"
              icon={<Table2 className="h-4 w-4 text-sky-400" />}
              count={summary.tables.length}
              open={!!openSections.tables}
              onToggle={() => toggle('tables')}
            >
              {tableGroups.map(g => {
                const groupOpen = openGroups.has(g.key)
                return (
                  <div key={g.key}>
                    <button
                      onClick={() => toggleGroup(g.key)}
                      data-nodo={chiaveNodo('schema', g.key)}
                      className="flex w-full items-center gap-1.5 rounded px-2 py-1 pl-2 text-left text-xs font-semibold text-zinc-400 transition-colors hover:bg-zinc-800/70 hover:text-zinc-200"
                    >
                      {groupOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      <span>{g.label}</span>
                      <span className="ml-auto rounded-full bg-zinc-800 px-1.5 text-[10px] text-zinc-400">
                        {g.tables.length}
                      </span>
                    </button>
                    {groupOpen && (
                      <div className="mt-0.5 space-y-0.5">
                        {g.tables.map(t => {
                          const tKey = `${t.schema}.${t.name}`
                          const expanded = expandedTables.has(tKey)
                          const tableTriggers = triggersByTable.map.get(tKey) ?? []
                          // INDICI veri (non vincoli: PK/UNIQUE CONSTRAINT stanno fra i vincoli)
                          const indiciVeri = (t.indexes ?? []).filter(ix => !indiceVincolo(ix))
                          // VINCOLI: chiave primaria, unique, chiavi esterne uscenti e CHECK
                          const vincoli = expanded ? vincoliDiTabella(t) : []
                          return (
                            <TableRow
                              key={tKey}
                              nodo={chiaveNodo('tabella', t.schema, t.name)}
                              label={t.schema !== 'dbo' ? `${t.schema}.${t.name}` : t.name}
                              badge={`${t.columnCount}`}
                              usageText={usageDetail(t.usage)}
                              expanded={expanded}
                              onToggleExpand={() => toggleTable(tKey)}
                              onInsert={() => onInsertText(qualified(t.schema, t.name))}
                              onHover={e => hoverTable(e, t)}
                              onHoverLeave={scheduleClose}
                              onQuickPreview={onPreviewInEditor ? () => onPreviewInEditor(quickPreviewSql(t)) : undefined}
                              onContextMenu={e =>
                                openObjectMenu(e, { kind: 'tabella', schema: t.schema, name: t.name, table: t })
                              }
                            >
                              {expanded && (
                                <>
                                  <div className="pl-9 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                                    Colonne
                                  </div>
                                  {t.columns?.map(c => (
                                    <button
                                      key={c.name}
                                      data-nodo={chiaveNodo('colonna', t.schema, t.name, c.name)}
                                      onClick={() => onInsertText(sqlIdent(c.name))}
                                      onMouseEnter={e => hoverColumn(e, t.name, c)}
                                      onMouseLeave={scheduleClose}
                                      className="flex w-full items-center gap-2 rounded px-2 py-0.5 pl-10 text-left text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                                      title={`${c.dataType}${c.isNullable ? ' NULL' : ''}${c.isIdentity ? ' IDENTITY' : ''}`}
                                    >
                                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.isIdentity ? 'bg-amber-400' : c.isNullable ? 'bg-zinc-600' : 'bg-emerald-500'}`} />
                                      <span className="min-w-0 break-all font-mono">{c.name}</span>
                                      <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-600">{c.dataType}</span>
                                    </button>
                                  ))}
                                  {indiciVeri.length > 0 && (
                                    <>
                                      <div className="pl-9 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                                        Indici
                                      </div>
                                      {indiciVeri.map(ix => (
                                        <button
                                          key={ix.name}
                                          data-nodo={chiaveNodo('indice', t.schema, t.name, ix.name)}
                                          onClick={() => apriScriptFiglia(`Indice ${ix.name}`, scriptCreateIndex(t, ix))}
                                          onContextMenu={e =>
                                            openObjectMenu(e, {
                                              kind: 'indice',
                                              schema: t.schema,
                                              name: ix.name,
                                              detail: t.name,
                                              table: t,
                                              index: ix,
                                            })
                                          }
                                          className="flex w-full items-center gap-2 rounded px-2 py-0.5 pl-10 text-left text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                                          title={`${ix.isUnique ? 'UNIQUE ' : ''}${ix.isClustered ? 'CLUSTERED' : 'NONCLUSTERED'} INDEX ${ix.name}${
                                            (ix.columns ?? []).length > 0 ? `\nColonne: ${(ix.columns ?? []).join(', ')}` : ''
                                          }${
                                            (ix.includedColumns ?? []).length > 0 ? `\nINCLUDE: ${(ix.includedColumns ?? []).join(', ')}` : ''
                                          }${ix.filterDefinition ? `\nFiltro: ${ix.filterDefinition}` : ''}\nClicca per lo script CREATE — tasto destro per CREATE/DROP`}
                                        >
                                          <KeyRound className="h-3 w-3 shrink-0 text-sky-400/70" />
                                          <span className="min-w-0 break-all font-mono">{ix.name}</span>
                                          {ix.isUnique && (
                                            <span className="shrink-0 rounded bg-zinc-800 px-1 text-[9px] font-semibold uppercase text-zinc-400">UNIQUE</span>
                                          )}
                                          {ix.isClustered && (
                                            <span className="shrink-0 rounded bg-zinc-800 px-1 text-[9px] font-semibold uppercase text-sky-300/80">CLUSTERED</span>
                                          )}
                                          {ix.columns && ix.columns.length > 0 && (
                                            <span className="ml-auto min-w-0 break-all text-right font-mono text-[10px] text-zinc-600">
                                              {ix.columns.join(', ')}
                                            </span>
                                          )}
                                        </button>
                                      ))}
                                    </>
                                  )}
                                  {vincoli.length > 0 && (
                                    <div className="pl-9 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                                      Vincoli
                                    </div>
                                  )}
                                  {vincoli.map(v => (
                                    <button
                                      key={`${v.tipo}:${v.nome}`}
                                      data-nodo={chiaveNodo('vincolo', t.schema, t.name, v.nome)}
                                      onClick={() => apriScriptFiglia(`${v.tipo} ${v.nome}`, v.sqlCreate)}
                                      onContextMenu={e =>
                                        openObjectMenu(e, {
                                          kind: 'vincolo',
                                          schema: t.schema,
                                          name: v.nome,
                                          detail: t.name,
                                          table: t,
                                          vincolo: v,
                                        })
                                      }
                                      className="flex w-full items-center gap-2 rounded px-2 py-0.5 pl-10 text-left text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                                      title={`${v.tipo} ${v.nome}\n${v.dettaglio}\nClicca per lo script di creazione — tasto destro per CREATE/DROP`}
                                    >
                                      {v.tipo === 'CHECK' ? (
                                        <BadgeCheck className="h-3 w-3 shrink-0 text-emerald-400/70" />
                                      ) : v.tipo === 'FOREIGN KEY' ? (
                                        <Share2 className="h-3 w-3 shrink-0 text-violet-400/70" />
                                      ) : (
                                        <KeyRound className="h-3 w-3 shrink-0 text-amber-400/70" />
                                      )}
                                      <span className="min-w-0 break-all font-mono">{v.nome}</span>
                                      <span
                                        className={`shrink-0 rounded px-1 text-[9px] font-bold uppercase ${
                                          v.tipo === 'PRIMARY KEY'
                                            ? 'bg-amber-950/70 text-amber-300'
                                            : v.tipo === 'FOREIGN KEY'
                                              ? 'bg-violet-950/70 text-violet-300'
                                              : 'bg-zinc-800 text-zinc-400'
                                        }`}
                                      >
                                        {v.tipo === 'PRIMARY KEY' ? 'PK' : v.tipo === 'FOREIGN KEY' ? 'FK' : v.tipo}
                                      </span>
                                      {v.disabilitato && (
                                        <span className="shrink-0 rounded bg-zinc-800 px-1 text-[9px] font-semibold uppercase text-amber-400">off</span>
                                      )}
                                    </button>
                                  ))}
                                  {tableTriggers.length > 0 && (
                                    <div className="pl-9 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                                      Trigger
                                    </div>
                                  )}
                                  {tableTriggers.map(trg => (
                                    <button
                                      key={trg.name}
                                      data-nodo={chiaveNodo('trigger', trg.schema, trg.name)}
                                      onClick={() => onInsertText(qualified(trg.schema, trg.name))}
                                      onContextMenu={e =>
                                        openObjectMenu(e, { kind: 'trigger', schema: trg.schema, name: trg.name, detail: trg.tableName, trigger: trg })
                                      }
                                      className="flex w-full items-center gap-2 rounded px-2 py-0.5 pl-10 text-left text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                                      title="Clicca per inserire — tasto destro per le azioni"
                                    >
                                      <Flame className="h-3 w-3 shrink-0 text-rose-400/70" />
                                      <span className="min-w-0 break-all font-mono">{trg.name}</span>
                                    </button>
                                  ))}
                                </>
                              )}
                            </TableRow>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </Section>

            <Section
              title="Viste"
              icon={<Eye className="h-4 w-4 text-violet-400" />}
              count={summary.views.length}
              open={!!openSections.views}
              onToggle={() => toggle('views')}
            >
              {summary.views.map(v => (
                <ObjectRow
                  key={`${v.schema}.${v.name}`}
                  nodo={chiaveNodo('vista', v.schema, v.name)}
                  label={v.schema !== 'dbo' ? `${v.schema}.${v.name}` : v.name}
                  onInsert={() => onInsertText(qualified(v.schema, v.name))}
                  onContextMenu={e =>
                    openObjectMenu(e, { kind: 'vista', schema: v.schema, name: v.name, view: v })
                  }
                />
              ))}
            </Section>

            <Section
              title="Programmabilità"
              icon={<Braces className="h-4 w-4 text-indigo-400" />}
              count={summary.procedures.length + summary.functions.length + summary.triggers.length}
              open={!!openSections.programmability}
              onToggle={() => toggle('programmability')}
            >
              <div className="space-y-1 pl-2">
                <Section
                  title="Stored Procedure"
                  icon={<FileCode2 className="h-3.5 w-3.5 text-emerald-400" />}
                  count={summary.procedures.length}
                  open={!!openSections.procedures}
                  onToggle={() => toggle('procedures')}
                  nested
                >
                  {summary.procedures.map(p => (
                    <ObjectRow
                      key={`${p.schema}.${p.name}`}
                      nodo={chiaveNodo('procedura', p.schema, p.name)}
                      label={p.schema !== 'dbo' ? `${p.schema}.${p.name}` : p.name}
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.setData('text/plain', scriptExecProcedure(p))
                        e.dataTransfer.effectAllowed = 'copy'
                      }}
                      onContextMenu={e =>
                        openObjectMenu(e, { kind: 'procedura', schema: p.schema, name: p.name, proc: p })
                      }
                    >
                      {p.parameters?.map(par => (
                        <div key={par.name} className="flex items-center gap-2 py-0.5 pl-9 text-xs text-zinc-500">
                          <span className="font-mono text-zinc-400">@{par.name}</span>
                          <span className="font-mono text-[10px] text-zinc-600">
                            {par.dataType} {par.mode}
                          </span>
                        </div>
                      ))}
                    </ObjectRow>
                  ))}
                </Section>

                <Section
                  title="Funzioni"
                  icon={<Zap className="h-3.5 w-3.5 text-amber-400" />}
                  count={summary.functions.length}
                  open={!!openSections.functions}
                  onToggle={() => toggle('functions')}
                  nested
                >
                  {summary.functions.map(f => (
                    <ObjectRow
                      key={`${f.schema}.${f.name}`}
                      nodo={chiaveNodo('funzione', f.schema, f.name)}
                      label={f.schema !== 'dbo' ? `${f.schema}.${f.name}` : f.name}
                      onInsert={() => onInsertText(qualified(f.schema, f.name))}
                      onContextMenu={e =>
                        openObjectMenu(e, { kind: 'funzione', schema: f.schema, name: f.name })
                      }
                    />
                  ))}
                </Section>

                {triggersByTable.orphans.length > 0 && (
                  <Section
                    title="Trigger"
                    icon={<Flame className="h-3.5 w-3.5 text-rose-400" />}
                    count={triggersByTable.orphans.length}
                    open={!!openSections.triggers}
                    onToggle={() => toggle('triggers')}
                    nested
                  >
                    {triggersByTable.orphans.map(t => (
                      <ObjectRow
                        key={`${t.schema}.${t.tableName}.${t.name}`}
                        nodo={chiaveNodo('trigger', t.schema, t.name)}
                        label={t.name}
                        detail={t.schema !== 'dbo' ? `${t.schema}.${t.tableName}` : t.tableName}
                        onInsert={() => onInsertText(qualified(t.schema, t.name))}
                        onContextMenu={e =>
                          openObjectMenu(e, { kind: 'trigger', schema: t.schema, name: t.name, detail: t.tableName, trigger: t })
                        }
                      />
                    ))}
                  </Section>
                )}
              </div>
            </Section>
          </div>
        ) : null}
      </div>
    </>
  )

  const dbDockedLeft = panels.db.open && !panels.db.floating && panels.db.dockSide === 'left'
  const objectsDockedLeft = panels.objects.open && !panels.objects.floating && panels.objects.dockSide === 'left'
  const dbFloating = panels.db.open && panels.db.floating
  const objectsFloating = panels.objects.open && panels.objects.floating

  return (
    <div
      ref={sidebarRef}
      className="flex h-full flex-col"
      // La selezione delle voci dell'albero si prende QUI (delegata): ogni riga dichiara
      // `data-nodo`, quindi non serve un gestore per riga. Il tasto destro seleziona pure lui.
      onClickCapture={selezionaDaClic}
      onContextMenuCapture={selezionaDaClic}
    >
      {/* Pannello DATABASE ancorato a sinistra: lista dei database */}
      {dbDockedLeft && (
        <DockPanel
          title="Database"
          icon={<DbIcon className="h-3.5 w-3.5 text-sky-400" />}
          floating={false}
          position={{ x: panels.db.x, y: panels.db.y }}
          onMove={moveDbPanel}
          onClose={() => setDbOpen(false)}
          onToggleFloat={floatDb}
          accent="text-sky-300"
          dockClassName="shrink-0"
          dbHeight={panels.db.dockHeight}
          onScroll={clearCloseTimerAndHover}
        >
          {dbListContent()}
        </DockPanel>
      )}

      {/* Divider spostabile tra Database e Oggetti (solo quando entrambi sono ancorati a sinistra) */}
      {dbDockedLeft && objectsDockedLeft && (
        <div
          onMouseDown={onDividerMouseDown}
          className="group relative z-10 flex h-2 shrink-0 cursor-row-resize items-center justify-center border-y border-zinc-800 bg-zinc-900/80 hover:bg-sky-950/60"
          title="Trascina per ridimensionare"
        >
          <div className="h-0.5 w-8 rounded bg-zinc-700 group-hover:bg-sky-400" />
        </div>
      )}

      {/* Pannello OGGETTI ancorato a sinistra: ricerca + albero */}
      {objectsDockedLeft && (
        <DockPanel
          title="Oggetti"
          icon={<Boxes className="h-3.5 w-3.5 text-emerald-400" />}
          floating={false}
          position={{ x: panels.objects.x, y: panels.objects.y }}
          onMove={moveObjectsPanel}
          onClose={() => setObjectsOpen(false)}
          onToggleFloat={floatObjects}
          accent="text-emerald-300"
          dockClassName="min-h-0 flex-1"
          bodyClassName="flex flex-col overflow-hidden"
          onScroll={clearCloseTimerAndHover}
        >
          {objectsContent()}
        </DockPanel>
      )}

      {/* Barra per riaprire i pannelli chiusi */}
      {(!panels.db.open || !panels.objects.open) && (
        <div className="flex shrink-0 items-center gap-1 border-t border-zinc-800 bg-zinc-900/80 px-2 py-1">
          <span className="text-[10px] uppercase tracking-wide text-zinc-600">Pannelli:</span>
          {!panels.db.open && (
            <button
              onClick={() => setDbOpen(true)}
              className="rounded px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              + Database
            </button>
          )}
          {!panels.objects.open && (
            <button
              onClick={() => setObjectsOpen(true)}
              className="rounded px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              + Oggetti
            </button>
          )}
        </div>
      )}

      {/* Pannello DATABASE flottante (trascinabile e ridimensionabile) */}
      {dbFloating && (
        <DockPanel
          title="Database"
          icon={<DbIcon className="h-3.5 w-3.5 text-sky-400" />}
          floating
          position={{ x: panels.db.x, y: panels.db.y }}
          size={{ width: panels.db.width, height: panels.db.height }}
          onMove={moveDbPanel}
          onDragEnd={dbDragEnd}
          onResize={resizeDbPanel}
          onClose={() => setDbOpen(false)}
          onDockLeft={dockDbLeft}
          onDockRight={dockDbRight}
          accent="text-sky-300"
          onScroll={clearCloseTimerAndHover}
        >
          {dbListContent()}
        </DockPanel>
      )}

      {/* Pannello OGGETTI flottante (trascinabile e ridimensionabile) */}
      {objectsFloating && (
        <DockPanel
          title="Oggetti"
          icon={<Boxes className="h-3.5 w-3.5 text-emerald-400" />}
          floating
          position={{ x: panels.objects.x, y: panels.objects.y }}
          size={{ width: panels.objects.width, height: panels.objects.height }}
          onMove={moveObjectsPanel}
          onDragEnd={objectsDragEnd}
          onResize={resizeObjectsPanel}
          onClose={() => setObjectsOpen(false)}
          onDockLeft={dockObjectsLeft}
          onDockRight={dockObjectsRight}
          accent="text-emerald-300"
          bodyClassName="flex flex-col overflow-hidden"
          onScroll={clearCloseTimerAndHover}
        >
          {objectsContent()}
        </DockPanel>
      )}

      {/* Pannelli ancorati a DESTRA: il contenuto viene portato nella colonna destra di App */}
      {rightDockEl && panels.db.open && !panels.db.floating && panels.db.dockSide === 'right' &&
        createPortal(
          <DockPanel
            title="Database"
            icon={<DbIcon className="h-3.5 w-3.5 text-sky-400" />}
            floating={false}
            position={{ x: 0, y: 0 }}
            onMove={() => {}}
            onClose={() => setDbOpen(false)}
            onToggleFloat={floatDb}
            accent="text-sky-300"
            dockClassName="min-h-0 flex-1"
            onScroll={clearCloseTimerAndHover}
          >
            {dbListContent()}
          </DockPanel>,
          rightDockEl,
        )}
      {rightDockEl && panels.objects.open && !panels.objects.floating && panels.objects.dockSide === 'right' &&
        createPortal(
          <DockPanel
            title="Oggetti"
            icon={<Boxes className="h-3.5 w-3.5 text-emerald-400" />}
            floating={false}
            position={{ x: 0, y: 0 }}
            onMove={() => {}}
            onClose={() => setObjectsOpen(false)}
            onToggleFloat={floatObjects}
            accent="text-emerald-300"
            dockClassName="min-h-0 flex-1"
            bodyClassName="flex flex-col overflow-hidden"
            onScroll={clearCloseTimerAndHover}
          >
            {objectsContent()}
          </DockPanel>,
          rightDockEl,
        )}

      {hover?.kind === 'table' && (
        <TableHoverCard
          table={hover.table}
          rect={hover.rect}
          onHoverEnter={clearCloseTimer}
          onHoverLeave={scheduleClose}
          onOpenInEditor={onPreviewInEditor}
        />
      )}
      {hover?.kind === 'column' && (
        <ColumnHoverCard
          tableName={hover.tableName}
          column={hover.column}
          rect={hover.rect}
          onHoverEnter={clearCloseTimer}
          onHoverLeave={scheduleClose}
        />
      )}

      {colorMenu && (
        <>
          <div
            className="fixed inset-0 z-[59]"
            onClick={() => setColorMenu(null)}
            onContextMenu={e => {
              e.preventDefault()
              setColorMenu(null)
            }}
          />
          <div
            className="fixed z-[60] w-44 rounded-lg border border-zinc-700 bg-zinc-900 p-2 shadow-2xl"
            style={{
              left: Math.min(colorMenu.x, window.innerWidth - 180),
              top: Math.min(colorMenu.y, window.innerHeight - 180),
            }}
          >
            <div className="mb-1.5 break-all border-b border-zinc-800 pb-1 text-xs font-semibold text-zinc-300">
              Colore per {colorMenu.db}
            </div>
            <div className="grid grid-cols-6 gap-1">
              {dbColorPalette.map(c => (
                <button
                  key={c}
                  onClick={() => {
                    onSetDbColor?.(colorMenu.db, c)
                    setColorMenu(null)
                  }}
                  className="h-5 w-5 rounded-full border border-zinc-700 transition-transform hover:scale-110"
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
            <button
              onClick={() => {
                onSetDbColor?.(colorMenu.db, null)
                setColorMenu(null)
              }}
              className="mt-2 w-full rounded px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              title="Ripristina il colore automatico"
            >
              Ripristina default
            </button>
            {colorMenu.db === activeDatabase && (
              <button
                onClick={() => {
                  onOpenReport?.()
                  setColorMenu(null)
                }}
                className="mt-2 flex w-full items-center gap-1.5 rounded border-t border-zinc-800 px-2 pt-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-sky-300"
                title="Report utilizzo tabelle del database attivo (si apre in una tab)"
              >
                <Rows3 className="h-3.5 w-3.5 text-sky-400" /> Report utilizzo tabelle…
              </button>
            )}
            {colorMenu.db === activeDatabase && (
              <button
                onClick={() => {
                  setChangesOpen(true)
                  setColorMenu(null)
                }}
                className="flex w-full items-center gap-1.5 rounded px-2 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-amber-300"
                title="Modifiche agli oggetti: quando sono stati modificati (giorno e ora)"
              >
                <History className="h-3.5 w-3.5 text-amber-400" /> Modifiche agli oggetti…
              </button>
            )}
          </div>
        </>
      )}

      {objectMenu && (
        <>
          <div
            className="fixed inset-0 z-[61]"
            onClick={() => setObjectMenu(null)}
            onContextMenu={e => {
              e.preventDefault()
              setObjectMenu(null)
            }}
          />
          <ObjectMenu
            x={objectMenu.x}
            y={objectMenu.y}
            title={`${objectMenu.hit.schema}.${objectMenu.hit.name}`}
            subtitle={objectMenu.hit.kind}
            actions={objectActions(objectMenu.hit)}
            onClose={() => setObjectMenu(null)}
          />
        </>
      )}

      {/* Modifiche agli oggetti: griglia con giorno e ora dell'ultima modifica */}
      {changesOpen && connectionId && (
        <ChangesModal
          connectionId={connectionId}
          database={activeDatabase}
          onClose={() => setChangesOpen(false)}
          onOpenObject={(kind, schema, name) => onOpenObject?.(kind, schema, name, 'alter', true)}
        />
      )}
    </div>
  )
}

function ObjectMenu({
  x,
  y,
  title,
  subtitle,
  actions,
  onClose,
}: {
  x: number
  y: number
  title: string
  subtitle: string
  actions: ObjectAction[]
  onClose: () => void
}) {
  const [sub, setSub] = useState<{ id: string; x: number; y: number; items: ObjectAction[] } | null>(null)
  const clamp = (px: number, py: number, w: number, h: number) => ({
    left: Math.max(4, Math.min(px, window.innerWidth - w - 4)),
    top: Math.max(4, Math.min(py, window.innerHeight - h - 4)),
  })
  const mainPos = clamp(x, y, 288, 360)
  const subPos = sub ? clamp(sub.x, sub.y, 220, 300) : null

  return (
    <>
      <div
        className="fixed z-[62] w-72 rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 shadow-2xl"
        style={mainPos}
      >
        <div className="mb-1 break-all border-b border-zinc-800 px-2 pb-1.5 pt-0.5 text-xs font-semibold text-zinc-300">
          {title}
          <span className="ml-1.5 font-normal capitalize text-zinc-500">{subtitle}</span>
        </div>
        {actions.map(a =>
          a.submenu ? (
            <button
              key={a.id}
              onMouseEnter={e => {
                const r = e.currentTarget.getBoundingClientRect()
                setSub({ id: a.id, x: r.right + 4, y: r.top, items: a.submenu! })
              }}
              title={a.hint}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-white"
            >
              {a.icon && <span className="text-zinc-400">{a.icon}</span>}
              <span className="flex-1">{a.label}</span>
              <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
            </button>
          ) : (
            <button
              key={a.id}
              onClick={() => {
                a.run?.()
                onClose()
              }}
              onMouseEnter={() => setSub(null)}
              title={a.hint}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-zinc-800 ${
                a.danger ? 'text-rose-300 hover:text-rose-200' : 'text-zinc-200 hover:text-white'
              }`}
            >
              {a.icon && <span className={a.danger ? 'text-rose-400/80' : 'text-zinc-400'}>{a.icon}</span>}
              <span>{a.label}</span>
            </button>
          ),
        )}
      </div>
      {sub && subPos && (
        <div
          className="fixed z-[63] w-52 rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 shadow-2xl"
          style={subPos}
        >
          {sub.items.map(s => (
            <button
              key={s.id}
              onClick={() => {
                s.run?.()
                onClose()
              }}
              title={s.hint}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-zinc-800 ${
                s.danger ? 'text-rose-300 hover:text-rose-200' : 'text-zinc-200 hover:text-white'
              }`}
            >
              {s.icon && <span className={s.danger ? 'text-rose-400/80' : 'text-zinc-400'}>{s.icon}</span>}
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function Section({
  title,
  icon,
  count,
  open,
  onToggle,
  children,
  nested = false,
}: {
  title: string
  icon: ReactNode
  count: number
  open: boolean
  onToggle: () => void
  children: ReactNode
  nested?: boolean
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        data-nodo={chiaveNodo('sezione', title)}
        className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs font-semibold transition-colors hover:bg-zinc-800/70 hover:text-zinc-200 ${
          nested ? 'normal-case tracking-normal text-zinc-400' : 'uppercase tracking-wide text-zinc-400'
        }`}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        {icon}
        <span>{title}</span>
        <span className="ml-auto rounded-full bg-zinc-800 px-1.5 text-[10px] text-zinc-400">{count}</span>
      </button>
      {open && <div className="mt-0.5 space-y-0.5">{children}</div>}
    </div>
  )
}

function ObjectRow({
  label,
  detail,
  nodo,
  onInsert,
  onContextMenu,
  draggable,
  onDragStart,
  children,
}: {
  label: string
  detail?: string
  /** Chiave della voce (`data-nodo`): serve alla selezione dell'albero. */
  nodo?: string
  onInsert?: () => void
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void
  draggable?: boolean
  onDragStart?: (e: DragEvent<HTMLElement>) => void
  children?: ReactNode
}) {
  return (
    <div>
      <button
        onClick={onInsert}
        data-nodo={nodo}
        onContextMenu={onContextMenu}
        draggable={draggable}
        onDragStart={onDragStart}
        className={`flex w-full items-center gap-2 rounded px-2 py-1 pl-7 text-left text-[13px] text-zinc-200 transition-colors hover:bg-zinc-800 ${
          draggable ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
        title={
          onInsert
            ? 'Clicca per inserire nel editor — tasto destro per le azioni'
            : draggable
              ? 'Trascina nel editor per generare EXEC con i parametri — tasto destro per le azioni'
              : 'Tasto destro per le azioni'
        }
      >
        <span className="min-w-0 break-all font-mono">{label}</span>
        {detail && <span className="min-w-0 break-all text-[11px] text-zinc-500">{detail}</span>}
      </button>
      {children}
    </div>
  )
}

function TableRow({
  label,
  badge,
  nodo,
  usageText,
  expanded,
  onToggleExpand,
  onInsert,
  onHover,
  onHoverLeave,
  onQuickPreview,
  onContextMenu,
  children,
}: {
  label: string
  badge?: string
  /** Chiave della voce (`data-nodo`): serve alla selezione dell'albero. */
  nodo?: string
  usageText?: string
  expanded: boolean
  onToggleExpand: () => void
  onInsert: () => void
  onHover: (e: MouseEvent<HTMLElement>) => void
  onHoverLeave: () => void
  onQuickPreview?: () => void
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void
  children?: ReactNode
}) {
  return (
    <div className="group">
      <div className="flex items-center">
        <button
          onClick={onToggleExpand}
          className="shrink-0 rounded p-1 pl-4 text-zinc-500 transition-colors hover:text-zinc-300"
          title={expanded ? 'Chiudi i campi' : 'Mostra i campi'}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={onInsert}
          data-nodo={nodo}
          onMouseEnter={onHover}
          onMouseLeave={onHoverLeave}
          onContextMenu={onContextMenu}
          className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-[13px] text-zinc-200 transition-colors hover:bg-zinc-800"
          title={usageText ? `${usageText} — clicca per inserire, tasto destro per le azioni` : 'Clicca per inserire, tasto destro per le azioni'}
        >
          <span className="min-w-0 break-all font-mono">{label}</span>
          {badge && <span className="ml-auto shrink-0 rounded bg-zinc-800 px-1 text-[10px] text-zinc-500">{badge}</span>}
        </button>
        {onQuickPreview && (
          <button
            onClick={onQuickPreview}
            onMouseEnter={onHover}
            onMouseLeave={onHoverLeave}
            className="mr-1 shrink-0 rounded p-1 text-zinc-600 opacity-0 transition-all hover:bg-sky-950 hover:text-sky-300 group-hover:opacity-100"
            title="Esegui SELECT TOP 100 * (griglia risultati)"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {expanded && children}
    </div>
  )
}

function KindIcon({ kind }: { kind: HitKind }) {
  switch (kind) {
    case 'tabella':
      return <Table2 className="h-3.5 w-3.5 shrink-0 text-sky-400" />
    case 'vista':
      return <Eye className="h-3.5 w-3.5 shrink-0 text-violet-400" />
    case 'procedura':
      return <FileCode2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
    case 'funzione':
      return <Zap className="h-3.5 w-3.5 shrink-0 text-amber-400" />
    default:
      return <Flame className="h-3.5 w-3.5 shrink-0 text-rose-400" />
  }
}
