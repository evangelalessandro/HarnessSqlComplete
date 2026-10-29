// UPDATE con un commento "--" su riga propria fra la lista del SET e la FROM.
// SEGNALAZIONE UTENTE: "se formatto questa query non si formatta bene, mentre se tolgo il commento sì".
// Causa: un commento su riga propria diventava un SEGMENTO a sé e spezzava lo statement in due, quindi
// la parte FROM/JOIN/WHERE restava tutta su una riga (il commento chiudeva il primo statement).
// Ora il commento resta DENTRO lo statement quando questo è ancora "aperto" (per l'UPDATE: finché non
// arriva FROM/WHERE…), e la query esce identica alla versione senza commento.
import { describe, expect, it } from 'vitest'
import { formatRoutineWithProfile, formatSqlWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { buildFormatProfile, loadFormatProfileXml } from '../formatProfile'

const profile = buildFormatProfile(loadFormatProfileXml())

const SQL = `UPDATE RUN_MISSIONI
  SET MIS_L2STA           = 'OUTHD'
      ,MIS_MODULO         = ''
      ,MIS_l1STA          = 'TE'
      ,MIS_GES_STA        = 'TE'
      ,MIS_ESMISS         = 'OK'
      ,MIS_H_MOD_SVUOTATO = 1
      ,MIS_NO_REG         = 1
--commento
FROM RUN_MISSIONI
  INNER JOIN tbl_TransKitting_St1 ON X_UDC_SOURCE = MIS_UDC
WHERE MIS_L2STA IN ('OUTHD', 'WS', 'WO')`

const righe = (sql: string) => formatSqlWithProfile(sql, profile).trimEnd().split('\n')

describe('UPDATE con commento "--" prima della FROM', () => {
  it('le clausole finiscono su righe proprie (non tutte su una riga)', () => {
    const out = righe(SQL)
    out.forEach(r => console.log(`  |${r}`))
    expect(out).toContain('FROM RUN_MISSIONI')
    expect(out.some(r => /^ {2}INNER JOIN tbl_TransKitting_St1 ON X_UDC_SOURCE = MIS_UDC$/.test(r))).toBe(true)
    expect(out.some(r => /^WHERE MIS_L2STA IN \('OUTHD', 'WS', 'WO'\)$/.test(r))).toBe(true)
    // nessuna riga contiene sia FROM sia WHERE (era il difetto: tutto attaccato)
    expect(out.some(r => r.includes('FROM') && r.includes('WHERE'))).toBe(false)
  })

  it('il risultato è identico alla stessa query SENZA commento', () => {
    const senza = righe(SQL.replace('--commento\n', ''))
    const con = righe(SQL).filter(r => r.trim() !== '--commento')
    expect(con).toEqual(senza)
  })

  it('il commento resta sulla sua riga, allo stesso margine della FROM', () => {
    const out = righe(SQL)
    const i = out.findIndex(r => r.trim() === '--commento')
    expect(i).toBeGreaterThan(0)
    const from = out.findIndex(r => r.trim() === 'FROM RUN_MISSIONI')
    // stesso margine della FROM (= margine dello statement), non indentato come i campi del SET
    expect(out[i].length - out[i].trimStart().length).toBe(out[from].length - out[from].trimStart().length)
  })

  it('nessun token perso o inventato e formattazione idempotente', () => {
    const una = formatSqlWithProfile(SQL, profile)
    const firma = (s: string) =>
      tokenizeSqlText(s)
        .map(t => `${t.type}:${t.text.toLowerCase()}`)
        .sort()
    expect(firma(una)).toEqual(firma(SQL))
    expect(formatSqlWithProfile(una, profile)).toBe(una)
  })

  it('dentro una routine le clausole sono allineate al corpo', () => {
    const out = formatRoutineWithProfile(`create procedure p as\nbegin\n  ${SQL.replace(/\n/g, '\n  ')}\nend`, profile)
    out.split('\n').forEach(r => console.log(`  |${r}`))
    expect(out).toContain('    FROM RUN_MISSIONI')
    expect(out).toContain("    WHERE MIS_L2STA IN ('OUTHD', 'WS', 'WO')")
  })
})
