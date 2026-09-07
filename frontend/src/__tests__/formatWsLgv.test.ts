// Verifica: formattando ws_LGV_Redirection (SP reale con molti commenti in posizioni
// difficili) NON si devono rompere statement o commenti (bug: i commenti "--" seguiti
// da codice accodato sulla stessa riga commentavano via il resto della query; il ";"
// di ";WITH" spariva).
import { describe, expect, it } from 'vitest'
import rawSql from './fixtures/ws_LGV_Redirection.sql?raw'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'
import { formatSqlWithProfile, tokenizeSqlText } from '../tsqlFormatter'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)
const sql = rawSql

/** Sequenza di token "significativi" (niente commenti/spazi): parole minuscole + punteggiatura + stringhe identiche. */
function meaningfulTokens(text: string): string[] {
  return tokenizeSqlText(text)
    .filter(t => t.type !== 'comment')
    .map(t => (t.type === 'word' ? t.text.toLowerCase() : t.text))
}

describe('fixture ws_LGV_Redirection (commenti che non devono rompere la SP)', () => {
  it('formatta senza perdere o alterare alcun token SQL', () => {
    let out: string
    expect(() => {
      out = formatSqlWithProfile(sql, profile)
    }).not.toThrow()
    expect(out!.length).toBeGreaterThan(0)
    // confronto multiset: nessun token (es. il ";" di ";WITH" o codice dopo "--") perso/duplicato
    const count = (xs: string[]) => {
      const m = new Map<string, number>()
      for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
      return m
    }
    const ma = count(meaningfulTokens(sql))
    const mb = count(meaningfulTokens(out!))
    const freqDiff: string[] = []
    for (const [t, n] of ma) {
      const nb = mb.get(t) ?? 0
      if (nb !== n) freqDiff.push(`"${t}": input ${n} → output ${nb}`)
    }
    for (const [t, n] of mb) {
      if (!ma.has(t)) freqDiff.push(`"${t}": output ${n} (assente in input)`)
    }
    expect(freqDiff).toEqual([])
  })

  it('i commenti a blocco restano bilanciati dopo la formattazione', () => {
    const out = formatSqlWithProfile(sql, profile)
    const open = (out.match(/\/\*/g) ?? []).length
    const close = (out.match(/\*\//g) ?? []).length
    expect(open).toBe(close)
  })

  it('mantiene tutte le label e le istruzioni chiave della SP', () => {
    const out = formatSqlWithProfile(sql, profile)
    for (const key of ['Evac:', 'Search_other:', 'ShowOutput:', 'end_ok:', 'end_err:', 'goto Evac', 'ALTER PROCEDURE', 'update dbo.RUN_MISSIONI', 'output inserted.MIS_MISSIONE', '; with tbl_master_bays']) {
      expect(out.toLowerCase()).toContain(key.toLowerCase())
    }
  })
})
