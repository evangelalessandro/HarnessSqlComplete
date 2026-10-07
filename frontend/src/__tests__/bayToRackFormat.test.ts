// FORMATTAZIONE della store segnalata dall'utente
// (ws_CUSTOM_Handheld_Kitting_Bay_To_Rack_St1_GetList):
//
// "nella parte dove fa
//    SELECT TOP 1 SCO_SCOMPARTO X_SCO --sorgente
//    , UDC_UDC X_UDC_SOURCE, IIF (…) X_SSCC --sorgente
//    , UDC_ARTICOLO X_SKU, … UDC_TAG X_TAG INTO #tmpAcc
//  into dovrebbe stare a capo ma anche i campi nella select non si allineano così come gli
//  alias e nella where dovrebbe indentare e mandare a capo e fare che le cose tra parentesi
//  stiano indentate"
//
// Causa: la select-list conteneva commenti "--" e detailedSelectRows rinunciava all'impaginazione
// (guardia "commenti -- nella testata"): la lista restava storta, senza INTO a capo e con la
// WHERE su una riga sola.
import { describe, expect, it } from 'vitest'
import { formatRoutineWithProfile, formatSqlWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'
import store from './fixtures/routine_ws_CUSTOM_Handheld_Kitting_Bay_To_Rack_St1_GetList.sql?raw'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)
const fmt = (sql: string) => formatRoutineWithProfile(sql, profile)

/** Firma dei token (tipo + testo): la formattazione non deve perdere né inventare nulla. */
function firmaToken(sql: string): string[] {
  return tokenizeSqlText(sql)
    .map(t => `${t.type}:${t.text.toLowerCase().replace(/\s+/g, ' ').trim()}`)
    .sort()
}

