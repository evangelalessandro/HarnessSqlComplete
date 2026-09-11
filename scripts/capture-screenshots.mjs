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
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      }
    })
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
