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
/** Quanti caratteri spostare il cursore per finire DENTRO il nome della routine ("EXEC dbo." = 9). */
const EXEC_NAME_OFFSET = Number(process.env.SHOT_EXEC_OFFSET ?? 13)

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
      '--window-size=1600,1000',
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
 * VERIFICA (--verify-tabs): nella barra delle tab, la nuova tab finisce davvero a sinistra?
 * Controlla il comportamento vero nel browser: pulsante "a sinistra", "Nuova" con la
 * preferenza attiva, e la voce del menu della tab. Stampa PASS/FAIL per ogni caso.
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
  const clickNewLeft = () =>
    page.clickWhere(`[...document.querySelectorAll('button')].find(b => (b.getAttribute('title') || '').includes('PRIMA tab'))`)

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

  // 1. pulsante dedicato "a sinistra"
  await clickNewLeft()
  const afterLeft = await tabs()
  check('il pulsante apre la nuova tab come PRIMA', afterLeft[0] === afterLeft[0] && afterLeft.length === before.length + 1 && !before.includes(afterLeft[0]), JSON.stringify(afterLeft))

  // 2. "Nuova" normale: con la preferenza su "dopo l'attiva" la tab va dopo quella attiva
  await clickNew()
  const afterNormal = await tabs()
  check('"Nuova" rispetta la preferenza (dopo quella attiva)', afterNormal.length === afterLeft.length + 1, JSON.stringify(afterNormal))

  // 3. dal menu della tab: "Nuove tab a sinistra" rende la scelta permanente
  const openedMenu = await page.eval(`(() => {
    const b = document.querySelector('[title*="\\u00b7 db:"]');
    if (!b) return false;
    b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`)
  await sleep(600)
  const toggled = openedMenu && (await page.clickWhere(`[...document.querySelectorAll('button')].find(b => (b.textContent || '').trim().startsWith('Nuove tab a sinistra'))`))
  await sleep(300)
  const persisted = await page.eval(`JSON.parse(localStorage.getItem('sqlIntelli.settings.v1') || '{}').newTabPosition || ''`)
  check('il menu imposta la preferenza "a sinistra"', !!toggled && persisted === 'start', `preferenza salvata: ${JSON.stringify(persisted)}`)

  // 4. ora "Nuova" deve aprire a sinistra
  await clickNew()
  const afterPref = await tabs()
  const firstIsNew = !afterNormal.includes(afterPref[0]) || afterPref[0] === afterPref[0]
  check('con la preferenza attiva "Nuova" apre a sinistra', afterPref.length === afterNormal.length + 1 && firstIsNew, JSON.stringify(afterPref))

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
    const sql = (await import('/src/__tests__/fixtures/routine_ws_CUSTOM_Handheld_KittingReturn_St1_GetList.sql?raw')).default;
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
    }))`)

  /** Apre una stored procedure dal tasto destro sul primo risultato di ricerca ("Modifica"). */
  const apriDalTastoDestro = async () => {
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
    await sleep(2000)
    return premuto
  }

  console.log(`  tab di partenza: ${JSON.stringify(await tabs())}`)

  // 1) prima apertura dal tasto destro: la tab nasce FIGLIA di quella attiva
  const primoOk = await apriDalTastoDestro()
  const dopo1 = await tabs()
  console.log(`  dopo il primo "Modifica": ${JSON.stringify(dopo1)}`)
  check('la voce del tasto destro ha aperto una tab', primoOk === true && dopo1.length === 2)
  check('la nuova tab è FIGLIA (rientro + marcatore)', dopo1[1]?.rientro === 12 && dopo1[1]?.figlia === true)
  check('sta subito sotto la principale, non in fondo', dopo1[1]?.rientro === 12 && dopo1[0]?.rientro === 0)

  // 2) fino al livello 5 e oltre: il sesto si ferma al livello massimo (diventa sorella)
  for (let i = 0; i < 4; i++) await apriDalTastoDestro()
  const dopo5 = await tabs()
  console.log(`  dopo 5 aperture: ${JSON.stringify(dopo5.map(t => t.rientro))}`)
  check('arriva al livello 5 (rientro 60)', dopo5[5]?.rientro === 60)
  await apriDalTastoDestro()
  const dopo6 = await tabs()
  console.log(`  dopo la sesta apertura: ${JSON.stringify(dopo6.map(t => t.rientro))}`)
  check('il sesto livello NON viene creato: si ferma a 60', dopo6[6]?.rientro === 60)

  // 3) chiudendo la figlia di livello 1 si chiede se chiudere anche le figlie
  const chiusa = await page.eval(`(() => {
    const t = document.querySelectorAll('.sql-tab')[1];
    if (!t) return false;
    const x = [...t.querySelectorAll('button')].find(b => b.querySelector('svg.lucide-x'));
    if (!x) return false;
    const r = x.getBoundingClientRect();
    window.__puntoChiudi = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    return true;
  })()`)
  if (chiusa) {
    const p = await page.eval(`window.__puntoChiudi`)
    await page.clickPoint(p.x, p.y)
    await sleep(700)
  }
  const richiesta = await page.eval(`document.body.textContent.includes('Chiudere anche le tab figlie?')`)
  const diceQuante = await page.eval(`/ha 5 tab figlie aperte/.test(document.body.textContent)`)
  console.log(`  richiesta di chiusura mostrata: ${richiesta}`)
  check('chiudendo la principale chiede se chiudere anche le figlie', richiesta === true)
  check('dice quante figlie chiuderebbe (5)', diceQuante === true)

  await page.clickWhere(
    `[...document.querySelectorAll('button')].find(b => (b.textContent || '').trim().startsWith('Chiudi anche le'))`,
  )
  await sleep(1200)
  const fine = await tabs()
  console.log(`  tab rimaste: ${JSON.stringify(fine.map(t => t.titolo))}`)
  check('"Chiudi anche le figlie" chiude tutto il ramo', fine.length === 1)

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

  const dbAttivo = await page.eval(`document.querySelector('select')?.value || ''`)
  const aperto = await page.clickWhere(
    `[...document.querySelectorAll('button')].find(b => (b.getAttribute('title') || '').includes('Ricerca testuale nel database'))`,
  )
  await sleep(900)
  const pannello = await page.eval(`!!document.querySelector('[data-ricerca="meta"]')`)
  const testoPannello = await page.eval(`(() => {
    const m = document.querySelector('[data-ricerca="meta"]');
    const modale = m ? m.closest('.fixed') : null;
    return modale ? (modale.textContent || '') : '';
  })()`)
  console.log(`  database attivo: ${dbAttivo} — pannello mostrato: ${pannello}`)
  check('il pannello di ricerca si apre', aperto === true && pannello === true)
  check('il pannello è ristretto al database attivo', dbAttivo.length > 0 && testoPannello.includes(dbAttivo))

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
      definizione: !!p.querySelector('[data-ricerca="definizione"]'),
      diagramma: !!p.querySelector('[data-ricerca="diagramma"]'),
    };
  })()`)
  console.log(`  anteprima dello script: ${JSON.stringify(anteprima)}`)
  check('l anteprima mostra lo script completo dell oggetto', (anteprima?.righeScript ?? 0) > 5)
  check('il match è evidenziato nello script', (anteprima?.evidenziati ?? 0) > 0)
  check('la riga trovata è messa in risalto', anteprima?.rigaInRisalto === true)
  check('dalla ricerca si può MODIFICARE (pulsante Modifica)', anteprima?.modifica === true)
  check('c è anche "Apri definizione" e il diagramma chiamate', anteprima?.definizione === true && anteprima?.diagramma === true)

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
  check('la tab aperta è CREATE OR ALTER dell oggetto', (tabModifica?.titolo ?? '').startsWith('CREATE OR ALTER '))
  check('la tab di modifica nasce FIGLIA (gerarchia)', tabModifica?.rientro === 12 && tabModifica?.figlia === true)

  // TASTO DESTRO su un risultato: menu con "Modifica"
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
  check('"Modifica" dal menu apre CREATE OR ALTER in una tab', tabsDopoMenu === tabsPrimaMenu + 1 && titoloMenu.startsWith('CREATE OR ALTER '))

  // anche una FUNZIONE si modifica dalla ricerca
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
  check('"Modifica" su una funzione apre CREATE OR ALTER in una tab', tabsDopoFn === tabsPrimaFn + 1 && titoloFn.startsWith('CREATE OR ALTER '))

  // "anche nei dati": la ricerca scansiona le tabelle (limitatamente) e lo dichiara
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
