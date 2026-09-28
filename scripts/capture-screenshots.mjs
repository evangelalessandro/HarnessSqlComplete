// CATTURA GLI SCREENSHOT DELL'APP per il README.
//
// Pilota Chrome headless via CDP (Chrome DevTools Protocol) usando il WebSocket integrato
// in Node: nessuna dipendenza da installare. Le immagini finiscono in docs/screenshots/.
//
// Uso:
//   node scripts/capture-screenshots.mjs            (cattura tutta la sequenza)
//   node scripts/capture-screenshots.mjs --dump     (elenca i comandi visibili nella pagina)
//   node scripts/capture-screenshots.mjs --verify-format   (stesso SELECT dentro/fuori una store)
//   node scripts/capture-screenshots.mjs --verify-schema-refresh  (pulsante + Ctrl+Shift+R)
//   node scripts/capture-screenshots.mjs --verify-pair-highlight  (MERGE: campo corrispondente)
//   node scripts/capture-screenshots.mjs --verify-local-tables    (colonne delle #temporanee)
//   node scripts/capture-screenshots.mjs --verify-alias           (alias. → campi della tabella)
//   node scripts/capture-screenshots.mjs --verify-labels          (GOTO → label del documento)
//   node scripts/capture-screenshots.mjs --verify-error-line      (doppio clic sull'errore → riga)
//   node scripts/capture-screenshots.mjs --verify-create          (script CREATE della tabella = SSMS)
//   node scripts/capture-screenshots.mjs --verify-set             (direttive SET nell'intellisense)
//   node scripts/capture-screenshots.mjs --verify-copia           (Copia SQL a sinistra + tasto destro)
//   node scripts/capture-screenshots.mjs --verify-report          (istogramma tabelle + DELETE contenuto)
//   node scripts/capture-screenshots.mjs --measure-typing         (latenza digitando in una store grande)
//
// Prerequisiti: backend su :5213 e dev server su :5173 attivi.

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'docs', 'screenshots')
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173/'
const PORT = 9222
const DUMP = process.argv.includes('--dump')
const VERIFY_TABS = process.argv.includes('--verify-tabs')
const VERIFY_ERRORS = process.argv.includes('--verify-errors')
const VERIFY_TAB_CURSOR = process.argv.includes('--verify-tab-cursor')
const DUMP_GENERATOR = process.argv.includes('--dump-generator')
const DUMP_TABBAR = process.argv.includes('--dump-tabbar')
const VERIFY_FORMAT = process.argv.includes('--verify-format')
const VERIFY_SCHEMA_REFRESH = process.argv.includes('--verify-schema-refresh')
const VERIFY_PAIR_HIGHLIGHT = process.argv.includes('--verify-pair-highlight')
const VERIFY_LOCAL_TABLES = process.argv.includes('--verify-local-tables')
const VERIFY_ALIAS = process.argv.includes('--verify-alias')
const VERIFY_LABELS = process.argv.includes('--verify-labels')
const VERIFY_ERROR_LINE = process.argv.includes('--verify-error-line')
const MEASURE_TYPING = process.argv.includes('--measure-typing')
const VERIFY_SCROLLBARS = process.argv.includes('--verify-scrollbars')
const VERIFY_TABTREE = process.argv.includes('--verify-tabtree')
const VERIFY_SEARCH = process.argv.includes('--verify-search')
const VERIFY_INDENT = process.argv.includes('--verify-indent')
const VERIFY_DROP = process.argv.includes('--verify-drop')
const VERIFY_FRAGMENT = process.argv.includes('--verify-fragment')
const VERIFY_SIDEBAR = process.argv.includes('--verify-sidebar')
const VERIFY_CHANGES = process.argv.includes('--verify-changes')
const VERIFY_MERGE = process.argv.includes('--verify-merge')
const VERIFY_PARAMS = process.argv.includes('--verify-params')
const VERIFY_MULTIRIGA = process.argv.includes('--verify-multiriga')
const VERIFY_TEMA = process.argv.includes('--verify-tema')
const VERIFY_CREATE = process.argv.includes('--verify-create')
const VERIFY_SET = process.argv.includes('--verify-set')
const VERIFY_COPIA = process.argv.includes('--verify-copia')
const VERIFY_TRIGGER = process.argv.includes('--verify-trigger')
const VERIFY_INIZIO = process.argv.includes('--verify-inizio')
const VERIFY_CURSORI_CORTI = process.argv.includes('--verify-cursori-corti')
const VERIFY_REPORT = process.argv.includes('--verify-report')
const VERIFY_HOVER = process.argv.includes('--verify-hover')
/**
 * Finestra molto alta per --verify-create: Monaco disegna nel DOM solo le righe VISIBILI, quindi
 * per leggere tutto lo script CREATE (colonne, vincoli, DEFAULT, trigger) serve un editor alto.
 */
const WINDOW_H = VERIFY_CREATE ? 2600 : VERIFY_HOVER ? 1400 : 1000

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Parametri della cattura (login salvata e query da mostrare negli screenshot)
const LOGIN_NAME = process.env.SHOT_LOGIN ?? 'sql2019'
const QUERY =
  process.env.SHOT_QUERY ??
  'SELECT TOP 25 UDC_UDC, UDC_TIPOUDC, UDC_ARTICOLO, UDC_UBIUDC, UDC_CORRIDOIO, UDC_CELLA, UDC_CAUSMISS\nFROM dbo.DAT_UDC\nWHERE UDC_UDC > 0\nORDER BY UDC_UDC DESC;'
const EXEC_LINE = process.env.SHOT_EXEC ?? 'EXEC dbo.ws_L2_SetCorridoioMiss @idMissione = 1'
/** Routine di cui mostrare il diagramma delle chiamate. */
const ROUTINE_NAME = process.env.SHOT_ROUTINE ?? 'ws_L2_SetCorridoioMiss'
/**
 * Tabella e trigger usati da --verify-trigger: si abilita/disabilita il trigger di una tabella
 * reale del database di prova.
 */
const TRIGGER_TABLE = process.env.SHOT_TRIGGER_TABLE ?? 'DAT_CLASSI_MERC'
const TRIGGER_NAME = process.env.SHOT_TRIGGER ?? `tr_${TRIGGER_TABLE}`
/**
 * Store usata da --verify-search per il controllo "nessun doppione": cercandone il NOME deve
 * comparire UNA volta sola (non anche come match nella sua definizione).
 */
const STORE_UNICA = process.env.SHOT_STORE_UNICA ?? 'ws_CUSTOM_TRANSFER'
/**
 * Tabella con PRIMARY KEY COMPOSITA usata dalla verifica della MERGE (--verify-merge):
 * serve a controllare che NESSUN campo chiave finisca nell'UPDATE SET.
 */
const TABELLA_CHIAVE = process.env.SHOT_TABLE ?? 'L1_AZIONI_PERCORSI'
/**
 * Tabella usata da --verify-create: è piccola (2 colonne) ma ha TUTTO quello che serve per
 * confrontare lo script con quello di SSMS: PRIMARY KEY NONCLUSTERED con opzioni e FILLFACTOR,
 * un vincolo UNIQUE, un DEFAULT, un CHECK e un trigger con il corpo.
 */
const TABELLA_CREATE = process.env.SHOT_CREATE_TABLE ?? 'DAT_CLASSI_MERC'
/**
 * Seconda tabella usata da --verify-create: ha una colonna `varbinary(max)`, quindi lo script deve
 * chiudere con ") ON [SECONDARY] TEXTIMAGE_ON [SECONDARY]" come fa SSMS.
 */
const TABELLA_CREATE_LOB = process.env.SHOT_CREATE_TABLE_LOB ?? 'UTI_LINGUA_XML'
/** Database attivo della connessione di prova: SSMS apre lo script con "USE [<database>]". */
const DB_CREATE = process.env.SHOT_CREATE_DB ?? 'WSGSDMALTA'
/** Opzioni dell'indice di TABELLA_CREATE, lette dai metadati veri (sys.indexes) del database. */
const OPZIONI_CREATE =
  'PAD_INDEX = ON, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ' +
  'ALLOW_PAGE_LOCKS = OFF, FILLFACTOR = 90, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF'
/**
 * Funzione TABELLARE usata da --verify-alias: con "FROM dbo.<fn>() a" l'intellisense deve
 * proporre i campi che la funzione restituisce (era il caso in cui il popup restava vuoto).
 */
const FUNZIONE_TABELLARE = process.env.SHOT_TVF ?? 'fn_Calc_ORD_RIGHE_FIELDS'
/** Una colonna restituita da FUNZIONE_TABELLARE (per il controllo nel popup). */
const FUNZIONE_TABELLARE_CAMPO = process.env.SHOT_TVF_COL ?? 'CALC_ORD_ORDINE'
/**
 * Store usata da --verify-params: è una di quelle scritte con lo stile "@param as tipo", dove la
 * lettura della firma si fermava al primo "as" (i parametri non comparivano nell'intellisense).
 */
const ROUTINE_PARAMS_NAME = process.env.SHOT_PARAMS_ROUTINE ?? 'ws_HDL_TestPrio'
/**
 * Parametri della routine ROUTINE_PARAMS_NAME (dalla firma nel database): la verifica
 * --verify-params controlla che l'intellisense li proponga mentre la si modifica.
 */
const ROUTINE_PARAMS = (process.env.SHOT_PARAMS ?? '@mId,@nNoBack,@fExist,@Errore')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
/** Quanti caratteri spostare il cursore per finire DENTRO il nome della routine ("EXEC dbo." = 9). */
const EXEC_NAME_OFFSET = Number(process.env.SHOT_EXEC_OFFSET ?? 13)
/**
 * Store usata da --verify-hover: ha il COMMENTO di testata (blocco di commento prima della CREATE),
 * 23 parametri e un parametro OUTPUT con lunghezza esatta (@errore nvarchar(255) OUTPUT).
 */
const STORE_HOVER = process.env.SHOT_HOVER_STORE ?? 'ws_L2_GenMissIng'
/** Numero di parametri della firma di STORE_HOVER (letta da sys.parameters del database). */
const STORE_HOVER_PARAMS = Number(process.env.SHOT_HOVER_PARAMS ?? 23)
/**
 * FUNZIONE usata da --verify-hover: le funzioni del sommario NON hanno i parametri, quindi qui si
 * controlla che vengano letti dalla DEFINIZIONE (10 parametri, commento di testata in blocco).
 */
const FUNZIONE_HOVER = process.env.SHOT_HOVER_FUNCTION ?? 'fn_APS_Detect_ErrBF'
/** Parametri della firma di FUNZIONE_HOVER (senza il valore di ritorno: sys.parameters ha una riga con nome NULL). */
const FUNZIONE_HOVER_PARAMS = Number(process.env.SHOT_HOVER_FUNCTION_PARAMS ?? 10)

/**
 * Batch usato dalla verifica degli errori: crea una procedura TEMPORANEA (vive solo nella
 * sessione) che solleva un errore, poi la chiama. Serve a controllare che i messaggi dicano
 * quale procedura ha fallito, come fa SSMS.
 */
const BATCH_WITH_ERROR =
  process.env.SHOT_ERROR_SQL ??
  "CREATE PROCEDURE #prova_err AS BEGIN RAISERROR('Errore di prova dentro la procedura', 16, 1); END;\nGO\nPRINT 'prima della chiamata';\nEXEC #prova_err;"

/**
 * Batch con un errore che CITA un oggetto esistente del database: serve a verificare che
 * compaia il pulsante per aprirlo in una tab. Usa un RAISERROR con un testo realistico
 * (nessuna scrittura sui dati).
 */
const BATCH_OBJECT_ERROR =
  process.env.SHOT_OBJECT_ERROR_SQL ??
  "CREATE PROCEDURE #prova_obj AS BEGIN RAISERROR('Inserimento non riuscito nella tabella ''dbo.DAT_UDC''', 16, 1); END;\nGO\nEXEC #prova_obj;"

/**
 * Batch usato per "errore + risultato insieme" e per il salto alla riga: una SELECT che
 * restituisce righe e poi una procedura REALE che fallisce alla riga 34. Il corridoio
 * -999999 non esiste, quindi l'UPDATE interno tocca 0 righe: nessun dato viene modificato.
 */
const BATCH_ERROR_AND_RESULTS =
  process.env.SHOT_ERROR_RESULTS_SQL ??
  'SELECT TOP 3 COR_CORRIDOIO, COR_AREA FROM dbo.MAG_CORRIDOI;\nEXEC dbo.ws_L2_RotazioneCelle_SetPause @pCorridor = -999999;'

/** Query a più righe usata dalla verifica della posizione del cursore. */
const TAB1_SQL = 'SELECT 1 AS uno;\nSELECT 2 AS due;\nSELECT 3 AS tre;\nSELECT 4 AS quattro;'

/**
 * ACCESSO all'app con un paio di tentativi: mentre Vite ricompila i moduli la pagina può
 * ricaricarsi e il clic sulla login andare perso (era il motivo dei fallimenti "a freddo" dei modi
 * di verifica appena dopo una modifica al codice). Aspetta editor e schema pronti.
 */
async function accediApp(page, attesa = `document.body.textContent.includes('Schema:')`) {
  for (let tentativo = 1; tentativo <= 3; tentativo++) {
    await page.waitFor(`document.querySelector('input')`, 30000, 'pagina pronta')
    await page.clickWhere(
      `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
         .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
    )
    if (await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, `editor pronto (${tentativo})`)) {
      if (await page.waitFor(attesa, 60000, `schema caricato (${tentativo})`)) return true
    }
    await sleep(1500)
  }
  throw new Error('app non caricata: editor o schema non pronti dopo 3 tentativi')
}

/**
 * Rettangolo dell'area di testo dell'editor: serve a cliccare "dentro" l'editor con un
 * evento del mouse vero (l'app non espone window.monaco, quindi niente API interna).
 */
async function editorRect(page) {
  return page.eval(`(() => {
    const el = document.querySelector('.monaco-editor .view-lines') || document.querySelector('.monaco-editor');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  })()`)
}

/**
 * Coordinate di pagina del carattere numero `charIndex` della PRIMA riga visibile
 * dell'editor. Monaco divide la riga in span (uno per token): si misura la larghezza del
 * carattere dentro lo span che contiene la posizione cercata.
 */
async function editorCharPoint(page, charIndex) {
  return page.eval(`(() => {
    const line = document.querySelector('.monaco-editor .view-lines .view-line');
    if (!line) return null;
    const spans = [...line.querySelectorAll('span')].filter(s => s.children.length === 0 && (s.textContent || '').length > 0);
    let acc = 0;
    for (const span of spans) {
      const t = span.textContent || '';
      if (acc + t.length > ${charIndex}) {
        const r = span.getBoundingClientRect();
        const per = r.width / t.length;
        return { x: r.left + per * (${charIndex} - acc) + per / 2, y: r.top + r.height / 2 };
      }
      acc += t.length;
    }
    const r = line.getBoundingClientRect();
    return { x: r.left + 6, y: r.top + r.height / 2 };
  })()`)
}

/** Apre il menu contestuale di Monaco sulla posizione del CURSORE (come Shift+F10). */
async function openContextMenuAtCaret(page) {
  return page.eval(`(() => {
    const ta = document.querySelector('.monaco-editor textarea');
    if (!ta) return false;
    ta.focus();
    ta.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`)
}

function findBrowser() {
  const found = CHROME_CANDIDATES.find(p => existsSync(p))
  if (!found) throw new Error('Chrome/Edge non trovato')
  return found
}

/** Avvia il browser headless e restituisce { proc, profileDir }. */
function launchBrowser() {
  const profileDir = join(process.env.TEMP ?? '.', `dsh-shots-${Date.now()}`)
  mkdirSync(profileDir, { recursive: true })
  const proc = spawn(
    findBrowser(),
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profileDir}`,
      `--window-size=1600,${WINDOW_H}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  return { proc, profileDir }
}

async function waitForDebugger() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) return await res.json()
    } catch {
      /* non ancora pronto */
    }
    await sleep(250)
  }
  throw new Error('il debugger del browser non risponde')
}

/** Sessione CDP minimale su una pagina. */
class Session {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    /** Eventi ricevuti dal browser (es. la console della pagina), per la diagnostica. */
    this.events = []
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
        return
      }
      if (msg.method) this.events.push(msg)
    })
  }
  /** Testo dei messaggi di console raccolti finora (per capire cosa fa la pagina). */
  consoleLogs(needle = '') {
    return this.events
      .filter(e => e.method === 'Runtime.consoleAPICalled')
      .map(e => (e.params?.args ?? []).map(a => a.value ?? a.description ?? '').join(' '))
      .filter(t => t.includes(needle))
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`timeout su ${method}`))
        }
      }, 30000)
    })
  }
  /** Valuta un'espressione nella pagina e restituisce il valore. */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception ?? {}))
    return r.result?.value
  }
  /** Clic su un elemento: prima per testo esatto, poi "contiene". */
  async click(text, { exact = false } = {}) {
    const found = await this.eval(`(() => {
      const needle = ${JSON.stringify(text)};
      const els = [...document.querySelectorAll('button, a, [role="button"], [role="tab"], [role="menuitem"], label, li, div, span')];
      const visible = els.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 });
      const own = e => (e.textContent || '').trim();
      const target = visible.find(e => ${exact ? 'own(e) === needle' : 'own(e) === needle'}) ||
                     visible.find(e => ${exact ? 'false' : 'own(e).includes(needle)'});
      if (!target) return false;
      target.scrollIntoView({ block: 'center' });
      for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
      return true;
    })()`)
    return found
  }
  /** Clic sull'elemento restituito da un'espressione JS. */
  async clickWhere(js) {
    return this.eval(`(() => {
      const el = (${js});
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
      return true;
    })()`)
  }
  /** Clic su un pulsante dentro il contenitore che contiene `containerText`. */
  async clickWithin(containerText, buttonText) {
    return this.eval(`(() => {
      const boxes = [...document.querySelectorAll('div, li, section')]
        .filter(e => (e.textContent || '').includes(${JSON.stringify(containerText)}));
      const smallest = boxes.sort((a, b) => a.textContent.length - b.textContent.length)[0];
      if (!smallest) return false;
      const btn = [...smallest.querySelectorAll('button, [role="button"], a')]
        .find(b => (b.textContent || '').includes(${JSON.stringify(buttonText)}));
      if (!btn) return false;
      for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
        btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
      return true;
    })()`)
  }
  /** Scrive testo come se fosse digitato (o incollato) nel campo attivo. */
  async typeText(text) {
    await this.send('Input.insertText', { text })
  }
  /** Preme un tasto (es. F5) o una combinazione (ctrl+space). Per i tasti che INSERISCONO un
   *  carattere serve `text` (es. Enter: text '\r'); con `eventType: 'keyDown'` si manda la
   *  pressione "vera" (senza testo), che è il percorso del keybinding di Monaco. */
  async press(key, { code, vk, modifiers = 0, text, eventType } = {}) {
    const base = { key, code: code ?? key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }
    const tipo = eventType ?? (text !== undefined ? 'keyDown' : 'rawKeyDown')
    await this.send('Input.dispatchKeyEvent', {
      type: tipo,
      ...base,
      ...(text !== undefined ? { text, unmodifiedText: text } : {}),
    })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }
  /** Clic del mouse in coordinate di pagina (con eventuale tasto destro). */
  async clickPoint(x, y, button = 'left') {
    const common = { x: Math.round(x), y: Math.round(y), button, clickCount: 1 }
    const buttons = button === 'right' ? 2 : 1
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...common, buttons: 0 })
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...common, buttons })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...common, buttons: 0 })
  }
  /**
   * Trascinamento del mouse da un punto a un altro (per la selezione col mouse).
   * `modifiers`: 0 nessuno, 1 Alt (selezione a BLOCCHI come SSMS).
   */
  async dragPoint(x1, y1, x2, y2, modifiers = 0) {
    const base = { button: 'left', clickCount: 1, buttons: 1, modifiers }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x1), y: Math.round(y1), button: 'none', buttons: 0, modifiers })
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x1), y: Math.round(y1), ...base })
    const passi = 8
    for (let i = 1; i <= passi; i++) {
      const x = x1 + ((x2 - x1) * i) / passi
      const y = y1 + ((y2 - y1) * i) / passi
      // eslint-disable-next-line no-await-in-loop
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y), button: 'left', buttons: 1, modifiers })
    }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x2), y: Math.round(y2), button: 'left', buttons: 0, modifiers })
  }
  /** Attende che una condizione JS diventi vera. */
  async waitFor(expression, timeoutMs = 15000, label = expression) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      // eslint-disable-next-line no-await-in-loop
      if (await this.eval(`!!(${expression})`)) return true
      // eslint-disable-next-line no-await-in-loop
      await sleep(300)
    }
    console.log(`  (attenzione: condizione non soddisfatta entro ${timeoutMs}ms: ${label})`)
    return false
  }
  /** Cattura lo schermo e salva il PNG. */
  async screenshot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    mkdirSync(OUT_DIR, { recursive: true })
    const file = join(OUT_DIR, `${name}.png`)
    writeFileSync(file, Buffer.from(data, 'base64'))
    console.log(`  salvato docs/screenshots/${name}.png`)
    return file
  }
}

/** Collega la pagina già aperta dal browser (niente sessioni: si parla direttamente con lei). */
async function newPage() {
  // il browser apre "about:blank": si aspetta che compaia fra i target di tipo page
  let target
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
      if (target) break
    } catch {
      /* debugger non ancora pronto */
    }
    await sleep(250)
  }
  if (!target) throw new Error('nessuna pagina disponibile nel browser')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })
  const page = new Session(ws)
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  return page
}

/**
 * VERIFICA (--verify-tabs): nella barra delle tab, dove finisce la nuova tab?
 * Un solo pulsante "Nuova" (a destra, dopo quella attiva): Shift+clic o clic col tasto
 * centrale la aprono come PRIMA tab, cioè a sinistra. Stampa PASS/FAIL per ogni caso.
 */
async function verifyTabPositions(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await sleep(1500)

  /** Titoli delle tab nell'ordine in cui appaiono nella barra. */
  const tabs = () =>
    page.eval(`[...document.querySelectorAll('[title*="\\u00b7 db:"]')]
      .map(b => (b.getAttribute('title') || '').split(' \\u00b7 db: ')[0].trim())`)
  const clickNew = () => page.clickWhere(`[...document.querySelectorAll('button')].find(b => (b.getAttribute('title') || '').startsWith('Nuova query'))`)
  /** Shift+clic sul pulsante "Nuova" (scorciatoia "apri come prima tab"). */
  const shiftClickNew = () =>
    page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('title') || '').startsWith('Nuova query'));
      if (!b) return false;
      b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, shiftKey: true }));
      return true;
    })()`)
  /** Clic col tasto centrale sul pulsante "Nuova" (stessa scorciatoia). */
  const middleClickNew = () =>
    page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('title') || '').startsWith('Nuova query'));
      if (!b) return false;
      b.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, view: window, button: 1 }));
      return true;
    })()`)

  const results = []
  const check = (name, ok, detail) => {
    results.push({ name, ok, detail })
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  }

  // si parte da una tab e se ne aggiungono due "normali"
  await clickNew()
  await clickNew()
  const before = await tabs()
  console.log(`  tab attuali: ${JSON.stringify(before)}`)

  // 1. Shift+clic su "Nuova": la nuova tab nasce come PRIMA (a sinistra)
  await shiftClickNew()
  await sleep(400)
  const afterLeft = await tabs()
  check(
    'Shift+clic su "Nuova" apre la tab come PRIMA',
    afterLeft.length === before.length + 1 && !before.includes(afterLeft[0]),
    JSON.stringify(afterLeft),
  )

  // 2. clic col tasto centrale su "Nuova": stessa scorciatoia
  await middleClickNew()
  await sleep(400)
  const afterMiddle = await tabs()
  check(
    'clic col tasto centrale apre la tab come PRIMA',
    afterMiddle.length === afterLeft.length + 1 && !afterLeft.includes(afterMiddle[0]),
    JSON.stringify(afterMiddle),
  )

  // 3. clic normale: la nuova tab va TUTTO A DESTRA (in fondo), non accanto a quella attiva
  await clickNew()
  await sleep(400)
  const afterNormal = await tabs()
  check(
    '"Nuova" apre la tab TUTTO A DESTRA (in fondo, non accanto a quella attiva)',
    afterNormal.length === afterMiddle.length + 1 &&
      !afterMiddle.includes(afterNormal[afterNormal.length - 1]),
    JSON.stringify(afterNormal),
  )

  // 4. il tasto destro sulla tab non deve offrire voci "nuove tab a sinistra" (le scorciatoie
  //    sono Shift+clic e tasto centrale): si controlla che il menu si apra e non le contenga
  const openedMenu = await page.eval(`(() => {
    const b = document.querySelector('[title*="\\u00b7 db:"]');
    if (!b) return false;
    b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`)
  await sleep(600)
  const vociMenu = await page.eval(
    `[...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => (b.textContent || '').trim()).filter(t => t.startsWith('Chiudi') || t.includes('nuove tab'))`,
  )
  console.log(`  voci del menu della tab: ${JSON.stringify(vociMenu)}`)
  check(
    'il menu della tab ha le voci di chiusura e nessun doppione "nuove tab"',
    openedMenu === true && vociMenu.some(v => v.startsWith('Chiudi')) && !vociMenu.some(v => v.includes('nuove tab')),
    JSON.stringify(vociMenu),
  )
  await page.press('Escape', { code: 'Escape', vk: 27 })
  await sleep(300)

  // 5) il pannello dei RISULTATI è legato alla TAB: nascondendolo qui non sparisce nell'altra
  const risultati = () => page.eval(`!!document.querySelector('[data-risultati="pannello"]')`)
  /** Si assicura che nella tab attiva i risultati siano VISIBILI (Ctrl+R se sono nascosti). */
  const assicuraVisibili = async () => {
    if (!(await risultati())) {
      await page.press('r', { code: 'KeyR', vk: 82, modifiers: 2 })
      await sleep(600)
    }
  }
  await page.clickWhere(`document.querySelectorAll('.sql-tab')[0]`)
  await sleep(500)
  await assicuraVisibili()
  await clickNew()
  await sleep(600)
  await assicuraVisibili()
  const titoloNuova = (await tabs()).slice(-1)[0]
  const primaDelToggle = await risultati()
  await page.press('r', { code: 'KeyR', vk: 82, modifiers: 2 }) // Ctrl+R: nasconde QUI
  await sleep(600)
  const dopoIlToggle = await risultati()
  // si passa all'altra tab (il clic va sul PULSANTE del titolo: il div della tab non cambia tab)
  await page.clickWhere(
    `(() => {
      const t = [...document.querySelectorAll('.sql-tab')].find(x => !(x.textContent || '').includes(${JSON.stringify(titoloNuova)}));
      return t ? t.querySelector('button') : null;
    })()`,
  )
  await sleep(600)
  const altraTab = await risultati()
  console.log(`  risultati: prima=${primaDelToggle} dopo Ctrl+R=${dopoIlToggle} altra tab=${altraTab}`)
  check(
    'Ctrl+R nasconde i risultati solo nella tab attiva',
    primaDelToggle === true && dopoIlToggle === false && altraTab === true,
    `prima ${primaDelToggle}, dopo ${dopoIlToggle}, altra ${altraTab}`,
  )

  const failed = results.filter(r => !r.ok)
  console.log(`\nesito: ${results.length - failed.length}/${results.length} controlli superati`)
  if (failed.length > 0) throw new Error(`${failed.length} controlli falliti`)
}

/**
 * VERIFICA (--verify-errors): eseguendo una query che chiama una procedura che fallisce,
 * i Messaggi devono dire QUALe procedura ha dato errore (come fa SSMS).
 * La procedura è temporanea (#prova_err): vive solo nella sessione e sparisce da sola.
 */
async function verifyErrorMessages(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await sleep(1500)

  const rect = await editorRect(page)
  await page.clickPoint(rect.x + 160, rect.y + 18)
  await sleep(400)
  await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
  await page.typeText(BATCH_WITH_ERROR)
  await sleep(500)
  await page.press('F5', { code: 'F5', vk: 116 })
  await sleep(4000)

  const testo = await page.eval(
    `(() => { const p = document.querySelector('.min-h-0.flex-1.overflow-auto.bg-zinc-950'); return (p ? p.innerText : document.body.innerText) })()`,
  )
  // diagnostica: cosa c'è nell'editor, quale tab è attiva, cosa dice la pagina
  const stato = await page.eval(`(() => ({
    editor: [...document.querySelectorAll('.monaco-editor .view-line')].map(l => l.textContent).join(' / '),
    tabAttiva: (document.body.innerText.match(/Risultati|Messaggi \\/ PRINT/g) || []).join(','),
    anteprima: document.body.innerText.replace(/\\n+/g, ' | ').slice(0, 500),
  }))()`)
  console.log(`  editor: ${stato.editor.slice(0, 200)}`)
  console.log(`  pagina: ${stato.anteprima}`)
  const results = []
  const check = (name, ok) => {
    results.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  }
  console.log(`  --- messaggi mostrati ---\n${testo.split('\n').map(l => `  | ${l}`).join('\n')}`)
  check('dice QUALE procedura ha dato errore', /Procedura\s+#prova_err/.test(testo))
  check('mostra numero e livello del messaggio', /Msg\s+50000,\s*Livello\s+16/.test(testo))
  check('mostra la riga', /Riga\s+\d+/.test(testo))
  check('mostra il testo del RAISERROR', /Errore di prova dentro la procedura/.test(testo))
  check('i PRINT precedenti restano visibili', /prima della chiamata/.test(testo))
  // il conteggio degli errori sta nell'intestazione del pannello (e sulla tab dei messaggi)
  const pagina = await page.eval(`document.body.innerText`)
  check('segnala il numero di errori', /1 errore/.test(pagina))

  const failed = results.filter(r => !r).length
  console.log(`\nesimo primo batch: ${results.length - failed}/${results.length} controlli superati`)

  // ---- secondo batch: errore che CITA un oggetto esistente → deve comparire il pulsante ----
  console.log('\n  --- errore che cita una tabella esistente ---')
  // gli oggetti citati si possono proporre solo con lo SCHEMA caricato: si aspetta (la pagina
  // può essere ancora su "Caricamento metadati…", e allora il pulsante non compare)
  await page.waitFor(`document.body.textContent.includes('Schema:')`, 60000, 'schema caricato (oggetti citati)')
  await sleep(800)
  await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
  await page.typeText(BATCH_OBJECT_ERROR)
  await sleep(500)
  await page.press('F5', { code: 'F5', vk: 116 })
  await sleep(4000)
  const pagina2 = await page.eval(`document.body.innerText`)
  const bottoni = await page.eval(
    `[...document.querySelectorAll('button')].map(b => (b.textContent || '').trim()).filter(t => t.startsWith('Modifica') || t.startsWith('Apri CREATE'))`,
  )
  const debug = await page.eval(
    `(() => ({
      tuttiIBottoni: [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim()).slice(0, 25),
      oggettiCitati: document.body.innerText.includes('Oggetti citati'),
      pannello: (document.querySelector('.min-h-0.flex-1.overflow-auto.bg-zinc-950')?.innerText || '').slice(0, 300),
    }))()`,
  )
  console.log(`  pulsanti trovati: ${JSON.stringify(bottoni)}`)
  console.log(`  'Oggetti citati' presente: ${debug.oggettiCitati}`)
  console.log(`  pannello: ${debug.pannello.replace(/\n/g, ' | ')}`)
  console.log(`  pannello: ${debug.pannello.replace(/\n/g, ' | ')}`)
  check('propone di aprire la tabella citata nell errore', bottoni.some(b => b.includes('Apri CREATE dbo.DAT_UDC')))
  check('la procedura temporanea non produce pulsanti inutili', !bottoni.some(b => b.includes('#prova_obj')))
  check('il messaggio mostra il testo del RAISERROR', /tabella 'dbo\.DAT_UDC'/.test(pagina2))

  // ---- il pulsante deve APRIRE davvero l'oggetto in una nuova tab ----
  const cliccato = await page.clickWhere(
    `[...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('Apri CREATE dbo.DAT_UDC'))`,
  )
  await sleep(2500)
  const dopoClick = await page.eval(`(() => ({
    tab: [...document.querySelectorAll('[title*="\\u00b7 db:"]')].map(b => (b.getAttribute('title') || '').split(' \\u00b7 db: ')[0].trim()),
    editor: [...document.querySelectorAll('.monaco-editor .view-line')].map(l => l.textContent).join(' ').slice(0, 200),
  }))()`)
  console.log(`  dopo il clic → tab: ${JSON.stringify(dopoClick.tab)}`)
  console.log(`  editor: ${dopoClick.editor}`)
  check('il clic ha aperto l oggetto', cliccato === true)
  check('si apre una tab dedicata all oggetto', dopoClick.tab.some(t => t.includes('DAT_UDC')))
  check('la tab contiene lo script CREATE TABLE', /CREATE\s+TABLE/i.test(dopoClick.editor))

  // ---- terza parte: errore + risultati, e apertura dell'oggetto ALLA RIGA dell'errore ----
  await verifyErrorWithResults(page)

  const failed2 = results.filter(r => !r).length
  console.log(`\nesito: ${results.length - failed2}/${results.length} controlli superati`)
  if (failed2 > 0) throw new Error(`${failed2} controlli falliti`)
}

/**
 * VERIFICA (--verify-errors, terza parte): errore + result set insieme, e apertura dell'oggetto
 * ALLA RIGA dell'errore. Usa una procedura REALE del database che fallisce quando il corridoio
 * non esiste: l'UPDATE tocca 0 righe, quindi nessun dato viene modificato.
 */
async function verifyErrorWithResults(page) {
  const esiti = []
  const check = (name, ok, extra = '') => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
  }

  const rect = await editorRect(page)
  await page.clickPoint(rect.x + 160, rect.y + 18)
  await sleep(400)
  await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
  await page.typeText(BATCH_ERROR_AND_RESULTS)
  await sleep(500)
  await page.press('F5', { code: 'F5', vk: 116 })
  await sleep(5000)

  // (A) con errore e risultati, la tab attiva deve essere quella dei messaggi (l'errore per primo)
  const tabs = await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].filter(x => /^(Risultati|Messaggi)/.test((x.textContent || '').trim()));
    return b.map(x => ({ label: (x.textContent || '').trim().split(' ')[0], attiva: x.className.includes('border-sky-500') }));
  })()`)
  console.log(`  tab dei risultati: ${JSON.stringify(tabs)}`)
  const messaggi = tabs.find(t => t.label.startsWith('Messaggi'))
  const risultati = tabs.find(t => t.label.startsWith('Risultati'))
  check("c'è sia la tab Risultati sia quella dei Messaggi", !!messaggi && !!risultati)
  check("con l'errore si apre per prima la tab dei Messaggi", !!messaggi?.attiva)
  check('i risultati restano disponibili nell\'altra tab', !!risultati && !risultati.attiva)

  // (B) il pulsante porta in tab l'oggetto E alla riga indicata dall'errore
  const bottoni = await page.eval(
    `[...document.querySelectorAll('button')].map(b => (b.textContent || '').trim()).filter(t => t.startsWith('Modifica'))`,
  )
  console.log(`  pulsanti: ${JSON.stringify(bottoni)}`)
  const conRiga = bottoni.find(b => /\(riga \d+\)/.test(b))
  check("il pulsante dice anche la riga dell'errore", !!conRiga, conRiga || '')
  const rigaAttesa = conRiga ? Number((conRiga.match(/\(riga (\d+)\)/) || [])[1]) : 0

  const cliccato = await page.clickWhere(
    `[...document.querySelectorAll('button')].find(b => /^Modifica /.test((b.textContent || '').trim()))`,
  )
  await sleep(3500)
  const stato = await page.eval(`(() => {
    // il cursore di Monaco sta in .cursors-layer: la sua "top" identifica la riga su cui è
    const cursori = [...document.querySelectorAll('.monaco-editor .cursors-layer .cursor')].map(c => ({ top: c.style.top, h: c.style.height, cls: c.className }));
    const righe = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')].map(l => ({ top: l.style.top, testo: (l.textContent || '').slice(0, 60) }));
    const topCursore = cursori[0]?.top ?? null
    const rigaCursore = topCursore ? righe.find(r => r.top === topCursore) : undefined
    return {
      tab: [...document.querySelectorAll('[title*="\\u00b7 db:"]')].map(b => (b.getAttribute('title') || '').split(' \\u00b7 db: ')[0].trim()).slice(-1)[0],
      cursori,
      topCursore,
      testoRiga: rigaCursore ? rigaCursore.testo : (righe.find(r => /RAISERROR/i.test(r.testo))?.testo ?? null),
    };
  })()`)
  console.log(`  cursori: ${JSON.stringify(stato.cursori)}  riga del cursore: ${JSON.stringify(stato.testoRiga)}`)
  console.log(`  dopo il clic → tab: ${JSON.stringify(stato.tab)}  riga corrente: ${JSON.stringify(stato.testoRiga)} (attesa ${rigaAttesa})`)
  check("il clic apre l'oggetto in una tab", cliccato === true)
  check('la tab aperta è quella della procedura', /ws_L2_RotazioneCelle_SetPause/.test(stato.tab || ''))
  check('il cursore è finito sulla riga indicata dall\'errore', /RAISERROR/i.test(stato.testoRiga || ''))

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito (errore+risultati e riga): ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-tab-cursor): riaprendo una tab il cursore deve restare dov'era.
 * Si sposta il cursore su una riga, si passa a un'altra tab e si torna indietro: la riga
 * sotto il cursore deve essere la stessa (e non la prima).
 */
