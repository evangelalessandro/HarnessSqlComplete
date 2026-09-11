import { describe, expect, it } from 'vitest'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'
import { formatRoutineWithProfile } from '../tsqlFormatter'

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
    expect(out).toMatch(/^            ,BPZ_PRIO$/m)
    expect(out).toMatch(/^            ,PZ_OK_PIAZZOLA DESC$/m)
  })
})
