// Genera il fixture con alcune definizioni REALI di stored procedure/funzioni del DB,
// usato dai test che controllano "Modifica" (CREATE OR ALTER) su testo vero.
//
// Serve perché gli header reali non sono come ce li si immagina: molti iniziano con uno
// o più commenti a blocco /* ... */ separati da righe vuote, e il bug segnalato
// ("CREATE OR ALTER attaccato al commento") nasceva proprio da lì.
//
// Uso: node scripts/makeDefinitionsFixture.mjs [idLogin] [database] [fileUscita]

import { writeFileSync } from 'node:fs'

const API = process.env.SQLINTELLI_API ?? 'http://localhost:5213'
const loginId = process.argv[2] ?? '3'
const database = process.argv[3] ?? 'WSBRITVIC'
const outFile = process.argv[4] ?? 'src/__tests__/fixtures/realDefinitions.ts'

/** Quante definizioni campionare. */
const HOW_MANY = 6
/** Quanti caratteri tenere per definizione (bastano header + intestazione dell'istruzione). */
const MAX_CHARS = 1500

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

async function get(path) {
  const res = await fetch(`${API}${path}`)
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

const connected = await post(`/api/connections/saved/${loginId}/connect`)
const session = await post(`/api/connections/${connected.connectionId}/switch-database`, { database })
const summary = await get(`/api/metadata/${session.connectionId}/summary`)

// Si scelgono procedure con header diversi: con commento a blocco, con più commenti,
// con commento di riga, e una che parte direttamente con CREATE.
const candidates = summary.procedures
  .map(p => `${p.schema}.${p.name}`)
  .filter(n => !/zzz|test/i.test(n))
  .slice(0, 60)

const picked = []
for (const full of candidates) {
  if (picked.length >= HOW_MANY) break
  const [schema, name] = full.split('.')
  let definition
  try {
    definition = (await get(`/api/metadata/${session.connectionId}/objects/${schema}/${name}/definition`)).definition
  } catch {
    continue
  }
  if (typeof definition !== 'string') continue
  const excerpt = definition.slice(0, MAX_CHARS)
  // serve solo se l'intestazione CREATE/ALTER è dentro l'estratto
  if (!/(CREATE|ALTER)\s+(OR\s+ALTER\s+)?(PROC|PROCEDURE|FUNCTION)/i.test(excerpt)) continue
  picked.push({ name: full, definition: excerpt })
}

const body = picked
  .map(d => `  {\n    name: ${JSON.stringify(d.name)},\n    definition: ${JSON.stringify(d.definition)},\n  },`)
  .join('\n')

writeFileSync(
  outFile,
  `// File GENERATO da scripts/makeDefinitionsFixture.mjs — non modificare a mano.
// Definizioni reali (estratti) dal database ${database}. Rigenera con:
//   node scripts/makeDefinitionsFixture.mjs ${loginId} ${database}
/* eslint-disable */

/** Estratti reali di definizioni: header + intestazione dell'istruzione. */
export const realDefinitions: { name: string; definition: string }[] = [
${body}
]
`,
  'utf8',
)

console.log(`scritto ${outFile} con ${picked.length} definizioni`)
for (const p of picked) {
  const head = p.definition.slice(0, 60).replace(/\r/g, '\\r').replace(/\n/g, '\\n')
  console.log(`  ${p.name}: ${head}`)
}
