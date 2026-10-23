// FORMATTAZIONE SEMPRE (richiesta utente: "la formattazione non fa più nulla, prova questa").
// Fino a ieri un testo riconosciuto come "già impaginato" (una riga per campo, virgole in testa,
// clausole a capo) veniva restituito IDENTICO, quindi su molte store scritte a mano il pulsante
// "Formatta" non cambiava nulla. La regola è stata tolta: la formattazione interviene sempre.
// Qui si usano DUE store reali scritte a mano nello stesso stile: entrambe devono essere
// riformattate senza perdere nemmeno un token.
import { describe, expect, it } from 'vitest'
import { formatSqlWithProfile, formatRoutineWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { buildFormatProfile, loadFormatProfileXml } from '../formatProfile'
import cellToCell from './fixtures/routine_ws_L2_CUSTOM_CELL_TO_CELL.sql?raw'
import replanishment from './fixtures/routine_ws_CUSTOM_Engine_Automatismi_Replanishment_Kitting_Stock.sql?raw'

const profile = buildFormatProfile(loadFormatProfileXml())

/** Firma dei token (tipo + testo): la formattazione non deve perdere né inventare nulla. */
function firmaToken(sql: string): string[] {
  return tokenizeSqlText(sql)
    .map(t => `${t.type}:${t.text.toLowerCase().replace(/\s+/g, ' ').trim()}`)
    .sort()
}

const CASI = [
  { nome: 'ws_L2_CUSTOM_CELL_TO_CELL', sql: cellToCell },
  { nome: 'ws_CUSTOM_Engine_Automatismi_Replanishment_Kitting_Stock', sql: replanishment },
]

describe('testi scritti a mano: la formattazione li riformatta (non li lascia identici)', () => {
  for (const c of CASI) {
    it(`${c.nome}: il testo CAMBIA`, () => {
      const out = formatSqlWithProfile(c.sql, profile)
      expect(out).not.toBe(c.sql.replace(/\r\n/g, '\n').trimEnd() + '\n')
      // non è un semplice ritocco: cambia l'impaginazione (righe diverse)
      expect(out.split('\n').length).not.toBe(c.sql.split('\n').length)
    })

    it(`${c.nome}: nessun token perso o aggiunto`, () => {
      const out = formatSqlWithProfile(c.sql, profile)
      expect(firmaToken(out)).toEqual(firmaToken(c.sql))
    })
  }

  it('ws_L2_CUSTOM_CELL_TO_CELL: CASE espanso, parole chiave in maiuscolo, tipi normalizzati', () => {
    const out = formatRoutineWithProfile(cellToCell, profile)
    console.log('  prime righe:')
    out.split('\n').slice(0, 12).forEach(r => console.log(`    |${r}`))
    // firma: nome routine e tipi dei parametri in maiuscolo, un parametro per riga
    expect(out).toContain('CREATE OR ALTER PROCEDURE [dbo].[ws_L2_CUSTOM_CELL_TO_CELL]')
    expect(out).toMatch(/@pUdc\s+DECIMAL\(15, 0\)/)
    expect(out).toContain('SET NOCOUNT ON')
    expect(out).toContain('SET XACT_ABORT ON')
    // il CASE della select-list viene espanso su righe proprie (era tutto storto a mano)
    expect(out).toMatch(/\bCASE\n\s+WHEN UDC_CAUSMISS <> ''\n\s+THEN 'LU already used'/)
    // il commento sulla riga del parametro resta attaccato
    expect(out).toContain("--'KIT','vna','ForceVNA'")
    // la label va a margine (come in SSMS)
    expect(out).toMatch(/\nlblExit:/)
    // il GOTO a metà corpo viene indentato dentro il blocco
    expect(out).toMatch(/\n\s+GOTO lblExit/)
  })

  it('ws_L2_CUSTOM_CELL_TO_CELL: la ELSE del blocco va su riga propria', () => {
    const out = formatRoutineWithProfile(cellToCell, profile)
    expect(out).toMatch(/\n\s+ELSE\n\s+BEGIN\n\s+SET @txtError = 'Caso non gestito'/)
  })
})
