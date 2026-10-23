// ALLINEAMENTO DEGLI ALIAS NELLA SELECT-LIST (passaggio finale, valido per tutti i motori).
//
// Segnalazione utente: "non mette in colonna gli alias dei campi nella cte".
// L'allineamento esisteva solo nel motore delle routine (stackSelectList): il corpo della CTE — e le
// query semplici — passano dal motore query, dove gli alias restavano attaccati al campo. Qui si fa
// un passaggio finale sul testo già formattato: in OGNI blocco di select-list impilata gli alias
// partono dalla stessa colonna. È idempotente: rieseguirlo non cambia niente.

import { splitAliasItem, tokenizeSqlText } from './tsqlFormatter'

/** Testo di un token così com'è in uscita dal formattatore (parole così come sono, il resto identico). */
const cosi = (t: { text: string }): string => t.text

/** Riga di select-list: indentazione, eventuale virgola in testa e resto. */
function partiRiga(riga: string): { indent: string; virgola: boolean; resto: string } | null {
  const m = /^(\s*)(,?)(.*)$/.exec(riga)
  if (!m) return null
  return { indent: m[1], virgola: m[2] === ',', resto: m[3] }
}

/**
 * Allinea gli alias di un blocco di select-list impilata (la prima riga è quella del SELECT, le
 * successive iniziano con la virgola). Si allinea solo se ci sono ALMENO DUE campi con alias; i campi
 * senza alias non vengono toccati. Restituisce le righe (stessa lunghezza dell'input).
 */
export function allineaBlocco(righe: string[]): string[] {
  const fuori = [...righe]
  const voci = righe.map((riga, idx) => {
    const p = partiRiga(riga)
    if (!p || p.resto.trim() === '') return null
    const split = splitAliasItem(tokenizeSqlText(p.resto), cosi)
    if (!split) return null
    const prefisso = `${p.indent}${p.virgola ? ',' : ''}`
    return { idx, prefisso, expr: split.expr, alias: split.alias, commento: split.commento }
  })
  const conAlias = voci.filter((v): v is NonNullable<typeof v> => !!v)
  if (conAlias.length < 2) return fuori
  const colonna = Math.max(...conAlias.map(v => v.prefisso.length + v.expr.length)) + 1
  for (const v of conAlias) {
    const finOra = v.prefisso.length + v.expr.length
    const spazi = ' '.repeat(Math.max(1, colonna - finOra))
    fuori[v.idx] = `${v.prefisso}${v.expr}${spazi}${v.alias}${v.commento ? ` ${v.commento}` : ''}`
  }
  return fuori
}

/**
 * Passaggio finale su un testo SQL già formattato: trova i blocchi di select-list impilata e allinea
 * gli alias. Non tocca nient'altro (le altre liste — DECLARE, EXEC, INSERT — hanno intestazioni
 * diverse e restano come sono).
 */
export function allineaAliasSelectList(testo: string): string {
  if (!testo || !testo.includes(',')) return testo
  const righe = testo.split('\n')
  let i = 0
  while (i < righe.length) {
    // testa del blocco: "SELECT …" (anche preceduto da una parentesi aperta)
    if (!/^\s*\(?\s*SELECT\b/i.test(righe[i])) {
      i++
      continue
    }
    let j = i + 1
    while (j < righe.length && /^\s*,/.test(righe[j])) j++
    const blocco = righe.slice(i, j)
    const allineato = allineaBlocco(blocco)
    for (let k = 0; k < allineato.length; k++) righe[i + k] = allineato[k]
    i = j
  }
  return righe.join('\n')
}