describe('store Bay_To_Rack_St1: la SELECT con commenti viene impaginata', () => {
  const out = fmt(store)
  const righe = out.split('\n')
  const iSelect = righe.findIndex(r => r.startsWith('SELECT TOP 1 SCO_SCOMPARTO'))
  const blocco = righe.slice(iSelect, iSelect + 12)

  it('i campi vanno UNO PER RIGA (prima erano ammassati su tre righe)', () => {
    console.log('  blocco formattato:')
    blocco.forEach(r => console.log(`    |${r}`))
    expect(iSelect).toBeGreaterThan(-1)
    const righeCampi = blocco.slice(0, 10).map(r => r.trimStart())
    expect(righeCampi[0].startsWith('SELECT TOP 1 SCO_SCOMPARTO')).toBe(true)
    // ogni campo apre la sua riga, con la virgola in testa
    const nomi = ['UDC_UDC', 'IIF', 'UDC_ARTICOLO', 'ART_DES', 'SCO_GIAC', 'UDC_USER_TASK', 'MIS_CAUSMISS', 'UDC_TAG']
    nomi.forEach((nome, k) => {
      expect(righeCampi[k + 1].startsWith(`,${nome}`), `campo ${nome} su riga propria`).toBe(true)
    })
    // e subito dopo la lista, l'INTO su riga propria
    expect(righeCampi[9]).toBe('INTO #tmpAcc')
  })

  it('gli ALIAS sono incolonnati', () => {
    const conAlias = blocco.filter(r => /(X_SCO|X_UDC_SOURCE|X_SSCC|X_SKU|X_SKU_DESC|X_QTY|X_CAUSMISS|X_TAG)\s*(--.*)?$/.test(r.trimEnd()))
    expect(conAlias.length).toBeGreaterThanOrEqual(6)
    const colonne = conAlias.map(r => {
      const t = r.replace(/\s*--.*$/, '').trimEnd()
      const m = /(X_SCO|X_UDC_SOURCE|X_SSCC|X_SKU|X_SKU_DESC|X_QTY|X_CAUSMISS|X_TAG)\s*$/.exec(t)!
      return t.length - m[1].length
    })
    console.log(`  colonne degli alias: ${JSON.stringify(colonne)}`)
    expect(new Set(colonne).size).toBe(1)
  })

  it('INTO va su riga propria', () => {
    expect(righe.some(r => r.trimEnd() === 'INTO #tmpAcc')).toBe(true)
  })

  it('i commenti "--sorgente" restano in coda al loro campo (e il codice dopo non è commentato)', () => {
    // il commento resta attaccato al campo che lo precedeva, dopo l'alias incolonnato
    expect(blocco[0]).toMatch(/^SELECT TOP 1 SCO_SCOMPARTO +X_SCO --sorgente$/)
    const rigaCommento = blocco.find(r => r.includes('--sorgente') && r.includes('X_SSCC'))
    expect(rigaCommento).toBeTruthy()
    expect(rigaCommento).toMatch(/X_SSCC --sorgente$/)
    // i campi DOPO il commento non sono finiti dentro il commento
    expect(blocco.some(r => r.includes('UDC_ARTICOLO'))).toBe(true)
    expect(blocco.some(r => r.includes('UDC_TAG'))).toBe(true)
  })

  it('nella WHERE le condizioni vanno a capo e le parentesi sono indentate', () => {
    const iWhere = righe.findIndex(r => r.startsWith('WHERE (MIS_L2STA IS NULL'))
    expect(iWhere).toBeGreaterThan(-1)
    const w = righe.slice(iWhere, iWhere + 9)
    w.forEach(r => console.log(`    |${r}`))
    // la WHERE apre il gruppo fra parentesi, le condizioni stanno a capo e RIENTRATE
    expect(w[0]).toBe('WHERE (MIS_L2STA IS NULL')
    expect(w[1].trim()).toBe("AND COR_AREA = 'AP'")
    expect(w[1].search(/\S/)).toBeGreaterThan(0)
    expect(w[2].trim()).toBe("OR MIS_L2STA IN ('WS', 'OUTHD', 'WO')")
    expect(w[3].trim()).toBe('AND CAUM_VNA_TO_KITTING = 1)')
    // ogni condizione dentro le parentesi è rientrata alla stessa colonna
    const dentro = [w[1], w[2], w[3]].map(r => r.search(/\S/))
    expect(new Set(dentro).size).toBe(1)
    // gli altri gruppi fra parentesi si aprono con AND e hanno le loro OR rientrate
    expect(w[4].trim()).toBe("AND (UDC_USER_TASK = ''")
    expect(w[5].trim()).toBe('OR UDC_USER_TASK = @user)')
    expect(w[5].search(/\S/)).toBeGreaterThan(w[4].search(/\S/))
    expect(w[8].trim()).toBe("OR UDC_TAG LIKE '%KREPL%')")
  })

  it('nessun token perso o inventato e formattazione idempotente', () => {
    expect(firmaToken(out)).toEqual(firmaToken(store))
    expect(fmt(out)).toBe(out)
  })

  it('anche il motore query (statement da solo) si comporta allo stesso modo', () => {
    const solo = `SELECT TOP 1 SCO_SCOMPARTO X_SCO --sorgente
, UDC_UDC X_UDC_SOURCE, IIF (UDC_SSCC > '', UDC_SSCC, SCO_SSCC_SOURCE) X_SSCC --sorgente
, UDC_ARTICOLO X_SKU, ART_DES X_SKU_DESC INTO #tmpAcc
FROM DAT_UDC
WHERE (A = 1 AND B = 2 OR C = 3) AND D = 4`
    const o = formatSqlWithProfile(solo, profile)
    console.log(o)
    expect(o).toMatch(/^SELECT TOP 1 SCO_SCOMPARTO +X_SCO --sorgente$/m)
    expect(o).toMatch(/^INTO #tmpAcc$/m)
    expect(o).toMatch(/^\s*,UDC_ARTICOLO +X_SKU$/m)
    expect(o).toMatch(/^\s*,ART_DES +X_SKU_DESC$/m)
    expect(firmaToken(o)).toEqual(firmaToken(solo))
  })
})