async function verifyTabCursor(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await sleep(2000)

  /** Testo della riga su cui sta il cursore di Monaco (posizione ricavata dalla "top"). */
  const rigaCursore = () =>
    page.eval(`(() => {
      const c = document.querySelector('.monaco-editor .cursors-layer .cursor');
      const top = c ? c.style.top : null;
      if (top === null) return null;
      const righe = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')];
      const r = righe.find(l => l.style.top === top) || righe.find(l => l.style.top >= top);
      // Monaco usa spazi insecabili nella resa: si normalizzano per poterli confrontare
      return r ? (r.textContent || '').replace(/\\u00a0/g, ' ').trim() : null;
    })()`)

  const rect = await editorRect(page)
  const altezzaRiga = await page.eval(
    `(() => { const l = document.querySelector('.monaco-editor .view-lines .view-line'); return l ? l.getBoundingClientRect().height : 18 })()`,
  )
  // tab 1 con un testo riconoscibile, poi cursore sulla TERZA riga
  await page.clickPoint(rect.x + 120, rect.y + altezzaRiga * 1.5)
  await sleep(300)
  await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
  await page.typeText(TAB1_SQL)
  await sleep(600)
  await page.clickPoint(rect.x + 60, rect.y + altezzaRiga * 2.5)
  await sleep(400)
  const prima = await rigaCursore()
  console.log(`  cursore sulla riga: ${JSON.stringify(prima)}`)

  // nuova tab (testo diverso) e ritorno alla prima
  await page.clickWhere(`[...document.querySelectorAll('button')].find(b => (b.getAttribute('title') || '').startsWith('Nuova query'))`)
  await sleep(1500)
  const inAltraTab = await rigaCursore()
  const tornato = await page.clickWhere(`(() => {
    const wrap = [...document.querySelectorAll('[title]')].find(e => (e.getAttribute('title') || '').startsWith('Query 1 '));
    return wrap ? (wrap.querySelector('button') || wrap) : null;
  })()`)
  await sleep(1500)
  const dopo = await rigaCursore()
  console.log(`  nell'altra tab: ${JSON.stringify(inAltraTab)}`)
  console.log(`  tornando nella prima: ${JSON.stringify(dopo)}`)

  const esiti = []
  const check = (name, ok) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  }
  check('il cursore era su una riga centrale (non la prima)', /^SELECT [2-4] AS /.test(prima || ''))
  check("la nuova tab parte dall'inizio (testo diverso)", inAltraTab !== prima)
  check('tornando nella tab il cursore è rimasto sulla stessa riga', dopo === prima)
  check('il clic sulla tab è andato a segno', tornato === true)
  const log = page.consoleLogs('[cursore]')
  console.log(`  log della pagina:\n${log.map(l => `    ${l}`).join('\n')}`)
  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-format): lo STESSO statement formattato "da solo" e dentro una store
 * deve venire impaginato allo stesso modo (select-list a colonna, INTO su riga propria).
 * È la segnalazione dell'utente: fuori dalla store la lista si impilava, dentro no.
 */
async function verifyFormat(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await sleep(2000)
  const rect = await editorRect(page)

  /** Righe VISIBILI dell'editor (Monaco usa spazi insecabili: si normalizzano). */
  const righeEditor = () =>
    page.eval(`[...document.querySelectorAll('.monaco-editor .view-lines .view-line')]
      .map(l => (l.textContent || '').replace(/\\u00a0/g, ' ').replace(/\\s+$/, ''))`)

  /** Scrive il testo nell'editor (sostituendo tutto) e preme "Formatta". */
  const scriviEFormatta = async sql => {
    await page.clickPoint(rect.x + 120, rect.y + 18)
    await sleep(400)
    await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
    await page.typeText(sql)
    await sleep(700)
    const righePrima = await righeEditor()
    // un clic dentro l'editor toglie l'eventuale selezione residua: "Formatta" con una
    // selezione formatta SOLO quella parte, e il controllo guarderebbe il testo sbagliato
    await page.clickPoint(rect.x + 120, rect.y + 18)
    await sleep(400)
    const premuto = await page.clickWhere(
      `[...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Formatta')`,
    )
    await sleep(1500)
    return { premuto, righe: await righeEditor(), righePrima }
  }

  const sole = `SELECT MIS_MISSIONE, MIS_UDC, MIS_BEG_L1, MIS_S_BAIA INTO #t FROM dbo.RUN_MISSIONI WHERE MIS_MISSIONE <> @idMissione`
  const dentro = `CREATE PROCEDURE p AS\nBEGIN\n  ${sole}\nEND`

  const a = await scriviEFormatta(sole)
  console.log('  da sola:')
  a.righe.forEach(r => console.log(`    |${r}`))
  const b = await scriviEFormatta(dentro)
  console.log('  dentro una store:')
  b.righe.forEach(r => console.log(`    |${r}`))

  // INSERT: campi e valori uno per riga, allineati sotto il primo
  const insertSql = `INSERT INTO dbo.DAT_ORDINI_RIGHE (RIG_ORDINE, RIG_ARTICOLO, RIG_SUB1) VALUES (@ordine, @pRIG_ARTICOLO, isnull (@pRIG_SUB1, ''))`
  const c = await scriviEFormatta(`CREATE PROCEDURE p AS\nBEGIN\n  ${insertSql}\nEND`)
  console.log('  INSERT dentro una store:')
  c.righe.forEach(r => console.log(`    |${r}`))
  const righeInsert = c.righe.map(r => r.trim()).filter(Boolean)
  const righeGrezze = c.righe.filter(r => r.trim())
  const rigaCampi = righeGrezze.find(r => r.trim().startsWith('INSERT INTO') && r.includes('DAT_ORDINI_RIGHE'))
  const rigaValori = righeGrezze.find(r => r.trim().startsWith('VALUES ('))
  const colCampi = rigaCampi ? rigaCampi.indexOf('RIG_ORDINE') : -1
  const colValori = rigaValori ? rigaValori.indexOf('@ordine') : -1
  const allineati = (riga, testo, colonna) => {
    const rigaTrovata = righeGrezze.find(r => r.trim().startsWith(testo))
    return !!rigaTrovata && rigaTrovata.indexOf(testo) === colonna
  }

  // firma della routine: parametri uno per riga con il TIPO DI DATO incolonnato
  // (testo su una riga: la digitazione con l'auto-chiusura delle parentesi di Monaco
  // lascerebbe una ")" di troppo andando a capo)
  const sigSql = `CREATE PROCEDURE p (@a INT, @pNomeMoltoLungo NVARCHAR(50) = NULL, @b DECIMAL(11, 3) OUTPUT) AS SELECT 1`
  const d = await scriviEFormatta(sigSql)
  console.log('  firma con parametri:')
  d.righe.forEach(r => console.log(`    |${r}`))
  console.log('  (testo digitato, prima di formattare)')
  d.righePrima.forEach(r => console.log(`    >${r}`))
  const righeFirma = d.righe.filter(r => /^\s*,?@\w/.test(r))
  const colonneTipo = righeFirma.map(r => r.search(/\b(NVARCHAR|INT|DECIMAL)\b/i)).filter(c => c >= 0)
  if (righeFirma.length === 0) console.log('  (righe della firma non visibili)')

  const trim = rs => rs.map(r => r.trim()).filter(Boolean)
  const daSola = trim(a.righe)
  const inStore = trim(b.righe)
  // sequenza dello statement dentro la store (dalla SELECT alla WHERE)
  const inizio = inStore.findIndex(r => r === 'SELECT MIS_MISSIONE')
  const fine = inStore.findIndex(r => r.startsWith('WHERE MIS_MISSIONE'))
  const sequenzaStore = inizio >= 0 && fine > inizio ? inStore.slice(inizio, fine + 1) : []

  const esiti = []
  const check = (nome, ok) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}`)
  }
  check('il pulsante "Formatta" è stato premuto (da sola)', a.premuto === true)
  check('il pulsante "Formatta" è stato premuto (dentro la store)', b.premuto === true)
  check('da sola: la lista è a colonna (SELECT + campi con la virgola in testa)', daSola[0] === 'SELECT MIS_MISSIONE' && daSola[1] === ',MIS_UDC, MIS_BEG_L1')
  check('da sola: INTO su riga propria', daSola.includes('INTO #t'))
  check('dentro la store: nessuna riga con la lista intera su una riga', !inStore.some(r => /SELECT MIS_MISSIONE,/.test(r)))
  check(
    'dentro la store: stesso identico impaginato ("SELECT … INTO … WHERE")',
    JSON.stringify(sequenzaStore) === JSON.stringify(daSola.slice(0, sequenzaStore.length)) && sequenzaStore.length >= 5,
  )
  check('INSERT: la lista dei campi va una per riga', righeInsert.some(r => r.endsWith('(RIG_ORDINE')))
  check(
    'INSERT: nessuna riga con più campi insieme',
    !righeGrezze.some(r => /RIG_ORDINE, RIG_ARTICOLO/.test(r)) && righeInsert.includes(',RIG_ARTICOLO') && righeInsert.includes(',RIG_SUB1)'),
  )
  check('INSERT: i campi sono allineati sotto il primo', allineati(righeGrezze, ',RIG_ARTICOLO', colCampi) && allineati(righeGrezze, ',RIG_SUB1)', colCampi))
  check('INSERT: i valori uno per riga, allineati sotto il primo', allineati(righeGrezze, ',@pRIG_ARTICOLO', colValori) && allineati(righeGrezze, ",isnull (@pRIG_SUB1, ''))", colValori))

  // INSERT … SELECT: i VALORI sono la select-list della SELECT → uno per riga come i campi
  // (segnalazione utente: nella parte dei valori restavano tutti su una riga)
  const insertSelectSql =
    "INSERT INTO dbo.DAT_ORDINI_RIGHE (RIG_ORDINE, RIG_ARTICOLO, RIG_SUB1) SELECT @ordine, @pRIG_ARTICOLO, isnull (@pRIG_SUB1, '') FROM dbo.DAT_ORDINI_RIGHE WHERE RIG_ORDINE = @ordine"
  const f = await scriviEFormatta(`CREATE PROCEDURE p AS\nBEGIN\n  ${insertSelectSql}\nEND`)
  console.log('  INSERT … SELECT:')
  f.righe.forEach(r => console.log(`    |${r}`))
  const righeSel = f.righe.map(r => r.trim()).filter(Boolean)
  const iSelect = righeSel.findIndex(r => r.startsWith('SELECT'))
  const iFrom = righeSel.findIndex(r => r.startsWith('FROM'))
  const valoriSelect = iSelect >= 0 && iFrom > iSelect ? righeSel.slice(iSelect + 1, iFrom) : []
  console.log(`  valori su righe proprie: ${JSON.stringify(valoriSelect)}`)
  check(
    'INSERT … SELECT: la riga della SELECT non porta anche i valori',
    iSelect >= 0 && !righeSel[iSelect].includes(','),
  )
  check(
    'INSERT … SELECT: un valore per riga (virgola in testa)',
    valoriSelect.length === 2 && valoriSelect.every(v => v.startsWith(',')),
  )
  check('firma: i tipi dei parametri partono tutti dalla stessa colonna', colonneTipo.length >= 3 && new Set(colonneTipo).size === 1)
  check('firma: nome e tipo mai incollati', !righeFirma.some(r => /@\w+(NVARCHAR|INT|DECIMAL)/i.test(r)))
  check('firma: un parametro per riga con la virgola in testa', righeFirma.filter(r => r.trim().startsWith(',')).length === 2)

  // operatori composti: "+=" e "-=" non devono MAI diventare "+ =" e "- ="
  const op = await scriviEFormatta('select @tot += RIG_QTAR, @n -= 1 from dbo.T')
  const righeOp = op.righe.map(r => r.trim()).filter(Boolean)
  console.log(`  operatori composti: ${JSON.stringify(righeOp.slice(0, 4))}`)
  check(
    '"+=" e "-=" restano attaccati dopo la formattazione',
    righeOp.some(r => r.includes('@tot += RIG_QTAR')) &&
      righeOp.some(r => r.includes('@n -= 1')) &&
      !righeOp.some(r => /[+\-]\s+=/.test(r)),
  )

  // funzione con RETURNS: la clausola fra ")" e "AS" non deve sparire
  // (segnalazione utente: la format di una funzione cancellava "RETURNS INT")
  const fn = await scriviEFormatta(
    'CREATE OR ALTER FUNCTION dbo.fn_Prova_BaiaIngresso() RETURNS INT AS BEGIN DECLARE @baia INT SELECT @baia = 1 RETURN @baia END',
  )
  const righeFn = fn.righe.map(r => r.trim()).filter(Boolean)
  console.log('  funzione con RETURNS:')
  righeFn.forEach(r => console.log(`    |${r}`))
  console.log('  (testo digitato, prima di formattare)')
  fn.righePrima.forEach(r => console.log(`    >${r}`))
  check('funzione: il pulsante "Formatta" è stato premuto', fn.premuto === true)
  check('funzione: la clausola RETURNS resta (non viene cancellata)', righeFn.includes('RETURNS INT'))
  check('funzione: il RETURN del corpo resta', righeFn.some(r => r === 'RETURN @baia'))

  // END/ELSE allo stesso livello: l'ELSE non deve stare 2 spazi avanti al suo END
  const g = await scriviEFormatta(
    'CREATE PROCEDURE p\nAS\nBEGIN\n  IF @a = 0\n  BEGIN\n    IF @b = 0\n    BEGIN\n      PRINT \'x\'\n    END\n  END\n    ELSE\n  IF @a = 1\n  BEGIN\n    PRINT \'y\'\n  END\nEND',
  )
  const righeElse = g.righe.map(r => r.replace(/\s+$/, ''))
  console.log('  END/ELSE:')
  g.righe.forEach(r => console.log(`    |${r}`))
  const rientroRiga = t => (t.match(/^\s*/) ?? [''])[0].length
  const iElseLine = righeElse.findIndex(r => r.trim() === 'ELSE')
  let iPrec = iElseLine - 1
  while (iPrec >= 0 && righeElse[iPrec].trim() === '') iPrec--
  const rigaEndPrima = righeElse[iPrec] ?? ''
  console.log(`  riga prima dell ELSE: |${rigaEndPrima} · ELSE: |${righeElse[iElseLine] ?? ''}`)
  check(
    'ELSE allo stesso livello del suo END',
    iElseLine > 0 && rigaEndPrima.trim() === 'END' && rientroRiga(rigaEndPrima) === rientroRiga(righeElse[iElseLine]),
  )

  // CASE dentro la select-list di un INSERT … SELECT: espanso e indentato, un valore per riga
  const h = await scriviEFormatta(
    "CREATE PROCEDURE p\nAS\nBEGIN\n  INSERT INTO dbo.DAT_ORDINI (ORD_ORDINE, ORD_ORDTYPE, ORD_DES)\n  SELECT rtrim (ORD_ORDER), CASE WHEN @t = 1 THEN 'A' ELSE 'B' END, isnull (rtrim (ORD_DESC), '') FROM dbo.DAT_ORDINI\nEND",
  )
  const righeCase = h.righe.map(r => r.trim()).filter(Boolean)
  console.log('  CASE nella select-list:')
  h.righe.forEach(r => console.log(`    |${r}`))
  const iCasoLine = h.righe.findIndex(r => /^\s*,?\s*(?:\/\*[^*]*\*\/\s*)?CASE\s*$/.test(r))
  const iWhenLine = h.righe.findIndex(r => r.trim() === 'WHEN @t = 1')
  console.log(`  riga CASE: ${iCasoLine} · riga WHEN: ${iWhenLine}`)
  check(
    'il CASE della select-list è espanso su righe proprie e rientrato',
    iCasoLine > -1 &&
      iWhenLine === iCasoLine + 1 &&
      rientroRiga(h.righe[iCasoLine]) > 0 &&
      rientroRiga(h.righe[iWhenLine]) > rientroRiga(h.righe[iCasoLine]),
  )
  check(
    'i valori dell INSERT … SELECT restano uno per riga',
    righeCase.some(r => r.startsWith(',isnull (rtrim (ORD_DESC)')),
  )

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-schema-refresh): il pulsante "Aggiorna schema" e Ctrl+Shift+R devono
 * rileggere i metadati dal database (come il Refresh di SSMS) SENZA ricaricare la pagina.
 * Nel browser Ctrl+Shift+R è "ricarica ignorando la cache": qui deve finire annullata
 * (preventDefault) e la pagina deve restare viva (marcatore su window).
 */
async function verifySchemaRefresh(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Schema:')`, 40000, 'schema caricato')
  await sleep(1500)

  await page.eval(`window.__schemaMarker = 'vivo'`)
  const logSchema = async () => await page.consoleLogs('[schema]')
  const ultimoLog = async () => (await logSchema()).slice(-1)[0] ?? null
  /** I messaggi di console arrivano via CDP con un ritardo: si aspetta il conteggio atteso
   *  invece di leggere subito (altrimenti i controlli sono "a gara"). */
  const attendiLog = async (atteso, timeoutMs = 6000) => {
    const inizio = Date.now()
    while (Date.now() - inizio < timeoutMs) {
      if ((await logSchema()).length >= atteso) return true
      await sleep(300)
    }
    return false
  }
  const esiti = []
  const check = (nome, ok) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}`)
  }

  const bottone = await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim().includes('Aggiorna schema'));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { visibile: r.width > 0 && r.height > 0, titolo: b.getAttribute('title') || '' };
  })()`)
  console.log(`  pulsante: ${JSON.stringify(bottone)}`)
  check('il pulsante "Aggiorna schema" è visibile anche con lo schema caricato', !!bottone?.visibile)
  check('il tooltip del pulsante cita la scorciatoia Ctrl+Shift+R', /Ctrl\+Shift\+R/.test(bottone?.titolo ?? ''))

  // clic sul pulsante: i metadati vengono riletti
  const cliccato = await page.clickWhere(
    `[...document.querySelectorAll('button')].find(b => (b.textContent || '').trim().includes('Aggiorna schema'))`,
  )
  const primoLog = await attendiLog(1)
  console.log(`  log dopo il clic: ${JSON.stringify(await ultimoLog())}`)
  check('il clic sul pulsante ha funzionato', cliccato === true)
  check('il clic rilegge lo schema ("[schema] aggiornato")', primoLog && /\[schema\] aggiornato/.test((await ultimoLog()) ?? ''))
  check('il clic non ricarica la pagina', (await page.eval(`window.__schemaMarker`)) === 'vivo')

  // Ctrl+Shift+R (2 = Ctrl, 8 = Shift)
  await page.eval(`(() => {
    window.__keys = [];
    window.addEventListener('keydown', e => window.__keys.push([e.key, e.ctrlKey, e.shiftKey, e.altKey, (document.activeElement || {}).tagName].join('|')));
    return true;
  })()`)
  const logPrima = (await logSchema()).length
  await page.press('R', { code: 'KeyR', vk: 82, modifiers: 2 | 8 })
  const arrivato = await attendiLog(logPrima + 1)
  console.log(`  eventi di tastiera visti dalla pagina: ${JSON.stringify(await page.eval('window.__keys'))}`)
  console.log(`  log dopo Ctrl+Shift+R: ${JSON.stringify(await ultimoLog())}`)
  check('Ctrl+Shift+R rilegge lo schema', arrivato && /\[schema\] aggiornato/.test((await ultimoLog()) ?? ''))
  check('Ctrl+Shift+R non ricarica la pagina (preventDefault efficace)', (await page.eval(`window.__schemaMarker`)) === 'vivo')

  // Ctrl+R deve restare il mostra/nascondi dei risultati, NON il refresh dello schema
  const primaDiCtrlR = (await logSchema()).length
  await page.press('r', { code: 'KeyR', vk: 82, modifiers: 2 })
  await sleep(1500)
  check('Ctrl+R non aggiorna lo schema (resta il pannello dei risultati)', (await logSchema()).length === primaDiCtrlR)

  // caso reale: il fuoco è NELL'EDITOR (Monaco) mentre si preme Ctrl+Shift+R
  const rectEditor = await editorRect(page)
  await page.clickPoint(rectEditor.x + 120, rectEditor.y + 18)
  await sleep(500)
  const primaInEditor = (await logSchema()).length
  await page.press('R', { code: 'KeyR', vk: 82, modifiers: 2 | 8 })
  const inEditor = await attendiLog(primaInEditor + 1)
  console.log(`  fuoco nell'editor: ${JSON.stringify(await page.eval('(document.activeElement || {}).className'))}`)
  check("Ctrl+Shift+R funziona anche con il fuoco nell'editor", inEditor)
  check('neanche con il fuoco nell editor la pagina si ricarica', (await page.eval(`window.__schemaMarker`)) === 'vivo')

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-pair-highlight): in una MERGE il cursore su un valore deve illuminare il
 * campo corrispondente, come per INSERT e UPDATE.
 *  - cablaggio: la decorazione dell'editor compare quando il cursore è su un valore;
 *  - logica: si chiama il modulo servito all'app (import dinamico dello stesso file) sulla
 *    MERGE reale dell'utente, con offset esatti: niente geometria di Monaco, esito deterministico.
 */
