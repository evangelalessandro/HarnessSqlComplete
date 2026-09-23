// Firma delle routine: parametri uno per riga e TIPI DI DATO incolonnati.
//
// Segnalato dall'utente sull'output di dbo.ws_L2_HAVO_IEDUGI_AESIPE: i nomi dei parametri
// erano allineati ma il tipo no (ognuno partiva subito dopo il proprio nome).
import { describe, expect, it } from 'vitest'
import { formatRoutineWithProfile } from '../tsqlFormatter'
import { buildFormatProfile, loadFormatProfileXml } from '../formatProfile'
import avvisi from './fixtures/routine_ws_L2_HAVO_IEDUGI_AESIPE.sql?raw'

const profile = buildFormatProfile(loadFormatProfileXml())

/** Colonna (0-based) in cui inizia il tipo di dato di ogni parametro della firma
 *  (considera solo le righe fra la "(" e la ")" della firma). */
function colonneTipo(out: string): number[] {
  const lines = out.split('\n')
  const apri = lines.findIndex(l => l.trim() === '(')
  const chiudi = lines.findIndex((l, i) => i > apri && l.trim() === ')')
  return lines
    .slice(apri + 1, chiudi)
    .map(l => l.search(/\b(NVARCHAR|VARCHAR|NCHAR|CHAR|INT|BIGINT|BIT|DECIMAL|NUMERIC|DATE|DATETIME|DATETIME2|MONEY|FLOAT|REAL|TEXT|UNIQUEIDENTIFIER|CURSOR|TABLE|VARBINARY|BINARY|SMALLINT|TINYINT)\b/i))
    .filter(c => c >= 0)
}

describe('firma: tipi di dato dei parametri incolonnati', () => {
  it('tutti i tipi partono dalla stessa colonna', () => {
    const out = formatRoutineWithProfile(
      `CREATE PROCEDURE dbo.p (
  @a INT,
  @pNomeMoltoLungo NVARCHAR(50) = NULL,
  @b DECIMAL(11, 3) OUTPUT,
  @c BIT = 0
) AS SELECT 1`,
      profile,
    )
    const colonne = colonneTipo(out)
    expect(colonne.length).toBe(4)
    expect(new Set(colonne).size).toBe(1)
    // nome e tipo mai incollati, anche per il parametro dal nome più lungo
    expect(out).toMatch(/^\s+,@pNomeMoltoLungo\s+NVARCHAR\(50\) = NULL$/m)
  })

  it('un solo parametro: un solo spazio (non c è niente da allineare)', () => {
    const out = formatRoutineWithProfile('CREATE PROCEDURE p (@x INT) AS SELECT 1', profile)
    expect(out).toContain('        @x INT')
  })

  it('il valore di default e i commenti restano attaccati al tipo', () => {
    const out = formatRoutineWithProfile(
      `CREATE PROCEDURE p (@a NVARCHAR(max) = NULL /* primo */, @pNomeLungo BIT = 1 /* secondo */) AS SELECT 1`,
      profile,
    )
    expect(out).toMatch(/^\s+@a\s+NVARCHAR\(max\) = NULL \/\* primo \*\/$/m)
    expect(out).toMatch(/^\s+,@pNomeLungo\s+BIT = 1 \/\* secondo \*\/$/m)
  })

  it('store reale: firma con 16 parametri, tipi tutti nella stessa colonna', () => {
    const out = formatRoutineWithProfile(avvisi, profile).replace(/\r\n/g, '\n')
    const colonne = colonneTipo(out)
    expect(colonne.length).toBe(16)
    expect(new Set(colonne).size).toBe(1)
    // il parametro dal nome più lungo non si incolla al tipo
    expect(out).toMatch(/^\s+,@pRIG_AVVISO_UDCPRED\s+NVARCHAR\(5\) = NULL$/m)
    // riformattare non cambia nulla
    expect(formatRoutineWithProfile(out, profile)).toBe(out)
  })
})
