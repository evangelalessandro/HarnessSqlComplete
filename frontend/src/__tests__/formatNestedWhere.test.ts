// Formattazione di una store "difficile" segnalata dall'utente: commenti "--" fra le colonne
// dell'INSERT, WHERE con parentesi annidate, un LEFT OUTER JOIN spezzato su due righe e una
// select-list lunghissima dopo un CASE. I nomi sono inventati: qui contano le FORME.
import { describe, expect, it } from 'vitest'
import { formatRoutineWithProfile } from '../tsqlFormatter'
import { buildFormatProfile, loadFormatProfileXml } from '../formatProfile'

const profile = buildFormatProfile(loadFormatProfileXml())

const routine = `CREATE OR ALTER PROCEDURE [dbo].[sp_prova]
(
        @ordine       NVARCHAR(20)
        ,@modo NVARCHAR(5)
)
AS
INSERT INTO #TMP_RIGHE (R_ORDINE, R_PADRE,
  --R_FIX
  R_TIPOOP, R_MODOLANCIO, R_INIBITO,
  --R_IMME
  R_RIGA,
  --R_PRIO
  R_PRIO, R_UDC, R_ARTICOLO)
SELECT
  CASE
    WHEN ORD_FIX = 1
      THEN ''
    ELSE RIG_ORDINE
  END
  ,CASE WHEN ORD_PADRE = '' THEN ORD_ORDINE ELSE ORD_PADRE END, ORD_TIPOOP, CASE WHEN ISNULL (@modo, '') <> '' THEN @modo ELSE ORD_MODOLANCIO END, ORD_INIBITO, RIG_RIGA, RIG_PRIO, RIG_UDC, RIG_ARTICOLO
FROM dbo.DAT_RIGHE
  INNER JOIN dbo.DAT_ORDINI ON (ORD_ORDINE = RIG_ORDINE)
  LEFT OUTER
  JOIN dbo.DAT_CLIENTI ON (ARC_ARTICOLO = RIG_ARTICOLO)
WHERE RIG_ORDINE = @ordine
      AND RIG_INIBITA = 0
          AND ((@tipo = N'I'
            AND (RIG_UDC = 0
              OR (RIG_SCOMPARTO > 0
        AND RIG_NESE = 0)))
        OR RIG_QTAR > (RIG_QTAI + RIG_QTAE)
      OR RIG_STARIORD = N'S')
RETURN 0
`

describe('store con commenti nelle colonne, WHERE annidato e LEFT OUTER JOIN', () => {
  const out = formatRoutineWithProfile(routine, profile)
  const righe = out.split('\n')
  const indentazione = (r: string) => r.length - r.trimStart().length

  it('la lista dei campi va una per riga, con i commenti "--" su riga propria', () => {
    expect(out).toMatch(/\n\s*--R_FIX\n/)
    expect(out).toMatch(/\n\s*,R_TIPOOP\n/)
    expect(out).toMatch(/\n\s*,R_MODOLANCIO\n/)
    expect(out).toMatch(/\n\s*,R_INIBITO\n/)
    expect(out).toMatch(/\n\s*--R_PRIO\n/)
    expect(out).toMatch(/\n\s*,R_PRIO\n/)
    // chiusura della lista sull'ultimo campo, non dopo un commento (finirebbe commentata)
    expect(out).toMatch(/\n\s*,R_ARTICOLO\)\n/)
  })

  it('i valori della SELECT sono uno per riga (niente righe chilometriche)', () => {
    const dopoSelect = righe.slice(righe.findIndex(r => r.trim() === 'SELECT'))
    expect(Math.max(...dopoSelect.map(r => r.length))).toBeLessThan(120)
    expect(out).toMatch(/\n\s*,CASE\n/)
    expect(out).toMatch(/\n\s*,ORD_TIPOOP\n/)
    expect(out).toMatch(/\n\s*,RIG_ARTICOLO\n/)
  })

  it('il LEFT OUTER JOIN resta su una riga sola', () => {
    expect(out).toMatch(/\n\s*LEFT OUTER JOIN dbo\.DAT_CLIENTI ON \(ARC_ARTICOLO = RIG_ARTICOLO\)\n/)
    expect(out).not.toMatch(/\n\s*LEFT OUTER\n/)
  })

  it('le condizioni annidate rientrano in modo coerente (mai all\'indietro)', () => {
    const prime = righe.filter(r => /^\s*(WHERE|AND|OR)\b/.test(r))
    const indent = prime.map(indentazione)
    expect(indent[0]).toBeLessThan(indent[1])
    // "AND RIG_NESE = 0)))" era la riga che rientrava ALL'INDIETRO rispetto a "OR (RIG_SCOMPARTO"
    const iNese = prime.findIndex(r => r.includes('RIG_NESE'))
    const iScomparto = prime.findIndex(r => r.includes('RIG_SCOMPARTO'))
    expect(iNese).toBeGreaterThan(0)
    expect(indent[iNese]).toBeGreaterThan(indent[iScomparto])
    // e le due OR di chiusura (stesso livello) sono allineate fra loro
    const iQtar = prime.findIndex(r => r.includes('RIG_QTAR'))
    const iStariord = prime.findIndex(r => r.includes('RIG_STARIORD'))
    expect(indent[iQtar]).toBe(indent[iStariord])
  })
})