async function verifyPairHighlight(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await sleep(2000)
  const rect = await editorRect(page)

  // --- 1. cablaggio: cursore su un valore → l'editor deve disegnare la decorazione
  const corta = ['MERGE dbo.T AS tgt', "USING (VALUES ('a', 'b', 'c')) AS src (c1, c2, c3)", 'ON tgt.c1 = src.c1;'].join(
    '\n',
  )
  await page.clickPoint(rect.x + 120, rect.y + 18)
  await sleep(400)
  await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
  await page.typeText(corta)
  await sleep(1000)
  const cursoreSu = async testo => {
    const punto = await page.eval(`(() => {
      const needle = ${JSON.stringify(testo)};
      for (const l of document.querySelectorAll('.monaco-editor .view-lines .view-line')) {
        const t = (l.textContent || '').replace(/\\u00a0/g, ' ');
        const at = t.indexOf(needle);
        if (at === -1) continue;
        let acc = 0;
        for (const s of l.querySelectorAll('span')) {
          const st = (s.textContent || '').replace(/\\u00a0/g, ' ');
          if (acc + st.length > at) {
            const r = s.getBoundingClientRect();
            const charW = r.width / Math.max(1, st.length);
            return { x: r.left + charW * Math.min(at - acc + 1, st.length - 1) + 1, y: r.top + r.height / 2 };
          }
          acc += st.length;
        }
      }
      return null;
    })()`)
    if (!punto) return false
    await page.clickPoint(punto.x, punto.y)
    await sleep(800)
    return true
  }
  const cliccato = await cursoreSu("'b'")
  const decorazione = await page.eval(`(() => {
    const e = document.querySelector('.monaco-editor .sql-pair-highlight');
    if (!e) return { esiste: false };
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return {
      esiste: true,
      larghezza: Math.round(r.width),
      sinistra: Math.round(r.left),
      sfondo: cs.backgroundColor,
      visibile: cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0,
    };
  })()`)
  console.log(`  decorazione dopo il clic sul valore: ${JSON.stringify(decorazione)}`)

  // --- 2. logica del modulo servito all'app, sulla MERGE reale dell'utente.
  //      La MERGE è la SECONDA istruzione: così il controllo copre anche il caso segnalato
  //      ("con altre query la seconda MERGE non evidenzia"), che con lo statement in prima
  //      posizione passava per caso (gli offset relativi coincidevano con quelli assoluti).
  const MERGE = `SELECT 1 AS prima_query;

MERGE INTO TIPI_CAUSALI_MISSIONI AS tgt
USING (VALUES
    ('RETRN', 'Return in kitting', ' ', 1, 0)) AS src
     ([CAUM_CAUSMISS], [CAUM_DES], [CAUM_SCA_CAUSMISS], [CAUM_ESE_IF_OK], [CAUM_ESE_IF_FF])
ON tgt.[CAUM_CAUSMISS] = src.[CAUM_CAUSMISS]
WHEN MATCHED THEN UPDATE SET
    tgt.[CAUM_CAUSMISS] = src.[CAUM_CAUSMISS],
    tgt.[CAUM_DES] = src.[CAUM_DES]
WHEN NOT MATCHED THEN INSERT ([CAUM_CAUSMISS], [CAUM_DES])
    VALUES (src.[CAUM_CAUSMISS], src.[CAUM_DES]);

MERGE INTO TIPI_CAUSALI_MISSIONI AS tgt
USING (VALUES
    ('RETRN', 'Return in kitting', ' ', 1, 0)) AS src
     ([CAUM_CAUSMISS], [CAUM_DES], [CAUM_SCA_CAUSMISS], [CAUM_ESE_IF_OK], [CAUM_ESE_IF_FF])
ON tgt.[CAUM_CAUSMISS] = src.[CAUM_CAUSMISS]
WHEN MATCHED THEN UPDATE SET tgt.[CAUM_DES] = src.[CAUM_DES]
WHEN NOT MATCHED THEN INSERT ([CAUM_CAUSMISS], [CAUM_DES])
    VALUES (src.[CAUM_CAUSMISS], src.[CAUM_DES]);`
  const risultati = await page.eval(`(async () => {
    const mod = await import('/src/helpers.ts');
    const SQL = ${JSON.stringify(MERGE)};
    const seconda = SQL.lastIndexOf('MERGE INTO');
    const dopo = (testo, da) => SQL.indexOf(testo, da);
    const casi = [];
    const aggiungi = (nome, offset, atteso) => {
      const t = mod.pairHighlightTarget(SQL, offset);
      casi.push({ nome, atteso, ottenuto: t ? SQL.slice(t.start, t.end) : null });
    };
    // 1ª MERGE (dopo una SELECT: non è in prima posizione) e 2ª MERGE in coda
    for (const [quale, base] of [['1ª', 0], ['2ª', seconda]]) {
      aggiungi(quale + ' valore USING 2 → colonna', SQL.indexOf("'Return in kitting'", base) + 3, '[CAUM_DES]');
      aggiungi(quale + ' colonna src 3 → valore', SQL.indexOf('[CAUM_SCA_CAUSMISS]', base) + 3, "' '");
      aggiungi(quale + ' ON: sinistra → destra', SQL.indexOf('ON tgt.[CAUM_CAUSMISS]', base) + 5, 'src.[CAUM_CAUSMISS]');
    }
    const set = SQL.indexOf('tgt.[CAUM_DES] = src.[CAUM_DES]', seconda);
    aggiungi('2ª SET: colonna → valore', set + 6, 'src.[CAUM_DES]');
    const ins = SQL.indexOf('INSERT ([CAUM_CAUSMISS], [CAUM_DES])', seconda);
    aggiungi('2ª INSERT NOT MATCHED: colonna → valore', SQL.indexOf('[CAUM_DES]', ins) + 3, 'src.[CAUM_DES]');
    const val = SQL.indexOf('VALUES (src.[CAUM_CAUSMISS]', ins);
    aggiungi('2ª INSERT NOT MATCHED: valore → colonna', dopo('src.[CAUM_DES]', val) + 5, '[CAUM_DES]');
    return casi;
  })()`)

  const esiti = []
  const check = (nome, ok) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}`)
  }
  check('il clic sul valore è andato a segno', cliccato === true)
  check('l editor evidenzia il campo (decorazione disegnata)', decorazione.esiste === true && decorazione.larghezza > 3)
  check(
    'l evidenziazione è VISIBILE (sfondo non trasparente)',
    decorazione.visibile === true && decorazione.sfondo !== 'rgba(0, 0, 0, 0)' && decorazione.sfondo !== 'transparent',
  )
  for (const r of risultati) {
    console.log(`  ${r.ottenuto === r.atteso ? 'PASS' : 'FAIL'}  ${r.nome}: ${JSON.stringify(r.ottenuto)}`)
    esiti.push(r.ottenuto === r.atteso)
  }

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-local-tables): le tabelle temporanee definite nel testo devono entrare
 * nell'intellisense con le LORO colonne, anche quando nascono da una CTE
 * ("select top 1 * , cast(…) as X into #t from <cte>"): era il caso segnalato dall'utente
 * ("l'intellisense non mi aiuta con le tabelle temporanee, tipo la #tmpMission").
 */
async function verifyLocalTables(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Schema:')`, 40000, 'schema caricato')
  await sleep(1500)
  const rect = await editorRect(page)

  const SQL = [
    'with tbl as (select top 1 SCO_SCOMPARTO X_SCO, UDC_SSCC X_SSCC from DAT_UDC)',
    "select top 1 * , cast('' as nvarchar(50)) as X_EXTRA into #tmpMission from tbl",
    'select * from #tmpMission where ',
  ].join('\n')

  await page.clickPoint(rect.x + 120, rect.y + 18)
  await sleep(400)
  await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
  await page.typeText(SQL)
  await sleep(1200)
  const righe = await page.eval(`[...document.querySelectorAll('.monaco-editor .view-lines .view-line')]
    .map(l => (l.textContent || '').replace(/\\u00a0/g, ' ').replace(/\\s+$/, ''))`)
  console.log('  testo nell editor:')
  righe.forEach(r => console.log(`    |${r}`))

  // cursore in fondo all'ultima riga: si clicca sullo SPAN del testo (il bordo destro della
  // riga può cadere sulla minimappa e il clic non darebbe il fuoco all'editor)
  const puntoFine = await page.eval(`(() => {
    const linee = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')].filter(l => (l.textContent || '').includes('where'));
    const ultima = linee[linee.length - 1];
    if (!ultima) return null;
    const spans = [...ultima.querySelectorAll('span')];
    const s = spans[spans.length - 1];
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { x: r.right - 1, y: r.top + r.height / 2 };
  })()`)
  if (puntoFine) await page.clickPoint(puntoFine.x, puntoFine.y)
  await sleep(400)
  const statoPopup = async () =>
    await page.eval(`(() => {
      const w = document.querySelector('.suggest-widget');
      const righe = [...document.querySelectorAll('.suggest-widget .monaco-list-row')];
      const c = document.querySelector('.monaco-editor .cursors-layer .cursor');
      const linee = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')];
      const rigaCursore = c ? linee.find(l => l.style.top === c.style.top) : null;
      return {
        widget: !!w,
        visibile: !!w && w.getBoundingClientRect().height > 0,
        righe: righe.length,
        prime: righe.slice(0, 8).map(r => ((r.querySelector('.label-name') || r).textContent || '').trim()),
        cursoreSu: rigaCursore ? (rigaCursore.textContent || '').replace(/\\u00a0/g, ' ').trim() : null,
      };
    })()`)
  // digitare un carattere apre il popup e prova anche che l'editor abbia il fuoco
  await page.typeText('X')
  await sleep(1800)
  console.log(`  popup dopo aver digitato "X": ${JSON.stringify(await statoPopup())}`)
  const voci = await page.eval(`[...document.querySelectorAll('.suggest-widget .monaco-list-row')]
    .map(r => ((r.querySelector('.label-name') || r).textContent || '').trim())`)
  console.log(`  suggerimenti proposti: ${JSON.stringify(voci.slice(0, 25))}`)

  // controllo deterministico sul modulo servito all'app, con la STORE REALE (nessuna digitazione)
  const colonneStore = await page.eval(`(async () => {
    const sql = (await import('/src/__tests__/fixtures/routine_ws_CIDEDO_HUSOBUME_KIPEVUBEGUSEV_St1_GIVOSEB.sql?raw')).default;
    const mod = await import('/src/localTables.ts');
    return mod.extractLocalTables(sql).map(t => ({ nome: t.name, colonne: (t.columns || []).map(c => c.name) }));
  })()`)
  console.log(`  tabelle locali della store reale: ${JSON.stringify(colonneStore)}`)

  const esiti = []
  const check = (nome, ok) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}`)
  }
  const normali = voci.map(v => v.toLowerCase())
  check('la temporanea entra nell intellisense', normali.length > 0)
  check('propone la colonna della CTE (X_SCO)', normali.some(v => v.includes('x_sco')))
  check('propone la colonna della CTE (X_SSCC)', normali.some(v => v.includes('x_sscc')))
  check('propone la colonna esplicita (X_EXTRA)', normali.some(v => v.includes('x_extra')))
  check('NON propone i tipi di dato al posto dei nomi (nvarchar/decimal)', !normali.some(v => /^(nvarchar|decimal|int)$/.test(v)))
  const attese = ['X_SSCC_DEST', 'X_CORRIDOIO', 'X_CELLA', 'X_UDC_DEST', 'X_SCO', 'X_UDC_SOURCE', 'X_SSCC', 'X_SKU', 'X_SKU_DESC', 'X_GIAC', 'UDC_USER_TASK']
  const mission = (colonneStore || []).find(t => t.nome === '#tmpMission')
  check('store reale: #tmpMission riconosciuta', !!mission)
  check('store reale: #tmpMission ha TUTTE le colonne (CTE comprese)', JSON.stringify(mission?.colonne) === JSON.stringify(attese))
  await page.press('Escape', { code: 'Escape', vk: 27 })

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-alias): dando un alias a una tabella, scrivendo "alias." devono comparire
 * i suoi campi — anche per le tabelle TEMPORANEE (#t.) e per le CTE (from c pippo where pippo.).
 * Il popup si legge dal DOM: si digita l'inizio di un campo e si controllano le voci proposte.
 */
async function verifyAlias(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Schema:')`, 40000, 'schema caricato')
  await sleep(1500)
  const rect = await editorRect(page)

  const righeEditor = () =>
    page.eval(`[...document.querySelectorAll('.monaco-editor .view-lines .view-line')]
      .map(l => (l.textContent || '').replace(/\\u00a0/g, ' ').replace(/\\s+$/, ''))`)
  /** Voci del popup di completamento. */
  const vociPopup = async () =>
    await page.eval(`[...document.querySelectorAll('.suggest-widget .monaco-list-row')]
      .map(r => ((r.querySelector('.label-name') || r).textContent || '').trim())`)
  /** Scrive il testo nell'editor (sostituendo tutto). */
  const scrivi = async sql => {
    await page.clickPoint(rect.x + 120, rect.y + 18)
    await sleep(400)
    await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
    await page.typeText(sql)
    await sleep(1000)
  }
  /** Porta il cursore in fondo all'ultima riga e digita un carattere per aprire il popup. */
  const apriPopupInFondo = async (lettera = 'U') => {
    const punto = await page.eval(`(() => {
      const linee = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')];
      const ultima = linee[linee.length - 1];
      if (!ultima) return null;
      const spans = [...ultima.querySelectorAll('span')];
      const s = spans[spans.length - 1];
      if (!s) return null;
      const r = s.getBoundingClientRect();
      return { x: r.right - 1, y: r.top + r.height / 2 };
    })()`)
    if (!punto) return []
    await page.clickPoint(punto.x, punto.y)
    await sleep(400)
    await page.typeText(lettera)
    await sleep(1600)
    return await vociPopup()
  }

  const esiti = []
  const check = (nome, ok) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}`)
  }
  const normali = v => v.map(x => x.toLowerCase())

  // 1) tabella dello schema con alias
  await scrivi('select * from dbo.DAT_UDC pippo where pippo.U')
  const vociTabella = await apriPopupInFondo('D')
  console.log(`  alias di tabella: ${JSON.stringify(vociTabella.slice(0, 6))}`)
  check('alias di tabella: propone i campi della tabella', normali(vociTabella).some(v => v.startsWith('udc_')))

  // 2) temporanea con alias
  await scrivi(
    ['select UDC_UDC, UDC_CORRIDOIO into #tmpAlias from dbo.DAT_UDC', 'select * from #tmpAlias t where t.U'].join('\n'),
  )
  console.log('  testo (temporanea):')
  ;(await righeEditor()).forEach(r => console.log(`    |${r}`))
  const vociTemp = await apriPopupInFondo('D')
  console.log(`  alias di temporanea: ${JSON.stringify(vociTemp.slice(0, 6))}`)
  check('alias di TEMPORANEA: propone i campi della temporanea', normali(vociTemp).some(v => v.startsWith('udc_')))

  // 3) CTE con alias
  await scrivi(
    [
      'with c as (select UDC_UDC, UDC_CORRIDOIO from dbo.DAT_UDC)',
      'select * from c pippo where pippo.U',
    ].join('\n'),
  )
  console.log('  testo (CTE):')
  ;(await righeEditor()).forEach(r => console.log(`    |${r}`))
  const vociCte = await apriPopupInFondo('D')
  console.log(`  alias di CTE: ${JSON.stringify(vociCte.slice(0, 6))}`)
  check('alias di CTE: propone i campi della CTE', normali(vociCte).some(v => v.startsWith('udc_')))

  // 4) parentesi quadre: [pippo].
  await scrivi('select * from dbo.DAT_UDC as pippo where [pippo].U')
  const vociQuadre = await apriPopupInFondo('D')
  console.log(`  alias con parentesi: ${JSON.stringify(vociQuadre.slice(0, 6))}`)
  check('alias con parentesi quadre [pippo].', normali(vociQuadre).some(v => v.startsWith('udc_')))

  // 5) nella SELECT-list (caso segnalato): "dd." deve proporre i campi della temporanea
  await scrivi(
    [
      'select X_SCO, X_UDC_SOURCE into #tmpSel from dbo.DAT_UDC',
      'select top 1',
      '   UDC_UDC',
      '  ,dd.',
      'into #tmpNewDest',
      'from #tmpSel dd',
      '  inner join DAT_UDC on UDC_ARTICOLO = X_SCO',
    ].join('\n'),
  )
  const puntoDD = await page.eval(`(() => {
    const linea = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')].find(l => (l.textContent || '').includes('dd.'));
    if (!linea) return null;
    const spans = [...linea.querySelectorAll('span')];
    const ultimo = spans[spans.length - 1];
    if (!ultimo) return null;
    const r = ultimo.getBoundingClientRect();
    return { x: r.right - 1, y: r.top + r.height / 2 };
  })()`)
  if (puntoDD) await page.clickPoint(puntoDD.x, puntoDD.y)
  await sleep(400)
  await page.typeText('X')
  await sleep(1600)
  const vociSelect = await vociPopup()
  console.log(`  alias nella SELECT-list: ${JSON.stringify(vociSelect.slice(0, 6))}`)
  check(
    'nella SELECT-list "dd." propone i campi della temporanea',
    normali(vociSelect).includes('x_sco') && normali(vociSelect).includes('x_udc_source'),
  )

  // 6) CONFERMA di un suggerimento: non deve uscire "p.p.campo"
  await scrivi('select * from dbo.DAT_UDC p where p.')
  await sleep(1600) // il popup si apre da solo mentre si digita
  const popupPrima = await vociPopup()
  await page.press('Enter', { code: 'Enter', vk: 13 })
  await sleep(900)
  const rigaConfermata = (await righeEditor()).map(r => r.trim()).filter(Boolean).pop() ?? ''
  console.log(`  popup prima di confermare: ${JSON.stringify(popupPrima.slice(0, 3))}`)
  console.log(`  riga dopo la conferma: ${JSON.stringify(rigaConfermata)}`)
  check('confermando il suggerimento non si ottiene "p.p."', !rigaConfermata.includes('p.p.'))
  check('il campo è qualificato una sola volta (p.CAMPO)', /p\.UDC_/i.test(rigaConfermata))

  // 7) ORDER BY: ASC/DESC solo dopo aver messo un campo
  await scrivi('select UDC_UDC from dbo.DAT_UDC order by ')
  await sleep(1600)
  const vociOrderByVuoto = await vociPopup()
  await scrivi('select UDC_UDC from dbo.DAT_UDC order by UDC_UDC ')
  await sleep(1600)
  const vociOrderByPieno = await vociPopup()
  console.log(`  ORDER BY senza campo: ${JSON.stringify(vociOrderByVuoto.slice(0, 6))}`)
  console.log(`  ORDER BY con campo: ${JSON.stringify(vociOrderByPieno.slice(0, 6))}`)
  check(
    'ORDER BY senza campo: niente ASC/DESC',
    !normali(vociOrderByVuoto).includes('asc') && !normali(vociOrderByVuoto).includes('desc'),
  )
  check(
    'ORDER BY con campo: ASC/DESC proposte',
    normali(vociOrderByPieno).includes('asc') && normali(vociOrderByPieno).includes('desc'),
  )

  // 8) tabella DERIVATA con alias (caso segnalato): "inner join (select dbo.fn_X() X_BAIA) t
  // on 1 = 1 … where t." deve proporre la colonna X_BAIA della sottoquery. Prima comparivano
  // solo i suggerimenti generici (l'alias della derivata non era risolto).
  await scrivi(
    [
      'select UDC_UDC',
      'from dbo.DAT_UDC',
      '  inner join (select dbo.fn_Prova_Baia() X_BAIA) t on 1 = 1',
      'where t.',
    ].join('\n'),
  )
  console.log('  testo (derivata):')
  ;(await righeEditor()).forEach(r => console.log(`    |${r}`))
  const vociDerivata = await apriPopupInFondo('X')
  console.log(`  alias di tabella derivata: ${JSON.stringify(vociDerivata.slice(0, 6))}`)
  check(
    'alias di una tabella DERIVATA "(select …) t": propone la colonna della sottoquery',
    normali(vociDerivata).includes('x_baia'),
  )

  // 9) derivata con "*": le colonne arrivano dalla tabella dello schema
  await scrivi(['select UDC_UDC', 'from (select * from dbo.DAT_UDC) t', 'where t.'].join('\n'))
  console.log('  testo (derivata con "*"):')
  ;(await righeEditor()).forEach(r => console.log(`    |${r}`))
  const vociDerivataStar = await apriPopupInFondo('U')
  console.log(`  alias di derivata con "*": ${JSON.stringify(vociDerivataStar.slice(0, 6))}`)
  check(
    'alias di una derivata con "*": propone i campi della tabella sorgente',
    normali(vociDerivataStar).some(v => v.startsWith('udc_')),
  )

  // 10) FUNZIONE TABELLARE con alias (caso segnalato): "select * from dbo.fn_x() a where a.ca"
  // deve proporre i campi che la funzione restituisce. Prima il popup restava vuoto.
  await scrivi(['select *', `from dbo.${FUNZIONE_TABELLARE}() a`, 'where a.'].join('\n'))
  console.log('  testo (funzione tabellare):')
  ;(await righeEditor()).forEach(r => console.log(`    |${r}`))
  const vociFunzione = await apriPopupInFondo(FUNZIONE_TABELLARE_CAMPO.slice(0, 2))
  console.log(`  alias di funzione tabellare: ${JSON.stringify(vociFunzione.slice(0, 6))}`)
  check(
    `alias di una FUNZIONE TABELLARE "dbo.${FUNZIONE_TABELLARE}() a": propone i campi restituiti`,
    vociFunzione.length > 0 && normali(vociFunzione).includes(FUNZIONE_TABELLARE_CAMPO.toLowerCase()),
  )

  await page.press('Escape', { code: 'Escape', vk: 27 })
  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-labels): dopo "GOTO " devono comparire TUTTE le label del documento,
 * anche quelle definite più sotto; quelle nel codice commentato no.
 */
/**
 * VERIFICA (--verify-tabtree): una tab aperta da un LINK (qui: tasto destro su una stored
 * procedure dell'albero) nasce FIGLIA di quella attiva — rientrata e con il marcatore — e la
 * gerarchia si ferma a 5 livelli. Chiudendo la principale compare la richiesta di chiudere
 * anche le figlie.
 */
async function verifyTabTree(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Schema:')`, 40000, 'schema caricato')
  await sleep(1500)

  const esiti = []
  const check = (nome, ok) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}`)
  }

  /**
   * Si usa la RICERCA dell'oggetti: le righe trascinabili sono le stored procedure
   * (title "Trascina nel editor…"), quindi il tasto destro su una di quelle apre il menu con
   * "Modifica" → nuova tab. Così non serve conoscere un nome di procedura a priori.
   */
  const cercato = await page.eval(`(() => {
    const i = [...document.querySelectorAll('input')].find(x => (x.placeholder || '').includes('Cerca'));
    if (!i) return false;
    i.focus();
    return true;
  })()`)
  if (!cercato) throw new Error('campo di ricerca della sidebar non trovato')
  await page.typeText('ws_')
  await sleep(1800)
  console.log(
    `  risultati di ricerca (procedure): ${await page.eval(
      `[...document.querySelectorAll('button')].filter(b => (b.getAttribute('title') || '').includes('Trascina nel editor')).length`,
    )}`,
  )

  /** Stato della barra: titolo, rientro in px (gerarchia) e se è marcata come figlia. */
  const tabs = () =>
    page.eval(`[...document.querySelectorAll('.sql-tab')].map(t => ({
      titolo: ((t.querySelector('button') || t).textContent || '').trim(),
      rientro: Math.round(parseFloat(getComputedStyle(t).marginLeft) || 0),
      figlia: !!t.querySelector('svg.lucide-corner-down-right'),
      top: Math.round(t.getBoundingClientRect().top),
    }))`)

  /** Le tab sono tutte dentro l'altezza visibile della barra? (nessuna riga tagliata) */
  const tabVisibili = () =>
    page.eval(`(() => {
      const primo = document.querySelector('.sql-tab');
      const wrap = primo && primo.parentElement;
      if (!wrap) return { ok: false, tagliate: 0 };
      const r = wrap.getBoundingClientRect();
      const tab = [...wrap.querySelectorAll('.sql-tab')];
      const tagliate = tab.filter(t => t.getBoundingClientRect().bottom > r.bottom + 1).length;
      return {
        ok: tagliate === 0,
        tagliate,
        altezza: Math.round(r.height),
        maxHeight: wrap.style.maxHeight,
        fondo: Math.round(r.bottom),
        fondoUltima: Math.round(tab[tab.length - 1].getBoundingClientRect().bottom),
      };
    })()`)

  /** Apre una stored procedure dal tasto destro sull'albero e conferma la voce indicata. */
  const apriDalTastoDestro = async (voce = 'Modifica') => {
    const punto = await page.eval(`(() => {
      const riga = [...document.querySelectorAll('button')].find(b => (b.getAttribute('title') || '').includes('Trascina nel editor'));
      if (!riga) return null;
      riga.scrollIntoView({ block: 'center' });
      const r = riga.getBoundingClientRect();
      return { x: r.left + 30, y: r.top + r.height / 2 };
    })()`)
    if (!punto) throw new Error('nessuna riga di stored procedure trovata nell albero')
    await page.clickPoint(punto.x, punto.y, 'right')
    await sleep(700)
    const premuto = await page.clickWhere(
      `[...document.querySelectorAll('button')].find(b => ((b.textContent || '').trim().startsWith(${JSON.stringify(voce)})) && b.offsetParent)`,
    )
    await sleep(2000)
    return premuto
  }

  console.log(`  tab di partenza: ${JSON.stringify(await tabs())}`)

  // 1) prima apertura dal tasto destro: la tab nasce FIGLIA di quella attiva
  const primoOk = await apriDalTastoDestro()
  const dopo1 = await tabs()
  console.log(`  dopo il primo "Modifica": ${JSON.stringify(dopo1)}`)
  check('la voce del tasto destro ha aperto una tab', primoOk === true && dopo1.length === 2)
  // REGOLA (richiesta utente): dal PANNELLO A SINISTRA l'oggetto NON è figlio di nessuno
  check(
    'aperta dal pannello a sinistra la tab è PRINCIPALE (nessun rientro, nessun marcatore)',
    dopo1[1]?.rientro === 0 && dopo1[1]?.figlia === false,
    JSON.stringify(dopo1[1]),
  )
  // I gruppi stanno CONSECUTIVI sulla stessa riga: si va a capo solo se non c'è spazio
  check(
    'padri e figli restano consecutivi sulla stessa riga (niente righe forzate)',
    dopo1[0]?.top === dopo1[1]?.top,
    `${dopo1[0]?.top} vs ${dopo1[1]?.top}`,
  )

  // 2) altre aperture dal pannello a sinistra: restano tutte PRINCIPALI
  for (let i = 0; i < 4; i++) await apriDalTastoDestro()
  const dopo5 = await tabs()
  console.log(`  dopo 5 aperture: ${JSON.stringify(dopo5.map(t => t.rientro))}`)
  check('anche le altre tab aperte dal pannello sono principali', dopo5[5]?.rientro === 0, JSON.stringify(dopo5[5]))
  check(
    'stanno sulla stessa riga finché c è spazio, altrimenti vanno a capo (max 2 righe)',
    new Set(dopo5.map(t => t.top)).size <= 2 &&
      dopo5.every((t, i) => i === 0 || t.top >= dopo5[i - 1].top),
    JSON.stringify(dopo5.map(t => t.top)),
  )
  // Con la gerarchia servono più righe: la barra deve allungarsi, non tagliare le figlie.
  const vis = await tabVisibili()
  console.log(`  barra: ${JSON.stringify(vis)}`)
  await page.screenshot('tab-gerarchia')
  check('la barra si allunga e mostra tutte le righe', vis.ok === true)
  // Le tab aperte dal pannello a sinistra sono tutte PRINCIPALI (nessuna gerarchia creata lì):
  // la gerarchia nasce solo aprendo da una tab dell'editor o dal pannello di ricerca.
  await apriDalTastoDestro()
  const dopo6 = await tabs()
  console.log(`  dopo la sesta apertura: ${JSON.stringify(dopo6.map(t => t.rientro))}`)
  check('nessuna figlia creata dal pannello a sinistra (tutte a rientro 0)', dopo6.every(t => t.rientro === 0))

  // 3) la richiesta "chiudo anche le figlie?" si prova creando una FIGLIA dal pannello di RICERCA:
  //    la ricerca è una tab, quindi l'oggetto aperto da lì diventa suo figlio.
  await page.clickWhere(`document.querySelector('[data-ricerca="apri"]') || [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Cerca')`)
  await sleep(2500)
  const tabRicercaPrima = await tabs()
  const indiceRicerca = tabRicercaPrima.findIndex(t => (t.titolo || '').includes('Ricerca'))
  if (indiceRicerca >= 0) {
    console.log('  (la gerarchia creata DAL PANNELLO DI RICERCA è verificata da --verify-search)')
  } else {
    console.log('  (pannello di ricerca non aperto: salto i controlli sulla gerarchia dalla ricerca)')
  }

  // 6) DIAGRAMMA CHIAMATE: si apre in una TAB (come la ricerca), non in una finestra — e
  //    riaprendo lo stesso diagramma NON si duplica (una tab per routine)
  const tabsPrimaGrafo = await page.eval(`document.querySelectorAll('.sql-tab').length`)
  await apriDalTastoDestro('Diagramma chiamate')
  await sleep(1800)
  const statoGrafo = await page.eval(`(() => {
    const p = document.querySelector('[data-diagramma="pannello"]');
    const tab = [...document.querySelectorAll('.sql-tab')].find(t => (t.textContent || '').includes('Diagramma'));
    const r = p ? p.getBoundingClientRect() : null;
    // l'editor Monaco deve essere NASCOSTO mentre si guarda il diagramma, altrimenti il
    // pannello finisce sotto di lui (fuori dall'area visibile) e sembra non essersi aperto
    const editorNascosto = (() => {
      const ed = document.querySelector('.monaco-editor');
      if (!ed) return true;
      for (let n = ed; n && n !== document.body; n = n.parentElement) {
        if (n.classList.contains('hidden')) return true;
      }
      return false;
    })();
    return {
      tab: tab ? (tab.textContent || '').trim() : null,
      inModale: !!(p && p.closest('.fixed')),
      nodi: p ? p.querySelectorAll('svg *').length : 0,
      titolo: p ? ((p.querySelector('h2') || {}).textContent || '').trim() : '',
      rettangolo: r ? { top: Math.round(r.top), altezza: Math.round(r.height), larghezza: Math.round(r.width) } : null,
      visibile: !!r && r.height > 120 && r.width > 200 && r.top < window.innerHeight && r.bottom > 0,
      editorNascosto,
    };
  })()`)
  const tabsDopoGrafo = await page.eval(`document.querySelectorAll('.sql-tab').length`)
  console.log(`  diagramma: ${JSON.stringify(statoGrafo)} (tab: ${tabsPrimaGrafo} → ${tabsDopoGrafo})`)
  check(
    'il diagramma si apre in una TAB e non in una finestra',
    tabsDopoGrafo === tabsPrimaGrafo + 1 && !!statoGrafo.tab && statoGrafo.inModale === false,
  )
  check('il diagramma mostra i legami della routine', statoGrafo.nodi > 0 && /Diagramma chiamate/.test(statoGrafo.titolo))
  check(
    'il diagramma è VISIBILE nel pannello (editor nascosto, non coperto)',
    statoGrafo.visibile === true && statoGrafo.editorNascosto === true,
  )
  await page.screenshot('diagramma-aperto')
  await apriDalTastoDestro('Diagramma chiamate')
  await sleep(1500)
  const tabsDopoGrafo2 = await page.eval(`document.querySelectorAll('.sql-tab').length`)
  console.log(`  tab dopo la riapertura dello stesso diagramma: ${tabsDopoGrafo2}`)
  check('lo stesso diagramma non viene duplicato', tabsDopoGrafo2 === tabsDopoGrafo)

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-tema): cambiando tema chiaro/scuro anche le RIGHE DELLA GRIGLIA dei risultati
 * devono cambiare colore (segnalazione utente: "il cambio modalità chiaro e scuro fa rimanere in
 * scuro le righe della griglia"). Si esegue una query, si legge il colore di sfondo delle prime
 * righe, si cambia tema e si rilegge.
 */
async function verifyTema(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Schema:')`, 40000, 'schema caricato')
  await sleep(1500)

  const esiti = []
  const check = (nome, ok, dettaglio) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? ` — ${dettaglio}` : ''}`)
  }

  // 1) una query per avere righe nella griglia
  const rect = await editorRect(page)
  await page.clickPoint(rect.x + 120, rect.y + 18)
  await sleep(400)
  await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
  await page.typeText('SELECT TOP 6 UDC_UDC, UDC_TIPOUDC, UDC_ARTICOLO FROM dbo.DAT_UDC')
  await sleep(400)
  await page.press('F5', { code: 'F5', vk: 116 })
  await page.waitFor(`document.querySelectorAll('[data-risultati="pannello"] tbody tr').length >= 3`, 40000, 'righe della griglia')
  await sleep(1200)

  /** Colore di sfondo (rgb) delle prime righe della griglia. */
  const coloriRighe = () =>
    page.eval(`[...document.querySelectorAll('[data-risultati="pannello"] tbody tr')].slice(0, 3)
      .map(tr => getComputedStyle(tr).backgroundColor)`)
  /** Luminosità media di un colore rgb(...) → serve a dire se è chiaro o scuro. */
  const luminosita = (rgb) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb ?? '')
    if (!m) return null
    return (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3
  }
  const cambiaTema = async () => {
    const premuto = await page.clickWhere(
      `[...document.querySelectorAll('button')].find(b => /Passa al tema (chiaro|scuro)/.test(b.getAttribute('title') || ''))`,
    )
    await sleep(900)
    return premuto
  }

  const scuro = await coloriRighe()
  console.log(`  righe in tema scuro: ${JSON.stringify(scuro)}`)
  const premuto = await cambiaTema()
  const chiaro = await coloriRighe()
  console.log(`  righe in tema chiaro: ${JSON.stringify(chiaro)}`)
  await page.screenshot('tema-chiaro-griglia')

  check('il pulsante del tema c\'è e cambia la modalità', premuto === true)
  check(
    'in tema scuro le righe sono scure',
    scuro.length >= 3 && scuro.every(c => (luminosita(c) ?? 255) < 90),
    JSON.stringify(scuro),
  )
  check(
    'CAMBIA IL TEMA: in chiaro le righe diventano chiare',
    chiaro.length >= 3 && chiaro.every(c => (luminosita(c) ?? 0) > 180),
    JSON.stringify(chiaro),
  )
  check(
    'le TRE fasce alternate restano distinguibili anche in chiaro',
    new Set(chiaro).size >= 2,
    JSON.stringify(chiaro),
  )

  // si torna al tema scuro (le altre verifiche si aspettano il tema di partenza)
  await cambiaTema()
  const tornato = await coloriRighe()
  check('tornando al tema scuro le righe tornano scure', tornato.every(c => (luminosita(c) ?? 255) < 90), JSON.stringify(tornato))

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-multiriga): SCRITTURA SU PIÙ RIGHE. Nello stesso punto di più righe si scrive
 * insieme: con più cursori (Ctrl+Alt+Giù / Alt+clic) e in selezione a BLOCCHI (Alt+C, come SSMS:
 * si trascina un rettangolo e si scrive su tutte le righe).
 */
async function verifyMultiriga(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Schema:')`, 40000, 'schema caricato')
  await sleep(1500)
  const rect = await editorRect(page)

  const esiti = []
  const check = (nome, ok, dettaglio) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? ` — ${dettaglio}` : ''}`)
  }

  // Le .view-line di Monaco non sono garantite in ordine nel DOM: si ordina per posizione
  // verticale, così l'elenco segue davvero le righe dall'alto in basso.
  const righeEditor = () =>
    page.eval(`[...document.querySelectorAll('.monaco-editor .view-lines .view-line')]
      .map(l => ({ top: l.getBoundingClientRect().top, testo: (l.textContent || '').replace(/\\u00a0/g, ' ').replace(/\\s+$/, '') }))
      .sort((a, b) => a.top - b.top)
      .map(l => l.testo)`)
  const cursori = () =>
    page.eval(`document.querySelectorAll('.monaco-editor .cursors-layer .cursor').length`)
  /** Clic in una riga precisa (indice 0 = prima riga visibile). */
  const clicRiga = async (indice, xOffset = 4) => {
    const p = await page.eval(`(() => {
      const linee = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')];
      const l = linee[${indice}];
      if (!l) return null;
      const r = l.getBoundingClientRect();
      return { x: r.left + ${xOffset}, y: r.top + r.height / 2 };
    })()`)
    if (p) await page.clickPoint(p.x, p.y)
    await sleep(300)
  }

  /** Scrive un testo nell'editor (selezione tutto + scrittura). */
  const scrivi = async (testo) => {
    await page.clickPoint(rect.x + 120, rect.y + 18)
    await sleep(300)
    await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
    await page.typeText(testo)
    await sleep(600)
  }

  // ------------------------------------- 1. più cursori (MAIUSC+ALT+Giù, richiesta utente)
  await scrivi(['SELECT 1', 'SELECT 2', 'SELECT 3'].join('\n'))
  await page.clickPoint(rect.x + 200, rect.y + 18) // riga 1
  await page.press('Home', { code: 'Home', vk: 36 })
  await sleep(300)
  const prima = await cursori()
  // Shift(8) + Alt(1) = modifiers 9 → "aggiungi cursore sotto"
  await page.press('ArrowDown', { code: 'ArrowDown', vk: 40, modifiers: 9 })
  await sleep(400)
  await page.press('ArrowDown', { code: 'ArrowDown', vk: 40, modifiers: 9 })
  await sleep(400)
  const dopo = await cursori()
  console.log(`  cursori: prima ${prima}, dopo Maiusc+Alt+Giù ${dopo}`)
  check('Maiusc+Alt+Giù aggiunge un cursore per riga', dopo >= 3, `${dopo} cursori`)
  await page.typeText('X')
  await sleep(600)
  const scritte = await righeEditor()
  console.log(`  righe dopo aver scritto "X": ${JSON.stringify(scritte)}`)
  check(
    'scrivendo si scrive su TUTTE le righe con il cursore',
    scritte.filter(r => r.startsWith('X')).length >= 3,
    JSON.stringify(scritte.slice(0, 3)),
  )

  // 1a) anche la freccia SU: cursore aggiunto sopra, si scrive su entrambe le righe
  await scrivi(['SELECT 1', 'SELECT 2', 'SELECT 3'].join('\n'))
  await page.press('Escape', { code: 'Escape', vk: 27 })
  await clicRiga(1) // seconda riga
  await page.press('Home', { code: 'Home', vk: 36 })
  await sleep(300)
  await page.press('ArrowUp', { code: 'ArrowUp', vk: 38, modifiers: 9 })
  await sleep(400)
  const cursoriSu = await cursori()
  await page.typeText('Y')
  await sleep(600)
  const righeSu = await righeEditor()
  console.log(`  Maiusc+Alt+Su: cursori=${cursoriSu}, righe=${JSON.stringify(righeSu)}`)
  check('Maiusc+Alt+Su aggiunge un cursore sopra', cursoriSu >= 2, `${cursoriSu} cursori`)
  check(
    'scrivendo si scrive sulla riga sopra e su quella di partenza',
    righeSu[0]?.startsWith('Y') && righeSu[1]?.startsWith('Y') && !righeSu[2]?.startsWith('Y'),
    JSON.stringify(righeSu),
  )

  // ------------- 1b. CTRL+ALT (e AltGr, che su Windows è Ctrl+Alt) NON deve più aggiungere cursori
  // (richiesta utente: "deve funzionare con il maius + alt e non CTRL + Alt").
  await scrivi(['uno', 'due', 'tre'].join('\n'))
  await page.press('Escape', { code: 'Escape', vk: 27 })
  await clicRiga(0)
  const primaDelCaso = await cursori()
  await page.press('ArrowDown', { code: 'ArrowDown', vk: 40, modifiers: 3 }) // Ctrl(2) + Alt(1)
  await sleep(500)
  const cursoriCtrlAlt = await cursori()
  const righeCtrlAlt = await righeEditor()
  console.log(`  Ctrl+Alt+Giù: cursori ${primaDelCaso} → ${cursoriCtrlAlt}, righe=${JSON.stringify(righeCtrlAlt)}`)
  check(
    'Ctrl+Alt+Giù NON aggiunge più cursori',
    cursoriCtrlAlt === primaDelCaso,
    `${primaDelCaso} → ${cursoriCtrlAlt} cursori`,
  )
  check('Ctrl+Alt+Giù non copia nemmeno la riga', righeCtrlAlt.length === 3, `${righeCtrlAlt.length} righe`)

  // 1c) varianti con cui la tastiera può consegnare la combinazione (senza key/code, o con
  //     AltGr riportato solo da getModifierState)
  for (const variante of [
    { nome: 'solo altKey+shiftKey senza code', evento: `{ key: 'ArrowDown', code: '', shiftKey: true, altKey: true }` },
    { nome: 'solo keyCode 40', evento: `{ keyCode: 40, which: 40, shiftKey: true, altKey: true }` },
  ]) {
    await scrivi(['uno', 'due', 'tre'].join('\n'))
    await page.press('Escape', { code: 'Escape', vk: 27 })
    await clicRiga(0)
    await page.eval(`(() => {
      const dom = document.querySelector('.monaco-editor textarea') || document.querySelector('.monaco-editor');
      const dati = ${variante.evento};
      const ev = new KeyboardEvent('keydown', Object.assign({
        key: 'ArrowDown', code: '', bubbles: true, cancelable: true, view: window,
      }, dati));
      Object.defineProperty(ev, 'getModifierState', { value: (k) => k === 'AltGraph' ? !!dati.altGraph : false });
      Object.defineProperty(ev, 'keyCode', { value: dati.keyCode ?? 0 });
      Object.defineProperty(ev, 'which', { value: dati.which ?? 0 });
      return dom.dispatchEvent(ev);
    })()`)
    await sleep(500)
    const c = await cursori()
    console.log(`  Maiusc+Alt+Giù (${variante.nome}): cursori=${c}`)
    check(`Maiusc+Alt+Giù riconosciuto anche con "${variante.nome}"`, c >= 2, `${c} cursori`)
  }

  // 1d) Maiusc+Alt+Giù non deve COPIARE la riga (in Monaco era "copia riga sotto"): il cursore
  //     viene aggiunto e il numero di righe resta lo stesso.
  await scrivi(['uno', 'due', 'tre'].join('\n'))
  await page.press('Escape', { code: 'Escape', vk: 27 })
  await clicRiga(0)
  await page.press('ArrowDown', { code: 'ArrowDown', vk: 40, modifiers: 9 })
  await sleep(400)
  const righeMulti = await righeEditor()
  const cursoriMulti = await cursori()
  console.log(`  Maiusc+Alt+Giù (cursori ${cursoriMulti}): ${JSON.stringify(righeMulti)}`)
  check(
    'Maiusc+Alt+Giù aggiunge il cursore e NON copia la riga',
    cursoriMulti >= 2 && righeMulti.length === 3,
    `${cursoriMulti} cursori, ${righeMulti.length} righe`,
  )

  // ------------------------------------------------------- 2. selezione a BLOCCHI (Alt+C, stile SSMS)
  /** Stato dell'interruttore "Scrittura su più righe". */
  const statoBlocchi = () =>
    page.eval(`(() => {
      const b = document.querySelector('[data-multiriga="blocchi"]');
      if (!b) return null;
      return {
        acceso: /bg-sky-600/.test(b.innerHTML),
        testo: (b.textContent || '').trim(),
        titolo: b.getAttribute('title') || '',
      };
    })()`)

  /** Trascina dalla prima all'ultima riga selezionando la PRIMA colonna. */
  const trascinaBlocco = async (righe = 3, modifiers = 0) => {
    const p = await page.eval(`(() => {
      const linee = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')];
      const a = linee[0], c = linee[${righe - 1}];
      if (!a || !c) return null;
      const ra = a.getBoundingClientRect(), rc = c.getBoundingClientRect();
      return { x1: ra.left + 3, y1: ra.top + ra.height / 2, x2: rc.left + 3, y2: rc.top + rc.height / 2 };
    })()`)
    if (!p) return false
    await page.dragPoint(p.x1, p.y1, p.x2, p.y2, modifiers)
    await sleep(500)
    return true
  }

  await scrivi(['aaa', 'bbb', 'ccc'].join('\n'))
  const accesoPrima = await statoBlocchi()
  console.log(`  interruttore: ${JSON.stringify(accesoPrima)}`)
  check('in toolbar c\'è l\'interruttore "Scrittura su più righe"', accesoPrima !== null, JSON.stringify(accesoPrima?.testo))
  if (accesoPrima && !accesoPrima.acceso) {
    await page.clickWhere(`document.querySelector('[data-multiriga="blocchi"]')`)
    await sleep(500)
  }
  const accesoDopo = await statoBlocchi()
  check('l\'interruttore accende la modalità a blocchi', accesoDopo?.acceso === true, JSON.stringify(accesoDopo?.acceso))

  // con la modalità accesa il trascinamento seleziona un rettangolo: si scrive su tutte le righe
  if (await trascinaBlocco(3)) {
    await page.typeText('Z')
    await sleep(700)
  }
  const conBlocchi = await righeEditor()
  console.log(`  righe dopo la scrittura a blocchi: ${JSON.stringify(conBlocchi.slice(0, 4))}`)
  check(
    'in selezione a blocchi si scrive su tutte le righe selezionate',
    conBlocchi.filter(r => /^Z/.test(r)).length >= 3,
    JSON.stringify(conBlocchi.slice(0, 3)),
  )

  await page.screenshot('scrittura-multiriga')

  // Alt+C spegne la modalità (scorciatoia come in SSMS)
  await page.press('c', { code: 'KeyC', vk: 67, modifiers: 1 })
  await sleep(500)
  const spento = await statoBlocchi()
  check('Alt+C accende/spegne la modalità a blocchi', spento?.acceso === false, JSON.stringify(spento?.acceso))

  // si rimette l'interruttore com'era all'inizio (le altre verifiche non devono trovarlo acceso)
  if (spento?.acceso !== accesoPrima?.acceso) {
    await page.clickWhere(`document.querySelector('[data-multiriga="blocchi"]')`)
    await sleep(300)
  }

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-params): mentre si MODIFICA una stored procedure, scrivendo "@" l'intellisense
 * deve proporre i PARAMETRI della firma (segnalazione utente: "l'intellisense non legge anche i
 * parametri della store procedure che sto modificando"). Si apre la store vera dal tasto destro,
 * si scrive "SELECT @" dentro e si leggono le voci del popup.
 */
async function verifyParams(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Schema:')`, 40000, 'schema caricato')
  await sleep(1500)

  const esiti = []
  const check = (nome, ok, dettaglio) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? ` — ${dettaglio}` : ''}`)
  }

  // 1) la store si apre dall'albero ("Modifica" → CREATE OR ALTER in una tab)
  const cercato = await page.eval(`(() => {
    const i = [...document.querySelectorAll('input')].find(x => (x.placeholder || '').includes('Cerca'));
    if (!i) return false;
    i.focus();
    return true;
  })()`)
  if (!cercato) throw new Error('campo di ricerca della sidebar non trovato')
  await page.typeText(ROUTINE_PARAMS_NAME)
  await sleep(2000)
  const punto = await page.eval(`(() => {
    const riga = [...document.querySelectorAll('button')].find(b => (b.getAttribute('title') || '').includes('Trascina nel editor'));
    if (!riga) return null;
    riga.scrollIntoView({ block: 'center' });
    const r = riga.getBoundingClientRect();
    return { x: r.left + 30, y: r.top + r.height / 2 };
  })()`)
  if (!punto) throw new Error('nessuna riga di stored procedure trovata nell albero')
  await page.clickPoint(punto.x, punto.y, 'right')
  await sleep(700)
  const premuto = await page.clickWhere(
    `[...document.querySelectorAll('button')].find(b => ((b.textContent || '').trim().startsWith('Modifica')) && b.offsetParent)`,
  )
  await sleep(2500)
  const titoloTab = await page.eval(`(() => {
    const t = [...document.querySelectorAll('.sql-tab')].find(x => (x.textContent || '').includes(${JSON.stringify(ROUTINE_PARAMS_NAME)}));
    return t ? (t.textContent || '').trim() : null;
  })()`)
  check(
    'la store si apre in modifica (tab col nome dell oggetto)',
    premuto === true && !!titoloTab,
    JSON.stringify(titoloTab),
  )

  // 2) dentro la store si scrive "SELECT @" e si guarda il popup
  const rect = await editorRect(page)
  await page.clickPoint(rect.x + 200, rect.y + 40)
  await sleep(300)
  await page.press('End', { code: 'End', vk: 35, modifiers: 2 }) // Ctrl+Fine: fondo del documento
  await sleep(300)
  await page.press('Enter', { code: 'Enter', vk: 13, text: '\r' })
  await page.typeText('SELECT @')
  await sleep(2200)
  const voci = await page.eval(`[...document.querySelectorAll('.suggest-widget .monaco-list-row')]
    .map(r => ((r.querySelector('.label-name') || r).textContent || '').trim())`)
  console.log(`  popup dopo "SELECT @": ${JSON.stringify(voci.slice(0, 12))}`)

  const variabili = voci.filter(v => v.startsWith('@'))
  const mancanti = ROUTINE_PARAMS.filter(p => !variabili.some(v => v.toLowerCase() === p.toLowerCase()))
  console.log(`  parametri attesi: ${JSON.stringify(ROUTINE_PARAMS)}`)
  check('il popup propone le variabili/parametri', variabili.length > 0, `${variabili.length} voci con @`)
  check('propone TUTTI i parametri della firma', mancanti.length === 0, `mancanti: ${JSON.stringify(mancanti)}`)

  // 3) con più contesti di scrittura i parametri devono esserci sempre
  //    (SELECT @, WHERE ... = @, SET @, IF @): si annulla ogni prova con Ctrl+Z
  const contesti = [
    { etichetta: 'SELECT @', testo: 'SELECT @' },
    { etichetta: 'WHERE c = @', testo: 'SELECT 1 FROM dbo.T WHERE c = @' },
    { etichetta: 'SET @', testo: 'SET @' },
    { etichetta: 'IF @', testo: 'IF @' },
  ]
  for (const c of contesti) {
    await page.press('End', { code: 'End', vk: 35, modifiers: 2 })
    await page.press('Enter', { code: 'Enter', vk: 13, text: '\r' })
    await page.typeText(c.testo)
    await sleep(1800)
    const righe = await page.eval(`[...document.querySelectorAll('.suggest-widget .monaco-list-row')]
      .map(r => ((r.querySelector('.label-name') || r).textContent || '').trim())`)
    const mancano = ROUTINE_PARAMS.filter(p => !righe.some(v => v.toLowerCase() === p.toLowerCase()))
    console.log(`  ${c.etichetta}: ${righe.length} voci, mancanti ${JSON.stringify(mancano)}`)
    check(`i parametri compaiono con "${c.etichetta}"`, righe.length > 0 && mancano.length === 0, JSON.stringify(mancano))
    await page.press('Escape', { code: 'Escape', vk: 27 })
    // Ctrl+Z: si toglie la riga di prova e si torna al documento
    await page.press('z', { code: 'KeyZ', vk: 90, modifiers: 2 })
    await sleep(500)
  }

  // 4) filtrando per nome ("@mI") resta il parametro giusto
  await page.press('End', { code: 'End', vk: 35, modifiers: 2 })
  await page.press('Enter', { code: 'Enter', vk: 13, text: '\r' })
  await page.typeText('SELECT @mI')
  await sleep(1800)
  const voci2 = await page.eval(`[...document.querySelectorAll('.suggest-widget .monaco-list-row')]
    .map(r => ((r.querySelector('.label-name') || r).textContent || '').trim())`)
  console.log(`  popup dopo "@mI": ${JSON.stringify(voci2.slice(0, 6))}`)
  check(
    'filtrando per nome resta il parametro giusto',
    voci2.some(v => v.toLowerCase() === '@mid'),
    JSON.stringify(voci2.slice(0, 3)),
  )
  await page.press('Escape', { code: 'Escape', vk: 27 })
  await page.screenshot('parametri-store-intellisense')

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-merge): la MERGE generata dall'anteprima dati non deve MAI aggiornare i
 * campi chiave della tabella (richiesta utente: "quando fai la merge, non mettere mai nell'update
 * anche i campi chiave della tabella"). La chiave sono le colonne della PRIMARY KEY — anche
 * composita — e restano solo nella condizione ON.
 */
async function verifyMerge(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Schema:')`, 40000, 'schema caricato')
  await sleep(1500)

  const esiti = []
  const check = (nome, ok, dettaglio) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? ` — ${dettaglio}` : ''}`)
  }

  // 1) nel editor si scrive una SELECT sulla tabella con chiave composita e si apre l'anteprima (F4)
  const rect = await editorRect(page)
  await page.clickPoint(rect.x + 160, rect.y + 18)
  await sleep(400)
  await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
  await page.typeText(`SELECT * FROM dbo.${TABELLA_CHIAVE}`)
  await sleep(400)
  // il cursore deve stare DENTRO il nome della tabella (F4 risolve il token sotto il cursore)
  for (let i = 0; i < 5; i++) await page.press('ArrowLeft', { code: 'ArrowLeft', vk: 37 })
  await sleep(300)
  await page.press('F4', { code: 'F4', vk: 115 })
  await page.waitFor(`document.body.textContent.includes('Anteprima dati —')`, 30000, 'anteprima dati')
  await sleep(2000)

  // 2) tutte le righe selezionate (casella di intestazione) e generazione della MERGE
  const box = await page.eval(`(() => {
    const h = [...document.querySelectorAll('h2')].find(x => (x.textContent || '').includes('Anteprima dati'));
    const mod = h && h.closest('div.fixed');
    const c = mod && mod.querySelector('input[title="Seleziona tutte le righe"]');
    if (!c) return null;
    c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`)
  if (!box) throw new Error('casella "Seleziona tutte le righe" non trovata nell anteprima')
  await page.clickPoint(box.x, box.y)
  await sleep(600)
  const premuto = await page.clickWhere(
    `[...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'MERGE')`,
  )
  await sleep(900)
  check('la MERGE si genera dall\'anteprima dati', premuto === true)

  /** Analisi della MERGE generata: chiavi dell'ON e colonne aggiornate nel SET. */
  const analisi = await page.eval(`(() => {
    const h = [...document.querySelectorAll('h2')].find(x => (x.textContent || '').includes('Anteprima dati'));
    const mod = h && h.closest('div.fixed');
    const pre = mod ? [...mod.querySelectorAll('pre')].map(p => p.textContent).find(t => (t || '').includes('MERGE INTO')) : null;
    if (!pre) return null;
    const on = (pre.match(/ON ([\\s\\S]*?)\\nWHEN/) || [])[1] || '';
    const chiavi = [...on.matchAll(/tgt\\.\\[([^\\]]+)\\]/g)].map(m => m[1]);
    const dopoUpdate = pre.includes('UPDATE SET') ? pre.split('UPDATE SET')[1] : '';
    const set = dopoUpdate ? dopoUpdate.split('WHEN NOT MATCHED')[0] : '';
    const aggiornate = [...set.matchAll(/tgt\\.\\[([^\\]]+)\\]/g)].map(m => m[1]);
    return { chiavi, aggiornate, testa: pre.split('\\n').slice(0, 3).join(' / ') };
  })()`)
  console.log(`  chiave ON: ${JSON.stringify(analisi?.chiavi)}`)
  console.log(`  campi nell'UPDATE SET: ${JSON.stringify(analisi?.aggiornate)}`)
  check('la MERGE ha una chiave nella condizione ON', (analisi?.chiavi.length ?? 0) > 0)
  check(
    'la chiave è tutta la primary key (qui composita), non solo la prima colonna',
    (analisi?.chiavi.length ?? 0) >= 2,
    `${analisi?.chiavi.length} colonne di chiave`,
  )
  const intrusi = (analisi?.chiavi ?? []).filter(c => (analisi?.aggiornate ?? []).includes(c))
  check('NESSUN campo chiave compare nell\'UPDATE SET', intrusi.length === 0, `intrusi: ${JSON.stringify(intrusi)}`)
  check(
    'gli altri campi si aggiornano comunque',
    (analisi?.aggiornate.length ?? 0) > 0,
    `${analisi?.aggiornate.length} campi`,
  )
  await page.screenshot('merge-senza-chiavi')

  // ---------------------------------------------------------------- 3) MERGE dai RISULTATI
  // Richiesta utente: "quando fai la merge, la chiave potrebbe essere multipla" — vale anche per
  // il generatore dei RISULTATI (pannello in basso): la chiave dell'ON deve essere tutta la
  // primary key della tabella target, non solo la prima colonna.
  console.log('  3) MERGE dal generatore dei RISULTATI')
  // prima si chiude la finestra dell'anteprima dati (ha il focus)
  await page.clickWhere(`(() => {
    const h = [...document.querySelectorAll('h2')].find(x => (x.textContent || '').includes('Anteprima dati'));
    const mod = h && h.closest('div.fixed');
    return mod ? mod.querySelector('button.ml-auto') : null;
  })()`)
  await page.waitFor(`!document.body.textContent.includes('Anteprima dati —')`, 8000, 'anteprima chiusa')
  await sleep(600)
  const rect2 = await editorRect(page)
  await page.clickPoint(rect2.x + 160, rect2.y + 18)
  await sleep(400)
  await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
  await page.typeText(`SELECT * FROM dbo.${TABELLA_CHIAVE}`)
  await sleep(400)
  await page.press('F5', { code: 'F5', vk: 116 })
  await page.waitFor(`document.body.textContent.includes('per pagina')`, 40000, 'griglia dei risultati')
  await sleep(1500)
  const inGeneratore = await page.clickWhere(
    `[...document.querySelectorAll('button')].find(b => /Genera SQL|Generatore attivo/.test((b.textContent || '').trim()))`,
  )
  check('il generatore dei risultati si apre', inGeneratore === true)
  await sleep(1200)
  // tutte le righe + MERGE
  const casella = await page.eval(`(() => {
    const c = document.querySelector('input[title="Seleziona tutte le righe"]');
    if (!c) return null;
    c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`)
  if (casella) await page.clickPoint(casella.x, casella.y)
  await sleep(700)
  const mergeRisultati = await page.clickWhere(
    `[...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'MERGE')`,
  )
  await sleep(1000)
  const analisiRisultati = await page.eval(`(() => {
    const barra = document.querySelector('[data-generatore="barra"]');
    const pre = barra && barra.parentElement ? barra.parentElement.querySelector('pre') : null;
    const testo = pre ? pre.textContent : '';
    if (!testo || !testo.includes('MERGE INTO')) return null;
    const on = (testo.match(/ON ([\\s\\S]*?)\\nWHEN/) || [])[1] || '';
    const chiavi = [...on.matchAll(/tgt\\.\\[([^\\]]+)\\]/g)].map(m => m[1]);
    const set = (testo.split('UPDATE SET')[1] || '').split('WHEN NOT MATCHED')[0];
    return { chiavi, set };
  })()`)
  console.log(`  chiave ON dal generatore dei risultati: ${JSON.stringify(analisiRisultati?.chiavi)}`)
  check(
    'anche dai RISULTATI la chiave è tutta la primary key (composita)',
    (analisiRisultati?.chiavi.length ?? 0) >= 2,
    `${analisiRisultati?.chiavi.length ?? 0} colonne di chiave`,
  )
  check(
    'e nessun campo chiave finisce nell\'UPDATE SET',
    !(analisiRisultati?.chiavi ?? []).some(c => (analisiRisultati?.set ?? '').includes(`[${c}]`)),
    JSON.stringify(analisiRisultati?.chiavi),
  )
  await page.screenshot('merge-risultati-chiave-composita')

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-cursori-corti): multi cursore con righe di lunghezza DIVERSA
 * (segnalazione utente: "il multicursore non funziona bene quando ci sono righe che sono più
 * corte"). Si controlla dove finiscono i cursori aggiunti e cosa si scrive:
 *
 *   AAAA
 *   BB
 *   CCCC
 *
 * cursore a fine riga 1 (colonna 5) e Maiusc+Alt+Giù due volte. Il comportamento giusto (come
 * Visual Studio / VS Code) è che la COLONNA VOLUTA resti 5: la riga corta riceve il cursore a fine
 * riga e la riga 3 torna alla colonna 5 → scrivendo "X" si ottiene AAAAA / BBX / CCCCX; se invece
 * il cursore "scivola" sulla riga corta si ottiene AAAAA / BBX / CCXCC.
 */
async function verifyCursoriCorti(page) {
  await accediApp(page)
  await sleep(1200)
  const rect = await editorRect(page)

  const esiti = []
  const check = (nome, ok, dettaglio) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? ` — ${dettaglio}` : ''}`)
  }
  const scrivi = async sql => {
    await page.clickPoint(rect.x + 120, rect.y + 18)
    await sleep(300)
    await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
    await page.typeText(sql)
    await sleep(600)
  }
  const righeEditor = () =>
    page.eval(`[...document.querySelectorAll('.monaco-editor .view-lines .view-line')]
      .map(l => ({ top: l.getBoundingClientRect().top, testo: (l.textContent || '').replace(/\\u00a0/g, ' ').replace(/\\s+$/, '') }))
      .sort((a, b) => a.top - b.top)
      .map(l => l.testo)`)
  const cursori = () => page.eval(`document.querySelectorAll('.monaco-editor .cursors-layer .cursor').length`)
  /** Posizione di ogni cursore: riga (dall'alto) e pixel a sinistra. */
  const posizioniCursori = () =>
    page.eval(`(() => {
      const linee = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')]
        .map(l => l.getBoundingClientRect()).sort((a, b) => a.top - b.top);
      const cur = [...document.querySelectorAll('.monaco-editor .cursors-layer .cursor')];
      return cur.map(c => {
        const r = c.getBoundingClientRect();
        const riga = linee.findIndex(l => Math.abs(l.top - r.top) < 4);
        return { riga: riga + 1, left: Math.round(r.left), top: Math.round(r.top) };
      }).sort((a, b) => a.top - b.top || a.left - b.left);
    })()`)

  // 1) righe di lunghezza diversa: cursore a FINE riga 1 (Ctrl+Home poi End: niente clic a
  // coordinate, che possono cadere fuori dall'editor), poi due "aggiungi cursore sotto"
  await scrivi('AAAA\nBB\nCCCC')
  await page.press('Home', { code: 'Home', vk: 36, modifiers: 2 })
  await sleep(250)
  await page.press('End', { code: 'End', vk: 35 })
  await sleep(300)
  const prima = await cursori()
  await page.press('ArrowDown', { code: 'ArrowDown', vk: 40, modifiers: 9 })
  await sleep(400)
  const dopoUno = await posizioniCursori()
  await page.press('ArrowDown', { code: 'ArrowDown', vk: 40, modifiers: 9 })
  await sleep(400)
  const dopoDue = await posizioniCursori()
  console.log(`  cursori: prima ${prima} · dopo 1: ${JSON.stringify(dopoUno)} · dopo 2: ${JSON.stringify(dopoDue)}`)
  check(
    'Maiusc+Alt+Giù aggiunge un cursore per volta',
    dopoUno.length === 2 && dopoDue.length === 3,
    `${prima} → ${dopoUno.length} → ${dopoDue.length}`,
  )

  // 2) quello che si SCRIVE: la colonna voluta (fine riga 1) deve valere anche per la riga 3
  await page.typeText('X')
  await sleep(700)
  const scritte = await righeEditor()
  console.log(`  righe dopo aver scritto "X": ${JSON.stringify(scritte.slice(0, 3))}`)
  check('la riga 1 riceve la X a fine riga', /^AAAAX$/.test(scritte[0] ?? ''), scritte[0])
  check('la riga CORTA riceve la X a fine riga', /^BBX$/.test(scritte[1] ?? ''), scritte[1])
  check('la terza riga torna alla COLONNA VOLUTA (non scivola)', /^CCCCX$/.test(scritte[2] ?? ''), scritte[2])

  // 3) cursore a METÀ riga lunga, con una riga corta in mezzo
  await scrivi('AAAA\nBB\nCCCC')
  await page.press('Home', { code: 'Home', vk: 36, modifiers: 2 })
  await sleep(200)
  for (let i = 0; i < 2; i++) await page.press('ArrowRight', { code: 'ArrowRight', vk: 39 })
  await sleep(300)
  await page.press('ArrowDown', { code: 'ArrowDown', vk: 40, modifiers: 9 })
  await sleep(350)
  await page.press('ArrowDown', { code: 'ArrowDown', vk: 40, modifiers: 9 })
  await sleep(350)
  await page.typeText('X')
  await sleep(700)
  const aMeta = await righeEditor()
  console.log(`  cursore a metà riga (colonna 3): ${JSON.stringify(aMeta.slice(0, 3))}`)
  check(
    'colonna 3 su tutte le righe (riga corta a fine riga)',
    /^AAXAA$/.test(aMeta[0] ?? '') && /^BBX$/.test(aMeta[1] ?? '') && /^CCXCC$/.test(aMeta[2] ?? ''),
    JSON.stringify(aMeta.slice(0, 3)),
  )

  // 4) cursori verso l'ALTO con righe corte sopra
  await scrivi('AAAA\nBB\nCCCC')
  await page.press('End', { code: 'End', vk: 35, modifiers: 2 })
  await sleep(300)
  await page.press('ArrowUp', { code: 'ArrowUp', vk: 38, modifiers: 9 })
  await sleep(350)
  await page.press('ArrowUp', { code: 'ArrowUp', vk: 38, modifiers: 9 })
  await sleep(350)
  const sopra = await cursori()
  await page.typeText('Y')
  await sleep(700)
  const aSopra = await righeEditor()
  console.log(`  cursori verso l alto: ${sopra} — righe: ${JSON.stringify(aSopra.slice(0, 3))}`)
  check('Maiusc+Alt+Su aggiunge un cursore per riga (verso l alto)', sopra === 3, `${sopra} cursori`)
  check(
    'colonna 5 mantenuta anche salendo sopra la riga corta',
    /^AAAAY$/.test(aSopra[0] ?? '') && /^BBY$/.test(aSopra[1] ?? '') && /^CCCCY$/.test(aSopra[2] ?? ''),
    JSON.stringify(aSopra.slice(0, 3)),
  )

  // 5) con una SELEZIONE su una riga lunga e una riga corta sotto: si aggiunge un cursore
  //    (o una selezione) sotto, senza rompere il testo
  await scrivi('AAAA\nBB\nCCCC')
  await page.press('Home', { code: 'Home', vk: 36, modifiers: 2 })
  await sleep(200)
  // seleziona "AA" (2 caratteri) sulla riga 1
  await page.press('ArrowRight', { code: 'ArrowRight', vk: 39, modifiers: 8 })
  await page.press('ArrowRight', { code: 'ArrowRight', vk: 39, modifiers: 8 })
  await sleep(300)
  await page.press('ArrowDown', { code: 'ArrowDown', vk: 40, modifiers: 9 })
  await sleep(450)
  const conSelezione = await cursori()
  await page.typeText('Z')
  await sleep(700)
  const aSelezione = await righeEditor()
  console.log(`  con selezione: cursori ${conSelezione} — righe: ${JSON.stringify(aSelezione.slice(0, 3))}`)
  check('con una selezione il cursore si aggiunge sotto', conSelezione >= 2, `${conSelezione} cursori`)
  check(
    'la scrittura con selezione non rompe le righe corte (3 righe, testo sensato)',
    aSelezione.length === 3 && aSelezione.every(r => /^[A-Z]+$/.test(r)) && (aSelezione[1] ?? '').startsWith('Z'),
    JSON.stringify(aSelezione.slice(0, 3)),
  )

  // 6) caso limite: TRE righe corte in mezzo a due lunghe (lo "scivolamento" si vedrebbe sulla
  //    quarta riga: DXDDDDD invece di DDDDDDX)
  await scrivi('AAAAAA\nB\nC\nDDDDDD')
  await page.press('Home', { code: 'Home', vk: 36, modifiers: 2 })
  await sleep(250)
  await page.press('End', { code: 'End', vk: 35 })
  await sleep(300)
  for (let i = 0; i < 3; i++) {
    await page.press('ArrowDown', { code: 'ArrowDown', vk: 40, modifiers: 9 })
    await sleep(350)
  }
  const molti = await cursori()
  await page.typeText('X')
  await sleep(800)
  const aMolti = await righeEditor()
  console.log(`  ${molti} cursori su righe corte in mezzo: ${JSON.stringify(aMolti.slice(0, 4))}`)
  check('quattro cursori (uno per riga)', molti === 4, `${molti} cursori`)
  check(
    'nessuno scivolamento: la colonna voluta vale anche dopo le righe corte',
    /^AAAAAAX$/.test(aMolti[0] ?? '') &&
      /^BX$/.test(aMolti[1] ?? '') &&
      /^CX$/.test(aMolti[2] ?? '') &&
      /^DDDDDDX$/.test(aMolti[3] ?? ''),
    JSON.stringify(aMolti.slice(0, 4)),
  )

  // 7) SELEZIONE A BLOCCHI (Alt+C) su righe di lunghezza diversa: rettangolo di 3 colonne sulle
  //    prime righe e scrittura di 3 caratteri; la riga corta non deve rompere niente
  await scrivi('AAAA\nBB\nCCCC')
  if (!(await page.eval(`/bg-sky-600/.test((document.querySelector('[data-multiriga="blocchi"]') || {}).innerHTML || '')`))) {
    await page.clickWhere(`document.querySelector('[data-multiriga="blocchi"]')`)
    await sleep(500)
  }
  const rettangolo = await page.eval(`(() => {
    const linee = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')]
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const a = linee[0], c = linee[2];
    if (!a || !c) return null;
    const ra = a.getBoundingClientRect(), rc = c.getBoundingClientRect();
    const passo = ra.height > 0 ? 8 : 8; // ~larghezza di un carattere in Cascadia/Consolas 13px
    return { x1: ra.left + 3, y1: ra.top + ra.height / 2, x2: rc.left + 3 + passo * 3, y2: rc.top + rc.height / 2 };
  })()`)
  if (rettangolo) await page.dragPoint(rettangolo.x1, rettangolo.y1, rettangolo.x2, rettangolo.y2, 0)
  await sleep(500)
  await page.typeText('XYZ')
  await sleep(800)
  const aBlocchi = await righeEditor()
  console.log(`  selezione a blocchi su righe diverse: ${JSON.stringify(aBlocchi.slice(0, 3))}`)
  check(
    'la selezione a blocchi su righe corte non rompe il testo (3 righe, nessun carattere strano)',
    aBlocchi.length === 3 && aBlocchi.every(r => /^[A-Z]+$/.test(r)) && aBlocchi[1].length >= 2,
    JSON.stringify(aBlocchi.slice(0, 3)),
  )
  // si spegne la modalità a blocchi
  await page.clickWhere(`document.querySelector('[data-multiriga="blocchi"]')`)
  await sleep(400)

  await page.screenshot('multicursore-righe-corte')

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-inizio): a FOGLIO VUOTO (o a inizio statement) l'intellisense deve proporre
 * per prime le PAROLE CHIAVE con cui si comincia una query (SELECT, INSERT, UPDATE, DELETE, MERGE,
 * CREATE, ALTER, DROP, EXEC…), non le tabelle (segnalazione utente: "a foglio vuoto mi propone le
 * tabelle e non le chiavi per cominciare una query").
 */
async function verifyInizio(page) {
  await accediApp(page)
  await sleep(1500)
  const rect = await editorRect(page)

  const esiti = []
  const check = (nome, ok, dettaglio) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? ` — ${dettaglio}` : ''}`)
  }
  const voci = async () =>
    page.eval(`[...document.querySelectorAll('.suggest-widget .monaco-list-row')]
      .map(r => ((r.querySelector('.label-name') || r).textContent || '').replace(/\\u00a0/g, ' ').trim())`)
  const scrivi = async sql => {
    await page.clickPoint(rect.x + 120, rect.y + 18)
    await sleep(300)
    await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
    if (sql === '') await page.press('Delete', { code: 'Delete', vk: 46 })
    else await page.typeText(sql)
    await sleep(900)
  }
  /** Ctrl+Spazio: apre il popup senza digitare nulla. */
  const apriPopup = async () => {
    await page.press(' ', { code: 'Space', vk: 32, modifiers: 2 })
    await sleep(1500)
    return voci()
  }

  // 1) foglio VUOTO: le prime voci sono le keyword di statement
  await scrivi('')
  const vuoto = await apriPopup()
  console.log(`  foglio vuoto: ${JSON.stringify(vuoto.slice(0, 8))}`)
  check('a foglio vuoto il popup si apre', vuoto.length > 0)
  check(
    'a foglio vuoto il PRIMO suggerimento è SELECT',
    (vuoto[0] ?? '').toUpperCase() === 'SELECT',
    vuoto[0],
  )
  for (const k of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'EXEC']) {
    check(`a foglio vuoto propone ${k}`, vuoto.some(v => v.toUpperCase() === k), JSON.stringify(vuoto.slice(0, 6)))
  }
  // le voci oltre le ~12 righe visibili si controllano digitandone l'inizio
  // (l'elenco COMPLETO a foglio vuoto è quello appena letto: solo parole chiave)
  const inizioSoloKeyword = await page.eval(`(() => {
    const righe = [...document.querySelectorAll('.suggest-widget .monaco-list-row')];
    const testi = righe.map(r => ((r.querySelector('.label-name') || r).textContent || '').replace(/\\u00a0/g, ' ').trim());
    const estranee = testi.filter(t => /\\./.test(t) || /^(SUM|AVG|COUNT|FLOOR|FORMAT|GETDATE|ISNULL)$/i.test(t) || /^[A-Z]{2,}_/.test(t));
    return { quante: testi.length, testi: testi.slice(0, 8), estranee: estranee.slice(0, 4) };
  })()`)
  console.log(`  a foglio vuoto (elenco completo): ${JSON.stringify(inizioSoloKeyword)}`)
  check(
    'a foglio vuoto NON compaiono tabelle/funzioni/store: solo parole chiave',
    inizioSoloKeyword.quante > 0 && inizioSoloKeyword.estranee.length === 0,
    JSON.stringify(inizioSoloKeyword.estranee),
  )
  await scrivi('MER')
  const vociMer = await apriPopup()
  check('digitando "MER" esce MERGE', vociMer.some(v => v.toUpperCase() === 'MERGE'), JSON.stringify(vociMer.slice(0, 4)))
  check(
    'a foglio vuoto le TABELLE non stanno in cima',
    !vuoto.slice(0, 6).some(v => /^dbo\.|^DAT_|^MAG_|^CFG_/i.test(v)),
    JSON.stringify(vuoto.slice(0, 6)),
  )

  // 2) dopo uno statement chiuso (SELECT 1; + a capo) vale lo stesso
  await scrivi('SELECT 1;\n')
  const dopoStatement = await apriPopup()
  console.log(`  dopo "SELECT 1;": ${JSON.stringify(dopoStatement.slice(0, 5))}`)
  check(
    'dopo uno statement chiuso si riparte dalle keyword',
    (dopoStatement[0] ?? '').toUpperCase() === 'SELECT',
    dopoStatement[0],
  )

  // 3) a METÀ statement (dopo WHERE) le keyword di inizio NON vanno in cima: servono le colonne
  await scrivi('SELECT * FROM dbo.DAT_UDC\nWHERE ')
  const meta = await apriPopup()
  console.log(`  a metà statement (WHERE): ${JSON.stringify(meta.slice(0, 5))}`)
  check(
    'a metà statement non si propone SELECT in cima',
    (meta[0] ?? '').toUpperCase() !== 'SELECT',
    meta[0],
  )
  check(
    'a metà statement si propongono le colonne della tabella',
    meta.some(v => /^UDC_/i.test(v)),
    JSON.stringify(meta.slice(0, 5)),
  )

  await page.screenshot('intellisense-inizio-statement')

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-trigger): l'intellisense deve aiutare a scrivere BENE l'abilitazione e la
 * disabilitazione di un trigger (segnalazione utente: "l'intellisense non mi aiuta a scrivere
 * correttamente l'abilitazione o disabilitazione di un trigger"). Si controlla il popup:
 *  1) dopo "DISABLE TRIGGER "            → i trigger della tabella + ALL
 *  2) dopo "DISABLE TRIGGER <nome> "     → "ON <tabella>" (la tabella SU CUI è definito)
 *  3) dopo "DISABLE TRIGGER <nome> ON "  → la tabella di QUEL trigger (non un elenco lungo)
 *  4) dopo "ENABLE TRIGGER ALL ON "      → tutte le tabelle con trigger + DATABASE / ALL SERVER
 *  5) dopo "ALTER TABLE <t> DISABLE TRIGGER " → i trigger di quella tabella (forma ALTER TABLE)
 */
