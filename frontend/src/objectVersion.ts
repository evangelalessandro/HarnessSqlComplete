// "VERSIONE DI PARTENZA" DI UN OGGETTO APERTO IN MODIFICA.
//
// Aprendo una store/funzione/vista in Modifica, la tab lavora su una FOTOGRAFIA della definizione
// letta dal database. Se nel frattempo la definizione cambia (un'altra tab, un altro utente, un
// altro strumento), chi prosegue rischia di sovrascrivere la versione nuova con quella vecchia.
// Richiesta utente: "se apro in edit una store\funzione mostrami se ce n'era una già aperta e se
// sto lavorando da una versione di partenza che è vecchia".
//
// Qui c'è solo la parte PURA (riconoscere la tab che ha già l'oggetto, impronta della definizione,
// confronto): l'app la usa per la tab e per l'avviso.
import type { EditorTab, ObjectRef } from './types'

/** Due oggetti sono lo stesso oggetto se coincidono schema e nome (senza badare alle maiuscole). */
export function chiaveOggetto(schema: string, name: string): string {
  return `${schema.trim().toLowerCase()}.${name.trim().toLowerCase()}`
}

/**
 * La tab che ha già aperto QUEL oggetto (la prima, esclusa eventualmente una tab).
 * Serve a non aprire due volte la stessa store e a dirlo all'utente.
 */
export function trovaTabOggetto(
  tabs: EditorTab[],
  schema: string,
  name: string,
  escludiId?: string,
): EditorTab | undefined {
  const chiave = chiaveOggetto(schema, name)
  return tabs.find(
    t => t.id !== escludiId && t.objectRef && chiaveOggetto(t.objectRef.schema, t.objectRef.name) === chiave,
  )
}

/**
 * Impronta (FNV-1a a 32 bit, esadecimale) della definizione: cambia SOLO se cambia il testo.
 * I fine riga vengono normalizzati (CRLF/CR → LF) così un salvataggio che cambia solo la codifica
 * delle righe non fa credere che l'oggetto sia stato modificato.
 */
export function improntaDefinizione(testo: string): string {
  const s = testo.replace(/\r\n?/g, '\n')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** True se la definizione letta ADESSO dal database è diversa da quella di partenza della tab. */
export function versioneSuperata(baseHash: string, definizioneAttuale: string): boolean {
  return improntaDefinizione(definizioneAttuale) !== baseHash
}

/**
 * Testo "normalizzato" per il confronto: fine riga uniformati, spazi in fondo a ogni riga tolti,
 * righe vuote ai bordi tolte. Serve a riconoscere che la tab e il database hanno la STESSA
 * definizione anche se una delle due ha un ritorno a capo in più (capita eseguendo il CREATE OR
 * ALTER della tab: il database restituisce il testo salvato, che può differire solo in coda).
 */
export function normalizzaDefinizione(testo: string): string {
  return testo
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(r => r.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
}

/** True se la tab e il database hanno la STESSA definizione (a meno di spazi in coda). */
export function stessaDefinizione(a: string, b: string): boolean {
  return normalizzaDefinizione(a) === normalizzaDefinizione(b)
}

/**
 * Testo della tab a partire dalla definizione del database, secondo COME è stata aperta:
 * 'alter' → CREATE OR ALTER (la "Modifica"), 'open' → la definizione così com'è.
 */
export function testoPerLaTab(
  modo: ObjectRef['modo'],
  definizione: string,
  toCreateOrAlter: (d: string) => string,
): string {
  return modo === 'alter' ? toCreateOrAlter(definizione) : definizione
}

/**
 * La "fotografia" da mettere sulla tab quando si apre un oggetto in modifica.
 * `testoInTab` è il testo DAVVERO scritto nella tab (già trasformato in CREATE OR ALTER quando
 * si apre in "Modifica"): il confronto con la definizione riletta dal database si fa con la stessa
 * trasformazione, altrimenti la tab sembrerebbe sempre modificata.
 */
export function nuovoObjectRef(
  schema: string,
  name: string,
  kind: ObjectRef['kind'],
  modo: ObjectRef['modo'],
  testoInTab: string,
  apertoIl = Date.now(),
): ObjectRef {
  return { schema, name, kind, modo, baseHash: improntaDefinizione(testoInTab), openedAt: apertoIl }
}

/** Etichetta dell'oggetto come la mostra l'avviso: "dbo.X" oppure "X" per dbo. */
export function etichettaOggetto(schema: string, name: string): string {
  return schema.trim().toLowerCase() === 'dbo' ? name : `${schema}.${name}`
}

/** Testo leggibile di quando la tab è stata aperta (per l'avviso). */
export function quandoAperta(openedAt: number): string {
  const d = new Date(openedAt)
  const due = (n: number) => String(n).padStart(2, '0')
  return `${due(d.getDate())}/${due(d.getMonth() + 1)} ${due(d.getHours())}:${due(d.getMinutes())}`
}
