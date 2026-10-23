// Condizioni IF/WHILE lunghe (segnalazione utente: "la while exists non formatta quello che
// c'è dentro parentesi"): la condizione di un "WHILE EXISTS (SELECT … FROM … WHERE … AND …)"
// restava TUTTA su una riga, perché le condizioni di IF/WHILE venivano rese con rowsNoDashEat
// che spezza solo sui commenti "--" su riga propria. Ora la condizione:
//   - spezza le congiunzioni AND/OR di primo livello (come fa la WHERE);
//   - impagina la sotto-query fra parentesi (EXISTS/IN (SELECT …)) come uno statement a
//     clausole, coerente con il profilo (Subquery_SingleLine_…Exists = false);
//   - resta su una riga quando è corta e non contiene sotto-query (nessun churn inutile).
import { describe, expect, it } from 'vitest'
import { formatRoutineWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'
import handheld from './fixtures/routine_ws_CUSTOM_Handheld_KittingPicking_St3Bis_EXEC_CONF.sql?raw'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)
const fmt = (sql: string) => formatRoutineWithProfile(sql, profile)

/** Firma dei token (tipo + testo): la formattazione non deve perdere né inventare nulla. */
function firmaToken(sql: string): string[] {
  return tokenizeSqlText(sql)
    .map(t => `${t.type}:${t.text.toLowerCase().replace(/\s+/g, ' ').trim()}`)
    .sort()
}

describe('condizioni IF/WHILE lunghe dentro le store', () => {
  it('la sotto-query di "WHILE EXISTS (…)" viene impaginata, non resta su una riga', () => {
    const out = fmt(handheld)
    const righe = out.split('\n').map(r => r.replace(/\s+$/, ''))
    const iWhile = righe.findIndex(r => r.trim().startsWith('WHILE EXISTS'))
    console.log('  condizione del WHILE dopo la formattazione:')
    righe.slice(iWhile, iWhile + 10).forEach(r => console.log(`    |${r}`))
    expect(iWhile).toBeGreaterThan(-1)
    // la "(" resta in coda alla riga del WHILE, la sotto-query comincia sulla riga dopo
    expect(righe[iWhile]).toMatch(/WHILE EXISTS \($/)
    expect(righe[iWhile + 1].trim()).toBe('SELECT 1')
    // FROM/WHERE/AND della sotto-query su righe proprie
    const blocco = righe.slice(iWhile, iWhile + 12).map(r => r.trim())
    expect(blocco).toContain('FROM RUN_ESEGUI')
    expect(blocco.some(r => r.startsWith('WHERE @pEseId LIKE'))).toBe(true)
    expect(blocco).toContain('AND ESE_QTAE > 0')
    // l'AND esterno alla sotto-query va a capo anche lui
    expect(blocco).toContain('AND @diff > 0')
  })

  it('nessuna riga resta chilometrica (prima la condizione era ~200 caratteri)', () => {
    const out = fmt(handheld)
    const lunghe = out.split('\n').filter(r => r.length > 120)
    console.log(`  righe oltre 120 caratteri: ${lunghe.length}`)
    expect(lunghe).toEqual([])
  })

  it('una condizione corta resta su una riga (niente churn)', () => {
    const out = fmt('IF @a = 1 AND @b = 2\n  SELECT 1')
    expect(out).toContain('IF @a = 1 AND @b = 2')
    const out2 = fmt("IF @trancount = 0 AND @@trancount > 0\nBEGIN\n  SELECT 1\nEND")
    expect(out2).toContain('IF @trancount = 0 AND @@trancount > 0')
  })

  it('una sotto-query corta viene comunque espansa (EXISTS su righe proprie)', () => {
    const out = fmt('WHILE EXISTS (SELECT 1 FROM #t)\nBEGIN\n  DELETE FROM #t\nEND')
    const righe = out.split('\n').map(r => r.replace(/\s+$/, ''))
    expect(righe[0]).toBe('WHILE EXISTS (')
    expect(righe[1].trim()).toBe('SELECT 1')
    expect(righe[2].trim()).toBe('FROM #t')
    expect(righe[3].trim()).toBe(')')
  })

  it('nessun token perso o aggiunto sulla store della segnalazione', () => {
    expect(firmaToken(fmt(handheld))).toEqual(firmaToken(handheld))
  })

  it('la formattazione è stabile: riformattare non cambia più nulla', () => {
    const unaVolta = fmt(handheld)
    expect(fmt(unaVolta)).toBe(unaVolta)
  })
})