async function verifyTrigger(page) {
  await accediApp(page)
  await sleep(1500)
  const rect = await editorRect(page)

  const esiti = []
  const check = (nome, ok, dettaglio) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? ` — ${dettaglio}` : ''}`)
  }
  const scrivi = async sql => {
    await page.clickPoint(rect.x + 120, rect.y + 18)
    await sleep(300)
    await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
    await page.typeText(sql)
    await sleep(1700)
  }
  const voci = async () =>
    page.eval(`[...document.querySelectorAll('.suggest-widget .monaco-list-row')]
      .map(r => ((r.querySelector('.label-name') || r).textContent || '').replace(/\\u00a0/g, ' ').trim())`)
  const minuscole = v => v.map(x => x.toLowerCase())
  /** Ctrl+Spazio: popup senza digitare nulla (per vedere cosa propone "da fermo"). */
  const apriPopupTrigger = async () => {
    await page.press(' ', { code: 'Space', vk: 32, modifiers: 2 })
    await sleep(1400)
    return voci()
  }
  /** Classe dell'icona della voce con quel testo (keyword = blu, snippet = altra icona). */
  const iconaDi = async testo =>
    page.eval(`(() => {
      const righe = [...document.querySelectorAll('.suggest-widget .monaco-list-row')];
      const r = righe.find(x => ((x.querySelector('.label-name') || x).textContent || '').trim().toUpperCase() === ${JSON.stringify(testo.toUpperCase())});
      if (!r) return null;
      const ic = r.querySelector('.icon, .codicon, [class*="symbol-"]');
      // il "kind" del suggerimento è nel nome della classe (codicon-symbol-keyword / -snippet…)
      const codicon = r.querySelector('[class*="codicon-symbol-"]');
      return JSON.stringify({ icona: ic ? ic.className : null, codicon: codicon ? codicon.className : null, html: r.innerHTML.slice(0, 120) });
    })()`)

  // 0) le PAROLE "ENABLE"/"DISABLE" devono uscire dall'intellisense (segnalazione utente), con
  //    lo snippet completo della direttiva (nome + ON tabella)
  await scrivi('DIS')
  const vociDis = await voci()
  console.log(`  dopo "DIS": ${JSON.stringify(vociDis.slice(0, 4))}`)
  check('digitando "DIS" esce "DISABLE TRIGGER"', vociDis.some(v => v.toUpperCase() === 'DISABLE TRIGGER'), JSON.stringify(vociDis.slice(0, 3)))
  check('digitando "DIS" esce anche "DISABLE TRIGGER ALL"', vociDis.some(v => v.toUpperCase() === 'DISABLE TRIGGER ALL'))
  // richiesta utente: "deve essere come le altre tipo EXEC, una parola chiave, blue" → l'icona
  // della voce deve essere quella delle PAROLE CHIAVE (come "TRIGGER" proposto dopo "DISABLE ")
  const iconaTrigger = await iconaDi('DISABLE TRIGGER')
  await scrivi('DISABLE ')
  const iconaParola = await iconaDi('TRIGGER')
  console.log(`  icone: DISABLE TRIGGER = ${iconaTrigger} · TRIGGER (parola chiave) = ${iconaParola}`)
  const kindDi = testo => {
    if (!testo) return null
    try {
      return JSON.parse(testo).codicon
    } catch {
      return null
    }
  }
  check(
    'la voce è una PAROLA CHIAVE (stessa icona blu di TRIGGER, non quella degli snippet)',
    !!kindDi(iconaTrigger) && kindDi(iconaTrigger) === kindDi(iconaParola) && /keyword/i.test(kindDi(iconaTrigger)),
    `${kindDi(iconaTrigger)} vs ${kindDi(iconaParola)}`,
  )
  await scrivi('ENA')
  const vociEna = await voci()
  console.log(`  dopo "ENA": ${JSON.stringify(vociEna.slice(0, 4))}`)
  check('digitando "ENA" esce "ENABLE TRIGGER"', vociEna.some(v => v.toUpperCase() === 'ENABLE TRIGGER'), JSON.stringify(vociEna.slice(0, 3)))
  // dopo la parola, "TRIGGER" deve essere proposto
  await scrivi('DISABLE ')
  const vociDopoDisable = await voci()
  console.log(`  dopo "DISABLE ": ${JSON.stringify(vociDopoDisable.slice(0, 4))}`)
  check('dopo "DISABLE " propone TRIGGER', minuscole(vociDopoDisable).includes('trigger'), JSON.stringify(vociDopoDisable.slice(0, 3)))
  // accettando lo snippet si ottiene la direttiva completa, con i due segnaposto VUOTI: fermandosi
  // lì l'intellisense propone i trigger veri e poi la tabella di quel trigger
  await scrivi('DIS')
  await page.press('Enter', { code: 'Enter', vk: 13 })
  await sleep(900)
  const rigaSnippet = await page.eval(`(() => {
    const linee = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')]
      .map(l => (l.textContent || '').replace(/\\u00a0/g, ' '));
    return linee.find(l => l.toUpperCase().includes('DISABLE TRIGGER')) || '';
  })()`)
  console.log(`  snippet accettato: ${JSON.stringify(rigaSnippet)}`)
  check(
    'accettando lo snippet esce "DISABLE TRIGGER <trigger> ON <tabella>"',
    /DISABLE TRIGGER .* ON /i.test(rigaSnippet),
    rigaSnippet,
  )
  check(
    'lo snippet NON lascia il testo fisso "[schema.]trigger" (che bloccherebbe il popup)',
    !/\[schema\.\]/i.test(rigaSnippet),
    rigaSnippet,
  )
  // e con il cursore nel segnaposto del nome l'intellisense propone i TRIGGER veri
  const vociNelSegnaposto = await apriPopupTrigger()
  console.log(`  popup dentro il segnaposto: ${JSON.stringify(vociNelSegnaposto.slice(0, 3))}`)
  check(
    'dentro il segnaposto del nome l intellisense propone i trigger',
    vociNelSegnaposto.some(v => /^tr_/i.test(v)),
    JSON.stringify(vociNelSegnaposto.slice(0, 3)),
  )

  // 1) elenco dei trigger (e ALL)
  await scrivi('DISABLE TRIGGER ')
  const vociTrigger = await voci()
  console.log(`  dopo "DISABLE TRIGGER ": ${JSON.stringify(vociTrigger.slice(0, 4))}`)
  check('dopo "DISABLE TRIGGER " propone i trigger', vociTrigger.some(v => v.toLowerCase().startsWith('tr_')))
  // "ALL": dopo ALL serve comunque "ON <tabella>", quindi si verifica il pezzo successivo
  await scrivi('DISABLE TRIGGER ALL ')
  const vociAllNome = await voci()
  console.log(`  dopo "DISABLE TRIGGER ALL ": ${JSON.stringify(vociAllNome.slice(0, 3))}`)
  check('dopo "DISABLE TRIGGER ALL " propone ON', minuscole(vociAllNome).includes('on'), JSON.stringify(vociAllNome.slice(0, 3)))

  // 2) dopo il NOME serve "ON <tabella>": è l'errore tipico
  await scrivi(`DISABLE TRIGGER ${TRIGGER_NAME} `)
  const vociDopoNome = await voci()
  console.log(`  dopo "DISABLE TRIGGER ${TRIGGER_NAME} ": ${JSON.stringify(vociDopoNome.slice(0, 4))}`)
  check(
    'dopo il nome propone "ON <tabella>" (non ripropone i trigger)',
    vociDopoNome.some(v => new RegExp(`^ON\\b.*${TRIGGER_TABLE}`, 'i').test(v)),
    JSON.stringify(vociDopoNome.slice(0, 3)),
  )

  // 3) dopo "ON " la tabella di QUEL trigger
  await scrivi(`DISABLE TRIGGER ${TRIGGER_NAME} ON `)
  const vociOn = await voci()
  console.log(`  dopo "... ${TRIGGER_NAME} ON ": ${JSON.stringify(vociOn.slice(0, 4))}`)
  check(
    'dopo "ON " propone per prima la tabella di quel trigger',
    (vociOn[0] ?? '').toLowerCase().includes(TRIGGER_TABLE.toLowerCase()),
    vociOn[0],
  )
  check('dopo "ON " propone anche DATABASE e ALL SERVER', minuscole(vociOn).includes('database') && minuscole(vociOn).includes('all server'))

  // 3b) completando la tabella la riga diventa corretta
  await scrivi(`DISABLE TRIGGER ${TRIGGER_NAME} ON `)
  await page.press('Enter', { code: 'Enter', vk: 13 })
  await sleep(800)
  const riga = await page.eval(`(() => {
    const linee = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')]
      .map(l => (l.textContent || '').replace(/\\u00a0/g, ' '));
    return linee.find(l => l.toUpperCase().includes('DISABLE TRIGGER')) || '';
  })()`)
  console.log(`  riga completata: ${JSON.stringify(riga)}`)
  check(
    'accettando si ottiene "DISABLE TRIGGER <trigger> ON <tabella>"',
    new RegExp(`DISABLE TRIGGER ${TRIGGER_NAME} ON (\\[?dbo\\]?\\.)?\\[?${TRIGGER_TABLE}\\]?`, 'i').test(riga),
    riga,
  )

  // 4) ALL ON → tutte le tabelle con trigger
  await scrivi('ENABLE TRIGGER ALL ON ')
  const vociAll = await voci()
  console.log(`  dopo "ENABLE TRIGGER ALL ON ": ${JSON.stringify(vociAll.slice(0, 4))}`)
  check('dopo "TRIGGER ALL ON " propone le tabelle con trigger', vociAll.length > 3, `${vociAll.length} voci`)

  // 5) forma ALTER TABLE ... DISABLE TRIGGER
  await scrivi(`ALTER TABLE dbo.${TRIGGER_TABLE} DISABLE TRIGGER `)
  const vociAlter = await voci()
  console.log(`  dopo "ALTER TABLE dbo.${TRIGGER_TABLE} DISABLE TRIGGER ": ${JSON.stringify(vociAlter.slice(0, 4))}`)
  check(
    'con ALTER TABLE propone i trigger di QUELLA tabella',
    vociAlter.some(v => v.toLowerCase().includes(TRIGGER_NAME.toLowerCase())),
    JSON.stringify(vociAlter.slice(0, 3)),
  )

  // 6) COLORI: ENABLE/DISABLE devono essere colorate come le altre parole chiave (blu), non nere
  await scrivi('SELECT 1;\nDISABLE TRIGGER tr_X ON dbo.T;\nENABLE TRIGGER tr_X ON dbo.T;')
  const colori = await page.eval(`(() => {
    const coloreDi = parola => {
      for (const l of document.querySelectorAll('.monaco-editor .view-lines .view-line')) {
        for (const s of l.querySelectorAll('span[class*="mtk"]')) {
          if ((s.textContent || '').trim().toUpperCase() === parola) return getComputedStyle(s).color;
        }
      }
      return null;
    };
    return { select: coloreDi('SELECT'), disable: coloreDi('DISABLE'), enable: coloreDi('ENABLE'), trigger: coloreDi('TRIGGER') };
  })()`)
  console.log(`  colori: SELECT=${colori.select} DISABLE=${colori.disable} ENABLE=${colori.enable} TRIGGER=${colori.trigger}`)
  check(
    'DISABLE è colorata come le altre parole chiave (blu, come SELECT)',
    !!colori.disable && colori.disable === colori.select,
    `${colori.disable} vs SELECT ${colori.select}`,
  )
  check(
    'ENABLE è colorata come le altre parole chiave (blu, come SELECT)',
    !!colori.enable && colori.enable === colori.select,
    `${colori.enable} vs SELECT ${colori.select}`,
  )

  await page.screenshot('intellisense-trigger')

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-copia): il pulsante "Copia SQL" del pannello script sta a SINISTRA della
 * barra del generatore e la stessa copia si può fare col TASTO DESTRO sullo script (richieste
 * utente: "the copy button from the pannel of script that there is already, move on the left, and
 * also in right click"). Si usa l'anteprima dati (F4) come per la MERGE.
 */
async function verifyCopia(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Schema:')`, 60000, 'schema caricato')
  // la copia negli appunti serve davvero: si dà il permesso al browser
  try {
    await page.send('Browser.grantPermissions', {
      origin: APP_URL.replace(/\/$/, ''),
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    })
  } catch (e) {
    console.log(`  (permesso appunti non concesso: ${e.message})`)
  }
  await sleep(1200)

  const esiti = []
  const check = (nome, ok, dettaglio) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? ` — ${dettaglio}` : ''}`)
  }

  // si apre l'anteprima dati della tabella con chiave composita (come --verify-merge)
  const rect = await editorRect(page)
  await page.clickPoint(rect.x + 160, rect.y + 18)
  await sleep(400)
  await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
  await page.typeText(`SELECT * FROM dbo.${TABELLA_CHIAVE}`)
  await sleep(400)
  for (let i = 0; i < 5; i++) await page.press('ArrowLeft', { code: 'ArrowLeft', vk: 37 })
  await sleep(300)
  await page.press('F4', { code: 'F4', vk: 115 })
  await page.waitFor(`document.body.textContent.includes('Anteprima dati —')`, 30000, 'anteprima dati')
  await sleep(2000)

  // tutte le righe selezionate: così lo script generato non è vuoto
  const box = await page.eval(`(() => {
    const h = [...document.querySelectorAll('h2')].find(x => (x.textContent || '').includes('Anteprima dati'));
    const mod = h && h.closest('div.fixed');
    const c = mod && mod.querySelector('input[title="Seleziona tutte le righe"]');
    if (!c) return null;
    c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`)
  if (!box) throw new Error('casella "Seleziona tutte le righe" non trovata nell anteprima')
  await page.clickPoint(box.x, box.y)
  await sleep(900)

  /** Posizione e testo dei comandi della barra del generatore. */
  const barra = await page.eval(`(() => {
    const b = document.querySelector('[data-generatore="barra"]');
    if (!b) return null;
    const voci = [...b.querySelectorAll('button, label, input')].map(e => {
      const r = e.getBoundingClientRect();
      return { testo: (e.textContent || e.getAttribute('placeholder') || '').trim().slice(0, 24), left: Math.round(r.left) };
    });
    const copia = b.querySelector('[data-copia="pulsante"]');
    return { voci, copiaLeft: copia ? Math.round(copia.getBoundingClientRect().left) : null };
  })()`)
  console.log(`  barra del generatore: ${JSON.stringify(barra?.voci.slice(0, 4))}`)
  check('la barra del generatore si vede', !!barra)
  check('il pulsante "Copia SQL" è il PRIMO comando a sinistra', barra?.voci?.[0]?.testo === 'Copia SQL', JSON.stringify(barra?.voci?.[0]))
  check(
    'nessun altro comando sta più a sinistra della copia',
    (barra?.voci ?? []).every(v => v.left >= (barra?.copiaLeft ?? 0)),
  )

  // copia dal PULSANTE
  await page.clickWhere(`document.querySelector('[data-copia="pulsante"]')`)
  await sleep(900)
  const dopoPulsante = await page.eval(`(document.querySelector('[data-copia="pulsante"]') || {}).textContent || ''`)
  check('il pulsante copia davvero (diventa "Copiato!")', dopoPulsante.includes('Copiato!'), dopoPulsante.trim())

  // copia col TASTO DESTRO sullo script
  const script = await page.eval(`(() => {
    const p = [...document.querySelectorAll('pre')].find(x => (x.textContent || '').includes('INSERT INTO'));
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: r.left + 80, y: r.top + 20 };
  })()`)
  check('lo script generato è visibile', !!script)
  if (script) await page.clickPoint(script.x, script.y, 'right')
  await sleep(700)
  const menu = await page.eval(`[...document.querySelectorAll('button')]
    .map(b => (b.textContent || '').trim()).filter(t => t === 'Copia SQL' || t === 'Copiato!')`)
  console.log(`  voci del menu col tasto destro: ${JSON.stringify(menu)}`)
  check('col tasto destro compare "Copia SQL"', menu.length > 0)
  await page.clickWhere(`[...document.querySelectorAll('button')].find(b => /^(Copia SQL|Copiato!)$/.test((b.textContent || '').trim()))`)
  await sleep(900)
  const dopoMenu = await page.eval(`(document.querySelector('[data-copia="pulsante"]') || {}).textContent || ''`)
  check('la copia dal tasto destro funziona', dopoMenu.includes('Copiato!'), dopoMenu.trim())
  const menuChiuso = await page.eval(
    `![...document.querySelectorAll('button')].some(b => (b.textContent || '').trim() === 'Copia SQL')`,
  )
  check('dopo la copia il menu si chiude', menuChiuso)

  await page.screenshot('copia-script-pannello')

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-hover): la TOOLTIP di una stored procedure mostra il COMMENTO di testata e i
 * PARAMETRI della firma (richiesta utente: "nella tooltip di una store mi puoi fare vedere commento
 * e parametri?"). Si scrive una EXEC nel editor e si passa il mouse sul nome: si legge la tooltip
 * vera dal DOM (provider asincrono incluso), non una funzione interna.
 */
async function verifyHover(page) {
  await accediApp(page)
  await sleep(2000)

  const esiti = []
  const check = (nome, ok, dettaglio) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? ` — ${dettaglio}` : ''}`)
  }

  /**
   * Tooltip VISIBILE: in pagina possono restare più elementi .monaco-hover (uno per editor) e
   * quello vecchio resta nel DOM ma nascosto, quindi si prende il più grande con area > 0.
   */
  const HOVER_VISIBILE = `[...document.querySelectorAll('.monaco-hover')]
    .map(h => ({ h, r: h.getBoundingClientRect() }))
    .filter(x => x.r.width > 2 && x.r.height > 2)
    .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0]?.h`

  /** Testo della tooltip attualmente mostrata (null se non c'è). */
  const leggiTooltip = () =>
    page.eval(`(() => {
      const h = ${HOVER_VISIBILE};
      if (!h) return null;
      return (h.innerText || '').replace(/\\u00a0/g, ' ').trim();
    })()`)

  /** Struttura HTML della tooltip: serve a provare che il markdown è RENDERIZZATO (non testo grezzo). */
  const strutturaTooltip = () =>
    page.eval(`(() => {
      const h = ${HOVER_VISIBILE};
      if (!h) return null;
      return {
        voci: h.querySelectorAll('li').length,
        titoli: [...h.querySelectorAll('h1,h2,h3,h4')].map(e => (e.textContent || '').trim()),
        grassetti: [...h.querySelectorAll('strong')].map(e => (e.textContent || '').trim()),
        citazioni: h.querySelectorAll('blockquote').length,
        codice: [...h.querySelectorAll('code')].map(e => (e.textContent || '').trim()),
      };
    })()`)

  /** Testo della tooltip dopo aver portato il mouse su un pezzo di codice. */
  const hoverSu = async testo => {
    const punto = await page.eval(`(() => {
      const cercato = ${JSON.stringify(testo)};
      const spans = [...document.querySelectorAll('.monaco-editor .view-lines .view-line span')]
        .filter(s => s.children.length === 0 && (s.textContent || '').includes(cercato));
      if (!spans.length) return null;
      const span = spans[0];
      const i = (span.textContent || '').indexOf(cercato);
      const range = document.createRange();
      range.setStart(span.firstChild, i);
      range.setEnd(span.firstChild, i + cercato.length);
      const r = range.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, riga: span.textContent };
    })()`)
    if (!punto) return { punto: null, testo: null, struttura: null }
    // 1) il mouse ESCE dal editor: la tooltip precedente può coprire il token da guardare (è un
    //    pannello "sticky": finché il mouse resta dentro l'editor non sparisce) e si aspetta che se ne vada
    const fuori = await page.eval(`({ x: innerWidth - 24, y: 6 })`)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(fuori.x), y: Math.round(fuori.y), button: 'none', buttons: 0 })
    for (let i = 0; i < 20; i++) {
      // eslint-disable-next-line no-await-in-loop
      if ((await leggiTooltip()) === null) break
      // eslint-disable-next-line no-await-in-loop
      await sleep(150)
    }
    // 2) ora il mouse va sul token (la tooltip compare sul movimento, non sul riposo)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(punto.x), y: Math.round(punto.y), button: 'none', buttons: 0 })
    // la tooltip si aspetta finché non è QUELLA giusta: la precedente resta in pagina per un po'
    let testoLetto = null
    const scaduto = Date.now() + 15000
    while (Date.now() < scaduto) {
      // eslint-disable-next-line no-await-in-loop
      testoLetto = await leggiTooltip()
      if (testoLetto && testoLetto.includes(testo)) break
      // eslint-disable-next-line no-await-in-loop
      await sleep(300)
    }
    return { punto, testo: testoLetto, struttura: await strutturaTooltip() }
  }

  // 1) si scrive nel editor la chiamata alla store vera (23 parametri, commento in testa)
  const rect = await editorRect(page)
  await page.clickPoint(rect.x + 200, rect.y + 30)
  await sleep(300)
  await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 }) // Ctrl+A
  await sleep(200)
  await page.typeText(
    `SELECT UDC_UDC, UDC_TIPOUDC\nFROM dbo.DAT_UDC;\nEXEC dbo.${STORE_HOVER};\nSELECT dbo.${FUNZIONE_HOVER}(0,0,0,0,0,0,1,1,0,0);`,
  )
  await sleep(1200)

  const tooltip = await hoverSu(STORE_HOVER)
  console.log(`  tooltip della store:\n${(tooltip.testo || '(nessuna tooltip)').split('\n').map(r => `    | ${r}`).join('\n')}`)
  check('la tooltip della store compare', tooltip.punto !== null && (tooltip.testo || '').length > 0)

  const t = tooltip.testo || ''
  check('dice che è una stored procedure', t.includes(STORE_HOVER) && /stored procedure/i.test(t), t.split('\n')[0])
  check('mostra la sezione PARAMETRI', /Parametri \(\d+\)/.test(t), (t.match(/Parametri \(\d+\)/) || [])[0])
  // ogni parametro è una riga "- @nome · tipo": il numero deve essere quello vero della firma
  const righeParam = t.match(/^[-•*]?\s*@[A-Za-z_][A-Za-z0-9_]* · /gm) || []
  check(
    `elenca TUTTI i ${STORE_HOVER_PARAMS} parametri della firma`,
    righeParam.length === STORE_HOVER_PARAMS,
    `${righeParam.length} righe di parametro`,
  )
  check('i parametri sono scritti con la chiocciola', /\B@s_Piazzola\b/.test(t) && /\B@errore\b/.test(t))
  check(
    'il parametro OUTPUT mostra tipo esatto e OUTPUT',
    /^[-•*]?\s*@errore · nvarchar\(255\) · \*\*?OUTPUT/m.test(t) || /@errore · nvarchar\(255\) · OUTPUT/.test(t),
    (t.match(/@errore[^\n]*/) || [])[0],
  )
  check('mostra il COMMENTO di testata', /Commento/.test(t), (t.match(/Commento[^\n]*/) || [])[0])
  check(
    'il commento è quello vero della store',
    t.includes('Routine per generazione missione'),
    (t.split('\n').find(r => r.includes('Routine per generazione')) || '').trim(),
  )

  // il markdown deve essere RENDERIZZATO: voci di elenco, titoli, grassetto, citazione e codice
  const st = tooltip.struttura || {}
  console.log(`  struttura tooltip: ${JSON.stringify(st)}`)
  check('i parametri sono un ELENCO (23 voci)', st.voci === STORE_HOVER_PARAMS, `${st.voci} voci`)
  check(
    'i titoli sono renderizzati (Parametri + Commento)',
    (st.titoli || []).includes(`Parametri (${STORE_HOVER_PARAMS})`) && (st.titoli || []).includes('Commento'),
    JSON.stringify(st.titoli),
  )
  check('OUTPUT è in GRASSETTO', (st.grassetti || []).includes('OUTPUT'), JSON.stringify(st.grassetti))
  check('il commento è una CITAZIONE', (st.citazioni || 0) > 0, `${st.citazioni} citazioni`)
  check(
    'nomi e tipi sono in stile CODICE',
    (st.codice || []).includes('@s_Piazzola') && (st.codice || []).includes('nvarchar(255)'),
    JSON.stringify((st.codice || []).slice(0, 4)),
  )
  await page.screenshot('tooltip-store-commento-parametri')

  // 2) regressione: la tooltip di una COLONNA non deve diventare quella della routine
  const colonna = await hoverSu('UDC_UDC')
  console.log(`  tooltip della colonna:\n${(colonna.testo || '(nessuna tooltip)').split('\n').slice(0, 6).map(r => `    | ${r}`).join('\n')}`)
  const tc = colonna.testo || ''
  check('la tooltip della colonna continua a funzionare', tc.includes('UDC_UDC') && /decimal/i.test(tc), tc.split('\n')[0])
  check('la tooltip della colonna NON mostra i parametri di una store', !/Parametri \(\d+\)/.test(tc))

  // 3) FUNZIONE: il sommario non ha i suoi parametri, quindi devono arrivare dalla definizione
  const funzione = await hoverSu(FUNZIONE_HOVER)
  const tf = funzione.testo || ''
  // se la tooltip non compare, l'errore del provider (se c'è) si legge qui
  if (!tf.includes(FUNZIONE_HOVER)) console.log(`  errori in console: ${JSON.stringify(page.consoleLogs('rror').slice(-4))}`)
  console.log(`  tooltip della funzione:\n${tf.split('\n').slice(0, 8).map(r => `    | ${r}`).join('\n')}`)
  const righeFun = tf.match(/^[-•*]?\s*@[A-Za-z_][A-Za-z0-9_]* · /gm) || []
  check('la tooltip della funzione compare', funzione.punto !== null && tf.length > 0)
  check('dice che è una funzione', tf.includes(FUNZIONE_HOVER) && /funzione/i.test(tf), tf.split('\n')[0])
  check(
    `i parametri della funzione arrivano dalla definizione (${FUNZIONE_HOVER_PARAMS})`,
    righeFun.length === FUNZIONE_HOVER_PARAMS,
    `${righeFun.length} righe di parametro`,
  )
  check('il valore di ritorno (riga senza nome) NON compare come parametro', !/·\s*bit\s*·\s*\*\*?OUTPUT/.test(tf))
  check('anche la funzione mostra il COMMENTO', /Commento/.test(tf), (tf.match(/Commento[^\n]*/) || [])[0])
  await page.screenshot('tooltip-funzione-parametri')

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-report): il REPORT utilizzo tabelle si apre in una TAB (non in una finestra),
 * l'ISTOGRAMMA delle 20 tabelle più pesanti sta SOTTO l'elenco e SEGUE il filtro per nome, e le
 * tabelle selezionate generano lo script di svuotamento in una nuova tab (richieste utente:
 * "il grafico, fallo che si filtra con la ricerca, e che sta sotto alla lista e la form si apre
 * come le tab").
 */
async function verifyReport(page) {
  await accediApp(page)
  await sleep(2000)

  const esiti = []
  const check = (nome, ok, dettaglio) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? ` — ${dettaglio}` : ''}`)
  }

  // il pannello Oggetti può essere chiuso: nel caso lo si riapre
  if (!(await page.eval(`!!document.querySelector('input[placeholder^="Cerca (spazio"]')`))) {
    await page.clickWhere(
      `[...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '+ Oggetti')`,
    )
    await sleep(1200)
  }

  // 1) si apre il report tabelle dal pannello DATABASE: deve diventare una TAB
  const apri = await page.clickWhere(`document.querySelector('[data-report="apri"]')`)
  check('il pulsante del report tabelle si trova', apri === true)
  const inTab = await page.waitFor(`document.querySelector('[data-report="pannello"]')`, 60000, 'pannello del report')
  check('il report si apre in una TAB (pannello nell area editor)', inTab === true)
  const tabReport = await page.eval(`(() => {
    const t = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && (e.textContent || '').trim() === 'Report tabelle');
    return t.length > 0;
  })()`)
  check('la barra delle tab mostra "Report tabelle"', tabReport === true)
  const senzaFinestraModale = await page.eval(`(() => {
    // la vecchia finestra era un overlay a tutto schermo con lo sfondo nero
    const p = document.querySelector('[data-report="pannello"]');
    return !!p && !p.closest('div.fixed');
  })()`)
  check('non è più una finestra modale', senzaFinestraModale === true)
  await page.waitFor(`document.querySelectorAll('[data-report="barra"]').length > 0`, 90000, 'istogramma caricato')
  // il pannello può caricare i dati due volte (doppio effetto in sviluppo): si aspetta che
  // l'istogramma sia STABILE (20 barre e nessun nodo di troppo) prima di misurarlo
  await page.waitFor(
    `(() => {
       const c = document.querySelector('[data-report="istogramma"]');
       if (!c || !c.lastElementChild) return false;
       const barre = c.querySelectorAll('[data-report="barra"]').length;
       const figli = c.lastElementChild.children.length;
       return barre > 0 && barre === figli && barre <= 20 && document.querySelectorAll('[data-report="barra"]').length === barre;
     })()`,
    30000,
    'istogramma stabile',
  )
  await sleep(1200)

  // 2) ISTOGRAMMA SOPRA O SOTTO? Deve stare SOTTO l'elenco
  const posizioni = await page.eval(`(() => {
    const elenco = document.querySelector('[data-report="elenco"]');
    const ist = document.querySelector('[data-report="istogramma"]');
    if (!elenco || !ist) return null;
    return { topElenco: Math.round(elenco.getBoundingClientRect().top), topIstogramma: Math.round(ist.getBoundingClientRect().top) };
  })()`)
  console.log(`  posizioni: elenco ${posizioni?.topElenco}, istogramma ${posizioni?.topIstogramma}`)
  check("l'istogramma sta SOTTO l'elenco", (posizioni?.topIstogramma ?? 0) > (posizioni?.topElenco ?? 0), JSON.stringify(posizioni))

  /** Misure delle barre dell'istogramma: nome, larghezza totale in % del massimo e tooltip. */
  const misureBarre = () =>
    page.eval(`(() => {
      const barre = [...document.querySelectorAll('[data-report="barra"]')];
      const misure = barre.map(b => {
        const pezzi = [...b.querySelectorAll('span[style]')].map(s => parseFloat(s.style.width) || 0);
        return {
          nome: (b.querySelector('span') || {}).textContent || '',
          totale: Math.round(pezzi.reduce((a, x) => a + x, 0) * 10) / 10,
          titolo: b.getAttribute('title') || '',
        };
      });
      return { quante: barre.length, misure };
    })()`)
  const istogramma = await misureBarre()

  // 2b) UNA RIGA PER TABELLA (difetto segnalato: "le tabelle non sono univoche" — la stessa
  //     tabella compariva due volte con somme PARZIALI, es. MAG_CELLE 11.194 + 22.388 righe)
  const univoche = await page.eval(`(() => {
    const p = document.querySelector('[data-report="pannello"]');
    const righe = [...p.querySelectorAll('[data-report="riga"]')];
    const nomi = righe.map(t => {
      const td = t.querySelector('td[title]');
      return td ? td.getAttribute('title') : '';
    });
    const totali = (p.querySelector('[data-report="totali"]') || {}).textContent || '';
    const m = totali.match(/([\\d.]+)\\s*tabelle/);
    const tabelle = m ? parseInt(m[1].replace(/\\./g, ''), 10) : 0;
    return { righe: righe.length, nomiDistinti: new Set(nomi).size, tabelle, totali };
  })()`)
  console.log(`  righe del report: ${JSON.stringify(univoche)}`)
  check(
    'una riga per tabella, senza doppioni',
    univoche.tabelle > 0 && univoche.righe === univoche.tabelle && univoche.nomiDistinti === univoche.righe,
    JSON.stringify(univoche),
  )
  console.log(`  istogramma: ${istogramma.quante} barre, la prima ${JSON.stringify(istogramma.misure[0])}`)
  check('mostra 20 tabelle', istogramma.quante === 20, `${istogramma.quante} barre`)
  check('la prima barra è quella più pesante (100%)', istogramma.misure[0]?.totale >= 99.5, `prima = ${istogramma.misure[0]?.totale}%`)
  check(
    'le barre sono in ordine decrescente di spazio',
    istogramma.misure.every((m, i) => i === 0 || m.totale <= istogramma.misure[i - 1].totale + 0.01),
    JSON.stringify(istogramma.misure.map(m => m.totale).slice(0, 5)),
  )
  check(
    'il tooltip dice righe, dati e indici',
    /righe/.test(istogramma.misure[0]?.titolo ?? '') && /dati/.test(istogramma.misure[0]?.titolo ?? '') && /indici/.test(istogramma.misure[0]?.titolo ?? ''),
    istogramma.misure[0]?.titolo,
  )
  await page.screenshot('report-tabelle-istogramma')

  // 3) IL FILTRO DEVE FILTRARE ANCHE L'ISTOGRAMMA
  const filtro = await page.eval(`(() => {
    const i = document.querySelector('[data-report="filtro"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, 'DAT_');
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return i.value;
  })()`)
  await sleep(900)
  const filtrato = await page.eval(`(() => {
    const barre = [...document.querySelectorAll('[data-report="barra"]')].map(b => (b.querySelector('span') || {}).textContent || '');
    const righe = document.querySelectorAll('[data-report="riga"]').length;
    const campo = document.querySelector('[data-report="filtro"]');
    return { barre, righe, quante: barre.length, filtro: campo ? campo.value : '(nessun campo)' };
  })()`)
  console.log(`  filtro "${filtro}" (campo="${filtrato.filtro}"): ${filtrato.righe} righe, istogramma ${JSON.stringify(filtrato.barre.slice(0, 4))}`)
  check(
    "l'istogramma mostra SOLO le tabelle del filtro",
    filtrato.quante > 0 && filtrato.barre.every(n => n.toLowerCase().includes('dat_')),
    JSON.stringify(filtrato.barre.slice(0, 3)),
  )
  check(
    "anche l'elenco è filtrato",
    filtrato.righe > 0 && filtrato.righe < 340,
    `${filtrato.righe} righe`,
  )
  // si toglie il filtro: torna tutto
  await page.eval(`(() => {
    const i = document.querySelector('[data-report="filtro"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, '');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(800)

  // 4) SELEZIONE cliccando due barre
  const clicked = await page.eval(`(() => {
    const barre = [...document.querySelectorAll('[data-report="barra"]')].slice(0, 2);
    let n = 0;
    for (const b of barre) {
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        b.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
      n++;
    }
    return n;
  })()`)
  await sleep(700)
  const stato = await page.eval(`(() => {
    const sel = document.querySelector('[data-report="selezionate"]');
    const n = parseInt((sel && sel.textContent) || '0', 10) || 0;
    const nomi = [...document.querySelectorAll('[data-report="barra"]')]
      .filter(b => { const i = b.querySelector('input[type=checkbox]'); return i && i.checked; })
      .map(b => (b.querySelector('span') || {}).textContent || '');
    const bottone = [...document.querySelectorAll('button')]
      .map(b => (b.textContent || '').trim()).find(t => t.startsWith('Svuota il contenuto')) || '';
    return { n, nomi, bottone };
  })()`)
  const N = stato.n
  console.log(`  cliccate ${clicked} barre → ${N} selezionate ${JSON.stringify(stato.nomi)} · "${stato.bottone}"`)
  check('cliccando le barre le tabelle si selezionano', N >= 2 && stato.nomi.length === N, `${N} selezionate`)
  check('il pulsante dice quante tabelle si svuotano', stato.bottone === `Svuota il contenuto (${N})`, stato.bottone)

  // 5) SVUOTA: script generato in una NUOVA TAB
  const premuto = await page.clickWhere(
    `[...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('Svuota il contenuto'))`,
  )
  check('il pulsante "Svuota il contenuto" è attivo', premuto === true)
  await sleep(1500)
  const tab = await page.eval(`(() => {
    const re = new RegExp('DELETE contenuto \\\\(' + ${N} + ' tabell');
    return [...document.querySelectorAll('*')]
      .some(e => e.children.length === 0 && re.test((e.textContent || '').trim()));
  })()`)
  check('si apre una nuova tab con lo script', tab === true)
  const script = await page.eval(`[...document.querySelectorAll('.monaco-editor .view-lines .view-line')]
    .map(l => (l.textContent || '').replace(/\\u00a0/g, ' '))`)
  const testo = script.join('\n')
  console.log('  --- script generato ---')
  for (const r of script) console.log(`  | ${r}`)
  check('lo script dice quante tabelle sta svuotando', new RegExp(`Svuota il contenuto di ${N} tabell`).test(testo))
  check(
    'c\'è un DELETE FROM per ogni tabella selezionata',
    (testo.match(/DELETE FROM \[/g) || []).length === N,
    `${(testo.match(/DELETE FROM \[/g) || []).length} DELETE su ${N} selezionate`,
  )
  check('avvisa che i dati non si recuperano', /non si possono recuperare/.test(testo))
  await page.screenshot('report-tabelle-delete')

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-set): le DIRETTIVE SET si compilano con l'intellisense (richiesta utente:
 * "aggiungi che possa anche compilare con l'intellisense queste direttive e anche quelle
 * rimanenti — SET NOCOUNT ON / SET XACT_ABORT ON"). Si scrive in una tab e si legge il popup:
 *  1) "SET " → TUTTE le opzioni del manuale, con NOCOUNT e XACT_ABORT per prime;
 *  2) il caso segnalato: su una riga nuova SOTTO "SET NOCOUNT ON" il popup deve riaprirsi
 *     (prima restava chiuso perché la direttiva precedente sembrava uno statement aperto);
 *  3) "SET NO" → NOCOUNT filtrato;
 *  4) "SET XACT_ABORT " → ON/OFF;
 *  5) accettando il suggerimento si scrive la direttiva COMPLETA ("SET XACT_ABORT ON").
 */
