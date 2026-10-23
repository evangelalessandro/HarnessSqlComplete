// GHOST TEXT (suggerimento in linea) — motore puro.
// Richiesta utente: "che altro si può inventare per essere più veloci a scrivere delle query?" →
// scelta: "Ghost text: suggerimento inline con Tab".
//
// Qui si verifica cosa viene proposto in ogni situazione. Il comportamento vero (testo grigio
// nell'editor e Tab che lo accetta) è verificato nel browser con `--verify-ghost`.
import { describe, expect, it } from 'vitest'
import { dentroCommentoOStringa, statementAttorno, suggerisciInLinea } from '../inlineSuggest'
import { demoStoreLikeSummary } from './schema'

const summary = demoStoreLikeSummary()

/** Suggerimento alla fine del testo (cursore in fondo). */
const ghost = (sql: string) => suggerisciInLinea(sql, sql.length, summary)

/** Suggerimento con il cursore SUBITO DOPO un frammento (es. dopo "SELECT " o dopo la virgola). */
const ghostDopo = (sql: string, frammento: string) => {
  const i = sql.indexOf(frammento)
  expect(i, `frammento non trovato: ${frammento}`).toBeGreaterThanOrEqual(0)
  return suggerisciInLinea(sql, i + frammento.length, summary)
}

describe('ghost text: ON del JOIN dalla chiave esterna', () => {
  it('dopo "LEFT JOIN tabella" propone ON con le colonne della FK', () => {
    const s = ghost('SELECT * FROM dbo.RUN_MISSIONI INNER JOIN dbo.DAT_UDC')
    console.log(`  ${s?.testo}`)
    expect(s?.motivo).toBe('join-on')
    expect(s?.testo).toMatch(/^\s+ON \(.+ = .+\)$/)
    // le due colonne della relazione RUN_MISSIONI.MIS_UDC → DAT_UDC.UDC_UDC
    expect(s?.testo.replace(/\s+/g, ' ').trim()).toBe('ON (MIS_UDC = UDC_UDC)')
  })

  it('funziona anche senza "dbo." e con la virgola prima', () => {
    const s = ghost('SELECT * FROM RUN_MISSIONI rm INNER JOIN DAT_UDC')
    expect(s?.motivo).toBe('join-on')
    expect(s?.testo).toContain('ON (')
  })

  it('se l ON c è già non propone niente', () => {
    expect(ghost('SELECT * FROM dbo.RUN_MISSIONI INNER JOIN dbo.DAT_UDC ON X = Y')).toBeNull()
    // ...anche se l'ON è sulla riga dopo (il cursore è a fine riga del JOIN)
    const conOnDopo = 'SELECT * FROM dbo.RUN_MISSIONI INNER JOIN dbo.DAT_UDC'
    exactly: {
      const sql = `${conOnDopo}\nON X = Y`
      const s = suggerisciInLinea(sql, conOnDopo.length, summary)
      expect(s).toBeNull()
    }
  })

  it('niente suggerimento per tabelle temporanee o sconosciute', () => {
    expect(ghost('SELECT * FROM dbo.RUN_MISSIONI INNER JOIN #tmpMission')).toBeNull()
    expect(ghost('SELECT * FROM dbo.RUN_MISSIONI INNER JOIN tabella_inesistente')).toBeNull()
  })

  it('niente suggerimento se la tabella non ha relazioni con il contesto', () => {
    // due tabelle senza FK fra loro
    expect(ghost('SELECT * FROM dbo.Clienti INNER JOIN dbo.Articoli')).toBeNull()
  })

  it('non propone dentro i commenti o le stringhe', () => {
    const inCommento = 'SELECT * FROM dbo.RUN_MISSIONI INNER JOIN dbo.DAT_UDC -- nota'
    expect(suggerisciInLinea(inCommento, inCommento.length, summary)).toBeNull()
    const inStringa = "SELECT 'x' FROM dbo.RUN_MISSIONI INNER JOIN dbo.DAT_UDC"
    expect(suggerisciInLinea(inStringa, inStringa.length, summary)).not.toBeNull() // fuori dalla stringa
  })
})

describe('ghost text: colonna successiva nella select-list', () => {
  it('dopo la virgola propone la prima colonna non ancora elencata', () => {
    const s = ghostDopo('SELECT UDC_UDC, FROM dbo.DAT_UDC', 'SELECT UDC_UDC,')
    expect(s?.motivo).toBe('colonna-successiva')
    expect(s?.testo.toLowerCase()).not.toBe('udc_udc')
    console.log(`  proposta: ${s?.testo}`)
  })

  it('dopo SELECT propone la prima colonna della tabella', () => {
    const s = ghostDopo('SELECT  FROM dbo.DAT_UDC', 'SELECT ')
    expect(s?.motivo).toBe('colonna-successiva')
    const primaColonna = summary.tables.find(t => t.name === 'DAT_UDC')?.columns?.[0]?.name
    expect(s?.testo).toBe(primaColonna)
  })

  it('non propone se le colonne sono già tutte elencate', () => {
    const t = summary.tables.find(t => t.name === 'DAT_UDC')!
    const tutte = (t.columns ?? []).map(c => c.name).join(', ')
    const sql = `SELECT ${tutte}, FROM dbo.DAT_UDC`
    expect(ghostDopo(sql, `SELECT ${tutte},`)).toBeNull()
  })

  it('non propone con più tabelle nello statement (ambiguo)', () => {
    const sql = 'SELECT  FROM dbo.DAT_UDC a INNER JOIN dbo.RUN_MISSIONI b ON a.UDC_UDC = b.MIS_UDC'
    expect(ghostDopo(sql, 'SELECT ')).toBeNull()
  })
})

describe('ghost text: nessun suggerimento a sproposito', () => {
  it('a inizio riga, dopo un punto e virgola o su testo libero', () => {
    expect(ghost('')).toBeNull()
    expect(ghost('SELECT 1; ')).toBeNull()
    expect(ghost('questo non è sql')).toBeNull()
  })

  it('senza schema caricato non propone niente', () => {
    const sql = 'SELECT * FROM dbo.RUN_MISSIONI INNER JOIN dbo.DAT_UDC'
    expect(suggerisciInLinea(sql, sql.length, null)).toBeNull()
  })
})

describe('utilità: statement e commenti', () => {
  it('statementAttorno delimita su ; e GO', () => {
    const sql = 'SELECT 1;\nSELECT 2 FROM dbo.T;\nGO\nSELECT 3'
    const r = statementAttorno(sql, sql.indexOf('FROM dbo.T') + 4)
    expect(sql.slice(r.inizio, r.fine).trim()).toBe('SELECT 2 FROM dbo.T')
    const r2 = statementAttorno(sql, sql.length - 1)
    expect(sql.slice(r2.inizio, r2.fine).trim()).toBe('SELECT 3')
  })

  it('dentroCommentoOStringa riconosce commenti e stringhe', () => {
    expect(dentroCommentoOStringa('SELECT 1 -- nota', 14)).toBe(true)
    expect(dentroCommentoOStringa('SELECT 1 /* nota */', 12)).toBe(true)
    expect(dentroCommentoOStringa("SELECT 'abc", 11)).toBe(true)
    expect(dentroCommentoOStringa('SELECT abc', 10)).toBe(false)
  })
})
