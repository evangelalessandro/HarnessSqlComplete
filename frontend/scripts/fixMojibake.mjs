// RIPARA I CARATTERI DOPPIAMENTE CODIFICATI (mojibake) nei sorgenti.
//
// Sintomo segnalato: nell'intellisense e nei commenti si legge la sequenza rotta
// (a-circumflex + euro + virgoletta tipografica) invece del trattino lungo "—".
// Causa: il testo è stato convertito due volte: i byte UTF-8 di "—" (E2 80 94) sono stati
// riletti come Windows-1252 — dove 0x80 è il simbolo dell'euro e 0x94 è la virgoletta
// tipografica di chiusura — e risalvati in UTF-8. Per questo le sequenze rotte contengono
// caratteri che SEMBRANO virgolette normali ma non lo sono: la tabella va costruita dai
// caratteri veri, non a occhio.
//
// Qui la riparazione è deterministica: si prende ogni sequenza che comincia con i caratteri
// spia (le lettere latine che corrispondono ai byte C2, C3, E2, F0 — mai legittime in
// italiano), si riportano i caratteri ai byte CP1252 originali e si decodificano come UTF-8.
// Il risultato viene accettato solo se è un carattere plausibile (accento, punteggiatura,
// simbolo, emoji).
//
// Uso:  node scripts/fixMojibake.mjs          (prova a vuoto: elenca cosa cambierebbe)
//       node scripts/fixMojibake.mjs --apply  (applica)

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'

const APPLY = process.argv.includes('--apply')
const ROOT = process.cwd()

const EXTENSIONS = new Set(['.ts', '.tsx', '.cs', '.css', '.html', '.json', '.md', '.mjs', '.js', '.sql'])
const SKIP_DIRS = new Set(['node_modules', 'bin', 'obj', 'dist', '.git', '.vite'])

/** Tabella inversa di Windows-1252: carattere → byte originale. */
const CP1252_BYTE = (() => {
  const map = new Map()
  for (let b = 0; b <= 0xff; b++) map.set(String.fromCharCode(b), b)
  const special = {
    0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
    0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
    0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
    0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
    0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
    0x9e: 0x017e, 0x9f: 0x0178,
  }
  for (const [byte, code] of Object.entries(special)) map.set(String.fromCharCode(code), Number(byte))
  return map
})()

/** Caratteri che aprono una sequenza doppiamente codificata (byte C2/C3/E2/F0 letti come CP1252). */
const LEAD = /[\u00C2\u00C3\u00E2\u00F0]/

/** Caratteri ammessi come risultato (accenti, punteggiatura tipografica, frecce, simboli, emoji). */
function plausible(ch) {
  const c = ch.codePointAt(0)
  return (
    (c >= 0x00a0 && c <= 0x00ff) || // accenti e simboli latini (à è ù · »)
    (c >= 0x2000 && c <= 0x2bff) || // punteggiatura, frecce, simboli (— … → ★ ⭐ ⚠ ● ◆ ✅)
    (c >= 0x3000 && c <= 0x303f) ||
    (c >= 0xfe00 && c <= 0xfe0f) || // selettore di variante (️)
    (c >= 0x1f000 && c <= 0x1faff) // emoji (🐞 🔥)
  )
}

/** Ripara una sequenza: caratteri CP1252 → byte → testo UTF-8. null se non è riparabile. */
function repair(seq) {
  const bytes = []
  for (const ch of seq) {
    const b = CP1252_BYTE.get(ch)
    if (b === undefined) return null
    bytes.push(b)
  }
  const decoded = Buffer.from(bytes).toString('utf8')
  if (decoded.includes('\uFFFD')) return null
  if (decoded === seq) return null
  if ([...decoded].some(ch => !plausible(ch))) return null
  return decoded
}

/** Sequenza riparabile più lunga che comincia a `i` (max 4 caratteri). */
function sequenceAt(text, i) {
  for (let len = 4; len >= 2; len--) {
    const seq = text.slice(i, i + len)
    if (seq.length < len) continue
    const fixed = repair(seq)
    if (fixed !== null) return { seq, fixed }
  }
  return null
}

/** Pezzi rimasti da soli (coda di una sequenza già riparata), es. il selettore di variante. */
const FIXUPS = [
  // i tre caratteri che corrispondono ai byte EF B8 8F = selettore di variante U+FE0F
  // (resta dopo il simbolo di avviso, che è una sequenza a sé)
  ['\u00EF\u00B8\u008F', '\uFE0F'],
  ['\u00FE\u000F', '\uFE0F'],
]

/** Escape leggibile e senza ambiguità (le virgolette tipografiche sembrano quelle normali). */
function esc(s) {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)
    out += c >= 0x20 && c <= 0x7e ? ch : `\\u${c.toString(16).padStart(4, '0')}`
  }
  return out
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (EXTENSIONS.has(extname(entry))) out.push(full)
  }
  return out
}

/** Ripara il testo e restituisce anche l'elenco delle sostituzioni fatte. */
function repairText(text) {
  let out = ''
  let i = 0
  const done = new Map()
  while (i < text.length) {
    if (LEAD.test(text[i])) {
      const found = sequenceAt(text, i)
      if (found) {
        out += found.fixed
        i += found.seq.length
        const key = `${esc(found.seq)} -> ${esc(found.fixed)}`
        done.set(key, (done.get(key) ?? 0) + 1)
        continue
      }
    }
    out += text[i]
    i++
  }
  for (const [broken, fixed] of FIXUPS) {
    if (!out.includes(broken)) continue
    const hits = out.split(broken).length - 1
    out = out.split(broken).join(fixed)
    const key = `${esc(broken)} -> ${esc(fixed)}`
    done.set(key, (done.get(key) ?? 0) + hits)
  }
  return { out, done }
}

const files = walk(ROOT)
const counts = new Map()
const touched = []
let total = 0

for (const file of files) {
  const original = readFileSync(file, 'utf8')
  const { out, done } = repairText(original)
  const fileCount = [...done.values()].reduce((s, n) => s + n, 0)
  for (const [key, n] of done) counts.set(key, (counts.get(key) ?? 0) + n)
  if (fileCount > 0) {
    touched.push(file)
    total += fileCount
    if (APPLY) writeFileSync(file, out, 'utf8')
  }
}

console.log(APPLY ? '=== RIPARAZIONE APPLICATA ===' : '=== PROVA A VUOTO (nessun file modificato) ===')
console.log(`file analizzati: ${files.length} · file da correggere: ${touched.length} · sostituzioni: ${total}`)
console.log('\nsostituzioni distinte (sequenze in escape: \\u201d è la virgoletta tipografica):')
for (const [key, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)} × ${key}`)
}
console.log('\nfile:')
for (const f of touched) console.log(`  ${relative(ROOT, f)}`)

// Residui: righe che, DOPO la riparazione, contengono ancora un carattere spia
console.log('\nrighe con caratteri ancora sospetti (dopo la riparazione):')
let left = 0
for (const file of files) {
  const { out } = repairText(readFileSync(file, 'utf8'))
  out.split(/\r?\n/).forEach((line, i) => {
    if (/[\u00C2\u00C3\u00E2\u00F0]/.test(line) || line.includes('\u00EF\u00B8')) {
      left++
      if (left <= 30) console.log(`  ${relative(ROOT, file)}:${i + 1}: ${esc(line.trim().slice(0, 130))}`)
    }
  })
}
console.log(`  totale: ${left}`)