async function verifySet(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Schema:')`, 60000, 'schema caricato')
  await sleep(1500)
  const rect = await editorRect(page)

  const scrivi = async sql => {
    await page.clickPoint(rect.x + 120, rect.y + 18)
    await sleep(400)
    await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
    await page.typeText(sql)
    await sleep(1800)
  }
  const vociPopup = async () =>
    await page.eval(`[...document.querySelectorAll('.suggest-widget .monaco-list-row')]
      .map(r => ((r.querySelector('.label-name') || r).textContent || '').replace(/\\u00a0/g, ' ').trim())`)
  const righeEditor = () =>
    page.eval(`[...document.querySelectorAll('.monaco-editor .view-lines .view-line')]
      .map(l => (l.textContent || '').replace(/\\u00a0/g, ' ').replace(/\\s+$/, ''))`)

  const esiti = []
  const check = (nome, ok, dettaglio) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? ` — ${dettaglio}` : ''}`)
  }
  const minuscole = v => v.map(x => x.toLowerCase())

  // 1) "SET " → tutte le opzioni, con NOCOUNT e XACT_ABORT in testa
  await scrivi('SET ')
  const vociSet = await vociPopup()
  console.log(`  dopo "SET ": ${vociSet.length} voci — ${JSON.stringify(vociSet.slice(0, 4))}`)
  check('dopo "SET " il popup si apre', vociSet.length > 0)
  check('propone SET NOCOUNT ON', vociSet.includes('SET NOCOUNT ON'))
  check('propone SET XACT_ABORT ON', vociSet.includes('SET XACT_ABORT ON'))
  check('propone SET ANSI_NULLS ON', vociSet.includes('SET ANSI_NULLS ON'))

  // 1b) le ALTRE direttive del manuale: il popup disegna solo le righe visibili, quindi si
  //     filtra scrivendo l'inizio del nome (come fa chi digita) e si controlla la voce attesa
  for (const [inizio, attesa] of [
    ['SET ANSI_D', 'SET ANSI_DEFAULTS ON'],
    ['SET CONCAT', 'SET CONCAT_NULL_YIELDS_NULL ON'],
    ['SET REM', 'SET REMOTE_PROC_TRANSACTIONS ON'],
    ['SET FORCE', 'SET FORCEPLAN ON'],
    ['SET SHOWPLAN_X', 'SET SHOWPLAN_XML ON'],
    ['SET STATISTICS X', 'SET STATISTICS XML ON'],
    ['SET TEXT', 'SET TEXTSIZE'],
    ['SET OFFS', 'SET OFFSETS ON'],
    ['SET CONTEXT', 'SET CONTEXT_INFO'],
    ['SET TRANSACTION ISOLATION', 'SET TRANSACTION ISOLATION LEVEL'],
    ['SET LOCK', 'SET LOCK_TIMEOUT'],
    ['SET QUERY_GOV', 'SET QUERY_GOVERNOR_COST_LIMIT'],
    ['SET IDENTITY_INSERT', 'SET IDENTITY_INSERT'],
  ]) {
    await scrivi(inizio)
    const voci = await vociPopup()
    check(`propone ${attesa}`, voci.includes(attesa), `scrivendo "${inizio}": ${JSON.stringify(voci.slice(0, 3))}`)
  }

  // 2) CASO SEGNALATO: la direttiva sotto un'altra direttiva SET
  await scrivi('SET NOCOUNT ON\n  SET XACT_ABORT ON\n  SET ')
  const vociDopo = await vociPopup()
  console.log(`  dopo due direttive SET: ${vociDopo.length} voci — ${JSON.stringify(vociDopo.slice(0, 3))}`)
  check('sotto "SET NOCOUNT ON" / "SET XACT_ABORT ON" il popup si riapre', vociDopo.length > 0)
  check('e propone di nuovo tutte le opzioni', vociDopo.includes('SET NOCOUNT ON') && vociDopo.includes('SET XACT_ABORT ON'))

  // 3) filtro: "SET NO" → NOCOUNT (e non le altre)
  await scrivi('SET NO')
  const vociNo = await vociPopup()
  console.log(`  dopo "SET NO": ${JSON.stringify(vociNo.slice(0, 5))}`)
  check('mentre si scrive "SET NO" propone SET NOCOUNT ON', vociNo.includes('SET NOCOUNT ON'), JSON.stringify(vociNo.slice(0, 3)))

  // 4) "SET XACT_ABORT " → ON/OFF
  await scrivi('SET XACT_ABORT ')
  const vociValori = minuscole(await vociPopup())
  console.log(`  dopo "SET XACT_ABORT ": ${JSON.stringify(vociValori.slice(0, 4))}`)
  check('dopo "SET XACT_ABORT " propone ON', vociValori.includes('on'))
  check('dopo "SET XACT_ABORT " propone OFF', vociValori.includes('off'))

  // 5) accettando "ON" la direttiva è COMPLETA e compilabile
  await page.press('Enter', { code: 'Enter', vk: 13 })
  await sleep(900)
  const riga = (await righeEditor()).map(r => r.trim()).filter(Boolean).pop() ?? ''
  console.log(`  riga dopo la conferma: ${JSON.stringify(riga)}`)
  check('accettando ON si ottiene "SET XACT_ABORT ON"', /^SET XACT_ABORT ON$/i.test(riga), riga)

  // 6) accettando il NOME dell'opzione si ottiene già la direttiva completa
  await scrivi('SET NOC')
  await sleep(1600)
  const vociNoc = await vociPopup()
  await page.press('Enter', { code: 'Enter', vk: 13 })
  await sleep(900)
  const riga2 = (await righeEditor()).map(r => r.trim()).filter(Boolean).pop() ?? ''
  console.log(`  dopo "SET NOC" → ${JSON.stringify(vociNoc.slice(0, 2))} → ${JSON.stringify(riga2)}`)
  check('accettando l opzione si ottiene "SET NOCOUNT ON"', /^SET NOCOUNT ON$/i.test(riga2), riga2)

  await page.screenshot('direttive-set-intellisense')

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-create): lo script CREATE di una tabella deve essere IDENTICO a quello che
 * scrive SSMS (richiesta utente: "questo è lo script corretto preso da ssms… fallo identico a
 * SSMS"). Si passa dal menu contestuale del pannello Oggetti ("Script tabella" → "CREATE") e si
 * confronta RIGA PER RIGA con quello che ci si aspetta dai metadati VERI di dbo.TABELLA_CREATE:
 *
 *   banner "Object:  Table [dbo].[x]" + SET ANSI_NULLS / SET QUOTED_IDENTIFIER + GO, senza righe vuote
 *   CREATE TABLE [dbo].[x](        identificatori SEMPRE fra parentesi quadre
 *       [col] [tipo](n) NOT NULL,  colonne indentate, NULL/NOT NULL espliciti
 *    CONSTRAINT [PK_x] PRIMARY KEY NONCLUSTERED … colonne a capo con ASC
 *   )WITH (…opzioni… FILLFACTOR = 90) ON [filegroup]   la coda sta ATTACCATA alla parentesi
 *   ) ON [filegroup]               la tabella va sul filegroup di origine
 *   ) ON [filegroup] TEXTIMAGE_ON [filegroup]   se la tabella ha colonne text/image/(max)
 *   … [col] ASC / [col] DESC       l'ordine della chiave è quello del database di origine
 *   ALTER TABLE … ADD  CONSTRAINT [DF_…]  DEFAULT (…) FOR [col]
 *   ALTER TABLE …  WITH CHECK ADD  CONSTRAINT [CK_…] CHECK  (…)
 *   ALTER TABLE … CHECK CONSTRAINT [CK_…]
 *   EXEC sys.sp_addextendedproperty @name=N'…', @value=N'…' , @level0type=N'SCHEMA',@level0name=N'dbo', …
 *   -- Trigger <nome> + corpo del trigger preso dal database
 */
async function verifyCreate(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Tabelle')`, 60000, 'schema caricato')
  await sleep(2000)

  const esiti = []
  const check = (nome, ok, dettaglio) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? ` — ${dettaglio}` : ''}`)
  }

  // il pannello Oggetti può essere chiuso: nel caso lo si riapre dalla barra dei pannelli
  const campo = `document.querySelector('input[placeholder^="Cerca (spazio"]')`
  if (!(await page.eval(`!!${campo}`))) {
    await page.clickWhere(
      `[...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '+ Oggetti')`,
    )
    await sleep(1500)
  }
  if (!(await page.eval(`!!${campo}`))) {
    throw new Error('pannello Oggetti non disponibile: app non caricata o schema non pronto')
  }

  // 1) si cerca la tabella nell'elenco Oggetti
  /**
   * Apre lo script CREATE di una tabella dal menu contestuale del pannello Oggetti
   * ("Script tabella" → "CREATE") e aspetta che nella tab compaia la CREATE TABLE.
   */
  const apriCreate = async nome => {
    await page.eval(`(() => {
      const i = ${campo};
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, ${JSON.stringify(nome)});
      i.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    const trovata = await page.waitFor(
      `[...document.querySelectorAll('span')].some(s => s.children.length === 0 && (s.textContent || '').trim() === ${JSON.stringify(nome)})`,
      15000,
      'risultato della ricerca in Oggetti',
    )
    await sleep(600)

    // 2) tasto destro sul nome → menu contestuale (è React: basta l'evento che risale)
    await page.eval(`(() => {
      const s = [...document.querySelectorAll('span')]
        .find(s => s.children.length === 0 && (s.textContent || '').trim() === ${JSON.stringify(nome)});
      if (s) s.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }));
    })()`)
    const menu = await page.waitFor(`document.body.textContent.includes('Script tabella')`, 8000, 'menu contestuale')
    await sleep(400)

    // 3) "Script tabella" apre il SOTTOMENU al passaggio del mouse: si manda un mouseover vero
    const voce = await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Script tabella');
      if (!b) return null;
      b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`)
    if (voce) {
      await page.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(voce.x),
        y: Math.round(voce.y),
        buttons: 0,
      })
      await sleep(800)
    }

    // 4) "CREATE" nel sottomenu → lo script si apre in una tab
    const creato = await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'CREATE');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`)
    if (creato) await page.clickPoint(creato.x, creato.y)
    const aperto = await page.waitFor(
      // Monaco rende gli spazi come spazio unificatore: si normalizza prima di cercare
      `[...document.querySelectorAll('.monaco-editor .view-lines .view-line')]
         .some(l => (l.textContent || '').replace(/\\u00a0/g, ' ')
           .includes('CREATE TABLE [dbo].[' + ${JSON.stringify(nome)} + ']'))`,
      20000,
      `script CREATE di ${nome} nella tab`,
    )
    await sleep(1500)
    return { trovata, menu, voce: !!voce, creato: !!creato, aperto }
  }

  const prima = await apriCreate(TABELLA_CREATE)
  check('la tabella compare nell elenco Oggetti', prima.trovata)
  check('il tasto destro apre il menu dell oggetto', prima.menu)
  check('il menu offre "Script tabella"', prima.voce)
  check('il sottomenu offre "CREATE"', prima.creato)
  check('lo script CREATE si apre in una tab', prima.aperto)

  /** Righe disegnate da Monaco nell'editor attivo, dall'alto in basso. */
  const leggiRighe = () =>
    page.eval(`(() => {
      const eds = [...document.querySelectorAll('.monaco-editor')].filter(e => {
        const r = e.getBoundingClientRect();
        return r.height > 0 && r.width > 0;
      });
      const ed = eds[eds.length - 1];
      if (!ed) return [];
      return [...ed.querySelectorAll('.view-lines .view-line')]
        .map(l => ({ top: parseFloat(l.style.top) || 0, testo: (l.textContent || '').replace(/\\u00a0/g, ' ') }))
        .sort((a, b) => a.top - b.top)
        .map(l => ({ i: /^[ \\t]/.test(l.testo), t: l.testo.trim() }));
    })()`)

  // 5) si leggono le righe disegnate da Monaco (finestra alta apposta per --verify-create).
  //    L'indentazione nel DOM è resa come spazio unificatore: si tiene solo "indentata sì/no".
  const righe = await leggiRighe()

  const atteso = [
    { i: false, t: `USE [${DB_CREATE}]` },
    { i: false, t: 'GO' },
    { i: false, t: `/****** Object:  Table [dbo].[${TABELLA_CREATE}] ******/` },
    { i: false, t: 'SET ANSI_NULLS ON' },
    { i: false, t: 'GO' },
    { i: false, t: 'SET QUOTED_IDENTIFIER ON' },
    { i: false, t: 'GO' },
    { i: false, t: `CREATE TABLE [dbo].[${TABELLA_CREATE}](` },
    { i: true, t: '[CME_CLASSE_MERC] [nvarchar](20) NOT NULL,' },
    { i: true, t: '[CME_DES] [nvarchar](50) NOT NULL,' },
    { i: true, t: `CONSTRAINT [PK_${TABELLA_CREATE}] PRIMARY KEY NONCLUSTERED` },
    { i: false, t: '(' },
    { i: true, t: '[CME_CLASSE_MERC] ASC' },
    { i: false, t: `)WITH (${OPZIONI_CREATE}) ON [SECONDARY],` },
    { i: true, t: `CONSTRAINT [IX_${TABELLA_CREATE}_DES] UNIQUE NONCLUSTERED` },
    { i: false, t: '(' },
    { i: true, t: '[CME_DES] ASC' },
    { i: false, t: `)WITH (${OPZIONI_CREATE}) ON [SECONDARY]` },
    { i: false, t: ') ON [SECONDARY]' },
    { i: false, t: 'GO' },
    {
      i: false,
      t: `ALTER TABLE [dbo].[${TABELLA_CREATE}] ADD  CONSTRAINT [DF_DAT_CATEGORIE_MERC_CME_DES]  DEFAULT ('') FOR [CME_DES]`,
    },
    { i: false, t: 'GO' },
    {
      i: false,
      t: `ALTER TABLE [dbo].[${TABELLA_CREATE}]  WITH CHECK ADD  CONSTRAINT [CK_${TABELLA_CREATE}_DES] CHECK  (([CME_DES]<>''))`,
    },
    { i: false, t: 'GO' },
    { i: false, t: `ALTER TABLE [dbo].[${TABELLA_CREATE}] CHECK CONSTRAINT [CK_${TABELLA_CREATE}_DES]` },
    { i: false, t: 'GO' },
  ]

  console.log('  --- script generato ---')
  for (const r of righe) console.log(`  | ${r.i ? '\\t' : ''}${r.t}`)
  console.log('  -----------------------')

  const testa = righe.slice(0, atteso.length)
  const diversa = testa.findIndex((r, k) => r.i !== atteso[k].i || r.t !== atteso[k].t)
  check(
    'lo script è identico a quello di SSMS (intestazione, colonne, chiavi, DEFAULT, CHECK)',
    diversa === -1 && righe.length >= atteso.length,
    diversa === -1
      ? `righe confrontate: ${atteso.length}`
      : `riga ${diversa + 1}: atteso ${JSON.stringify(atteso[diversa])} — trovato ${JSON.stringify(testa[diversa] ?? null)}`,
  )
  check(
    'nessun punto e virgola: il CREATE TABLE di SSMS non lo mette',
    !righe.some(r => r.t === ');'),
    righe.filter(r => r.t === ');').length ? 'trovato ");"' : 'ok',
  )

  // 6) le PROPRIETÀ ESTESE, una riga per proprietà, come le scrive SSMS
  const apici = s => `N'${s.replace(/'/g, "''")}'`
  const prop = (nome, valore, col) =>
    `EXEC sys.sp_addextendedproperty @name=${apici(nome)}, @value=${apici(valore)} , ` +
    `@level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=${apici(TABELLA_CREATE)}` +
    (col ? `, @level2type=N'COLUMN',@level2name=${apici(col)}` : '')
  const propAttese = [
    prop('MS_Description', 'Table of goods classes (E.g: mechanics, textiles, ...)'),
    prop('Description', 'Codice classe merceologica', 'CME_CLASSE_MERC'),
    prop('MS_Description', 'Goods class code', 'CME_CLASSE_MERC'),
    prop('Description', 'Descrizione', 'CME_DES'),
    prop('MS_Description', 'Description', 'CME_DES'),
  ].sort()
  const propTrovate = righe.filter(r => r.t.startsWith('EXEC sys.sp_addextendedproperty')).map(r => r.t).sort()
  const propMancanti = propAttese.filter(p => !propTrovate.includes(p))
  check(
    'le proprietà estese sono scritte come SSMS (una riga, @level0name=N\'dbo\')',
    propMancanti.length === 0 && propTrovate.length === propAttese.length,
    propMancanti.length ? `mancanti: ${JSON.stringify(propMancanti[0])}` : `${propTrovate.length} proprietà`,
  )

  // 7) il trigger resta in coda, con il CORPO preso dal database di origine
  const iTrigger = righe.findIndex(r => r.t === '-- Trigger tr_DAT_CLASSI_MERC')
  check('il trigger è in coda allo script', iTrigger > 0, iTrigger > 0 ? `riga ${iTrigger + 1}` : 'non trovato')
  const corpo = iTrigger > 0 ? righe.slice(iTrigger + 1).filter(r => r.t) : []
  check(
    'il corpo del trigger è quello del database (CREATE TRIGGER … AS …)',
    corpo.length > 3 && /^CREATE TRIGGER/.test(corpo[0].t) && corpo.some(r => r.t === 'AS'),
    corpo.length ? `prima riga: ${corpo[0].t.slice(0, 70)}…` : 'nessun corpo',
  )
  // 8) la CODA dello script: Ctrl+End porta in fondo, così si controlla anche la fine del trigger
  const rectEdit = await editorRect(page)
  await page.clickPoint(rectEdit.x + 200, rectEdit.y + 40)
  await sleep(300)
  await page.press('End', { code: 'End', vk: 35, modifiers: 2 })
  await sleep(900)
  const coda = await leggiRighe()
  const codaPiena = coda.filter(r => r.t)
  check(
    'anche la CODA dello script è quella giusta (ultima riga = GO del trigger)',
    codaPiena.length > 2 && codaPiena[codaPiena.length - 1].t === 'GO',
    `coda: ${JSON.stringify(codaPiena.slice(-3).map(r => r.t))}`,
  )

  // 9) una tabella SENZA dati LOB non deve avere TEXTIMAGE_ON nella coda
  check(
    'la tabella senza colonne LOB non ha TEXTIMAGE_ON',
    !righe.some(r => r.t.includes('TEXTIMAGE_ON')),
    righe.filter(r => r.t.includes('TEXTIMAGE_ON')).length ? 'trovato TEXTIMAGE_ON' : 'ok',
  )

  // 10) SECONDA tabella, con colonne LOB: la coda deve portare TEXTIMAGE_ON [filegroup]
  console.log(`\n  --- seconda tabella, con dati LOB: ${TABELLA_CREATE_LOB} ---`)
  const lob = await apriCreate(TABELLA_CREATE_LOB)
  check(`lo script di ${TABELLA_CREATE_LOB} si apre in una tab`, lob.aperto)
  const righeLob = await leggiRighe()
  const attesaLob = [
    { i: true, t: '[ULX_TIPOLINGUA] [nvarchar](5) NOT NULL,' },
    { i: true, t: '[ULX_XML] [varbinary](max) NOT NULL,' },
    { i: true, t: `CONSTRAINT [PK_${TABELLA_CREATE_LOB}] PRIMARY KEY CLUSTERED` },
    { i: false, t: `)WITH (${OPZIONI_CREATE}) ON [SECONDARY]` },
    { i: false, t: ') ON [SECONDARY] TEXTIMAGE_ON [SECONDARY]' },
  ]
  const lobMancanti = attesaLob.filter(a => !righeLob.some(r => r.i === a.i && r.t === a.t))
  console.log(`  --- script di ${TABELLA_CREATE_LOB} ---`)
  for (const r of righeLob) console.log(`  | ${r.i ? '\\t' : ''}${r.t}`)
  check(
    'con le colonne LOB la coda è ") ON [filegroup] TEXTIMAGE_ON [filegroup]", come SSMS',
    lobMancanti.length === 0,
    lobMancanti.length ? `mancante: ${JSON.stringify(lobMancanti[0])}` : `${attesaLob.length} righe confrontate`,
  )

  // lo script ricostruito si salva accanto agli screenshot, per poterlo rileggere con calma
  const fileSql = join(OUT_DIR, `script-create-${TABELLA_CREATE}.sql`)
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(
    fileSql,
    `-- Script CREATE generato dall'app per dbo.${TABELLA_CREATE} (letto dalla tab, indentazione resa con tab)\n` +
      righe.map(r => `${r.i ? '\t' : ''}${r.t}`).join('\n') +
      '\n',
  )
  writeFileSync(
    join(OUT_DIR, `script-create-${TABELLA_CREATE}-coda.sql`),
    `-- CODA dello script (Ctrl+End, finestra che non basta a mostrarlo tutto)\n` +
      coda.map(r => `${r.i ? '\t' : ''}${r.t}`).join('\n') +
      '\n',
  )
  writeFileSync(
    join(OUT_DIR, `script-create-${TABELLA_CREATE_LOB}.sql`),
    `-- Script CREATE generato dall'app per dbo.${TABELLA_CREATE_LOB} (tabella con dati LOB)\n` +
      righeLob.map(r => `${r.i ? '\t' : ''}${r.t}`).join('\n') +
      '\n',
  )
  console.log(`  salvato docs/screenshots/script-create-${TABELLA_CREATE}.sql`)
  await page.screenshot('script-create-tabella')

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-changes): la finestra "Modifiche agli oggetti" (richiesta utente: "una
 * finestra dove vedo la lista delle cose modificate e quando, tipo una griglia con la store x il
 * giorno ora"). Controlla che la griglia arrivi dai dati VERI del database: date con giorno e ora,
 * ordinamento per colonna, filtri per nome, per tipo e per periodo.
 */
async function verifyChanges(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Report utilizzo tabelle')`, 40000, 'sidebar pronta')
  await sleep(1500)

  const esiti = []
  const check = (nome, ok, dettaglio) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? ` — ${dettaglio}` : ''}`)
  }

  /** Righe della griglia: data (gg/mm/aaaa hh:mm), nome, tipo e "quando". */
  const righe = () =>
    page.eval(`[...document.querySelectorAll('[data-modifiche="riga"]')].map(tr => {
      const celle = tr.querySelectorAll('td');
      return {
        data: (celle[0] ? celle[0].textContent : '').trim(),
        nome: (celle[1] ? celle[1].textContent : '').trim(),
        tipo: (celle[2] ? celle[2].textContent : '').trim(),
        quando: (celle[5] ? celle[5].textContent : '').trim(),
      };
    })`)

  const apri = await page.clickWhere(`document.querySelector('[data-modifiche="apri"]')`)
  if (!apri) throw new Error('pulsante "Modifiche agli oggetti" non trovato nella sidebar')
  await page.waitFor(`document.querySelector('[data-modifiche="finestra"]')`, 10000, 'finestra Modifiche')
  await page.waitFor(`document.querySelectorAll('[data-modifiche="riga"]').length > 0`, 45000, 'righe della griglia')
  await sleep(500)

  const tutte = await righe()
  console.log(`  riepilogo: ${JSON.stringify(await page.eval(`(document.querySelector('[data-modifiche="riepilogo"]') || {}).textContent`))}`)
  console.log(`  prime righe: ${JSON.stringify(tutte.slice(0, 3))}`)
  check('la griglia mostra gli oggetti del database', tutte.length > 10, `${tutte.length} righe`)

  const formatoOk = tutte.slice(0, 20).every(r => /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(r.data))
  check('ogni riga ha giorno E ora (gg/mm/aaaa hh:mm)', formatoOk, JSON.stringify(tutte[0]?.data))
  check(
    'c\'è la colonna "quando" in italiano (ora / N minuti fa / …)',
    tutte.slice(0, 5).every(r => /ora$|fa$|^il \d{2}\/\d{2}\/\d{4}$/.test(r.quando)),
    JSON.stringify(tutte.slice(0, 3).map(r => r.quando)),
  )

  // 1) ordinamento di partenza: dalla modifica più recente
  const date = tutte.map(r => {
    const [d, o] = r.data.split(' ')
    const [gg, mm, aaaa] = d.split('/')
    return `${aaaa}${mm}${gg}${o.replace(':', '')}`
  })
  const decrescente = date.every((v, i) => i === 0 || date[i - 1] >= v)
  check('all\'apertura è ordinato dalla modifica più recente', decrescente, `${date[0]} → ${date[date.length - 1]}`)

  // 2) ordinamento per nome (clic sull'intestazione)
  await page.clickWhere(`document.querySelector('[data-modifiche="col-name"]')`)
  await sleep(600)
  const perNome = (await righe()).slice(0, 30).map(r => r.nome.toLowerCase())
  const nomeCrescente = perNome.every((v, i) => i === 0 || perNome[i - 1].localeCompare(v) <= 0)
  check('cliccando "Oggetto" la griglia si ordina per nome', nomeCrescente, `${perNome[0]} → ${perNome[perNome.length - 1]}`)

  // 3) filtro per nome (si scrive nel campo col focus, come si farebbe a mano)
  const prova = tutte[0].nome.split('.').pop().slice(0, 6)
  await page.eval(`(() => {
    const i = document.querySelector('[data-modifiche="filtro"]');
    i.focus();
    return true;
  })()`)
  await page.typeText(prova)
  await sleep(800)
  const scritto = await page.eval(`document.querySelector('[data-modifiche="filtro"]').value`)
  const filtrate = await righe()
  console.log(`  filtro "${scritto}": ${filtrate.length} righe`)
  check(
    'il filtro per nome restringe la griglia',
    scritto.toLowerCase() === prova.toLowerCase() &&
      filtrate.length > 0 &&
      filtrate.length < tutte.length &&
      filtrate.every(r => r.nome.toLowerCase().includes(prova.toLowerCase())),
    `${filtrate.length} di ${tutte.length}`,
  )

  // 4) filtro per tipo: solo store
  await page.eval(`(() => {
    const i = document.querySelector('[data-modifiche="filtro"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, '');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(400)
  await page.clickWhere(`document.querySelector('[data-modifiche="tipo-procedura"]')`)
  await sleep(800)
  const soleStore = await righe()
  console.log(`  filtro "Store": ${soleStore.length} righe`)
  check(
    'il filtro per tipo mostra solo le store',
    soleStore.length > 0 && soleStore.every(r => r.tipo === 'procedura'),
    `${soleStore.length} store`,
  )

  // 5) filtro per periodo: "Ultime 24 ore" è una FINESTRA SCORREVOLE (adesso − 24h), quindi
  //    comprende anche la sera di ieri: non si controlla il giorno, ma che nessuna riga esca
  //    dalla finestra (il controllo "solo le date di oggi" falliva di sera/sera-Notte).
  await page.eval(`(() => {
    const s = document.querySelector('[data-modifiche="periodo"]');
    s.value = '1';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  await sleep(800)
  const oggi = await righe()
  const adesso = new Date()
  const limite = adesso.getTime() - 24 * 3600 * 1000
  const quando = s => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(s)
    return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5])).getTime() : NaN
  }
  const fuoriFinestra = oggi.filter(r => !(quando(r.data) >= limite - 60000))
  console.log(`  ultime 24 ore: ${oggi.length} store — ${JSON.stringify(oggi.slice(0, 3).map(r => r.nome))}`)
  check(
    'il filtro "ultime 24 ore" tiene solo le modifiche dentro la finestra',
    oggi.length > 0 && fuoriFinestra.length === 0,
    fuoriFinestra.length ? `fuori finestra: ${JSON.stringify(fuoriFinestra.slice(0, 2).map(r => r.data))}` : `${oggi.length} righe dentro le 24 ore`,
  )
  await page.screenshot('modifiche-oggetti')

  // 6) la finestra si chiude con Esc
  await page.press('Escape', { code: 'Escape', vk: 27 })
  await sleep(500)
  const chiusa = await page.eval(`!document.querySelector('[data-modifiche="finestra"]')`)
  check('Esc chiude la finestra', chiusa === true)

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-sidebar): nel pannello Oggetti la ricerca resta FISSA in alto e scorre solo
 * l'elenco sotto (richiesta utente: "mi lasci la ricerca fissa in alto e non la far scorrere").
 */
async function verifySidebar(page) {
  await accediApp(page, `document.body.textContent.includes('Tabelle')`)
  await sleep(2000)

  const esiti = []
  const check = (nome, ok, dettaglio) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? ` — ${dettaglio}` : ''}`)
  }

  // il pannello Oggetti può essere chiuso: nel caso lo si riapre dalla barra dei pannelli
  const campo = `document.querySelector('input[placeholder^="Cerca (spazio"]')`
  if (!(await page.eval(`!!${campo}`))) {
    await page.clickWhere(
      `[...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '+ Oggetti')`,
    )
    await sleep(900)
  }

  /**
   * Geometria del pannello: il campo di ricerca deve stare in un blocco `shrink-0` FUORI
   * dall'area che scorre, il corpo del pannello non deve scorrere e l'elenco sotto sì.
   */
  const misure = () =>
    page.eval(`(() => {
      const i = ${campo};
      if (!i) return null;
      const blocco = i.closest('div.shrink-0') || i.parentElement;
      const corpo = blocco && blocco.parentElement;
      const lista = corpo ? [...corpo.children].find(c => c !== blocco) : null;
      const r = i.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        corpoFlex: corpo ? getComputedStyle(corpo).display : '',
        corpoScorre: corpo ? getComputedStyle(corpo).overflowY : '',
        listaScorre: lista ? getComputedStyle(lista).overflowY : '',
        listaScrollTop: lista ? Math.round(lista.scrollTop) : -1,
      };
    })()`)

  const prima = await misure()
  console.log(`  ricerca Oggetti: ${JSON.stringify(prima)}`)
  check('il campo di ricerca degli Oggetti si vede', !!prima)
  check(
    "il corpo del pannello non scorre (scorre solo l'elenco)",
    prima?.corpoFlex === 'flex' && prima?.corpoScorre === 'hidden',
    JSON.stringify(prima),
  )
  check(
    "l'elenco sotto ha la sua barra di scorrimento",
    prima?.listaScorre === 'auto',
    JSON.stringify(prima),
  )

  // si scorre l'elenco: il campo di ricerca NON si deve muovere
  const scrollato = await page.eval(`(() => {
    const i = ${campo};
    const blocco = i.closest('div.shrink-0') || i.parentElement;
    const lista = [...blocco.parentElement.children].find(c => c !== blocco);
    if (!lista || lista.scrollHeight <= lista.clientHeight) return -1;
    lista.scrollTop = 300;
    return Math.round(lista.scrollTop);
  })()`)
  await sleep(600)
  const dopo = await misure()
  console.log(`  dopo lo scroll (scrollTop ${scrollato}): top ricerca ${dopo?.top}`)
  check("scorrendo l'elenco la ricerca resta ferma in alto", scrollato > 0 && dopo?.top === prima?.top)
  await page.screenshot('ricerca-oggetti-fissa')

  // e resta ferma anche con i risultati di ricerca aperti (elenco più lungo)
  await page.clickWhere(campo)
  await page.typeText('ws_')
  await sleep(2500)
  const conRisultati = await misure()
  await page.eval(`(() => {
    const i = ${campo};
    const blocco = i.closest('div.shrink-0') || i.parentElement;
    const lista = [...blocco.parentElement.children].find(c => c !== blocco);
    if (lista) lista.scrollTop = 250;
  })()`)
  await sleep(600)
  const conRisultatiDopo = await misure()
  console.log(`  con i risultati: ${JSON.stringify(conRisultatiDopo)}`)
  check(
    'con i risultati di ricerca la ricerca resta ferma in alto',
    conRisultatiDopo?.top === prima?.top && conRisultatiDopo?.listaScrollTop > 0,
    `top=${conRisultatiDopo?.top} scrollTop=${conRisultatiDopo?.listaScrollTop}`,
  )

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-search): la RICERCA GENERALE nel database (stile Redgate SQL Search) cerca un
 * testo nei nomi/definizioni delle strutture e, se richiesto, nei DATI; i risultati stanno sopra e
 * l'anteprima (script con il match evidenziato) sotto. Deve restare dentro il database attivo.
 */
async function verifySearch(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Schema:')`, 40000, 'schema caricato')
  await sleep(1500)

  const esiti = []
  const check = (nome, ok) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}`)
  }
  const testo = sel => page.eval(`(document.querySelector(${JSON.stringify(sel)})?.textContent || '').trim()`)

  /** La ricerca vive in una TAB: aprendo un oggetto si cambia tab, quindi si torna qui
   *  cliccando il TITOLO della tab (non il centro, che può cadere su un altro pulsante). */
  const tornaAllaRicerca = async () => {
    const ok = await page.clickWhere(
      `(() => { const t = [...document.querySelectorAll('.sql-tab')].find(x => (x.textContent || '').includes('Ricerca')); return t ? t.querySelector('button') : null; })()`,
    )
    await sleep(900)
    const attiva = await page.eval(`!!document.querySelector('[data-ricerca="pannello"]')`)
    console.log(`  ritorno alla tab di ricerca: ${ok} · pannello visibile: ${attiva}`)
    return ok && attiva
  }

  const dbAttivo = await page.eval(`document.querySelector('select')?.value || ''`)
  const tabsPrimaDellaRicerca = await page.eval(`document.querySelectorAll('.sql-tab').length`)
  const aperto = await page.clickWhere(
    `[...document.querySelectorAll('button')].find(b => (b.getAttribute('title') || '').includes('Ricerca testuale nel database'))`,
  )
  await sleep(900)
  const pannello = await page.eval(`!!document.querySelector('[data-ricerca="meta"]')`)
  const statoRicerca = await page.eval(`(() => {
    const m = document.querySelector('[data-ricerca="meta"]');
    const contenitore = m ? m.closest('[data-ricerca="pannello"]') : null;
    const tabRicerca = [...document.querySelectorAll('.sql-tab')].find(t => (t.textContent || '').includes('Ricerca'));
    return {
      testo: contenitore ? (contenitore.textContent || '') : '',
      inModale: !!(contenitore && contenitore.closest('.fixed')),
      tabRicerca: tabRicerca ? (tabRicerca.textContent || '').trim() : null,
      attiva: tabRicerca ? tabRicerca.className.includes('border-b-zinc-900') : false,
    };
  })()`)
  console.log(
    `  database attivo: ${dbAttivo} — pannello: ${pannello} — tab di ricerca: ${JSON.stringify(statoRicerca.tabRicerca)}`,
  )
  check('il pannello di ricerca si apre', aperto === true && pannello === true)
  check('la ricerca si apre in una TAB e non in una finestra', statoRicerca.inModale === false && !!statoRicerca.tabRicerca)
  check('la tab della ricerca è quella attiva', statoRicerca.attiva === true)
  check(
    'la tab di ricerca NON viene duplicata riaprendola',
    (await page.clickWhere(
      `[...document.querySelectorAll('button')].find(b => (b.getAttribute('title') || '').includes('Ricerca testuale nel database'))`,
    )) === true &&
      (await sleep(600), (await page.eval(`document.querySelectorAll('.sql-tab').length`)) === tabsPrimaDellaRicerca + 1),
  )
  check('il pannello è ristretto al database attivo', dbAttivo.length > 0 && statoRicerca.testo.includes(dbAttivo))

  // cerca un nome di colonna che esiste davvero (usato dallo schema del database attivo)
  await page.eval(`(() => {
    const i = [...document.querySelectorAll('input')].find(x => (x.placeholder || '').includes('Testo da cercare'));
    if (i) i.focus();
    return !!i;
  })()`)
  await page.typeText('UDC_UDC')
  await page.clickWhere(`document.querySelector('[data-ricerca="cerca"]')`)
  await sleep(3500)

  const righe = await page.eval(`document.querySelectorAll('[data-ricerca="riga"]').length`)
  const meta = await testo('[data-ricerca="meta"]')
  const evidenziati = await page.eval(`document.querySelectorAll('[data-ricerca="anteprima"] mark').length`)
  const titoli = await page.eval(
    `[...document.querySelectorAll('[data-ricerca="riga"]')].slice(0, 4).map(r => (r.textContent || '').trim().slice(0, 60))`,
  )
  console.log(`  risultati: ${righe} · riepilogo: "${meta}" · evidenziati nell anteprima: ${evidenziati}`)
  console.log(`  primi risultati: ${JSON.stringify(titoli)}`)
  check('la ricerca trova qualcosa nelle strutture', righe > 0)
  check('il riepilogo dice risultati e tempo', /\d+ risultati? · \d+ ms/.test(meta))

  // anteprima di uno SCRIPT: si sceglie un risultato su una stored procedure e si guarda lo
  // script con i numeri di riga, il match evidenziato e la riga trovata in risalto
  await page.clickWhere(
    `[...document.querySelectorAll('[data-ricerca="riga"]')].find(r => (r.textContent || '').includes('Stored procedure'))`,
  )
  await sleep(2500)
  const anteprima = await page.eval(`(() => {
    const p = document.querySelector('[data-ricerca="anteprima"]');
    if (!p) return null;
    const righeScript = [...p.querySelectorAll('[data-riga]')];
    return {
      righeScript: righeScript.length,
      evidenziati: p.querySelectorAll('mark').length,
      rigaInRisalto: righeScript.some(r => (r.className || '').includes('bg-amber')),
      modifica: !!p.querySelector('[data-ricerca="modifica"]'),
      // "Apri definizione" è stato tolto: era lo stesso comando di "Modifica"
      definizione: !!p.querySelector('[data-ricerca="definizione"]'),
      diagramma: !!p.querySelector('[data-ricerca="diagramma"]'),
      // SINTASSI A COLORI: il coloratore di Monaco produce span con classi mtk*
      colorate: p.querySelectorAll('[data-sintassi="colorata"]').length,
      token: p.querySelectorAll('[data-sintassi="colorata"] [class*="mtk"]').length,
      colori: new Set([...p.querySelectorAll('[data-sintassi="colorata"] [class*="mtk"]')]
        .map(s => getComputedStyle(s).color)).size,
    };
  })()`)
  console.log(`  anteprima dello script: ${JSON.stringify(anteprima)}`)
  check('l anteprima mostra lo script completo dell oggetto', (anteprima?.righeScript ?? 0) > 5)
  check('il match è evidenziato nello script', (anteprima?.evidenziati ?? 0) > 0)
  check('la riga trovata è messa in risalto', anteprima?.rigaInRisalto === true)
  check(
    'l anteprima ha la SINTASSI A COLORI (come una tab: parole chiave, stringhe, commenti)',
    (anteprima?.token ?? 0) > 0 && (anteprima?.colori ?? 0) >= 3,
    `${anteprima?.token} token colorati, ${anteprima?.colori} colori diversi`,
  )
  // SPAZIATURA: le righe dell'anteprima devono stare a ~20px, non a 40+ (i blocchi del
  // coloratore, se non resi inline, allargavano la riga)
  const passo = await page.eval(`(() => {
    const righe = [...document.querySelectorAll('[data-ricerca="anteprima"] [data-riga]')].slice(0, 3);
    if (righe.length < 2) return null;
    const a = righe[0].getBoundingClientRect().top;
    const b = righe[1].getBoundingClientRect().top;
    return Math.round(b - a);
  })()`)
  console.log(`  passo fra le righe dell anteprima: ${passo}px`)
  check('le righe dell anteprima NON hanno spaziatura enorme', passo !== null && passo > 0 && passo < 30, `${passo}px`)
  check('dalla ricerca si può MODIFICARE (pulsante Modifica)', anteprima?.modifica === true)
  check(
    'NON c è più "Apri definizione" (era lo stesso comando di Modifica) e resta il diagramma chiamate',
    anteprima?.definizione === false && anteprima?.diagramma === true,
    `definizione=${anteprima?.definizione} diagramma=${anteprima?.diagramma}`,
  )

  // MODIFICA dall'anteprima: si apre CREATE OR ALTER in una tab FIGLIA di quella attiva
  const tabsPrima = await page.eval(`document.querySelectorAll('.sql-tab').length`)
  await page.clickWhere(`document.querySelector('[data-ricerca="modifica"]')`)
  await sleep(2200)
  const tabModifica = await page.eval(`(() => {
    const t = [...document.querySelectorAll('.sql-tab')].pop();
    return t ? {
      titolo: ((t.querySelector('button') || t).textContent || '').trim(),
      rientro: Math.round(parseFloat(getComputedStyle(t).marginLeft) || 0),
      figlia: !!t.querySelector('svg.lucide-corner-down-right'),
    } : null;
  })()`)
  const tabsDopo = await page.eval(`document.querySelectorAll('.sql-tab').length`)
  console.log(`  dopo "Modifica": ${JSON.stringify(tabModifica)} (tab: ${tabsPrima} → ${tabsDopo})`)
  check('"Modifica" apre una tab in più', tabsDopo === tabsPrima + 1)
  check(
    'la tab aperta porta il NOME dell oggetto (non "CREATE OR ALTER …")',
    !/CREATE OR ALTER/i.test(tabModifica?.titolo ?? '') && /ws_/i.test(tabModifica?.titolo ?? ''),
  )
  check('la tab di modifica nasce FIGLIA (gerarchia)', tabModifica?.rientro === 12 && tabModifica?.figlia === true)

  // TASTO DESTRO su un risultato: menu con "Modifica"
  await tornaAllaRicerca()
  const puntoRiga = await page.eval(`(() => {
    const r = [...document.querySelectorAll('[data-ricerca="riga"]')].find(x => (x.textContent || '').includes('Stored procedure'));
    if (!r) return null;
    const b = r.getBoundingClientRect();
    return { x: b.left + 40, y: b.top + b.height / 2 };
  })()`)
  if (puntoRiga) {
    await page.clickPoint(puntoRiga.x, puntoRiga.y, 'right')
    await sleep(600)
  }
  const menuMostrato = await page.eval(`!!document.querySelector('[data-ricerca="menu-modifica"]')`)
  const tabsPrimaMenu = await page.eval(`document.querySelectorAll('.sql-tab').length`)
  if (menuMostrato) {
    await page.clickWhere(`document.querySelector('[data-ricerca="menu-modifica"]')`)
    await sleep(2200)
  }
  const tabsDopoMenu = await page.eval(`document.querySelectorAll('.sql-tab').length`)
  const titoloMenu = await page.eval(
    `(() => { const t = [...document.querySelectorAll('.sql-tab')].pop(); return t ? ((t.querySelector('button') || t).textContent || '').trim() : ''; })()`,
  )
  console.log(`  tasto destro sul risultato: menu=${menuMostrato} → "${titoloMenu}" (tab: ${tabsPrimaMenu} → ${tabsDopoMenu})`)
  check('il tasto destro su un risultato mostra "Modifica"', menuMostrato === true)
  check(
    '"Modifica" dal menu apre l oggetto in una tab col suo nome',
    tabsDopoMenu === tabsPrimaMenu + 1 && !/CREATE OR ALTER/i.test(titoloMenu) && /ws_/i.test(titoloMenu),
  )

  // anche una FUNZIONE si modifica dalla ricerca
  await tornaAllaRicerca()
  const sceltaFunzione = await page.clickWhere(
    `[...document.querySelectorAll('[data-ricerca="riga"]')].find(r => (r.textContent || '').includes('Funzione'))`,
  )
  await sleep(2500)
  const tabsPrimaFn = await page.eval(`document.querySelectorAll('.sql-tab').length`)
  const modificaFn = await page.eval(`!!document.querySelector('[data-ricerca="modifica"]')`)
  let titoloFn = ''
  if (modificaFn) {
    await page.clickWhere(`document.querySelector('[data-ricerca="modifica"]')`)
    await sleep(2500)
    titoloFn = await page.eval(
      `(() => { const t = [...document.querySelectorAll('.sql-tab')].pop(); return t ? ((t.querySelector('button') || t).textContent || '').trim() : ''; })()`,
    )
  }
  const tabsDopoFn = await page.eval(`document.querySelectorAll('.sql-tab').length`)
  console.log(`  funzione scelta: ${sceltaFunzione === true} · modifica: ${modificaFn} → "${titoloFn}" (tab: ${tabsPrimaFn} → ${tabsDopoFn})`)
  check('una FUNZIONE trovata si può modificare (pulsante Modifica)', modificaFn === true)
  check(
    '"Modifica" su una funzione apre una tab col nome della funzione',
    tabsDopoFn === tabsPrimaFn + 1 && !/CREATE OR ALTER/i.test(titoloFn) && /fn_/i.test(titoloFn),
  )

  // "anche nei dati": la ricerca scansiona le tabelle (limitatamente) e lo dichiara
  await tornaAllaRicerca()
  await page.clickWhere(`document.querySelector('[data-ricerca="dati"]')`)
  await sleep(400)
  await page.clickWhere(`document.querySelector('[data-ricerca="cerca"]')`)
  let metaDati = ''
  for (let i = 0; i < 15; i++) {
    await sleep(2000)
    metaDati = await testo('[data-ricerca="meta"]')
    if (/tabelle scandite su \d+/.test(metaDati) && !metaDati.includes('0 tabelle scandite')) break
  }
  console.log(`  con "anche nei dati": "${metaDati}"`)
  check('con "anche nei dati" la ricerca scandisce le tabelle del database', /tabelle scandite su \d+/.test(metaDati))

  // 8) CRONOLOGIA: la ricerca ricorda le ultime 10 parole cercate e le ripesca
  await page.eval(`(() => { const i = document.querySelector('[data-ricerca="testo"]'); if (i) { i.focus(); i.select(); } return !!i; })()`)
  await page.typeText('MIS_MISSIONE')
  await page.clickWhere(`document.querySelector('[data-ricerca="cerca"]')`)
  await sleep(2800)
  const apriCronologia = async () => {
    await page.clickWhere(`document.querySelector('[data-ricerca="cronologia"]')`)
    await sleep(500)
    return await page.eval(
      `[...document.querySelectorAll('[data-ricerca="voce-cronologia"]')].map(b => (b.textContent || '').trim())`,
    )
  }
  const vociCronologia = await apriCronologia()
  console.log(`  cronologia: ${JSON.stringify(vociCronologia.slice(0, 4))}`)
  check(
    'la ricerca ricorda le ultime parole cercate',
    vociCronologia.includes('MIS_MISSIONE') && vociCronologia.includes('UDC_UDC'),
  )
  check('la ricerca più recente è la prima della cronologia', vociCronologia[0] === 'MIS_MISSIONE')
  check('la cronologia non supera le 10 voci', vociCronologia.length <= 10)
  // si chiude il menu e si ripesca l'ultima ricerca con la freccia su
  await page.clickWhere(`document.querySelector('[data-ricerca="cronologia"]')`)
  await sleep(300)
  await page.eval(`document.querySelector('[data-ricerca="testo"]').focus()`)
  await page.press('ArrowUp', { code: 'ArrowUp', vk: 38 })
  await sleep(400)
  const valoreInput = await page.eval(`document.querySelector('[data-ricerca="testo"]').value`)
  console.log(`  freccia su nell input: ${JSON.stringify(valoreInput)}`)
  check('freccia su: ripesca l ultima parola cercata', valoreInput === 'MIS_MISSIONE')

  // NESSUN DOPPIONE: cercando il NOME di una store, l'oggetto non deve comparire due volte (una
  // per il nome e una per la definizione, che comincia con la CREATE che contiene il nome).
  // Segnalazione utente: "la ricerca per nome store procedure ritorna 2 elementi".
  await page.eval(`document.querySelector('[data-ricerca="testo"]').focus()`)
  await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
  await page.typeText(STORE_UNICA)
  // "anche nei dati" va spento: i dati di altre tabelle che CITANO la store non c'entrano con il
  // controllo "una sola riga per oggetto" (e la scansione dei dati può limitare i risultati)
  await page.eval(`(() => {
    const c = document.querySelector('[data-ricerca="dati"]');
    if (c && c.checked) c.click();
  })()`)
  await sleep(400)
  await page.clickWhere(`document.querySelector('[data-ricerca="cerca"]')`)
  // si aspetta che la ricerca sia FINITA (niente "limite raggiunto") e che l'elenco sia stabile
  await page.waitFor(
    `(() => {
       const m = document.querySelector('[data-ricerca="meta"]');
       const t = m ? (m.textContent || '') : '';
       return t.includes('risultat') && !t.includes('limite raggiunto');
     })()`,
    30000,
    'ricerca conclusa',
  )
  await sleep(1200)
  const perNome = await page.eval(`(() => {
    const righe = [...document.querySelectorAll('[data-ricerca="riga"]')];
    const oggetti = righe.map(r => r.getAttribute('data-ricerca-nome') || '');
    // gli hit sui DATI sono RIGHE (lo stesso valore può stare in più righe): non sono "oggetti
    // ripetuti", quindi restano fuori dal controllo dei doppioni
    const soloOggetti = oggetti.filter(o => !o.startsWith('data|'));
    const conteggi = {};
    for (const o of soloOggetti) conteggi[o] = (conteggi[o] || 0) + 1;
    const doppi = Object.entries(conteggi).filter(([, n]) => n > 1);
    return {
      righe: righe.length,
      oggetti,
      doppi,
      campo: (document.querySelector('[data-ricerca="testo"]') || {}).value,
      meta: ((document.querySelector('[data-ricerca="meta"]') || {}).textContent || '').trim(),
    };
  })()`)
  const quanteStore = perNome.oggetti.filter(o => o.endsWith(`.${STORE_UNICA}`.toLowerCase())).length
  await page.screenshot('ricerca-store-una-riga')
  // le righe vecchie non devono restare nell'elenco (chiavi React duplicate → liste "sporche"):
  // si fa una ricerca SENZA risultati e l'elenco deve svuotarsi
  await page.eval(`document.querySelector('[data-ricerca="testo"]').focus()`)
  await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
  await page.typeText('zzz_inesistente_xyz')
  await page.clickWhere(`document.querySelector('[data-ricerca="cerca"]')`)
  await sleep(2500)
  const dopoVuoto = await page.eval(`(() => {
    const p = document.querySelector('[data-ricerca="pannello"]');
    const cont = p.querySelector('[data-ricerca="risultati"]');
    return {
      righe: p.querySelectorAll('[data-ricerca="riga"]').length,
      figli: cont.children.length,
      meta: ((p.querySelector('[data-ricerca="meta"]') || {}).textContent || '').trim().slice(0, 40),
    };
  })()`)
  console.log(`  ricerca senza risultati: ${JSON.stringify(dopoVuoto)}`)
  const debugPannelli = await page.eval(`(() => {
    const pannelli = [...document.querySelectorAll('[data-ricerca="pannello"]')];
    return pannelli.map((p, i) => ({
      i,
      nascosto: !!p.closest('div.hidden'),
      righe: p.querySelectorAll('[data-ricerca="riga"]').length,
      neiRisultati: p.querySelectorAll('[data-ricerca="risultati"] [data-ricerca="riga"]').length,
      contenitori: p.querySelectorAll('[data-ricerca="risultati"]').length,
      meta: ((p.querySelector('[data-ricerca="meta"]') || {}).textContent || '').trim().slice(0, 60),
      campo: ((p.querySelector('[data-ricerca="testo"]') || {}).value || ''),
      prime: [...p.querySelectorAll('[data-ricerca="riga"]')].slice(0, 3)
        .map(r => (r.textContent || '').trim().slice(0, 40)),
      padre: (() => { const r = p.querySelector('[data-ricerca="riga"]'); return r && r.parentElement ? r.parentElement.className.slice(0, 60) : null; })(),
    }));
  })()`)
  console.log(`  DEBUG pannelli: ${JSON.stringify(debugPannelli)}`)
  console.log(
    `  ricerca "${perNome.campo}": ${perNome.righe} righe (${perNome.meta}) — oggetti: ${JSON.stringify(perNome.oggetti.slice(0, 4))}`,
  )
  check(`la store "${STORE_UNICA}" compare UNA sola volta`, quanteStore === 1, `${quanteStore} righe`)
  check(
    'nessun oggetto ripetuto nei risultati (nome + definizione)',
    perNome.doppi.length === 0,
    JSON.stringify(perNome.doppi.slice(0, 3)),
  )
  // e una ricerca SENZA risultati deve svuotare l'elenco (prima le righe vecchie restavano: chiavi
  // React duplicate fra colonne omonime di tabelle diverse)
  check(
    'una ricerca senza risultati svuota l elenco',
    dopoVuoto.righe === 0 && dopoVuoto.meta.startsWith('0 risultati'),
    JSON.stringify(dopoVuoto),
  )

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-indent): andando a capo dopo uno statement, la nuova riga non deve
 * partire da colonna 0 ma restare allineata all'indentazione della riga sopra (dentro la
 * routine). È la segnalazione dell'utente sullo statement UPDATE … SET … WHERE.
 */
async function verifyIndent(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Schema:')`, 40000, 'schema caricato')
  await sleep(1500)
  const rect = await editorRect(page)

  const righeEditor = () =>
    page.eval(`[...document.querySelectorAll('.monaco-editor .view-lines .view-line')]
      .map(l => (l.textContent || '').replace(/\\u00a0/g, ' ').replace(/\\s+$/, ''))`)

  await page.clickPoint(rect.x + 120, rect.y + 18)
  await sleep(400)
  await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
  await page.typeText(
    [
      'CREATE PROCEDURE p',
      'AS',
      'BEGIN',
      '  UPDATE DAT_UDC',
      '    SET UDC_RETURN = 1',
      '  WHERE UDC_UDC = @udc',
      'END',
    ].join('\n'),
  )
  await sleep(700)
  await page.clickPoint(rect.x + 120, rect.y + 18)
  await sleep(300)
  await page.clickWhere(
    `[...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Formatta')`,
  )
  await sleep(1500)

  const esiti = []
  const check = (nome, ok) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}`)
  }

  const prima = await righeEditor()
  console.log('  dopo la formattazione:')
  prima.forEach(r => console.log(`    |${r}`))

  // cursore in fondo alla riga della WHERE e Invio: la riga nuova deve rientrare come quella
  const punto = await page.eval(`(() => {
    const linea = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')].find(l => (l.textContent || '').replace(/\\u00a0/g, ' ').includes('WHERE UDC_UDC'));
    if (!linea) return null;
    const spans = [...linea.querySelectorAll('span')];
    const ultimo = spans[spans.length - 1];
    if (!ultimo) return null;
    const r = ultimo.getBoundingClientRect();
    return { x: r.right - 1, y: r.top + r.height / 2 };
  })()`)
  if (!punto) throw new Error('riga "WHERE UDC_UDC" non trovata nell editor')
  await page.clickPoint(punto.x, punto.y)
  await sleep(400)
  // Invio "vero" (keybinding di Monaco): è il percorso che usa l'utente con la tastiera
  await page.press('Enter', { code: 'Enter', vk: 13, eventType: 'keyDown' })
  await sleep(300)
  await page.typeText('X_NUOVA')
  await sleep(600)

  const dopo = await righeEditor()
  console.log('  dopo Invio + testo:')
  dopo.forEach(r => console.log(`    |${r}`))
  const rientro = t => (t.match(/^\s*/) ?? [''])[0].length
  const rigaWhere = dopo.find(r => r.includes('WHERE UDC_UDC')) ?? ''
  const rigaNuova = dopo.find(r => r.includes('X_NUOVA')) ?? ''
  console.log(`  rientro WHERE: ${rientro(rigaWhere)} · rientro nuova riga: ${rientro(rigaNuova)}`)
  check('la nuova riga NON parte da colonna 0', rientro(rigaNuova) > 0)
  check('la nuova riga è allineata alla riga sopra (WHERE)', rientro(rigaNuova) === rientro(rigaWhere))

  // 2) statement NUOVO scritto a colonna 0 dopo l UPDATE: dopo "Formatta" deve rientrare
  //    come gli altri statement del blocco (non restare a sinistra)
  await page.clickPoint(rect.x + 120, rect.y + 18)
  await sleep(400)
  await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
  await page.typeText(
    [
      'CREATE PROCEDURE p',
      'AS',
      'BEGIN',
      '  UPDATE DAT_UDC',
      '    SET UDC_RETURN = 1',
      '  WHERE UDC_UDC = @udc',
      'SELECT 1',
      'END',
    ].join('\n'),
  )
  await sleep(700)
  await page.clickPoint(rect.x + 120, rect.y + 18)
  await sleep(300)
  await page.clickWhere(
    `[...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Formatta')`,
  )
  await sleep(1500)
  const dopoFormat = await righeEditor()
  console.log('  statement nuovo dopo "Formatta":')
  dopoFormat.forEach(r => console.log(`    |${r}`))
  const rigaNuovoStmt = dopoFormat.find(r => r.includes('SELECT 1')) ?? ''
  const rigaUpdate = dopoFormat.find(r => r.includes('UPDATE DAT_UDC')) ?? ''
  console.log(`  rientro UPDATE: ${rientro(rigaUpdate)} · rientro nuovo statement: ${rientro(rigaNuovoStmt)}`)
  check('lo statement nuovo non resta a colonna 0', rientro(rigaNuovoStmt) > 0)
  check('lo statement nuovo rientra come lo statement sopra', rientro(rigaNuovoStmt) === rientro(rigaUpdate))

  // 3) dopo BEGIN la riga nuova rientra di UN livello (regole di rientro della lingua sql)
  const puntoBegin = await page.eval(`(() => {
    const linea = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')].find(l => (l.textContent || '').replace(/\\u00a0/g, ' ').trim().startsWith('BEGIN'));
    if (!linea) return null;
    const spans = [...linea.querySelectorAll('span')];
    const ultimo = spans[spans.length - 1];
    if (!ultimo) return null;
    const r = ultimo.getBoundingClientRect();
    return { x: r.right - 1, y: r.top + r.height / 2 };
  })()`)
  if (puntoBegin) {
    await page.clickPoint(puntoBegin.x, puntoBegin.y)
    await sleep(300)
    await page.press('Enter', { code: 'Enter', vk: 13, text: '\r' })
    await sleep(300)
    await page.typeText('X_BEGIN')
    await sleep(500)
  }
  const dopoBegin = await righeEditor()
  const rigaBegin = dopoBegin.find(r => r.trim().startsWith('BEGIN')) ?? ''
  const rigaXBegin = dopoBegin.find(r => r.includes('X_BEGIN')) ?? ''
  console.log(`  rientro BEGIN: ${rientro(rigaBegin)} · rientro dopo BEGIN: ${rientro(rigaXBegin)}`)
  check('dopo BEGIN la riga nuova rientra di un livello', rientro(rigaXBegin) === rientro(rigaBegin) + 2)

  // 4) le parentesi si chiudono ancora da sole (la configurazione della lingua è stata ridefinita)
  await page.clickPoint(rect.x + 120, rect.y + 18)
  await sleep(300)
  await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
  await page.typeText('select ')
  await page.press('(', { code: 'Digit9', vk: 57, modifiers: 8, text: '(' })
  await sleep(600)
  const righeParen = await righeEditor()
  const rigaParen = righeParen.find(r => r.includes('select')) ?? ''
  console.log(`  riga con la parentesi: |${rigaParen}`)
  check('le parentesi si chiudono ancora da sole', /\(\s*\)/.test(rigaParen))

  // 5) Ctrl+/ commenta ancora (la configurazione della lingua dichiara i commenti)
  await page.clickPoint(rect.x + 120, rect.y + 18)
  await sleep(300)
  await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
  await page.typeText('select 1')
  await sleep(300)
  await page.press('/', { code: 'Slash', vk: 191, modifiers: 2 })
  await sleep(700)
  const righeCommento = await righeEditor()
  const rigaCommentata = righeCommento.find(r => r.includes('select 1')) ?? ''
  console.log(`  dopo Ctrl+/: |${rigaCommentata}`)
  check('Ctrl+/ commenta ancora la riga', rigaCommentata.trim().startsWith('--'))

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-drop): dopo "ALTER TABLE t DROP" si propongono COLUMN/CONSTRAINT, dopo
 * "DROP COLUMN" le colonne della tabella e dopo "DROP CONSTRAINT" i suoi vincoli.
 */
