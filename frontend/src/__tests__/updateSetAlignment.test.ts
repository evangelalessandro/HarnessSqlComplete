// UPDATE … SET: i "=" in colonna.
//
// Segnalazione utente: "se provi a formattare questo update vedrai che non formatta bene in colonna
// quello che è dopo =" — con più assegnazioni i "=" restavano sfalsati, quindi nemmeno i valori
// erano incolonnati. Ora il lato sinistro di ogni assegnazione viene riempito fino alla colonna
// comune (tenendo conto che la prima riga ha "SET " e le altre la virgola davanti).
import { describe, expect, it } from 'vitest'
import { formatSqlWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { buildFormatProfile } from '../formatProfile'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)
const fmt = (sql: string) => formatSqlWithProfile(sql, profile)

/** Firma dei token: la formattazione non deve perdere né inventare nulla. */
const firma = (sql: string) =>
  tokenizeSqlText(sql)
    .map(t => `${t.type}:${t.text.toLowerCase().replace(/\s+/g, ' ').trim()}`)
    .sort()

/** Colonna (indice 0-based) della "=" in ogni riga di assegnazione del SET. */
function colonneUguale(out: string): number[] {
  return out
    .split('\n')
    .filter(r => /^\s*(SET |,\s*\S+\s*=)/.test(r) && !/^\s*WHERE/.test(r))
    .map(r => r.indexOf('='))
    .filter(i => i > 0)
}

const SQL_UTENTE = `/*gia esiste riga esegui versamento*/
  UPDATE [#tmpMission]
    SET X_CORRIDOIO = UDC_CORRIDOIO
        ,X_CELLA    = UDC_CELLA
        ,X_UDC_DEST = ESE_UDC_DEST
        ,X_QTY      = RIG_QTAR
  FROM RUN_ESEGUI
    INNER JOIN #tmpMission 
      ON ESE_UDC = X_UDC_SOURCE
    LEFT JOIN DAT_UDC 
      ON udc_udc = ESE_UDC_DEST
    LEFT JOIN DAT_ORDINI_RIGHE 
      ON RIG_RIGA = ESE_RIGA`

describe('UPDATE … SET: i "=" in colonna', () => {
  it('il caso segnalato: quattro assegnazioni con i "=" incolonnati', () => {
    const out = fmt(SQL_UTENTE)
    console.log(`\n${out.split('\n').map(r => `  |${r}`).join('\n')}`)
    expect(out).toContain(
      '  SET X_CORRIDOIO = UDC_CORRIDOIO\n' +
        '      ,X_CELLA    = UDC_CELLA\n' +
        '      ,X_UDC_DEST = ESE_UDC_DEST\n' +
        '      ,X_QTY      = RIG_QTAR',
    )
    // tutti i "=" delle assegnazioni nella STESSA colonna
    expect(new Set(colonneUguale(out)).size).toBe(1)
    // niente token perso e formattazione stabile
    expect(firma(out)).toEqual(firma(SQL_UTENTE))
    expect(fmt(out)).toBe(out)
  })

  it('una sola assegnazione resta com è (niente spazi in più)', () => {
    const out = fmt('update ordini set totale = 10 where id = 1')
    expect(out).toBe('UPDATE ordini\n  SET totale = 10\nWHERE id = 1\n')
  })

  it('nomi di lunghezza diversa: si riempie il più corto', () => {
    const out = fmt('update t set a = 1, @b = 2')
    console.log(`\n${out.split('\n').map(r => `  |${r}`).join('\n')}`)
    expect(out).toContain('  SET a   = 1\n      ,@b = 2')
    expect(new Set(colonneUguale(out)).size).toBe(1)
  })

  it('dentro una stored procedure gli "=" sono incolonnati nello stesso modo', () => {
    const sql = `alter procedure [dbo].[x]
as
begin
    update t
        set X_CORRIDOIO = UDC_CORRIDOIO
        , X_CELLA = UDC_CELLA
        , X_QTY = RIG_QTAR
    where id = 1
end`
    const out = fmt(sql)
    console.log(`\n${out.split('\n').map(r => `  |${r}`).join('\n')}`)
    expect(out).toContain(
      '      SET X_CORRIDOIO = UDC_CORRIDOIO\n' +
        '          ,X_CELLA    = UDC_CELLA\n' +
        '          ,X_QTY      = RIG_QTAR',
    )
    expect(new Set(colonneUguale(out)).size).toBe(1)
    expect(firma(out)).toEqual(firma(sql))
  })

  it('il "=" dentro le parentesi non viene scambiato per un assegnazione', () => {
    // RHS con sotto-query: il "=" interno non spezza la riga e non falsa l allineamento
    const out = fmt('update t set X = (select top 1 y from z where k = 1), Y = 2')
    console.log(`\n${out.split('\n').map(r => `  |${r}`).join('\n')}`)
    expect(out).toContain('SET X  = (SELECT TOP 1 y FROM z WHERE k = 1)\n      ,Y = 2')
  })

  it('l assegnamento composto (@x += 1) resta attaccato', () => {
    const out = fmt('set @x += 1')
    expect(out.trim()).toBe('SET @x += 1')
  })

  it('gli "=" della WHERE non entrano nell allineamento del SET', () => {
    const out = fmt('update t set a = 1, b = 2 where id = 999 and altra = 1')
    expect(new Set(colonneUguale(out)).size).toBe(1)
    // la WHERE resta su una riga sua, con i suoi spazi normali
    expect(out).toContain('\nWHERE id = 999')
    expect(out).toContain('AND altra = 1')
  })
})
