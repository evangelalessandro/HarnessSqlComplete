import { useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { Eraser, FolderOpen, IndentDecrease, IndentIncrease, MessageSquare, Moon, Play, Save, Settings2, Sun, Table2, Wand2, ZoomIn, ZoomOut } from 'lucide-react'
import monaco from '../monacoSetup'
import { api } from '../api'
import { syntaxIssuesFromCheck } from '../syntaxCheck'
import type { DatabaseSummary } from '../types'

import { resolveTokenAt } from '../helpers'
import DataPreviewModal from './DataPreviewModal'
import { registerPairHighlight } from '../sqlPairHighlight'
import { positionAt, runSqlDiagnostics } from '../sqlDiagnostics'
import { computeBlockGuides } from '../sqlBlockGuides'
import { computeFoldingRanges } from '../sqlFolding'
import { pickFormatTarget, pickSqlToExecute } from '../executeSelection'
import { registerTableColorizer } from '../sqlTableColors'
import { isCallableAt, resolveCallableAt } from '../callables'
import type { CallableRef } from '../callables'
import { provideSqlCompletions } from '../sqlCompletions'

import { historyColumnBoost, historyTableBoost, recordTablesFromSql } from '../history'
import { registerSqlHover } from '../sqlHover'
import { buildFormatProfile, loadFormatProfileXml } from '../formatProfile'
import { formatSqlWithProfile } from '../tsqlFormatter'
import { SQL_WORD_SEPARATORS } from '../editorOptions'
import FormatProfilePanel from './FormatProfilePanel'
import { Badge, Button, Spinner, Toggle } from './ui'

/** Testo del tipo per il dettaglio di una colonna ("INT NULL"), o '' se il tipo
 *  non è noto (colonne di temporanee dedotte da "SELECT … INTO", variabili tabella…). */

interface Props {
  connectionId: string
  summary: DatabaseSummary | null
  executing: boolean
  aiEnabled: boolean
  onAiEnabledChange: (v: boolean) => void
  aiConfigured: boolean
  aiStatusText: string
  onExecute: (sql: string) => void
  /** Notifica il contenuto dell'editor mentre si digita (per la persistenza). */
  onContentChange?: (sql: string) => void
  /** Salva la tab attiva (sovrascrive l'originale se aperta da file, altrimenti picker). */
  onSave?: () => void
  /** Salva sempre con picker (Salva con nome). */
  onSaveAs?: () => void
  /** Apre file .sql con il picker (handle per la sovrascrittura). */
  onOpenFile?: () => void
  /** Dimensione del testo (persistita). */
  fontSize?: number
  /** Tema Monaco: 'vs' (chiaro) o 'vs-dark'. */
  theme?: 'vs' | 'vs-dark'
  /** Zoom del testo (+1 / -1). */
  onZoomFont?: (delta: number) => void
  /** Alterna tema chiaro/scuro. */
  onToggleTheme?: () => void
  /** Livello del drago (0-100): il fuoco scaturito a ogni esecuzione cresce con esso. */
  dragonLevel?: number
  /** Contatore incrementato a ogni query eseguita: innesca il colpo di fuoco. */
  fireTick?: number
  /** Apre la definizione di una procedura/funzione in una nuova tab ('alter' = CREATE OR ALTER). */
  onOpenObject?: (kind: 'procedure' | 'function' | 'view' | 'trigger', schema: string, name: string, mode: 'alter' | 'open') => void
  /** Apre il diagramma delle chiamate della routine sotto il cursore (chi la chiama). */
  onShowCallGraph?: (kind: 'procedure' | 'function', schema: string, name: string) => void
  registerEditor: (editor: monaco.editor.IStandaloneCodeEditor) => void
}

export const DEFAULT_SQL = `-- Nuova query — modello transazione sicura
-- Sostituisci dbo.Tabella e premi F5 / Ctrl+Invio
BEGIN TRAN;

SELECT * FROM dbo.Tabella ORDER BY 1 DESC;

ROLLBACK;
`

export default function SqlEditor({
  connectionId,
  summary,
  executing,
  aiEnabled,
  onAiEnabledChange,
  aiConfigured,
  aiStatusText,
  onExecute,
  onContentChange,
  onSave,
  onSaveAs,
  onOpenFile,
  fontSize = 13,
  theme = 'vs-dark',
  onZoomFont,
  onToggleTheme,
  dragonLevel = 0,
  fireTick = 0,
  registerEditor,
  onOpenObject,
  onShowCallGraph,
}: Props) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const disposablesRef = useRef<monaco.IDisposable[]>([])
  const stateRef = useRef({ connectionId, summary, aiEnabled, onExecute, onOpenObject, onShowCallGraph })
  stateRef.current = { connectionId, summary, aiEnabled, onExecute, onOpenObject, onShowCallGraph }
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const onSaveAsRef = useRef(onSaveAs)
  onSaveAsRef.current = onSaveAs
  const onZoomFontRef = useRef(onZoomFont)
  onZoomFontRef.current = onZoomFont
  // Aggiorna la context key che abilita la voce "Modifica (CREATE OR ALTER)": la imposta
  // handleMount e la richiama l'effect qui sotto quando arriva/cambia lo schema.
  const syncCallableContextRef = useRef<() => void>(() => {})
  // L'istanza editor in stato React: l'effect del colorizer si (ri)registra
  // automaticamente quando editor o schema cambiano (pulizia inclusa)
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null)
  // Colpo di fuoco del drago a ogni esecuzione
  const [fireVisible, setFireVisible] = useState(false)
  useEffect(() => {
    if (!fireTick) return
    setFireVisible(true)
    const t = window.setTimeout(() => setFireVisible(false), 1900)
    return () => window.clearTimeout(t)
  }, [fireTick])
  // La voce "Modifica (CREATE OR ALTER)" dipende dallo schema (serve per riconoscere il
  // nome della routine): quando lo schema arriva o cambia si aggiorna subito, senza
  // aspettare che il cursore si muova.
  useEffect(() => {
    syncCallableContextRef.current()
  }, [summary, connectionId])
  // Pannello impostazioni di formattazione
  const [profileOpen, setProfileOpen] = useState(false)
  // Verifica di sintassi opzionale (errori reali di SQL Server con "Riga N:")
  const [syntaxCheck, setSyntaxCheck] = useState(false)
  // Finestra anteprima dati della tabella sotto il cursore (F4)
  const [previewTarget, setPreviewTarget] = useState<{ schema: string; table: string } | null>(null)
  // tabella attualmente sotto l'hover (per il pulsante cliccabile nella tooltip)
  const hoveredTableRef = useRef<{ schema: string; table: string } | null>(null)

  // Il link "command:sqlIntelli.openPreview" nella tooltip NON esegue comandi in
  // Monaco standalone (l'opener dei command: è roba da workbench): intercettiamo il
  // click sull'anchor con un listener a livello documento e apriamo la preview.
  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null
      const a = target?.closest?.('a[data-href]')
      if (!a) return
      const href = a.getAttribute('data-href') ?? ''
      if (!href.startsWith('command:sqlIntelli.openPreview')) return
      ev.preventDefault()
      ev.stopPropagation()
      const t = hoveredTableRef.current
      if (t) setPreviewTarget(t)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])
  // Registrazione robusta del colorizer, copre ogni ordine di mount/summary
  const colorizerRef = useRef<{
    ed: monaco.editor.IStandaloneCodeEditor
    sm: DatabaseSummary
    disposables: monaco.IDisposable[]
  } | null>(null)

  const ensureColorizer = () => {
    const ed = editorRef.current
    const sm = stateRef.current.summary
    if (!ed || !sm) return
    const cur = colorizerRef.current
    if (cur && cur.ed === ed && cur.sm === sm) return
    cur?.disposables.forEach(d => d.dispose())
    colorizerRef.current = { ed, sm, disposables: registerTableColorizer(ed, sm) }
  }

  useEffect(() => {
    return () => {
      disposablesRef.current.forEach(d => d.dispose())
      disposablesRef.current = []
      colorizerRef.current?.disposables.forEach(d => d.dispose())
      colorizerRef.current = null
    }
  }, [])

  useEffect(() => {
    ensureColorizer()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, editor])

  /**
   * Verifica di sintassi opzionale: con il toggle attivo, a ogni modifica (debounce)
   * chiede al backend di eseguire il testo in una transazione con rollback; gli errori
   * reali di SQL Server ("Riga N: …") diventano sottolineature nel documento.
   */
  useEffect(() => {
    const model = editorRef.current?.getModel()
    const connId = connectionId
    if (!syntaxCheck || !model || !connId) {
      if (model) monaco.editor.setModelMarkers(model, 'sql-check', [])
      return
    }
    let timer: number | null = null
    let cancelled = false
    const run = async () => {
      const text = model.getValue()
      if (!text.trim()) {
        monaco.editor.setModelMarkers(model, 'sql-check', [])
        return
      }
      try {
        const res = await api.checkSyntax(connId, text)
        if (cancelled) return
        const issues = syntaxIssuesFromCheck(res.error, res.messages)
        const markers: monaco.editor.IMarkerData[] = issues.map(i => ({
          startLineNumber: i.line,
          startColumn: 1,
          endLineNumber: i.line,
          endColumn: Math.max(1, model.getLineLength(i.line)) + 1,
          message: i.message,
          severity: monaco.MarkerSeverity.Error,
        }))
        monaco.editor.setModelMarkers(model, 'sql-check', markers)
      } catch {
        if (!cancelled) monaco.editor.setModelMarkers(model, 'sql-check', [])
      }
    }
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(run, 900)
    }
    const sub = model.onDidChangeContent(schedule)
    schedule()
    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
      sub.dispose()
      monaco.editor.setModelMarkers(model, 'sql-check', [])
    }
  }, [syntaxCheck, connectionId])

  const handleFormat = () => {
    const ed = editorRef.current
    const model = ed?.getModel()
    if (!ed || !model) return
    try {
      // come l'esecuzione: con una selezione si formatta SOLO quella parte
      const sel = ed.getSelection()
      const selected = sel && !sel.isEmpty() ? model.getValueInRange(sel) : null
      const { text, usesSelection } = pickFormatTarget(selected, model.getValue())
      const profileXml = loadFormatProfileXml()
      const profile = buildFormatProfile(profileXml)
      const formatted = formatSqlWithProfile(text, profile)
      const range = usesSelection ? sel! : model.getFullModelRange()
      ed.executeEdits('format', [{ range, text: formatted }])
    } catch {
      /* SQL non valido: nessuna azione */
    }
  }

  /**
   * Testo da eseguire: come SSMS, se c'è una selezione nell'editor viene eseguita
   * SOLO la selezione (ripulita dagli spazi ai bordi); altrimenti tutto il contenuto.
   */
  const getSqlToExecute = (): string => {
    const ed = editorRef.current
    const model = ed?.getModel()
    if (!ed || !model) return ''
    const sel = ed.getSelection()
    const selected = sel && !sel.isEmpty() ? model.getValueInRange(sel) : null
    return pickSqlToExecute(selected, ed.getValue())
  }

  const handleMount: OnMount = (editor, _monacoInstance) => {
    editorRef.current = editor
    registerEditor(editor)
    setEditor(editor)
    ensureColorizer()

    // Esegui: F5 e Ctrl+Invio (registra nella cronologia le tabelle usate)
    const runQuery = () => {
      const sql = getSqlToExecute()
      recordTablesFromSql(sql)
      stateRef.current.onExecute(sql)
    }
    editor.addCommand(monaco.KeyCode.F5, () => runQuery())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runQuery())
    // Salva: Ctrl+S
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current?.())
    // Salva con nome: Ctrl+Shift+S
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, () => onSaveAsRef.current?.())
    // Formatta: Ctrl+Shift+F
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, handleFormat)
    // Anteprima dati della tabella sotto il cursore: F4 (e pulsante toolbar)
    const openPreviewUnderCursor = () => {
      const model = editor.getModel()
      const pos = editor.getPosition()
      const sm = stateRef.current.summary
      if (!model || !pos || !sm) return
      const resolved = resolveTokenAt(model.getValue(), model.getOffsetAt(pos), sm)
      if (resolved?.kind === 'table') {
        setPreviewTarget({ schema: resolved.table.schema, table: resolved.table.name })
      }
    }
    editor.addCommand(monaco.KeyCode.F4, openPreviewUnderCursor)

    /**
     * TASTO DESTRO su una chiamata a stored procedure/funzione: riconosce il nome (anche
     * qualificato o tra parentesi quadre) sotto il cursore e restituisce la routine.
     * Da qui partono le due voci del menu: "Modifica" (CREATE OR ALTER in una nuova tab)
     * e "Diagramma chiamate" (chi la chiama, fino al chiamante più lontano).
     */
    const callableUnderCursor = (): CallableRef | null => {
      const model = editor.getModel()
      const pos = editor.getPosition()
      const sm = stateRef.current.summary
      if (!model || !pos || !sm) return null
      return resolveCallableAt(model.getValue(), model.getOffsetAt(pos), sm)
    }
    const openCallableUnderCursor = (): void => {
      const ref = callableUnderCursor()
      if (!ref) return
      stateRef.current.onOpenObject?.(ref.kind, ref.schema, ref.name, 'alter')
    }
    const showCallGraphUnderCursor = (): void => {
      const ref = callableUnderCursor()
      if (!ref) return
      stateRef.current.onShowCallGraph?.(ref.kind, ref.schema, ref.name)
    }
    // Le voci compaiono SOLO se sotto il cursore c'è davvero una stored procedure o una
    // funzione: su tabelle, campi e su testo qualsiasi non devono esserci.
    const onCallable = editor.createContextKey<boolean>('sqlIntelliOnCallable', false)
    const syncCallableContext = () => {
      const model = editor.getModel()
      const pos = editor.getPosition()
      const sm = stateRef.current.summary
      const onRoutine = !!model && !!pos && isCallableAt(model.getValue(), model.getOffsetAt(pos), sm)
      onCallable.set(onRoutine)
    }
    syncCallableContextRef.current = syncCallableContext
    disposablesRef.current.push(
      editor.onDidChangeCursorPosition(syncCallableContext),
      editor.onDidChangeModelContent(syncCallableContext),
      // IContextKey non è IDisposable: allo smontaggio si riporta a false
      { dispose: () => onCallable.reset() },
    )
    syncCallableContext()
    editor.addAction({
      id: 'sql-intelli-callable-modify',
      label: 'Modifica (CREATE OR ALTER in una nuova tab)',
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 0,
      precondition: 'editorTextFocus && sqlIntelliOnCallable',
      run: () => openCallableUnderCursor(),
    })
    editor.addAction({
      id: 'sql-intelli-callable-callgraph',
      label: 'Diagramma chiamate (chi la chiama)',
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 1,
      precondition: 'editorTextFocus && sqlIntelliOnCallable',
      run: () => showCallGraphUnderCursor(),
    })

    registerSchemaCompletions()
    registerInlineCompletions()
    registerSqlDiagnostics()
    registerBlockGuides()
    registerFolding()
    disposablesRef.current.push(...registerPairHighlight(editor))
    disposablesRef.current.push(
      registerSqlHover(() => ({
        summary: stateRef.current.summary,
        connectionId: stateRef.current.connectionId,
        onTableHover: (schema, table) => {
          hoveredTableRef.current = { schema, table }
        },
      })),
    )
    // Zoom con Ctrl+rotella del mouse (listener nativo sul DOM dell'editor)
    const domNode = editor.getDomNode()
    if (domNode) {
      const onWheel = (ev: WheelEvent) => {
        if (ev.ctrlKey || ev.metaKey) {
          ev.preventDefault()
          onZoomFontRef.current?.(ev.deltaY < 0 ? 1 : -1)
        }
      }
      domNode.addEventListener('wheel', onWheel)
      disposablesRef.current.push({
        dispose: () => domNode.removeEventListener('wheel', onWheel),
      })
    }
  }

  const registerSchemaCompletions = () => {
    disposablesRef.current.push(
      monaco.languages.registerCompletionItemProvider('sql', {
        triggerCharacters: ['.', ' ', '[', '"', '(', '*', '@'],
        provideCompletionItems: (model, position) => {
          // la preview dati ha il SUO provider filtrato sulla tabella
          if (model.uri.toString().startsWith('sql-intelli://preview')) return { suggestions: [] }
          return provideSqlCompletions({
            model,
            position,
            state: stateRef.current,
            historyTableBoost,
            historyColumnBoost,
          })
        },
      }),
    )
  }

  const registerInlineCompletions = () => {
    disposablesRef.current.push(
      monaco.languages.registerInlineCompletionsProvider('sql', {
        provideInlineCompletions: async (model, position, context, token) => {
          const st = stateRef.current
          if (!st.aiEnabled) return { items: [] }
          // la preview dati ha un mini-editor: niente autocompletamento IA lì
          if (model.uri.toString().startsWith('sql-intelli://preview')) return { items: [] }

          const textBefore = model.getValueInRange(
            new monaco.Range(1, 1, position.lineNumber, position.column),
          )
          const trimmed = textBefore.trim()
          if (trimmed.length < 4 || /[;,)]\s*$/.test(trimmed)) return { items: [] }

          const isManual = context.triggerKind === monaco.languages.InlineCompletionTriggerKind.Explicit
          if (!isManual) {
            await debounce(900, token)
            if (token.isCancellationRequested) return { items: [] }
          }

          try {
            const resp = await api.autocomplete(st.connectionId, textBefore)
            if (token.isCancellationRequested || !resp.suggestions?.length) return { items: [] }
            const insertRange = new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column,
            )
            return {
              items: [{ insertText: resp.suggestions[0].text, range: insertRange }],
            }
          } catch {
            return { items: [] }
          }
        },
        disposeInlineCompletions: () => {
          /* nessuna risorsa da liberare */
        },
      }),
    )
  }

  /** Diagnostica in tempo reale: sottolinea parentesi/apici non bilanciati e colonne inesistenti. */
  const registerSqlDiagnostics = () => {
    const model = editorRef.current?.getModel()
    if (!model) return
    disposablesRef.current.push(
      monaco.languages.registerCodeLensProvider('sql', {
        provideCodeLenses: () => ({ lenses: [] }),
      }),
    )
    const update = () => {
      const ed = editorRef.current
      const m = ed?.getModel()
      if (!ed || !m) return
      const text = m.getValue()
      const diags = runSqlDiagnostics(text, { summary: stateRef.current.summary })
      const markers: monaco.editor.IMarkerData[] = diags.map(d => {
        const start = positionAt(text, d.start)
        const end = positionAt(text, d.end)
        return {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: Math.max(end.column, start.column + 1),
          message: d.message,
          severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
        }
      })
      monaco.editor.setModelMarkers(m, 'sql-diag', markers)
    }
    const sub = model.onDidChangeContent(() => update())
    disposablesRef.current.push({ dispose: () => sub.dispose() })
    update()
  }

  /**
   * Righe verticali tra BEGIN e END (e CASE/END): disegna una linea continua nella
   * colonna della keyword di apertura per ogni riga del blocco, come in Visual Studio.
   */
  const registerBlockGuides = () => {
    const model = editorRef.current?.getModel()
    if (!model) return
    const decorationIds: string[] = []
    const update = () => {
      const m = editorRef.current?.getModel()
      if (!m) return
      const text = m.getValue()
      const guides = computeBlockGuides(text)
      const newDecorations: monaco.editor.IModelDeltaDecoration[] = []
      // più guide sulla STESSA colonna di una riga (es. IF agganciato al BEGIN) →
      // una sola linea: niente linee doppie
      const guideKeys = new Set<string>()
      for (const g of guides) {
        // linea verticale su ogni riga compresa tra apertura e chiusura (incluse).
        // Sulle righe vuote o più corte della colonna della guida Monaco non disegna
        // il box (la linea si interrompe): si usa la fine della riga e si compensa con
        // un margine in "ch" (classe sql-guide-offset-N) per restare sulla colonna giusta.
        for (let line = g.openLine; line <= g.closeLine; line++) {
          const key = `${line}:${g.column}`
          if (guideKeys.has(key)) continue
          guideKeys.add(key)
          const lineLen = m.getLineLength(line)
          const effCol = Math.min(g.column, Math.max(1, lineLen + 1))
          const offset = g.column - effCol
          const cls =
            `sql-block-guide sql-guide-depth-${Math.min(g.depth, 4)}` +
            (offset > 0 ? ` sql-guide-offset-${Math.min(offset, 20)}` : '')
          newDecorations.push({
            range: new monaco.Range(line, effCol, line, effCol),
            options: {
              isWholeLine: false,
              // classe custom: disegna il bordo verticale (CSS in index.css)
              beforeContentClassName: cls,
            },
          })
        }
        // evidenzia le keyword di apertura/chiusura (END alla colonna della guida,
        // non alla colonna 1: per i blocchi indentati l'evidenza sarebbe sugli spazi)
        const openRange = new monaco.Range(g.openLine, g.column, g.openLine, g.column + (g.kind === 'if' ? 2 : 5))
        newDecorations.push({
          range: openRange,
          options: { inlineClassName: 'sql-block-keyword' },
        })
        const closeRange = new monaco.Range(g.closeLine, g.column, g.closeLine, g.column + 3)
        newDecorations.push({
          range: closeRange,
          options: { inlineClassName: 'sql-block-keyword' },
        })
      }
      const old = decorationIds.splice(0)
      decorationIds.push(...m.deltaDecorations(old, newDecorations))
    }
    const sub = model.onDidChangeContent(() => update())
    disposablesRef.current.push({ dispose: () => sub.dispose() })
    update()
  }

  /**
   * Folding: chiudi/espandi porzioni di codice con le frecce nella gutter.
   * Copre blocchi BEGIN/END, regioni SSMS (--#region/--#endregion) e commenti
   * a blocco su più righe. Scorciatoie Monaco: Ctrl+Shift+[ (chiudi), Ctrl+Shift+]
   * (apri), Ctrl+K Ctrl+L (alterna), Ctrl+K Ctrl+0 (chiudi tutto), Ctrl+K Ctrl+J (apri tutto).
   */
  const registerFolding = () => {
    disposablesRef.current.push(
      monaco.languages.registerFoldingRangeProvider('sql', {
        provideFoldingRanges: model => {
          const ranges = computeFoldingRanges(model.getValue())
          return ranges.map(r => ({
            start: r.start,
            end: r.end,
            kind:
              r.kind === 'region'
                ? monaco.languages.FoldingRangeKind.Region
                : r.kind === 'comment'
                  ? monaco.languages.FoldingRangeKind.Comment
                  : undefined,
          }))
        },
      }),
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="relative">
            <Button
              variant="primary"
              onClick={() => {
                const sql = getSqlToExecute()
                recordTablesFromSql(sql)
                onExecute(sql)
              }}
              loading={executing}
              title="Esegui (F5 / Ctrl+Invio) — se hai selezionato del testo esegue solo la selezione"
            >
              <Play className="h-4 w-4" /> Esegui
            </Button>
            {/* Fuoco del drago: scaturisce dal pulsante a ogni query eseguita */}
            {fireVisible && (
              <div className="pointer-events-none absolute -top-5 left-1/2 z-30 h-16 w-24 -translate-x-1/2">
                {Array.from({ length: Math.min(6 + Math.floor(dragonLevel / 10), 18) }).map((_, i) => (
                  <span
                    key={`${fireTick}-${i}`}
                    className="dragon-flame absolute text-lg leading-none"
                    style={{
                      left: `${6 + (i * 82) / Math.min(6 + Math.floor(dragonLevel / 10), 18)}%`,
                      bottom: '4px',
                      animationDelay: `${(i % 6) * 0.13}s`,
                      animationDuration: `${1.2 + (i % 4) * 0.3}s`,
                      fontSize: `${14 + Math.min(dragonLevel / 100, 1) * 10}px`,
                    }}
                  >
                    🔥
                  </span>
                ))}
              </div>
            )}
          </span>
          <Button variant="secondary" onClick={() => onSave?.()} title="Salva la query (Ctrl+S) — sovrascrive il file originale se aperto">
            <Save className="h-4 w-4" /> Salva
          </Button>
          <Button variant="ghost" onClick={() => onSaveAs?.()} title="Salva con nome (Ctrl+Shift+S) — scegli dove salvarla">
            <Save className="h-4 w-4" /> Salva con nome
          </Button>
          <Button variant="ghost" onClick={() => onOpenFile?.()} title="Apri file .sql (permette di sovrascrivere l'originale)">
            <FolderOpen className="h-4 w-4" /> Apri file
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              editorRef.current?.focus()
              void editorRef.current?.getAction('editor.action.commentLine')?.run()
            }}
            title="Commenta / togli il commento alle righe selezionate (Ctrl+/)"
          >
            <MessageSquare className="h-4 w-4" /> Commenta
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              editorRef.current?.focus()
              void editorRef.current?.getAction('editor.action.indentLines')?.run()
            }}
            title="Aumenta il rientro delle righe selezionate (Tab)"
          >
            <IndentIncrease className="h-4 w-4" /> Rientra
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              editorRef.current?.focus()
              void editorRef.current?.getAction('editor.action.outdentLines')?.run()
            }}
            title="Riduce il rientro delle righe selezionate (Shift+Tab)"
          >
            <IndentDecrease className="h-4 w-4" /> Fuori rientro
          </Button>
          <Button variant="secondary" onClick={handleFormat} title="Formatta (Ctrl+Shift+F) — con una selezione formatta solo quella parte">
            <Wand2 className="h-4 w-4" /> Formatta
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              // apre l'anteprima della tabella sotto il cursore (come F4)
              const ed = editorRef.current
              const model = ed?.getModel()
              const pos = ed?.getPosition()
              const sm = stateRef.current.summary
              if (!ed || !model || !pos || !sm) return
              const resolved = resolveTokenAt(model.getValue(), model.getOffsetAt(pos), sm)
              if (resolved?.kind === 'table') {
                setPreviewTarget({ schema: resolved.table.schema, table: resolved.table.name })
              }
            }}
            title="Anteprima dati della tabella sotto il cursore (F4) — genera INSERT/UPDATE/MERGE/DELETE/#tmp"
          >
            <Table2 className="h-4 w-4" /> Anteprima
          </Button>
          <Button
            variant="ghost"
            onClick={() => setProfileOpen(true)}
            title="Impostazioni di formattazione (importa/edita/esporta il profilo T-SQL)"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" onClick={() => editorRef.current?.setValue('')}>
            <Eraser className="h-4 w-4" /> Svuota
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Button variant="ghost" onClick={() => onZoomFont?.(-1)} title="Riduci testo (Ctrl+rotella giù)">
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="w-6 text-center text-xs tabular-nums text-zinc-400">{fontSize}</span>
            <Button variant="ghost" onClick={() => onZoomFont?.(1)} title="Ingrandisci testo (Ctrl+rotella su)">
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
          <Button
            variant="ghost"
            onClick={() => onToggleTheme?.()}
            title={theme === 'vs-dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}
          >
            {theme === 'vs-dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Toggle checked={aiEnabled} onChange={onAiEnabledChange} label="Autocompletamento IA" />
          <Toggle
            checked={syntaxCheck}
            onChange={setSyntaxCheck}
            label="Verifica sintassi"
            title="Sottolinea gli errori reali di SQL Server (esegue il testo in una transazione che viene annullata — nessun effetto collaterale)"
          />
          <Badge tone={aiConfigured ? 'emerald' : 'amber'}>{aiStatusText}</Badge>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          defaultLanguage="sql"
          theme={theme}
          path="sql-intelli://main.sql"
          defaultValue={DEFAULT_SQL}
          onMount={handleMount}
          onChange={value => onContentChange?.(value ?? '')}
          loading={
            <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500">
              <Spinner /> Caricamento editor…
            </div>
          }
          options={{
            fontSize,
            fontFamily: 'Cascadia Code, Consolas, "Courier New", monospace',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            tabSize: 2,
            // doppio click: seleziona anche '@' e '#' iniziali (@var, @@ROWCOUNT, #tmp)
            wordSeparators: SQL_WORD_SEPARATORS,
            padding: { top: 10 },
            renderLineHighlight: 'all',
            // guide di indentazione verticali (visibili nei blocchi BEGIN/END dopo la formattazione)
            guides: { bracketPairs: false, indentation: true, highlightActiveIndentation: true },
            // folding: frecce nella gutter per chiudere porzioni di codice (BEGIN/END, --#region, commenti)
            folding: true,
            foldingHighlight: true,
            showFoldingControls: 'always',
            suggest: { showWords: false },
            quickSuggestions: { other: 'on', comments: false, strings: false },
            wordBasedSuggestions: 'off',
            inlineSuggest: { enabled: true, showToolbar: 'onHover' },
            // scrollbar: canale largo e cursore arrotondato (12px su 16), comodo da afferrare
            // col mouse; niente ombre e la rotella non viene "catturata" ai bordi
            scrollbar: {
              verticalScrollbarSize: 16,
              horizontalScrollbarSize: 16,
              verticalSliderSize: 12,
              horizontalSliderSize: 12,
              useShadows: false,
              alwaysConsumeMouseWheel: false,
            },
          }}
        />
      </div>
      {profileOpen && <FormatProfilePanel onClose={() => setProfileOpen(false)} />}
      {previewTarget && connectionId && (
        <DataPreviewModal
          target={previewTarget}
          connectionId={connectionId}
          summary={stateRef.current.summary}
          theme={theme}
          onClose={() => setPreviewTarget(null)}
        />
      )}
    </div>
  )
}

/** Attende `ms` millisecondi o fino alla cancellazione del token. */
function debounce(ms: number, token: monaco.CancellationToken): Promise<void> {
  return new Promise(resolve => {
    const sub = token.onCancellationRequested(() => {
      window.clearTimeout(id)
      resolve()
    })
    const id = window.setTimeout(() => {
      sub.dispose()
      resolve()
    }, ms)
  })
}