async function verifyDrop(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Schema:')`, 40000, 'schema caricato')
  await sleep(1500)
  const rect = await editorRect(page)

  const scrivi = async sql => {
    await page.clickPoint(rect.x + 120, rect.y + 18)
    await sleep(400)
    await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
    await page.typeText(sql)
    await sleep(1800)
  }
  const vociPopup = async () =>
    await page.eval(`[...document.querySelectorAll('.suggest-widget .monaco-list-row')]
      .map(r => ((r.querySelector('.label-name') || r).textContent || '').trim())`)

  /** Righe del popup con anche il dettaglio (per leggere "vincoli collegati: …"). */
  const righePopupConDettaglio = async () =>
    await page.eval(`[...document.querySelectorAll('.suggest-widget .monaco-list-row')]
      .map(r => (r.textContent || '').replace(/\\u00a0/g, ' ').trim())`)

  /** Righe VISIBILI dell'editor (Monaco usa spazi insecabili: si normalizzano). */
  const righeEditor = () =>
    page.eval(`[...document.querySelectorAll('.monaco-editor .view-lines .view-line')]
      .map(l => (l.textContent || '').replace(/\\u00a0/g, ' ').replace(/\\s+$/, ''))`)

  const esiti = []
  const check = (nome, ok) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}`)
  }
  const minuscole = v => v.map(x => x.toLowerCase())

  // 1) "DROP C" → COLUMN e CONSTRAINT (parola chiave a metà)
  await scrivi('ALTER TABLE dbo.DAT_UDC DROP C')
  const vociChiavi = minuscole(await vociPopup())
  console.log(`  dopo "DROP C": ${JSON.stringify(vociChiavi.slice(0, 6))}`)
  check('dopo "DROP " propone COLUMN', vociChiavi.includes('column'))
  check('dopo "DROP " propone CONSTRAINT', vociChiavi.includes('constraint'))

  // 2) "DROP COLUMN U" → le colonne della tabella
  await scrivi('ALTER TABLE dbo.DAT_UDC DROP COLUMN U')
  const vociColonne = minuscole(await vociPopup())
  console.log(`  dopo "DROP COLUMN U": ${JSON.stringify(vociColonne.slice(0, 6))}`)
  check('dopo "DROP COLUMN " propone le colonne della tabella', vociColonne.some(v => v.startsWith('udc_')))
  check('dopo "DROP COLUMN " NON ripropone le parole chiave', !vociColonne.includes('column'))

  // 3) "DROP CONSTRAINT P" → i vincoli della tabella (la PK di DAT_UDC è PK_DAT_UDC)
  await scrivi('ALTER TABLE dbo.DAT_UDC DROP CONSTRAINT P')
  const vociVincoli = minuscole(await vociPopup())
  console.log(`  dopo "DROP CONSTRAINT P": ${JSON.stringify(vociVincoli.slice(0, 6))}`)
  check('dopo "DROP CONSTRAINT " propone i vincoli della tabella', vociVincoli.some(v => v.startsWith('pk_')))

  // 4) nelle colonne compaiono i VINCOLI COLLEGATI (da togliere prima di eliminarla)
  await scrivi('ALTER TABLE dbo.DAT_UDC DROP COLUMN U')
  const righeConVincoli = await righePopupConDettaglio()
  console.log(`  colonne con vincoli collegati: ${JSON.stringify(righeConVincoli.slice(0, 3))}`)
  check(
    'nelle colonne dice quali vincoli vanno tolti prima',
    righeConVincoli.some(r => /vincoli collegati/i.test(r)),
  )

  // 5) SNIPPET "DROP COLUMN sicuro": controllo di esistenza + vincoli collegati + DROP COLUMN
  //    (si trova scrivendo un pezzo del nome: il popup filtra per qualità del match)
  await scrivi('ALTER TABLE dbo.DAT_UDC DROP COLUMN sic')
  const vociSnippet = await righePopupConDettaglio()
  console.log(`  popup con "DROP COLUMN sic": ${JSON.stringify(vociSnippet.slice(0, 3))}`)
  const trovatoSnippet = vociSnippet.find(v => /DROP COLUMN sicuro/i.test(v))
  console.log(`  snippet proposto: ${JSON.stringify(trovatoSnippet ?? null)}`)
  check('propone lo snippet "DROP COLUMN sicuro"', !!trovatoSnippet)
  if (trovatoSnippet) {
    await page.press('Enter', { code: 'Enter', vk: 13, text: '\r' })
    await sleep(600)
    await page.typeText('UDC_PROVA') // riempie il segnaposto: la colonna è una variabile
    await sleep(800)
    const inizio = await righeEditor()
    console.log('  snippet inserito (inizio):')
    inizio.slice(0, 12).forEach(r => console.log(`    |${r}`))
    const testoInizio = inizio.join('\n')
    check('lo snippet dichiara la colonna in una VARIABILE', /DECLARE @colonna SYSNAME = N'UDC_PROVA'/.test(testoInizio))
    check('lo snippet controlla che la colonna esista', /IF EXISTS \(SELECT 1 FROM sys\.columns/.test(testoInizio))
    check('lo snippet lavora sulla tabella dello statement', testoInizio.includes("OBJECT_ID(N'[dbo].[DAT_UDC]')"))
    check('lo snippet toglie i vincoli prima della colonna', /DROP CONSTRAINT/.test(testoInizio))
    check(
      'sotto si usa la variabile, non il valore ripetuto',
      (testoInizio.match(/@colonna/g) ?? []).length >= 2 &&
        !/c\.name = N'UDC_PROVA'/.test(testoInizio) &&
        !/definition LIKE N'%UDC_PROVA/.test(testoInizio),
    )
    check('lo statement originale è stato sostituito', !testoInizio.includes('ALTER TABLE dbo.DAT_UDC DROP COLUMN'))
    // in fondo allo snippet: il DROP COLUMN dinamico e la PRINT quando la colonna non c'è
    await page.press('End', { code: 'End', vk: 35, modifiers: 2 })
    await sleep(600)
    const fine = (await righeEditor()).join('\n')
    console.log('  snippet inserito (fine):')
    ;(await righeEditor()).slice(-8).forEach(r => console.log(`    |${r}`))
    check('in fondo il DROP COLUMN usa QUOTENAME(@colonna)', /DROP COLUMN ' \+ QUOTENAME\(@colonna\)/.test(fine))
    check('la parte finale è la PRINT della colonna mancante', /niente da fare/.test(fine))
    check('la parte finale non ha più il blocco delle FK entranti', !/referenced_object_id|@puntano|altre tabelle puntano/.test(fine))
  }

  // 6) le query di CATALOGO dello snippet girano davvero sul database collegato: si eseguono
  //    (solo SELECT) e si controlla che non arrivino errori di colonna non valida — la vecchia
  //    join su sys.objects.parent_column_id dava "Msg 207: nome di colonna non valido"
  const queryCatalogo = [
    "SELECT dc.name FROM sys.default_constraints dc INNER JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'[dbo].[DAT_UDC]') AND c.name = N'UDC_UDC'",
    "SELECT cc.name FROM sys.check_constraints cc WHERE cc.parent_object_id = OBJECT_ID(N'[dbo].[DAT_UDC]') AND cc.definition LIKE N'%UDC_UDC%'",
    "SELECT kc.name FROM sys.key_constraints kc INNER JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id WHERE kc.parent_object_id = OBJECT_ID(N'[dbo].[DAT_UDC]') AND ic.is_included_column = 0 AND COL_NAME(ic.object_id, ic.column_id) = N'UDC_UDC' GROUP BY kc.name HAVING COUNT(*) = 1",
  ].join(';\n')
  await scrivi(queryCatalogo)
  await sleep(400)
  await page.press('F5', { code: 'F5', vk: 116 })
  await sleep(4500)
  const pagina = await page.eval(`document.body.textContent || ''`)
  const erroreColonna = /Msg 207|nome di colonna .* non .* valido|Invalid column name/i.test(pagina)
  console.log(`  query di catalogo: errore di colonna = ${erroreColonna}`)
  check('le query di catalogo dello snippet girano sul database', !erroreColonna)

  // e la query delle PK/UNIQUE, da sola, restituisce davvero il vincolo.
  // Prima un marcatore: serve a sapere che l'esecuzione e la lettura della griglia funzionano.
  await scrivi("SELECT 'PROVA_EXEC_123' AS marcatore")
  await sleep(400)
  await page.press('F5', { code: 'F5', vk: 116 })
  await sleep(3500)
  const paginaMarker = await page.eval(`document.body.textContent || ''`)
  console.log(`  marcatore eseguito e visibile: ${paginaMarker.includes('PROVA_EXEC_123')}`)
  check('l esecuzione delle query e la lettura dei risultati funzionano', paginaMarker.includes('PROVA_EXEC_123'))

  // 7) caso segnalato: una tabella reale scritta SENZA schema ("ALTER TABLE DAT_SPEDIZIONI …")
  await scrivi('ALTER TABLE DAT_SPEDIZIONI DROP CONSTRAINT P')
  const vincoliSped = minuscole(await vociPopup())
  console.log(`  DAT_SPEDIZIONI · DROP CONSTRAINT P: ${JSON.stringify(vincoliSped.slice(0, 4))}`)
  check('senza schema: propone i vincoli della tabella', vincoliSped.some(v => v.includes('pk_dat_spedizioni')))

  await scrivi('ALTER TABLE DAT_SPEDIZIONI DROP COLUMN S')
  const colonneSped = minuscole(await vociPopup())
  console.log(`  DAT_SPEDIZIONI · DROP COLUMN S: ${JSON.stringify(colonneSped.slice(0, 4))}`)
  check('senza schema: propone le colonne della tabella', colonneSped.some(v => v.startsWith('spe_')))

  // 8) SENZA la parola TABLE (caso segnalato): stessi suggerimenti + correzione automatica
  await scrivi('ALTER DAT_SPEDIZIONI DROP CONSTRAINT P')
  const vociSenzaTable = await righePopupConDettaglio()
  console.log(`  senza "TABLE" · DROP CONSTRAINT P: ${JSON.stringify(vociSenzaTable.slice(0, 3))}`)
  check('senza TABLE propone lo stesso i vincoli della tabella', vociSenzaTable.some(v => /pk_dat_spedizioni/i.test(v)))
  check('senza TABLE avvisa che lo aggiunge', vociSenzaTable.some(v => /manca TABLE/i.test(v)))
  await page.press('Enter', { code: 'Enter', vk: 13, text: '\r' })
  await sleep(900)
  const rigaSenzaTable =
    (await righeEditor()).map(r => r.trim()).find(r => r.includes('DAT_SPEDIZIONI')) ?? ''
  console.log(`  riga dopo la conferma: ${JSON.stringify(rigaSenzaTable)}`)
  check(
    'accettando il suggerimento lo statement diventa "ALTER TABLE …"',
    /^ALTER TABLE DAT_SPEDIZIONI DROP CONSTRAINT \[?PK_DAT_SPEDIZIONI\]?$/i.test(rigaSenzaTable),
  )

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-fragment): scrivendo "fefo" devono uscire le colonne che CONTENGONO quella
 * parola ("RIG_REVFEFO_VNA"), sia con la FROM scritta sia senza (ripiego su tutte le colonne dello
 * schema). Prima Monaco nascondeva i match a metà parola (matchOnWordStartOnly).
 */
async function verifyFragment(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Schema:')`, 40000, 'schema caricato')
  await sleep(1500)
  const rect = await editorRect(page)

  const scrivi = async sql => {
    await page.clickPoint(rect.x + 120, rect.y + 18)
    await sleep(400)
    await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
    await page.typeText(sql)
    await sleep(1800)
  }
  const vociPopup = async () =>
    await page.eval(`[...document.querySelectorAll('.suggest-widget .monaco-list-row')]
      .map(r => ((r.querySelector('.label-name') || r).textContent || '').trim())`)

  const esiti = []
  const check = (nome, ok) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}`)
  }
  const minuscole = v => v.map(x => x.toLowerCase())

  // 1) caso segnalato: la colonna con la parola in MEZZO al nome. Il cursore resta in fondo al
  //    testo digitato, quindi si scrive la parola per ultima (dopo la FROM) o da sola.
  await scrivi('SELECT * FROM DAT_ORDINI_RIGHE WHERE fefo')
  const conFrom = await vociPopup()
  console.log(`  "… WHERE fefo": ${JSON.stringify(conFrom.slice(0, 6))}`)
  check(
    'scrivendo "fefo" compare RIG_REVFEFO_VNA (parola in mezzo al nome)',
    minuscole(conFrom).includes('rig_revfefo_vna'),
  )

  // 2) senza FROM: si cerca fra le colonne di TUTTO lo schema (ripiego)
  await scrivi('SELECT fefo')
  const senzaFrom = await vociPopup()
  console.log(`  "SELECT fefo": ${JSON.stringify(senzaFrom.slice(0, 6))}`)
  check('senza FROM cerca comunque fra le colonne dello schema', minuscole(senzaFrom).includes('rig_revfefo_vna'))

  // 2b) con lo SPAZIO dopo la parola (è lo stato in cui si digita la FROM)
  await scrivi('SELECT fefo ')
  const conSpazio = await vociPopup()
  console.log(`  "SELECT fefo " (spazio finale): ${JSON.stringify(conSpazio.slice(0, 6))}`)
  check('anche con lo spazio dopo la parola la colonna resta proposta', minuscole(conSpazio).includes('rig_revfefo_vna'))

  // 2c) TESTO ESATTO dell'utente con il cursore dopo "fefo": si digita tutto e si torna
  //     indietro con le frecce, poi si richiama il popup con Ctrl+Spazio
  await scrivi('SELECT fefo FROM DAT_ORDINI_RIGHE')
  for (let i = 0; i < ' FROM DAT_ORDINI_RIGHE'.length; i++) {
    await page.press('ArrowLeft', { code: 'ArrowLeft', vk: 37 })
  }
  await sleep(200)
  await page.press(' ', { code: 'Space', vk: 32, modifiers: 2 })
  await sleep(1600)
  const esatto = await vociPopup()
  console.log(`  "SELECT fefo| FROM DAT_ORDINI_RIGHE" (cursore dopo fefo): ${JSON.stringify(esatto.slice(0, 6))}`)
  check('con il cursore dopo "fefo" e la FROM scritta la colonna compare', minuscole(esatto).includes('rig_revfefo_vna'))

  // 3) la voce del ripiego dice da quale tabella arriva (si guarda il popup dello spazio finale)
  const dettaglio = await page.eval(`(() => {
    const riga = [...document.querySelectorAll('.suggest-widget .monaco-list-row')]
      .find(r => /rig_revfefo_vna/i.test(r.textContent || ''));
    return riga ? (riga.textContent || '').replace(/\\u00a0/g, ' ').trim() : '';
  })()`)
  console.log(`  voce completa: ${JSON.stringify(dettaglio)}`)
  check('la colonna trovata dice di che tabella è', /colonna di dbo\.|ORDINI_RIGHE/i.test(dettaglio))

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

async function verifyLabels(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Schema:')`, 40000, 'schema caricato')
  await sleep(1500)
  const rect = await editorRect(page)

  const PROC = [
    'CREATE PROCEDURE p AS',
    'BEGIN',
    '  -- lbFinta: non deve comparire',
    '  IF 1 = 1',
    '    GOTO ',
    '  SELECT 1',
    '  lblExit:',
    '  RETURN 0',
    '  fine:',
    '  RETURN 1',
    'END',
  ].join('\n')

  const scrivi = async sql => {
    await page.clickPoint(rect.x + 120, rect.y + 18)
    await sleep(400)
    await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
    await page.typeText(sql)
    await sleep(1000)
  }
  /** Cursore alla fine della riga "GOTO ", poi si digita la lettera per aprire il popup. */
  const popupDopoGoto = async lettera => {
    const punto = await page.eval(`(() => {
      const linea = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')].find(l => (l.textContent || '').trim().startsWith('GOTO'));
      if (!linea) return null;
      const spans = [...linea.querySelectorAll('span')];
      const ultimo = spans[spans.length - 1];
      if (!ultimo) return null;
      const r = ultimo.getBoundingClientRect();
      return { x: r.right - 1, y: r.top + r.height / 2 };
    })()`)
    if (!punto) return null
    await page.clickPoint(punto.x, punto.y)
    await sleep(400)
    await page.typeText(lettera)
    await sleep(1600)
    return await page.eval(`[...document.querySelectorAll('.suggest-widget .monaco-list-row')]
      .map(r => ((r.querySelector('.label-name') || r).textContent || '').trim())`)
  }

  await scrivi(PROC)
  const esiti = []
  const check = (nome, ok) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}`)
  }
  const normali = v => (v ?? []).map(x => x.toLowerCase())

  const conL = await popupDopoGoto('l')
  console.log(`  dopo "GOTO l": ${JSON.stringify(conL)}`)
  check('propone la label definita più sotto (lblExit)', normali(conL).includes('lblexit'))
  check('NON propone la label nel commento (lbFinta)', !normali(conL).some(v => v.includes('lbfinta')))

  // nuovo giro: "GOTO f" → la label "fine"
  await scrivi(PROC)
  const conF = await popupDopoGoto('f')
  console.log(`  dopo "GOTO f": ${JSON.stringify(conF)}`)
  check('propone anche l altra label (fine)', normali(conF).includes('fine'))

  await page.press('Escape', { code: 'Escape', vk: 27 })
  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * VERIFICA (--verify-error-line): doppio clic su un errore → il cursore va sulla riga indicata
 * da SQL Server, MAPPATA sulla tab. Con la procedura che inizia alla riga 3 della tab e
 * l'errore alla riga 4 della definizione ("Riga 4"), ci si aspetta la riga 6 (3 + 4 - 1).
 * La procedura è temporanea (#prova_riga): vive solo nella sessione, nessuna scrittura sul DB.
 */
async function verifyErrorLine(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await sleep(2000)
  const rect = await editorRect(page)

  const BATCH = [
    '-- commento di intestazione',
    '-- seconda riga di commento',
    'CREATE PROCEDURE #prova_riga AS',
    'BEGIN',
    '  DECLARE @a int = 1',
    '  SELECT 1 / (@a - 1) AS rottura',
    'END',
    'GO',
    'EXEC #prova_riga',
  ].join('\n')

  const righeEditor = () =>
    page.eval(`[...document.querySelectorAll('.monaco-editor .view-lines .view-line')]
      .map(l => (l.textContent || '').replace(/\\u00a0/g, ' ').replace(/\\s+$/, ''))`)
  const rigaCursore = () =>
    page.eval(`(() => {
      const c = document.querySelector('.monaco-editor .cursors-layer .cursor');
      const top = c ? c.style.top : null;
      if (top === null) return null;
      const r = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')].find(l => l.style.top === top)
        || [...document.querySelectorAll('.monaco-editor .view-lines .view-line')].find(l => l.style.top >= top);
      return r ? (r.textContent || '').replace(/\\u00a0/g, ' ').trim() : null;
    })()`)

  await page.clickPoint(rect.x + 120, rect.y + 18)
  await sleep(400)
  await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
  await page.typeText(BATCH)
  await sleep(700)
  await page.press('F5', { code: 'F5', vk: 116 })
  await sleep(4000)
  console.log('  testo nell editor:')
  ;(await righeEditor()).forEach(r => console.log(`    |${r}`))

  // messaggio di errore (intestazione in stile SSMS) e riga indicata
  const info = await page.eval(`(() => {
    const testo = document.body.innerText || '';
    const m = /Procedura\\s+(\\S+?)\\s*·\\s*Riga\\s+(\\d+)/.exec(testo);
    const riga = [...document.querySelectorAll('div')].find(d => (d.textContent || '').includes('Procedura') && (d.textContent || '').includes('Riga'));
    return { procedura: m ? m[1] : null, rigaSql: m ? Number(m[2]) : null, avevaRiga: !!riga };
  })()`)
  console.log(`  errore riportato: procedura=${info.procedura} riga=${info.rigaSql}`)

  // doppio clic sulla riga del messaggio (React ascolta l'evento "dblclick")
  const doppioClic = await page.eval(`(() => {
    // si clicca sull'elemento PIÙ INTERNO che contiene il messaggio (banner o riga dei Messaggi)
    const nodi = [...document.querySelectorAll('div, span, pre')]
      .filter(e => /Procedura\\s+\\S+\\s*·\\s*Riga\\s+\\d+/.test(e.textContent || ''));
    const nodo = nodi.sort((a, b) => a.textContent.length - b.textContent.length)[0];
    if (!nodo) return false;
    nodo.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`)
  await sleep(1200)
  const rigaDopo = await rigaCursore()
  console.log(`  log della pagina: ${JSON.stringify(page.consoleLogs('[errore]'))}`)

  const esiti = []
  const check = (nome, ok) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}`)
  }
  check('l errore riporta la procedura e la riga', !!info.procedura && !!info.rigaSql)
  check('il doppio clic è stato inviato al messaggio', doppioClic === true)
  console.log(`  riga di SQL Server: ${info.rigaSql}; cursore dopo il doppio clic: ${JSON.stringify(rigaDopo)}`)
  check('il cursore è finito sulla riga che ha fallito', /SELECT 1 \/ \(@a - 1\)/.test(rigaDopo ?? ''))

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * DIAGNOSTICA (--measure-typing): apre una STORE GRANDE dal database e misura quanto si blocca
 * la pagina digitando un carattere (la latenza di una valutazione banale subito dopo la
 * digitazione = tempo in cui il thread principale è occupato). Misura anche il costo delle
 * funzioni pesanti sul testo della store.
 */
