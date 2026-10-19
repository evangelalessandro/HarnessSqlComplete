import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { Activity, Eraser, Eye, FolderOpen, IndentDecrease, IndentIncrease, Loader2, MessageSquare, Moon, Pilcrow, Play, Save, Settings2, Sun, Wand2, ZoomIn, ZoomOut } from 'lucide-react'
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
import { suggerisciInLinea } from '../inlineSuggest'
import { spezzaDopoVirgola, testoSpezzato } from '../autoIndent'
import { inviiIndentati, riempimentiPerColonna } from '../multiCursorColonna'
import { dentroCommentoOStringa } from '../inlineSuggest'

import { historyColumnBoost, historyTableBoost, recordTablesFromSql } from '../history'
import { registerSqlHover } from '../sqlHover'
import { buildFormatProfile, loadFormatProfileXml } from '../formatProfile'
import { formattaConMotore, OPZIONI_SQLFLUFF_DEFAULT } from '../formatEngine'
import type { MotoreFormattazione, OpzioniSqlFluff } from '../formatEngine'
import { SQL_WORD_SEPARATORS } from '../editorOptions'
import { BLOCCHI_KEY, opzioniMonaco, parseBlocchi, serializzaBlocchi } from '../blockMode'
import { SPAZI_KEY, opzioniSpazi, parseSpazi, serializzaSpazi } from '../whitespaceMode'
import { azioneCursore, cursoreDaAggiungere, cursoreDaNeutralizzare } from '../multiCursor'
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
  /** Anteprima delle modifiche: mostra le righe che un UPDATE/DELETE toccherebbe (non modifica nulla). */
  onAnteprimaModifiche?: () => void
  /** Piano di esecuzione STIMATO dello statement (non esegue la query). */
  onPiano?: () => void
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
  /** Motore di formattazione scelto (nostro profilo T-SQL oppure SQLFluff via backend). */
  formatter?: MotoreFormattazione
  onFormatterChange?: (m: MotoreFormattazione) => void
  /** Opzioni di SQLFluff (usate quando il motore e' sqlfluff). */
  sqlFluff?: OpzioniSqlFluff
  onSqlFluffChange?: (o: OpzioniSqlFluff) => void
  /** Zoom del testo (+1 / -1). */
  onZoomFont?: (delta: number) => void
  /** Alterna tema chiaro/scuro. */
  onToggleTheme?: () => void
  /** Invio dopo la virgola → la virgola va in testa alla riga nuova (stile del progetto). */
  virgolaACapo?: boolean
  /** Cambia l'impostazione della virgola a capo (interruttore nelle impostazioni di formattazione). */
  onVirgolaACapoChange?: (attiva: boolean) => void
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
  onAnteprimaModifiche,
  onPiano,
  onContentChange,
  onSave,
  onSaveAs,
  onOpenFile,
  fontSize = 13,
  theme = 'vs-dark',
  formatter = 'nostro',
  onFormatterChange,
  sqlFluff,
  onSqlFluffChange,
  onZoomFont,
  onToggleTheme,
  virgolaACapo = true,
  onVirgolaACapoChange,
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
  const onAnteprimaRef = useRef(onAnteprimaModifiche)
  onAnteprimaRef.current = onAnteprimaModifiche
  const onPianoRef = useRef(onPiano)
  onPianoRef.current = onPiano
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
  /** Virgola a capo: il ref serve alla scorciatoia (il gestore dei tasti non si ricrea a ogni render). */
  const virgolaACapoRef = useRef(virgolaACapo)
  virgolaACapoRef.current = virgolaACapo
  /** Messaggio dell'ultima formattazione (es. SQLFluff non disponibile). */
  const [formatError, setFormatError] = useState<string | null>(null)
  /** True mentre la formattazione e' in corso (SQLFluff gira sul backend: puo' metterci secondi). */
  const [formatting, setFormatting] = useState(false)
  const formattingRef = useRef(false)
  formattingRef.current = formatting
  /** Motore e opzioni correnti, letti da handleFormat (che viene registrato una volta sola). */
  const motoreFormatRef = useRef<MotoreFormattazione>(formatter)
  motoreFormatRef.current = formatter
  const sqlFluffRef = useRef<OpzioniSqlFluff>(sqlFluff ?? OPZIONI_SQLFLUFF_DEFAULT)
  sqlFluffRef.current = sqlFluff ?? OPZIONI_SQLFLUFF_DEFAULT
  // Verifica di sintassi opzionale (errori reali di SQL Server con "Riga N:")
  const [syntaxCheck, setSyntaxCheck] = useState(false)
  /**
   * SCRITTURA SU PIÙ RIGHE (selezione a blocchi, come Alt+C di SSMS): accesa, trascinando si
   * seleziona un rettangolo e quello che si scrive finisce su tutte le righe selezionate.
   */
  const [blocchi, setBlocchi] = useState(() => {
    try {
      return parseBlocchi(localStorage.getItem(BLOCCHI_KEY))
    } catch {
      return false
    }
  })
  const toggleBlocchi = useCallback(() => {
    setBlocchi(v => {
      const nuovo = !v
      try {
        localStorage.setItem(BLOCCHI_KEY, serializzaBlocchi(nuovo))
      } catch {
        /* localStorage non disponibile */
      }
      return nuovo
    })
  }, [])
  // Il comando Alt+C è registrato al mount di Monaco: si passano i valori correnti con due ref.
  const blocchiRef = useRef(blocchi)
  blocchiRef.current = blocchi
  const toggleBlocchiRef = useRef(toggleBlocchi)
  toggleBlocchiRef.current = toggleBlocchi
  // Accensione/spegnimento: l'opzione di Monaco va aggiornata a editor montato.
  useEffect(() => {
    editorRef.current?.updateOptions(opzioniMonaco(blocchi))
  }, [blocchi])
  /**
   * MOSTRA SPAZI E TAB (richiesta utente): accesa, l'editor disegna lo spazio come '·' e il tab
   * come '→', così si vedono rientri sbagliati e tab mescolati agli spazi. La scelta si ricorda
   * fra un avvio e l'altro (come la scrittura a blocchi).
   */
  const [mostraSpazi, setMostraSpazi] = useState(() => {
    try {
      return parseSpazi(localStorage.getItem(SPAZI_KEY))
    } catch {
      return false
    }
  })
  const toggleSpazi = useCallback(() => {
    setMostraSpazi(v => {
      const nuovo = !v
      try {
        localStorage.setItem(SPAZI_KEY, serializzaSpazi(nuovo))
      } catch {
        /* localStorage non disponibile */
      }
      return nuovo
    })
  }, [])
  useEffect(() => {
    editorRef.current?.updateOptions(opzioniSpazi(mostraSpazi))
  }, [mostraSpazi])
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

  const handleFormat = async () => {
    const ed = editorRef.current
    const model = ed?.getModel()
    if (!ed || !model || formattingRef.current) return
    try {
      setFormatError(null)
      setFormatting(true)
      // un attimo di respiro: così l'indicatore "Formattazione…" viene dipinto PRIMA di
      // aspettare il backend (con SQLFluff la risposta può arrivare dopo qualche secondo)
      await new Promise(r => window.setTimeout(r, 0))
      // come l'esecuzione: con una selezione si formatta SOLO quella parte
      const sel = ed.getSelection()
      const selected = sel && !sel.isEmpty() ? model.getValueInRange(sel) : null
      const { text, usesSelection } = pickFormatTarget(selected, model.getValue())
      const profileXml = loadFormatProfileXml()
      const profile = buildFormatProfile(profileXml)
      const esito = await formattaConMotore(text, motoreFormatRef.current, profile, sqlFluffRef.current)
      const range = usesSelection ? sel! : model.getFullModelRange()
      ed.executeEdits('format', [{ range, text: esito.testo }])
      setFormatError(esito.errore)
    } catch {
      /* SQL non valido: nessuna azione */
    } finally {
      setFormatting(false)
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

    // SCRITTURA SU PIÙ RIGHE: si parte dalla preferenza salvata (selezione a blocchi stile SSMS)
    editor.updateOptions(opzioniMonaco(blocchiRef.current))
    // GHOST TEXT: suggerimenti in linea (testo grigio, Tab per accettare), dal database
    editor.updateOptions({ inlineSuggest: { enabled: true } })
    // Alt+C accende/spegne la selezione a blocchi, come in SSMS
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyC, () => toggleBlocchiRef.current?.())

    /** Aggiunge un cursore sopra/sotto: azione di Monaco, con ripiego sul comando per id. */
    const aggiungiCursore = (direzione: 'sopra' | 'sotto') => {
      const id = azioneCursore(direzione)
      const azione = editor.getAction(id)
      if (azione) void azione.run()
      else editor.trigger('sqlIntelli', id, null)
    }

    /**
     * MAIUSC+ALT+Su/Giù (Shift+Alt) DEVE aggiungere un cursore sopra/sotto, mai copiare o spostare
     * la riga (richiesta utente: "deve funzionare con il maius + alt e non CTRL + Alt"). L'evento
     * viene intercettato in fase di CAPTURA, prima di Monaco, e la combinazione si riconosce da
     * code/key/keyCode + modificatori.
     */
    const domNodeTasti = editor.getDomNode()
    const onTasti = (ev: KeyboardEvent) => {
      const tasto = {
        code: ev.code,
        key: ev.key,
        keyCode: ev.keyCode,
        which: ev.which,
        ctrlKey: ev.ctrlKey,
        metaKey: ev.metaKey,
        altKey: ev.altKey,
        shiftKey: ev.shiftKey,
        altGraph: ev.getModifierState?.('AltGraph') ?? false,
      }
      // Ctrl+Alt+Su/Giù (e AltGr, che su Windows è Ctrl+Alt) non deve fare NULLA: in Monaco è la
      // combinazione predefinita dei cursori e continuerebbe ad aggiungerli.
      if (cursoreDaNeutralizzare(tasto)) {
        ev.preventDefault()
        ev.stopPropagation()
        return
      }
      const direzione = cursoreDaAggiungere(tasto)
      if (!direzione) return
      ev.preventDefault()
      ev.stopPropagation()
      aggiungiCursore(direzione)
    }
    if (domNodeTasti) {
      domNodeTasti.addEventListener('keydown', onTasti, true)
      disposablesRef.current.push({
        dispose: () => domNodeTasti.removeEventListener('keydown', onTasti, true),
      })
    }
    // Seconda linea di difesa: le stesse combinazioni legate come comandi dell'editor, così
    // funzionano anche se l'evento non arriva al DOM dell'editor (focus sul pannello, ecc.).
    for (const direzione of ['sopra', 'sotto'] as const) {
      const freccia = direzione === 'sotto' ? monaco.KeyCode.DownArrow : monaco.KeyCode.UpArrow
      editor.addCommand(
        monaco.KeyMod.Shift | monaco.KeyMod.Alt | freccia,
        () => aggiungiCursore(direzione),
        'sqlIntelliMultiCursor',
      )
    }
    // Ctrl+Alt+Su/Giù NON deve più aggiungere cursori (si usa Maiusc+Alt): Monaco ha la stessa
    // combinazione fra i suoi comandi predefiniti, quindi si registra un comando VUOTO con lo
    // stesso tasto (i comandi dinamici hanno peso maggiore) per neutralizzarla.
    for (const freccia of [monaco.KeyCode.DownArrow, monaco.KeyCode.UpArrow]) {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | freccia, () => {}, 'sqlIntelliMultiCursor')
    }
    // ...e nella tendina del tasto destro, per chi non ricorda la scorciatoia
    editor.addAction({
      id: 'sql-intelli-cursore-sotto',
      label: 'Aggiungi cursore sotto (Maiusc+Alt+Giù)',
      contextMenuGroupId: 'sql-intelli-righe',
      contextMenuOrder: 1,
      run: () => aggiungiCursore('sotto'),
    })
    editor.addAction({
      id: 'sql-intelli-cursore-sopra',
      label: 'Aggiungi cursore sopra (Maiusc+Alt+Su)',
      contextMenuGroupId: 'sql-intelli-righe',
      contextMenuOrder: 2,
      run: () => aggiungiCursore('sopra'),
    })

    // Esegui: F5 e Ctrl+Invio (registra nella cronologia le tabelle usate)
    const runQuery = () => {
      const sql = getSqlToExecute()
      recordTablesFromSql(sql)
      stateRef.current.onExecute(sql)
    }
    editor.addCommand(monaco.KeyCode.F5, () => runQuery())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runQuery())
    // Anteprima delle modifiche di un UPDATE/DELETE: Alt+P (non modifica niente)
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyP, () => onAnteprimaRef.current?.())
    // Piano di esecuzione: Alt+E (non esegue la query)
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyE, () => onPianoRef.current?.())
    // Salva: Ctrl+S
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current?.())
    // Salva con nome: Ctrl+Shift+S
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, () => onSaveAsRef.current?.())
    // Formatta: Ctrl+Shift+F
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, handleFormat)
    /**
     * MAIUSCOLO / minuscolo della selezione (richiesta utente: "Ctrl+U per rendere maiuscolo la
     * selezione"). Si usano le azioni NATIVE di Monaco: funzionano con più cursori e selezioni
     * multiple, e senza selezione trasformano la parola sotto il cursore.
     * Ctrl+U è la scorciatoia richiesta; Ctrl+Shift+U e Ctrl+Shift+L sono quelle di SSMS, così chi
     * arriva da lì le ritrova.
     */
    const maiuscolo = () => void editor.getAction('editor.action.transformToUppercase')?.run()
    const minuscolo = () => void editor.getAction('editor.action.transformToLowercase')?.run()
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyU, maiuscolo)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyU, maiuscolo)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL, minuscolo)
    // Anteprima dati della tabella sotto il cursore: F4 (e il link nella scheda di hover; il
    // pulsante in toolbar è stato tolto — richiesta utente: "toglilo tanto c'è il tasto sotto")
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
    registerVirgolaACapo(editor)
    registerColonnaMultiCursore(editor)
    registerInvioIndentato(editor)
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

  /**
   * VIRGOLA A CAPO AUTOMATICA (richiesta utente: "Enter e virgola intelligenti").
   *
   * Nel progetto lo stile è "un campo per riga, virgola in testa". Premendo Invio a fine riga dopo
   * una virgola, la virgola viene SPOSTATA in testa alla riga nuova, già rientrata sotto il primo
   * campo della riga precedente ("SELECT a," + Invio → "SELECT a" / ",", incolonnato).
   *
   * Non interviene quando non deve: con altre combinazioni (Alt/Ctrl/Shift+Invio), con una
   * selezione attiva, dentro commenti/stringhe, con il popup dei suggerimenti aperto (lì Invio
   * accetta la voce) e se l'impostazione è spenta. Tutto in UNA modifica, quindi un solo Undo.
   */
  const registerVirgolaACapo = (editor: monaco.editor.IStandaloneCodeEditor) => {
    disposablesRef.current.push(
      editor.onKeyDown(e => {
        if (e.keyCode !== monaco.KeyCode.Enter) return
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
        if (virgolaACapoRef.current === false) return
        // con il popup dei suggerimenti aperto Invio deve accettare la voce selezionata
        if (document.querySelector('.suggest-widget.visible')) return
        const ed = editorRef.current
        const model = ed?.getModel()
        const pos = ed?.getPosition()
        if (!ed || !model || !pos) return
        if (ed.getSelections()?.some(s => !s.isEmpty())) return
        // con più cursori l'Invio lo gestisce registerInvioIndentato (la virgola qui è del cursore principale)
        if ((ed.getSelections()?.length ?? 1) > 1) return
        if (dentroCommentoOStringa(model.getValue(), model.getOffsetAt(pos))) return
        const spezzatura = spezzaDopoVirgola(model.getLineContent(pos.lineNumber), pos.column)
        if (!spezzatura) return
        e.preventDefault()
        e.stopPropagation()
        ed.pushUndoStop()
        // una sola modifica: toglie "virgola + spazi" in coda e mette la riga nuova con la virgola
        ed.executeEdits('sql-intelli-virgola', [
          {
            range: new monaco.Range(pos.lineNumber, spezzatura.colonnaVirgola, pos.lineNumber, pos.column),
            text: testoSpezzato(spezzatura),
          },
        ])
        ed.setPosition({ lineNumber: pos.lineNumber + 1, column: spezzatura.rientro + 2 })
        ed.pushUndoStop()
      }),
    )
  }

  /**
   * MULTI-CURSORE A COLONNA (richiesta utente: "se fai il multi cursore tra le 2 print comprese,
   * dovresti aggiungere spazi nella riga vuota per restare allo stesso livello… questo lo fa SSMS e
   * non Monaco di default").
   *
   * Con più cursori su righe diverse, digitando un carattere le righe più CORTE (tipicamente quelle
   * vuote in mezzo) vengono riempite di spazi fino alla colonna del cursore più avanzato, così il
   * testo resta allineato. Agisce solo se: il cursore è in fondo alla riga (o la riga è vuota), ci
   * sono almeno due cursori vuoti su righe diverse e qualcosa va davvero riempito. Il carattere lo
   * inserisce Monaco come sempre: qui si aggiungono solo gli spazi e si sposta il cursore.
   */
  /**
   * INVIO CON PIÙ CURSORI (richiesta utente: "Enter con più cursori deve mantenere il rientro della
   * riga di partenza anche quando la riga è vuota; in SSMS la riga nuova nasce già indentata").
   *
   * Monaco mantiene il rientro delle righe che hanno contenuto ma su una riga VUOTA crea una riga
   * vuota; qui l'Invio lo gestiamo noi quando ci sono più cursori su righe diverse: ogni riga nuova
   * prende il rientro della propria riga e le righe vuote prendono il rientro delle altre righe del
   * blocco. Con un solo cursore, con una selezione o col popup dei suggerimenti aperto resta Monaco.
   */
  const registerInvioIndentato = (editor: monaco.editor.IStandaloneCodeEditor) => {
    disposablesRef.current.push(
      editor.onKeyDown(e => {
        if (e.keyCode !== monaco.KeyCode.Enter) return
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
        if (document.querySelector('.suggest-widget.visible')) return
        const ed = editorRef.current
        const model = ed?.getModel()
        const selezioni = ed?.getSelections()
        if (!ed || !model || !selezioni || selezioni.length < 2) return
        if (selezioni.some(s => !s.isEmpty())) return
        const posizioni = selezioni.map(s => ({ lineNumber: s.positionLineNumber, column: s.positionColumn }))
        const righe: string[] = []
        for (const p of posizioni) righe[p.lineNumber - 1] = model.getLineContent(p.lineNumber)
        const invii = inviiIndentati(righe, posizioni)
        if (!invii) return
        e.preventDefault()
        e.stopPropagation()
        // dal basso verso l'alto: le posizioni delle righe sopra restano valide
        const dalBasso = [...invii].sort((a, b) => b.lineNumber - a.lineNumber || b.column - a.column)
        ed.pushUndoStop()
        ed.executeEdits(
          'sql-intelli-invio',
          dalBasso.map(v => ({
            range: new monaco.Range(v.lineNumber, v.column, v.lineNumber, v.column),
            text: `\n${v.rientro}`,
          })),
        )
        // cursori sulle righe nuove: ogni Invio inserito sopra sposta la riga di uno
        const ordinate = [...invii].sort((a, b) => a.lineNumber - b.lineNumber)
        ed.setSelections(
          ordinate.map((v, i) => {
            const riga = v.lineNumber + i + 1
            const colonna = v.rientro.length + 1
            return new monaco.Selection(riga, colonna, riga, colonna)
          }),
        )
        ed.pushUndoStop()
      }),
    )
  }

  const registerColonnaMultiCursore = (editor: monaco.editor.IStandaloneCodeEditor) => {
    disposablesRef.current.push(
      editor.onKeyDown(e => {
        // solo caratteri digitabili, senza modificatori (Enter, Backspace, frecce… restano a Monaco)
        const tasto = (e.browserEvent as KeyboardEvent).key
        if (!tasto || tasto.length !== 1) return
        if (e.ctrlKey || e.altKey || e.metaKey) return
        const ed = editorRef.current
        const model = ed?.getModel()
        const selezioni = ed?.getSelections()
        if (!ed || !model || !selezioni || selezioni.length < 2) return
        // con una selezione attiva si sta sostituendo del testo: si lascia fare a Monaco
        if (selezioni.some(s => !s.isEmpty())) return
        const posizioni = selezioni.map(s => ({ lineNumber: s.positionLineNumber, column: s.positionColumn }))
        const righe: string[] = []
        for (const p of posizioni) righe[p.lineNumber - 1] = model.getLineContent(p.lineNumber)
        const riempimenti = riempimentiPerColonna(righe, posizioni)
        if (riempimenti.length === 0) return
        ed.pushUndoStop()
        ed.executeEdits(
          'sql-intelli-colonna',
          riempimenti.map(r => {
            const fine = model.getLineContent(r.lineNumber).length + 1
            return { range: new monaco.Range(r.lineNumber, fine, r.lineNumber, fine), text: r.spazi }
          }),
        )
        // i cursori delle righe riempite vanno alla colonna allineata (il carattere cade lì)
        const colonne = new Map(riempimenti.map(r => [r.lineNumber, r.colonna]))
        ed.setSelections(
          selezioni.map(s => {
            const colonna = colonne.get(s.positionLineNumber)
            return colonna
              ? new monaco.Selection(s.positionLineNumber, colonna, s.positionLineNumber, colonna)
              : s
          }),
        )
        ed.pushUndoStop()
      }),
    )
  }

  const registerInlineCompletions = () => {
    disposablesRef.current.push(
      monaco.languages.registerInlineCompletionsProvider('sql', {
        provideInlineCompletions: async (model, position, context, token) => {
          const st = stateRef.current
          // la preview dati ha un mini-editor: niente autocompletamento IA lì
          if (model.uri.toString().startsWith('sql-intelli://preview')) return { items: [] }

          // 1) SUGGERIMENTI CERTI, dal database (chiavi esterne e colonne): non serve l'IA e non
          //    c'è niente da leggere — il testo compare già e Tab lo accetta. Vengono prima
          //    dell'IA perché sono immediati e sempre giusti sul TUO schema.
          const certo = suggerisciInLinea(model.getValue(), model.getOffsetAt(position), st.summary)
          if (certo) {
            const punto = new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column)
            // con il fantasma a schermo si nasconde il popup: altrimenti Tab sarebbe ambiguo
            return { items: [{ insertText: certo.testo, range: punto }], suppressSuggestions: true }
          }

          // 2) IA (solo se attiva: richiede la chiave DeepSeek configurata)
          if (!st.aiEnabled) return { items: [] }

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
              variant="secondary"
              onClick={() => {
                const sql = getSqlToExecute()
                recordTablesFromSql(sql)
                onExecute(sql)
              }}
              loading={executing}
              title="Esegui (F5 / Ctrl+Invio) — se hai selezionato del testo esegue solo la selezione"
            >
              {/* la freccia è VERDE (colore dell'esecuzione), il pulsante resta neutro come gli altri */}
              <Play className="h-4 w-4 fill-emerald-400 text-emerald-400" /> Esegui
            </Button>
            <Button
              variant="secondary"
              onClick={() => onAnteprimaRef.current?.()}
              title="Anteprima delle modifiche (Alt+P): mostra le righe che un UPDATE/DELETE toccherebbe, senza modificare niente"
              data-anteprima="modifiche"
            >
              <Eye className="h-4 w-4 text-sky-400" /> Anteprima
            </Button>
            <Button
              variant="ghost"
              onClick={() => onPianoRef.current?.()}
              title="Piano di esecuzione stimato (Alt+E): operatori e indici suggeriti, senza eseguire la query"
              data-piano="apri"
            >
              <Activity className="h-4 w-4 text-amber-400" /> Piano
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
            <Save className="h-4 w-4 text-sky-400" /> Salva
          </Button>
          <Button variant="ghost" onClick={() => onSaveAs?.()} title="Salva con nome (Ctrl+Shift+S) — scegli dove salvarla">
            <Save className="h-4 w-4 text-sky-300" /> Salva con nome
          </Button>
          <Button variant="ghost" onClick={() => onOpenFile?.()} title="Apri file .sql (permette di sovrascrivere l'originale)">
            <FolderOpen className="h-4 w-4 text-amber-400" /> Apri file
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              editorRef.current?.focus()
              void editorRef.current?.getAction('editor.action.commentLine')?.run()
            }}
            title="Commenta / togli il commento alle righe selezionate (Ctrl+/)"
          >
            <MessageSquare className="h-4 w-4 text-lime-400" /> Commenta
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              editorRef.current?.focus()
              void editorRef.current?.getAction('editor.action.indentLines')?.run()
            }}
            title="Aumenta il rientro delle righe selezionate (Tab)"
          >
            <IndentIncrease className="h-4 w-4 text-teal-300" /> Rientra
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              editorRef.current?.focus()
              void editorRef.current?.getAction('editor.action.outdentLines')?.run()
            }}
            title="Riduce il rientro delle righe selezionate (Shift+Tab)"
          >
            <IndentDecrease className="h-4 w-4 text-teal-300" /> Fuori rientro
          </Button>
          <Button
            variant="secondary"
            onClick={handleFormat}
            loading={formatting}
            disabled={formatting}
            data-formatta={formatting ? 'in-corso' : 'pronto'}
            title="Formatta (Ctrl+Shift+F) — con una selezione formatta solo quella parte"
          >
            {!formatting && <Wand2 className="h-4 w-4 text-violet-400" />} {formatting ? 'Formattazione…' : 'Formatta'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setProfileOpen(true)}
            title="Impostazioni di formattazione (importa/edita/esporta il profilo T-SQL)"
          >
            <Settings2 className="h-4 w-4 text-sky-300" />
          </Button>
          <Button
            variant={mostraSpazi ? 'primary' : 'ghost'}
            onClick={toggleSpazi}
            title="Mostra i caratteri invisibili: spazio (·) e tab (→)"
            data-spazi={mostraSpazi ? 'on' : 'off'}
          >
            <Pilcrow className={mostraSpazi ? 'h-4 w-4 text-amber-200' : 'h-4 w-4 text-zinc-400'} /> Spazi e tab
          </Button>
          <Button variant="ghost" onClick={() => editorRef.current?.setValue('')}>
            <Eraser className="h-4 w-4 text-rose-400" /> Svuota
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Button variant="ghost" onClick={() => onZoomFont?.(-1)} title="Riduci testo (Ctrl+rotella giù)">
              <ZoomOut className="h-4 w-4 text-sky-300/80" />
            </Button>
            <span className="w-6 text-center text-xs tabular-nums text-zinc-400">{fontSize}</span>
            <Button variant="ghost" onClick={() => onZoomFont?.(1)} title="Ingrandisci testo (Ctrl+rotella su)">
              <ZoomIn className="h-4 w-4 text-sky-300" />
            </Button>
          </div>
          <Button
            variant="ghost"
            onClick={() => onToggleTheme?.()}
            title={theme === 'vs-dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}
          >
            {theme === 'vs-dark' ? <Sun className="h-4 w-4 text-amber-300" /> : <Moon className="h-4 w-4 text-sky-300" />}
          </Button>
          <Toggle checked={aiEnabled} onChange={onAiEnabledChange} label="Autocompletamento IA" />
          <Toggle
            checked={syntaxCheck}
            onChange={setSyntaxCheck}
            label="Verifica sintassi"
            title="Sottolinea gli errori reali di SQL Server (esegue il testo in una transazione che viene annullata — nessun effetto collaterale)"
          />
          <Toggle
            checked={blocchi}
            onChange={toggleBlocchi}
            label="Scrittura su più righe"
            title="Selezione a BLOCCHI come in SSMS (Alt+C): trascina col mouse un rettangolo di testo e quello che scrivi va su TUTTE le righe selezionate. Per più cursori: Alt+clic oppure Maiusc+Alt+Giù / Maiusc+Alt+Su."
            data-multiriga="blocchi"
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
            // MOSTRA SPAZI E TAB: acceso dal tasto "Spazi e tab" della barra (spazio '·', tab '→')
            ...opzioniSpazi(mostraSpazi),
            // SCRITTURA SU PIÙ RIGHE: selezione a blocchi (stile SSMS) e Alt+clic per più cursori
            columnSelection: blocchi,
            multiCursorModifier: 'alt',
            multiCursorPaste: 'spread',
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
            suggest: {
              showWords: false,
              // si cerca anche DENTRO i nomi: scrivendo "fefo" deve uscire RIG_REVFEFO_VNA
              // (il filtro predefinito accetta solo i match a inizio parola)
              matchOnWordStartOnly: false,
            },
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
      {profileOpen && (
        <FormatProfilePanel
          onClose={() => setProfileOpen(false)}
          motore={formatter}
          onMotoreChange={onFormatterChange}
          opzioni={sqlFluff}
          onOpzioniChange={onSqlFluffChange}
          virgolaACapo={virgolaACapo}
          onVirgolaACapoChange={onVirgolaACapoChange}
        />
      )}
      {formatting && (
        <div
          className="absolute bottom-2 left-2 right-2 z-20 flex items-center gap-2 rounded border border-sky-700 bg-sky-950/80 px-2 py-1 text-[11px] text-sky-200"
          data-formatta="in-corso"
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          Formattazione in corso… ({formatter === 'sqlfluff' ? 'SQLFluff' : 'formattatore dell’app'})
        </div>
      )}
      {formatError && (
        <div
          className="absolute bottom-2 left-2 right-2 z-20 cursor-pointer rounded border border-amber-700 bg-amber-950/80 px-2 py-1 text-[11px] text-amber-200"
          data-formatta="errore"
          onClick={() => setFormatError(null)}
          title="Clicca per chiudere"
        >
          {formatError} — ho usato il formattatore dell’app.
        </div>
      )}
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
