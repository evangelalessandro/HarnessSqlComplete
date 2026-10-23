import { describe, expect, it } from 'vitest'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'
import { formatRoutineWithProfile, tokenizeSqlText } from '../tsqlFormatter'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)

describe('formatRoutineWithProfile: SELECT TOP n @a=… layout a colonna (assegnazioni, WHERE, ORDER BY)', () => {
  it('assegnazioni verticali con "=" allineato, FROM/JOIN a capo, AND su righe proprie, ORDER BY per colonna', () => {
    const sql = `BEGIN
SELECT TOP 1 @nDestBay = BCO_BAIA, @nDestPitch = PZ_PIAZZOLA, @nDestCor = 0, @nBcoAbbinCorridoio = BCO_ABBIN_CORRIDOIO
    FROM dbo.MAG_BAIE
      INNER JOIN dbo.MAG_BAIE_PIAZ ON (BPZ_BAIA = BCO_BAIA)
    WHERE BCO_USOBAIA LIKE '%,CW,%' AND BCO_ABI = 1 AND (BCO_TIPIUDC = N'' OR BCO_TIPIUDC LIKE CONCAT(N'%',@sTipoUdc,N'%'))
    ORDER BY BPZ_PRIOBAIE, BPZ_PRIO, PZ_OK_PIAZZOLA DESC
END`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toMatch(/^  SELECT TOP 1$/m)
    expect(out).toMatch(/^     @nDestBay           = BCO_BAIA$/m)
    expect(out).toMatch(/^    ,@nDestPitch         = PZ_PIAZZOLA$/m)
    expect(out).toMatch(/^    ,@nDestCor           = 0$/m)
    expect(out).toMatch(/^    ,@nBcoAbbinCorridoio = BCO_ABBIN_CORRIDOIO$/m)
    expect(out).toMatch(/^  FROM dbo\.MAG_BAIE$/m)
    expect(out).toMatch(/^    INNER JOIN dbo\.MAG_BAIE_PIAZ ON \(BPZ_BAIA = BCO_BAIA\)$/m)
    expect(out).toMatch(/^  WHERE BCO_USOBAIA LIKE '%,CW,%'$/m)
    expect(out).toMatch(/^        AND BCO_ABI = 1$/m)
    // AND dentro parentesi su riga propria
    expect(out).toMatch(/^\s*AND \(BCO_TIPIUDC = N''$/m)
    expect(out).toMatch(/^\s*OR BCO_TIPIUDC LIKE CONCAT \(N'%', @sTipoUdc, N'%'\)\)$/m)
    // ORDER BY: un elemento per riga con virgola allineata
    expect(out).toMatch(/^  ORDER BY BPZ_PRIOBAIE$/m)
    expect(out).toMatch(/^           ,BPZ_PRIO$/m)
    expect(out).toMatch(/^           ,PZ_OK_PIAZZOLA DESC$/m)
  })
})

// SEGNALAZIONE UTENTE: "SELECT TOP 1 @x = …" con un commento su riga propria fra le assegnazioni e
// la FROM veniva formattata male: il commento diventava un SEGMENTO a sé e spezzava lo statement in
// due, così la parte FROM/JOIN/WHERE/ORDER BY restava tutta su una riga.
describe("SELECT con assegnazioni e commento '--' prima della FROM", () => {
  const sql = `SELECT TOP 1
   @x_id         = X_ID
  ,@x_type       = X_TYPE
  ,@X_DST_BAY    = X_DST_BAY -- 999
  ,@X_QTY        = X_GIAC
--,@x_note=X_NOTE
FROM #TMP_ACTIONS INNER JOIN DAT_UDC ON UDC_UDC = X_UDC WHERE X_PROCESSED = 0 AND X_MSGKO = '' ORDER BY X_PALLETMANCANTI DESC, X_ART_FEFOFIFO_PRIO`

  const out = formatRoutineWithProfile(sql, profile)
  const righe = out.split('\n')

  it('le clausole finiscono su righe proprie (non tutte su una riga)', () => {
    righe.forEach(r => console.log(`  |${r}`))
    expect(righe).toContain('FROM #TMP_ACTIONS')
    expect(righe.some(r => /^ +INNER JOIN DAT_UDC ON UDC_UDC = X_UDC$/.test(r))).toBe(true)
    expect(righe).toContain('WHERE X_PROCESSED = 0')
    expect(righe.some(r => /^ +AND X_MSGKO = ''$/.test(r))).toBe(true)
    expect(righe).toContain('ORDER BY X_PALLETMANCANTI DESC')
    expect(righe.some(r => /^ +,X_ART_FEFOFIFO_PRIO$/.test(r))).toBe(true)
  })

  it("il commento resta sulla SUA riga (non in coda all'assegnazione)", () => {
    expect(righe).toContain('--,@x_note=X_NOTE')
    expect(righe.some(r => /@X_QTY\s+= X_GIAC --,/.test(r))).toBe(false)
  })

  it('nessun token perso o inventato', () => {
    const firma = (s: string) =>
      tokenizeSqlText(s)
        .filter(t => t.type !== 'comment')
        .map(t => `${t.type}:${t.text.toLowerCase()}`)
        .sort()
    expect(firma(out)).toEqual(firma(sql))
  })
})