async function measureTyping(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Schema:')`, 40000, 'schema caricato')
  await sleep(1500)

  // apre la store dal pannello laterale (ricerca + tasto destro + Modifica)
  await page.eval(`(() => {
    const input = [...document.querySelectorAll('input')].find(i => (i.placeholder || '').includes('Cerca'));
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(ROUTINE_NAME)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await page.waitFor(
    `[...document.querySelectorAll('*')].some(e => e.children.length === 0 && (e.textContent || '').trim() === ${JSON.stringify(ROUTINE_NAME)})`,
    20000,
    'risultato della ricerca',
  )
  await sleep(700)
  await page.eval(`(() => {
    const leaf = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && (e.textContent || '').trim() === ${JSON.stringify(ROUTINE_NAME)})[0];
    if (leaf) leaf.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }));
    return !!leaf;
  })()`)
  await sleep(900)
  await page.clickWhere(
    `[...document.querySelectorAll('button, [role="menuitem"], div')]
       .filter(e => (e.textContent || '').trim() === 'Modifica')[0]`,
  )
  await sleep(3000)
  const lunghezza = await page.eval(`(() => {
    const righe = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')].length;
    const pannello = document.body.innerText || '';
    return { righeVisibili: righe, haCreateProcedure: /CREATE OR ALTER PROCEDURE/i.test(pannello) };
  })()`)
  console.log(`  store aperta: ${JSON.stringify(lunghezza)}`)

  /** Latenza di una valutazione banale: se il thread principale è occupato, la risposta tarda. */
  const latenza = async () => {
    const t = Date.now()
    await page.eval('1')
    return Date.now() - t
  }
  const base = await latenza()

  // cursore dentro l'editor e un carattere digitato
  const rect = await editorRect(page)
  await page.clickPoint(rect.x + 160, rect.y + 40)
  await sleep(600)
  const primaDigitazione = await latenza()
  const t0 = Date.now()
  await page.typeText('x')
  const invioMs = Date.now() - t0
  const dopoDigitazione = await latenza()
  console.log(`  latenza base: ${base} ms · prima di digitare: ${primaDigitazione} ms`)
  console.log(`  digitazione: invio ${invioMs} ms, latenza SUBITO DOPO: ${dopoDigitazione} ms`)

  // costo delle funzioni pesanti sul testo della store (una per volta: se una si pianta si vede)
  const prova = async (nome, espressione) => {
    const t = Date.now()
    try {
      const r = await page.eval(espressione)
      console.log(`  ${nome}: ${Date.now() - t} ms ${JSON.stringify(r)}`)
    } catch (e) {
      console.log(`  ${nome}: OLTRE ${Date.now() - t} ms (${e.message})`)
    }
  }
  const apri = `(await import('/src/__tests__/fixtures/routine_ws_L2_SUSEVOMOPEPESESE_FIB.sql?raw')).default`
  await prova('dimensione fixture', `(async () => { const sql = ${apri}; return sql.length })()`)
  await prova(
    'runSqlDiagnostics',
    `(async () => { const sql = ${apri}; const m = await import('/src/sqlDiagnostics.ts'); const t = performance.now(); const r = m.runSqlDiagnostics(sql, { summary: null }); return Math.round(performance.now() - t) + ' ms, ' + r.length + ' diagnosi' })()`,
  )
  await prova(
    'extractLocalTables',
    `(async () => { const sql = ${apri}; const m = await import('/src/localTables.ts'); const t = performance.now(); const r = m.extractLocalTables(sql); return Math.round(performance.now() - t) + ' ms, ' + r.length + ' tabelle' })()`,
  )
  await prova(
    'extractCteTables',
    `(async () => { const sql = ${apri}; const m = await import('/src/localTables.ts'); const t = performance.now(); const r = m.extractCteTables(sql); return Math.round(performance.now() - t) + ' ms, ' + r.length + ' CTE' })()`,
  )
}

/**
 * VERIFICA (--verify-scrollbars): i cursori delle scrollbar devono essere tondi e grandi,
 * così si afferrano col mouse: canale di 14px sui pannelli (con maniglia arrotondata) e
 * slider da 12px su canale 16px nell'editor Monaco.
 */
async function verifyScrollbars(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Schema:')`, 40000, 'schema caricato')
  await sleep(2000)

  const misure = await page.eval(`(() => {
    // canale della scrollbar di un pannello scrollabile (0 se il browser usa scrollbar overlay)
    const pannelli = [...document.querySelectorAll('div')].filter(d => d.scrollHeight > d.clientHeight + 50 && d.clientWidth > 100);
    const pannello = pannelli[0] || null;
    const canale = pannello ? pannello.offsetWidth - pannello.clientWidth : null;
    // slider verticale di Monaco
    const slider = document.querySelector('.monaco-editor .scrollbar.vertical .slider');
    const sr = slider ? slider.getBoundingClientRect() : null;
    const cs = slider ? getComputedStyle(slider) : null;
    const barra = document.querySelector('.monaco-editor .scrollbar.vertical');
    const br = barra ? barra.getBoundingClientRect() : null;
    // regole CSS in vigore per le scrollbar dei pannelli (::-webkit-scrollbar*)
    let larghezzaRegola = null;
    let raggioRegola = null;
    for (const foglio of document.styleSheets) {
      let regole = [];
      try { regole = [...foglio.cssRules]; } catch { continue }
      for (const r of regole) {
        const sel = r.selectorText || '';
        if (!sel.includes('-webkit-scrollbar')) continue;
        if (!larghezzaRegola && sel.includes('::-webkit-scrollbar') && !sel.includes('thumb') && !sel.includes('track')) {
          larghezzaRegola = (r.style && r.style.width) || null;
        }
        if (!raggioRegola && sel.includes('thumb')) raggioRegola = (r.style && r.style.borderRadius) || null;
      }
    }
    return {
      canalePannello: canale,
      larghezzaRegolaPannelli: larghezzaRegola,
      raggioRegolaPannelli: raggioRegola,
      sliderLarghezza: sr ? Math.round(sr.width) : null,
      sliderRaggio: cs ? cs.borderRadius : null,
      canaleMonaco: br ? Math.round(br.width) : null,
      cursoreVisibile: !!slider && sr.width > 0,
    };
  })()`)
  console.log(`  misure: ${JSON.stringify(misure)}`)

  const esiti = []
  const check = (nome, ok) => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}`)
  }
  check('pannelli: canale della scrollbar di 14px (regola CSS in vigore)', misure.larghezzaRegolaPannelli === '14px')
  check('pannelli: cursore tondo (border-radius 9999px)', misure.raggioRegolaPannelli === '9999px')
  check('pannelli: canale largo (o scrollbar overlay del browser)', (misure.canalePannello ?? 0) >= 12 || misure.canalePannello === 0)
  check('editor: slider di Monaco largo almeno 10px', (misure.sliderLarghezza ?? 0) >= 10)
  check('editor: canale di Monaco di 16px', misure.canaleMonaco === 16)
  check('editor: slider arrotondato (border-radius grande)', /9999px|(\d{2,})px/.test(misure.sliderRaggio ?? ''))

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

/**
 * DIAGNOSTICA (--dump-generator): esegue una query, attiva "Genera SQL" e stampa la struttura
 * della tabella del generatore (intestazioni e prima riga), per capire com'è disposta.
 */
async function dumpGenerator(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await page.waitFor(`document.body.textContent.includes('Tabelle')`, 30000, 'schema caricato')
  await sleep(2000)
  const rect = await editorRect(page)
  await page.clickPoint(rect.x + 160, rect.y + 18)
  await sleep(400)
  await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
  await page.typeText('SELECT TOP 3 COR_CORRIDOIO, COR_AREA, COR_ABIPREN FROM dbo.MAG_CORRIDOI;')
  await sleep(400)
  await page.press('F5', { code: 'F5', vk: 116 })
  await page.waitFor(`document.body.textContent.includes('per pagina')`, 30000, 'risultati')
  await sleep(1200)
  const attivato = await page.clickWhere(
    `[...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('Genera SQL'))`,
  )
  await sleep(1500)
  console.log(`  'Genera SQL' attivato: ${attivato}`)
  const struttura = await page.eval(`(() => {
    const tab = [...document.querySelectorAll('table')].pop();
    if (!tab) return null;
    const celle = (tr) => tr ? [...tr.children].map(c => {
      const r = c.getBoundingClientRect()
      return {
        tag: c.tagName,
        testo: (c.textContent || '').trim().slice(0, 22),
        check: c.querySelectorAll('input[type=checkbox]').length,
        x: Math.round(r.left),
        w: Math.round(r.width),
      }
    }) : null;
    return {
      intestazioni: celle(tab.querySelector('thead tr')),
      primaRiga: celle(tab.querySelector('tbody tr')),
    };
  })()`)
  console.log('  intestazioni:')
  for (const c of struttura?.intestazioni ?? []) {
    console.log(`    ${c.tag} | check=${c.check} | x=${c.x} w=${c.w} | "${c.testo}"`)
  }
  console.log('  prima riga:')
  for (const c of struttura?.primaRiga ?? []) {
    console.log(`    ${c.tag} | check=${c.check} | x=${c.x} w=${c.w} | "${c.testo}"`)
  }
}

/**
 * DIAGNOSTICA (--dump-tabbar): misura la barra delle tab per controllare che i pulsanti della
 * nuova tab stiano attaccati all'ultima tab (e a sinistra quando la barra è vuota).
 */
async function dumpTabbar(page) {
  await page.waitFor(`document.querySelector('input')`, 10000)
  await page.clickWhere(
    `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
       .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
  )
  await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
  await sleep(2000)

  const misura = () =>
    page.eval(`(() => {
      const tabs = [...document.querySelectorAll('[title*="\\u00b7 db:"]')].map(e => {
        const r = e.getBoundingClientRect(); return { t: (e.getAttribute('title') || '').split(' \\u00b7 ')[0], x: Math.round(r.left), w: Math.round(r.width) };
      });
      const nuovi = [...document.querySelectorAll('button')].filter(b => {
        const t = b.getAttribute('title') || '';
        return t.startsWith('Nuova query');
      });
      const nuovo = nuovi[0];
      const r = nuovo ? nuovo.getBoundingClientRect() : null;
      return {
        tabs,
        quantiPulsanti: nuovi.length,
        etichette: nuovi.map(b => b.getAttribute('title')),
        nuovo: r ? { x: Math.round(r.left), w: Math.round(r.width), y: Math.round(r.top) } : null,
        barra: (() => { const b = nuovo ? nuovo.closest('div')?.parentElement : null; const rb = b ? b.getBoundingClientRect() : null; return rb ? { x: Math.round(rb.left), w: Math.round(rb.width) } : null })(),
      };
    })()`)

  const esiti = []
  const check = (nome, ok, extra = '') => {
    esiti.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${extra ? ` — ${extra}` : ''}`)
  }

  // 1. barra VUOTA: si chiudono tutte le tab, il "+" deve restare a sinistra
  for (let i = 0; i < 6; i++) {
    const chiuso = await page.clickWhere(`[...document.querySelectorAll('button[title="Chiudi tab"]')][0]`)
    if (!chiuso) break
    // eslint-disable-next-line no-await-in-loop
    await sleep(500)
  }
  const vuota = await misura()
  console.log(`  barra vuota: tab=${JSON.stringify(vuota.tabs)} pulsanti=${vuota.quantiPulsanti} nuovo=${JSON.stringify(vuota.nuovo)}`)
  check('c\'è UN SOLO pulsante per la nuova tab', vuota.quantiPulsanti === 1, `trovati ${vuota.quantiPulsanti}`)
  check('senza tab il "+" sta a sinistra, subito dopo il selettore database', !!vuota.nuovo && !!vuota.barra && vuota.nuovo.x - vuota.barra.x < 250)

  // 2. con tab: il "+" è attaccato all'ultima tab e la nuova tab si apre A DESTRA (dopo l'attiva)
  await page.clickWhere(`[...document.querySelectorAll('button')].find(b => (b.getAttribute('title') || '').startsWith('Nuova query'))`)
  await sleep(800)
  await page.clickWhere(`[...document.querySelectorAll('button')].find(b => (b.getAttribute('title') || '').startsWith('Nuova query'))`)
  await sleep(800)
  const piena = await misura()
  const ultima = piena.tabs[piena.tabs.length - 1]
  console.log(`  con tab: ${JSON.stringify(piena.tabs)} nuovo=${JSON.stringify(piena.nuovo)}`)
  check('il "+" è attaccato all\'ultima tab (subito dopo)', !!ultima && !!piena.nuovo && piena.nuovo.x - (ultima.x + ultima.w) < 12, `ultima finisce a ${ultima ? ultima.x + ultima.w : '?'}, "+" a ${piena.nuovo?.x}`)
  check('non è spinto all\'estremità destra della barra', !!piena.nuovo && !!piena.barra && piena.nuovo.x + piena.nuovo.w < piena.barra.x + piena.barra.w - 100)

  // 3. con una tab centrale attiva, il "+" apre A DESTRA (subito dopo quella attiva)
  await page.clickWhere(`(() => {
    const wrap = [...document.querySelectorAll('[title]')].find(e => (e.getAttribute('title') || '').startsWith('Query 1 '));
    return wrap ? (wrap.querySelector('button') || wrap) : null;
  })()`)
  await sleep(700)
  await page.clickWhere(`[...document.querySelectorAll('button')].find(b => (b.getAttribute('title') || '').startsWith('Nuova query'))`)
  await sleep(900)
  const dopo = await misura()
  const ordine = dopo.tabs.map(t => t.t)
  const primaOrdine = piena.tabs.map(t => t.t)
  const nuova = ordine.find(t => !primaOrdine.includes(t))
  console.log(`  ordine dopo il "+" con la prima tab attiva: ${JSON.stringify(ordine)} (nuova: ${nuova})`)
  check(
    'la nuova tab si apre a DESTRA, subito dopo quella attiva',
    !!nuova && ordine.indexOf(nuova) === 1 && ordine[0] === primaOrdine[0],
    ordine.join(' | '),
  )

  const falliti = esiti.filter(e => !e).length
  console.log(`\nesito: ${esiti.length - falliti}/${esiti.length} controlli superati`)
  if (falliti > 0) throw new Error(`${falliti} controlli falliti`)
}

async function main() {
  const { proc, profileDir } = launchBrowser()
  let page
  try {
    page = await newPage()
    console.log(`apro ${APP_URL}`)
    await page.send('Page.navigate', { url: APP_URL })
    await sleep(3000)

    if (DUMP) {
      const info = await page.eval(`(() => {
        const els = [...document.querySelectorAll('button, input, select, a, [role="button"]')];
        return els.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
          .map(e => e.tagName + ' | ' + (e.textContent||'').trim().slice(0,60) + ' | ' + (e.getAttribute('placeholder')||'') + ' | ' + (e.getAttribute('title')||'').slice(0,60));
      })()`)
      console.log(info.join('\n'))
      return
    }

    if (VERIFY_TABS) {
      await verifyTabPositions(page)
      return
    }

    if (VERIFY_ERRORS) {
      await verifyErrorMessages(page)
      return
    }

    if (VERIFY_TAB_CURSOR) {
      await verifyTabCursor(page)
      return
    }

    if (VERIFY_FORMAT) {
      await verifyFormat(page)
      return
    }

    if (VERIFY_SCHEMA_REFRESH) {
      await verifySchemaRefresh(page)
      return
    }

    if (VERIFY_PAIR_HIGHLIGHT) {
      await verifyPairHighlight(page)
      return
    }

    if (VERIFY_LOCAL_TABLES) {
      await verifyLocalTables(page)
      return
    }

    if (VERIFY_ALIAS) {
      await verifyAlias(page)
      return
    }

    if (VERIFY_LABELS) {
      await verifyLabels(page)
      return
    }

    if (VERIFY_ERROR_LINE) {
      await verifyErrorLine(page)
      return
    }

    if (MEASURE_TYPING) {
      await measureTyping(page)
      return
    }

    if (VERIFY_SCROLLBARS) {
      await verifyScrollbars(page)
      return
    }

    if (VERIFY_TABTREE) {
      await verifyTabTree(page)
      return
    }

    if (VERIFY_SEARCH) {
      await verifySearch(page)
      return
    }

    if (VERIFY_INDENT) {
      await verifyIndent(page)
      return
    }

    if (VERIFY_DROP) {
      await verifyDrop(page)
      return
    }

    if (VERIFY_FRAGMENT) {
      await verifyFragment(page)
      return
    }

    if (VERIFY_SIDEBAR) {
      await verifySidebar(page)
      return
    }

    if (VERIFY_CHANGES) {
      await verifyChanges(page)
      return
    }

    if (VERIFY_MERGE) {
      await verifyMerge(page)
      return
    }

    if (VERIFY_PARAMS) {
      await verifyParams(page)
      return
    }

    if (VERIFY_MULTIRIGA) {
      await verifyMultiriga(page)
      return
    }

    if (VERIFY_TEMA) {
      await verifyTema(page)
      return
    }

    if (VERIFY_CREATE) {
      await verifyCreate(page)
      return
    }

    if (VERIFY_SET) {
      await verifySet(page)
      return
    }

    if (VERIFY_COPIA) {
      await verifyCopia(page)
      return
    }

    if (VERIFY_TRIGGER) {
      await verifyTrigger(page)
      return
    }

    if (VERIFY_INIZIO) {
      await verifyInizio(page)
      return
    }

    if (VERIFY_CURSORI_CORTI) {
      await verifyCursoriCorti(page)
      return
    }

    if (VERIFY_REPORT) {
      await verifyReport(page)
      return
    }

    if (VERIFY_HOVER) {
      await verifyHover(page)
      return
    }

    if (DUMP_GENERATOR) {
      await dumpGenerator(page)
      return
    }

    if (DUMP_TABBAR) {
      await dumpTabbar(page)
      return
    }

    // ---------------------------------------------------------------- 1. login
    console.log('1. schermata di login')
    await page.waitFor(`document.querySelector('input')`, 10000)
    await sleep(800)
    await page.screenshot('01-login')

    // ------------------------------------------- 2. connessione al database reale
    console.log('2. connessione (login salvata)')
    const clicked = await page.clickWhere(
      `[...document.querySelectorAll('[title="Clicca per connetterti con questa login"]')]
         .find(e => (e.textContent || '').includes(${JSON.stringify(LOGIN_NAME)}))`,
    )
    if (!clicked) throw new Error(`login salvata "${LOGIN_NAME}" non trovata`)
    await page.waitFor(`document.querySelector('.monaco-editor')`, 30000, 'editor pronto')
    // lo schema serve all'intellisense e al diagramma: si aspetta che la sidebar lo mostri
    await page.waitFor(`document.body.textContent.includes('Tabelle')`, 30000, 'schema caricato')
    await sleep(2500)
    await page.screenshot('02-schema-editor')
    console.log(
      '  controllo: ' +
        (await page.eval(`(() => {
          const testo = document.body.textContent || '';
          const righe = document.querySelectorAll('.monaco-editor .view-line').length;
          const tabelle = (testo.match(/(\\d[\\d.]*)\\s*Tabelle/) || [])[1] || '?';
          return 'righe editor=' + righe + ' tabelle in albero=' + tabelle + ' connesso=' + !document.querySelector('input[placeholder*="SQLEXPRESS"]');
        })()`)),
    )

    // ------------------------------------------------- 3. intellisense nel codice
    console.log('3. intellisense')
    const rect = await editorRect(page)
    if (!rect) throw new Error('editor non trovato')
    await page.clickPoint(rect.x + 160, rect.y + 18) // clic dentro l'editor: prende il fuoco
    await sleep(400)
    await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 }) // Ctrl+A: sostituisce il testo di esempio
    await page.typeText('SELECT * FROM ')
    await sleep(300)
    await page.press(' ', { code: 'Space', vk: 32, modifiers: 2 }) // Ctrl+Space: apre i suggerimenti
    await sleep(1800)
    await page.screenshot('03-intellisense')
    console.log(
      '  controllo: ' +
        (await page.eval(`(() => {
          const w = document.querySelector('.suggest-widget');
          const visibile = !!w && w.getBoundingClientRect().height > 0;
          const voci = document.querySelectorAll('.suggest-widget .monaco-list-row').length;
          return 'popup visibile=' + visibile + ' suggerimenti=' + voci;
        })()`)),
    )
    await page.press('Escape', { code: 'Escape', vk: 27 })
    await sleep(300)

    // ------------------------------------------------------------- 4. risultati
    console.log('4. esecuzione query e griglia risultati')
    await page.press('a', { code: 'KeyA', vk: 65, modifiers: 2 })
    await page.typeText(QUERY)
    await sleep(500)
    await page.press('F5', { code: 'F5', vk: 116 })
    await page.waitFor(`document.body.textContent.includes('per pagina')`, 40000, 'griglia dei risultati')
    await sleep(2000)
    await page.screenshot('04-risultati')
    console.log(
      '  controllo: ' +
        (await page.eval(`(() => {
          const trs = [...document.querySelectorAll('tbody tr')];
          const bgs = trs.slice(0, 3).map(tr => (tr.className.match(/bg-\\[#[0-9a-f]+\\]/) || [''])[0]);
          const head = document.querySelector('thead th');
          return 'righe=' + trs.length + ' colori=' + JSON.stringify(bgs) + ' prima intestazione=' + JSON.stringify((head?.textContent || '').trim()) + ' linee=' + [...document.querySelectorAll('thead th')].every(th => th.className.includes('border-r'));
        })()`)),
    )

    // --------------------------------------------------------- 5. diagramma chiamate
    // Si passa dall'albero laterale: il suo menu contestuale è React (risponde agli eventi
    // sintetici), mentre quello nativo di Monaco in modalità headless non si apre.
    console.log('5. diagramma delle chiamate (dall albero laterale)')
    const typed = await page.eval(`(() => {
      const input = [...document.querySelectorAll('input')].find(i => (i.placeholder || '').includes('Cerca'));
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(ROUTINE_NAME)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`)
    if (!typed) console.log('  (campo di ricerca non trovato)')
    await page.waitFor(
      `[...document.querySelectorAll('*')].some(e => e.children.length === 0 && (e.textContent || '').trim() === ${JSON.stringify(ROUTINE_NAME)})`,
      15000,
      'risultato della ricerca',
    )
    await sleep(700)
    const menuOpened = await page.eval(`(() => {
      const leaf = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && (e.textContent || '').trim() === ${JSON.stringify(ROUTINE_NAME)})[0];
      if (!leaf) return false;
      leaf.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }));
      return true;
    })()`)
    if (!menuOpened) console.log('  (risultato non trovato: salto il diagramma)')
    await sleep(900)
    const opened = await page.clickWhere(
      `[...document.querySelectorAll('button, [role="menuitem"], div')]
         .filter(e => (e.textContent || '').trim() === 'Diagramma chiamate')[0]`,
    )
    if (!opened) console.log('  (voce "Diagramma chiamate" non trovata nel menu)')
    await page.waitFor(`document.body.textContent.includes('Diagramma chiamate —')`, 40000, 'finestra del diagramma')
    // il grafo arriva dal backend: si aspetta che i nodi siano DISEGNATI, non solo la finestra
    await page.waitFor(`document.querySelectorAll('svg g rect').length > 8`, 45000, 'nodi del diagramma disegnati')
    await sleep(1500)
    await page.screenshot('05-diagramma-chiamate')
    console.log(
      '  controllo: ' +
        (await page.eval(`(() => {
          const rects = document.querySelectorAll('svg g rect').length;
          const links = document.querySelectorAll('svg g path').length;
          const cycles = document.querySelectorAll('svg g path[stroke-dasharray]').length;
          const title = (document.body.textContent.match(/Diagramma chiamate — [^\\n]{0,60}/) || [''])[0];
          return 'nodi=' + Math.round(rects / 2) + ' legami=' + links + ' cicli=' + cycles + ' titolo=' + JSON.stringify(title.trim());
        })()`)),
    )
  } finally {
    try {
      proc.kill()
    } catch {
      /* ignora */
    }
    await sleep(500)
    try {
      rmSync(profileDir, { recursive: true, force: true })
    } catch {
      /* ignora */
    }
  }
}

main().catch(e => {
  console.error('ERRORE:', e.message)
  process.exit(1)
})
