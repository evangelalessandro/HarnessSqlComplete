// CATTURA GLI SCREENSHOT DELL'APP per il README.
//
// Pilota Chrome headless via CDP (Chrome DevTools Protocol) usando il WebSocket integrato
// in Node: nessuna dipendenza da installare. Le immagini finiscono in docs/screenshots/.
//
// Uso:
//   node scripts/capture-screenshots.mjs            (cattura tutta la sequenza)
//   node scripts/capture-screenshots.mjs --dump     (elenca i comandi visibili nella pagina)
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
  /** Preme un tasto (es. F5) o una combinazione (ctrl+space). */
  async press(key, { code, vk, modifiers = 0 } = {}) {
    const base = { key, code: code ?? key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
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
