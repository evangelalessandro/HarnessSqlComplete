// SELECT con CASE nella select-list, alias sull'END e INTO.
//
// SEGNALAZIONE UTENTE (identazione): la parte prima del CASE restava tutta su una riga, "END" e
// "AS X_MODULO" finivano su righe separate e il CASE non era allineato alle virgole degli altri campi.
import { describe, expect, it } from 'vitest'
import { formatSqlWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)
const fmt = (sql: string) => formatSqlWithProfile(sql, profile).replace(/\r\n/g, '\n')

const SQL = `SELECT ',' + STRING_AGG (ESE_ID, ',') X_ESE_ID, dbo.fn_Custom_RemoveZero (RIG_ARTICOLO) X_ARTICOLO, ART_DES X_DESC, sum (ESE_QTAR) X_QTAR, ART_UMI X_UM
  ,CASE
    WHEN COR_AREA = 'AM'
      THEN 'VNA'
    ELSE isnull (MIS_MODULO, 'RACK')
  END
  AS X_MODULO
INTO #tmpRighe
FROM dbo.DAT_ORDINI
  INNER JOIN DAT_ORDINI_RIGHE ON RIG_ORDINE = ORD_ORDINE
WHERE ORD_EXPORDINE = ''
GROUP BY RIG_ARTICOLO
         ,ART_DES`

describe('SELECT con CASE nella select-list e INTO', () => {
  it('impila TUTTI i campi, anche quelli prima del CASE', () => {
    const out = fmt(SQL)
    console.log(out)
    const righe = out.split('\n')
    // il primo campo sta sulla riga del SELECT, gli altri con la virgola in testa
    expect(righe[0]).toBe("SELECT ',' + STRING_AGG (ESE_ID, ',')       X_ESE_ID")
    expect(righe.some(r => /^\s+,dbo\.fn_Custom_RemoveZero/.test(r))).toBe(true)
    expect(righe.some(r => /^\s+,ART_UMI/.test(r))).toBe(true)
    // nessuna riga con più campi separati da virgola (a parte la select-list di STRING_AGG)
    const rigaConDueCampi = righe.some(r => (r.match(/,(?!')/g) ?? []).length > 1)
    expect(rigaConDueCampi).toBe(false)
  })

  it('il CASE è allineato alla colonna delle virgole degli altri campi', () => {
    const righe = fmt(SQL).split('\n')
    const iCaso = righe.findIndex(r => r.trim() === ',CASE')
    expect(iCaso).toBeGreaterThan(-1)
    const iCampo = righe.findIndex(r => /^\s+,ART_UMI/.test(r))
    expect(righe[iCaso].search(/\S/)).toBe(righe[iCampo].search(/\S/))
  })

  it('l alias resta sulla riga dell END', () => {
    const righe = fmt(SQL).split('\n')
    expect(righe.some(r => r.trim() === 'END AS X_MODULO')).toBe(true)
    expect(righe.some(r => r.trim() === 'END')).toBe(false)
  })

  it('INTO viene a margine', () => {
    const righe = fmt(SQL).split('\n')
    const iInto = righe.findIndex(r => r.startsWith('INTO #tmpRighe'))
    expect(iInto).toBeGreaterThan(-1)
  })

  it('è idempotente e non perde token', () => {
    const firma = (s: string) =>
      tokenizeSqlText(s)
        .filter(t => t.type !== 'comment')
        .map(t => t.type + ':' + t.text.toUpperCase())
        .sort()
        .join('|')
    const una = fmt(SQL)
    expect(fmt(una)).toBe(una)
    expect(firma(una)).toBe(firma(SQL))
  })
})

describe('CASE come PRIMO campo: nessuna virgola inventata', () => {
  it('"SELECT CASE …" non riceve una virgola prima', () => {
    const out = fmt("SELECT CASE WHEN A = 1 THEN 'x' ELSE 'y' END AS K FROM T")
    expect(out).not.toMatch(/^\s*,CASE/m)
    expect(out).toMatch(/CASE/)
  })
})

describe('assegnazione con CASE: nessuna virgola', () => {
  it('"SELECT @x = CASE …" resta senza virgola', () => {
    const out = fmt("SELECT @x = CASE WHEN A = 1 THEN 'a' ELSE 'b' END FROM T")
    expect(out).not.toMatch(/,\s*CASE/)
    expect(out).toMatch(/SELECT @x =/)
  })
})

describe('RETURN CASE: nessuna virgola', () => {
  it('RETURN seguito dal CASE non prende virgole', () => {
    const out = fmt("CREATE OR ALTER PROCEDURE dbo.P AS\nRETURN CASE WHEN @a > 0 THEN 1 ELSE 0 END")
    expect(out).not.toMatch(/,\s*CASE/)
    expect(out).toMatch(/RETURN\s+CASE/)
  })
})
