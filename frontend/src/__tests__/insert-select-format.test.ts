// INSERT … SELECT: la lista dei VALORI (la select-list della SELECT) va impaginata come quella
// dei campi — un valore per riga, allineati sotto il primo.
//
// Segnalazione utente: "la formattazione della sp sotto non funziona a dovere nella parte dei
// valori per la insert". I campi venivano impilati, i valori restavano tutti su una riga
// (27 valori di fila), perché la testata conteneva una variabile (@udc) e finiva nel ramo
// delle "assegnazioni" invece che in quello della select-list.
import { describe, expect, it } from 'vitest'
import { buildFormatProfile } from '../formatProfile'
import { formatRoutineWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)

/** Sequenza dei token senza commenti: prova che il formatter non perde niente. */
function tokeniUtili(sql: string): string[] {
  return tokenizeSqlText(sql)
    .filter(t => t.type !== 'comment')
    .map(t => (t.type === 'word' ? t.text.toUpperCase() : t.text))
}

describe('INSERT … SELECT: i valori uno per riga (caso segnalato)', () => {
  it('campi e valori impilati allo stesso modo', () => {
    const sql = `create procedure p as
begin
  insert into TEST_TAB (A, B, C)
  select @x, 'SYSTEM', 0
  from TEST_SRC
  where X = 1
end`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toMatch(/^    INSERT INTO TEST_TAB \(A$/m)
    expect(out).toMatch(/^                          ,B$/m)
    expect(out).toMatch(/^                          ,C\)$/m)
    expect(out).toMatch(/^    SELECT @x$/m)
    expect(out).toMatch(/^       ,'SYSTEM'$/m)
    expect(out).toMatch(/^       ,0$/m)
    expect(out).toMatch(/^    FROM TEST_SRC$/m)
    expect(out).toMatch(/^    WHERE X = 1$/m)
  })

  it('nessun valore resta sulla riga della SELECT', () => {
    const sql = `create procedure p as
begin
  INSERT INTO RUN_MISSIONI (MIS_UDC, MIS_OPERATORE, MIS_S_BAIA, MIS_D_BAIA, MIS_WEIGHT)
  SELECT @udc, 'SYSTEM', @pBay, @mis_D_Baia, 0
  FROM MAG_BAIE
  WHERE BCO_BAIA = @pBay
end`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).not.toMatch(/SELECT @udc,/)
    expect(out).toMatch(/^    SELECT @udc$/m)
    for (const v of ["       ,'SYSTEM'", '       ,@pBay', '       ,@mis_D_Baia', '       ,0']) {
      expect(out).toMatch(new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'))
    }
  })

  it('stessa impaginazione dei campi: tanti campi quanti valori (caso reale, 27+27)', () => {
    // il blocco è quello della stored procedure segnalata (nomi delle tabelle come nel database)
    const sql = `CREATE OR ALTER PROCEDURE [dbo].[ws_Prova_Infeed]
(
        @pBay INT
)
AS
BEGIN
      INSERT INTO RUN_MISSIONI (MIS_UDC
                                ,MIS_OPERATORE
                                ,MIS_S_BAIA
                                ,MIS_S_PIAZZOLA
                                ,MIS_S_CORRIDOIO
                                ,MIS_S_CELLA
                                ,MIS_S_POS
                                ,MIS_S_DEP
                                ,MIS_D_BAIA
                                ,MIS_D_PIAZZOLA
                                ,MIS_FIN_BAIA
                                ,MIS_D_CORRIDOIO
                                ,MIS_D_CELLA
                                ,MIS_L2STA
                                ,MIS_CAUSMISS
                                ,MIS_L1_GESTORE
                                ,MIS_L1STA
                                ,MIS_ERRMISS
                                ,MIS_COMPONENTE
                                ,MIS_MODULO
                                ,MIS_LOCK_ING
                                ,MIS_H_FLAGSDATI
                                ,MIS_TIPOMISS
                                ,MIS_GES_P_MODULO
                                ,MIS_H_FIFO
                                ,MIS_NOTE
                                ,MIS_WEIGHT)
      SELECT @udc, 'SYSTEM', @pBay, @pBay, 0, 0, 1, 1, @mis_D_Baia, @mis_D_Baia, @mis_FIN_Baia, 0, 0, 'WL', @mis_CausMiss, 'LIVELLO1', 'PR', '', 'UOMO', GM_MODULO, 1, dbo.fn_HDL_ResetDataFlags ('11111111', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL), 0, '', 0, '', 0
      FROM MAG_BAIE
        INNER JOIN MAG_BAIE_PIAZ ON MAG_BAIE.BCO_BAIA = MAG_BAIE_PIAZ.BPZ_BAIA
      WHERE BPZ_PIAZZOLA > 0
END`
    const out = formatRoutineWithProfile(sql, profile)
    const righe = out.split('\n')
    const iInsert = righe.findIndex(r => r.trim().startsWith('INSERT INTO RUN_MISSIONI'))
    const iSelect = righe.findIndex(r => r.trim().startsWith('SELECT @udc'))
    const iFrom = righe.findIndex(r => r.trim().startsWith('FROM MAG_BAIE'))
    expect(iInsert).toBeGreaterThan(-1)
    expect(iSelect).toBeGreaterThan(iInsert)
    expect(iFrom).toBeGreaterThan(iSelect)
    const righeCampi = iSelect - iInsert
    const righeValori = iFrom - iSelect
    console.log(`  campi: ${righeCampi} righe · valori: ${righeValori} righe`)
    expect(righeCampi).toBe(27)
    expect(righeValori).toBe(27) // 1 riga "SELECT …" + 26 valori, uno per riga
    // niente valori accodati alla riga della SELECT
    expect(righe[iSelect].trim()).toBe('SELECT @udc')
    // i valori sono tutti allineati: virgola in testa, tutte le righe con lo stesso rientro
    const rientri = righe.slice(iSelect + 1, iFrom).map(r => r.search(/[^ ]/))
    expect(new Set(rientri).size).toBe(1)
    // la funzione con le virgole interne resta su una riga sola (le parentesi non si spezzano)
    expect(out).toContain("dbo.fn_HDL_ResetDataFlags ('11111111', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL)")
  })

  it('nessun token perso nel caso reale', () => {
    const sql = `CREATE OR ALTER PROCEDURE dbo.ws_Prova_Infeed
AS
BEGIN
  INSERT INTO RUN_MISSIONI (MIS_UDC, MIS_OPERATORE, MIS_WEIGHT)
  SELECT @udc, 'SYSTEM', dbo.fn_HDL_ResetDataFlags ('11111111', 1, NULL), 0
  FROM MAG_BAIE
    INNER JOIN MAG_BAIE_PIAZ ON MAG_BAIE.BCO_BAIA = MAG_BAIE_PIAZ.BPZ_BAIA
  WHERE BPZ_PIAZZOLA > 0
END`
    expect(tokeniUtili(formatRoutineWithProfile(sql, profile))).toEqual(tokeniUtili(sql))
  })
})

describe('la SELECT che NON è di un INSERT', () => {
  it('anche qui i campi vanno UNO PER RIGA (non più due per riga)', () => {
    // Richiesta utente sulla store ws_CUSTOM_Handheld_Kitting_Bay_To_Rack_St1_GetList:
    // "i campi nella select non si allineano così come gli alias". Prima le liste con campi
    // corti venivano raggruppate a due per riga (",MIS_OPERATORE, MIS_WEIGHT"), quindi i campi
    // non erano allineati; ora la select-list è sempre un campo per riga, come nell'INSERT…SELECT.
    const sql = `create procedure p as
begin
  select MIS_UDC, MIS_OPERATORE, MIS_WEIGHT
  from TEST_SRC
  where X = 1
end`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toMatch(/^\s*SELECT MIS_UDC$/m)
    expect(out).toMatch(/^\s*,MIS_OPERATORE$/m)
    expect(out).toMatch(/^\s*,MIS_WEIGHT$/m)
    // nessuna riga con due campi
    expect(out).not.toMatch(/MIS_OPERATORE, MIS_WEIGHT/)
    // i campi cominciano tutti dalla stessa colonna
    const righe = out.split('\n').filter(r => /^\s*,?MIS_(UDC|OPERATORE|WEIGHT)$/.test(r))
    expect(new Set(righe.map(r => r.search(/[^ ]/))).size).toBe(1)
  })
})

describe('allineamento degli ALIAS nella select-list', () => {
  it('gli alias partono tutti dalla stessa colonna', () => {
    const sql = `create procedure p as
begin
  select SCO_SCOMPARTO X_SCO, UDC_UDC X_UDC_SOURCE, IIF (UDC_SSCC > '', UDC_SSCC, SCO_SSCC_SOURCE) X_SSCC, UDC_USER_TASK
  from TEST_SRC
  where X = 1
end`
    const out = formatRoutineWithProfile(sql, profile)
    console.log(out)
    const righe = out.split('\n').filter(r => /(X_SCO|X_UDC_SOURCE|X_SSCC)\s*$/.test(r.trimEnd()))
    expect(righe.length).toBe(3)
    // posizione di partenza dell'alias (dalla fine della riga, così non si confonde con
    // le colonne omonime dentro l'espressione)
    const colonne = righe.map(r => {
      const t = r.trimEnd()
      const m = /(X_SCO|X_UDC_SOURCE|X_SSCC)\s*$/.exec(t)!
      return t.length - m[1].length
    })
    console.log(`  colonne degli alias: ${JSON.stringify(colonne)}`)
    expect(new Set(colonne).size).toBe(1)
    // il campo senza alias resta nudo
    expect(out).toMatch(/^\s*,UDC_USER_TASK$/m)
  })

  it('con "AS" l alias (compreso l AS) resta incolonnato', () => {
    const sql = `create procedure p as
begin
  select CAST ('' AS NVARCHAR(50)) AS X_SSCC_DEST, ISNULL (UDC_UDC, 0) X_UDC_DEST
  from TEST_SRC
  where X = 1
end`
    const out = formatRoutineWithProfile(sql, profile)
    console.log(out)
    const righe = out.split('\n').filter(r => /(AS X_SSCC_DEST|X_UDC_DEST)\s*$/.test(r.trimEnd()))
    expect(righe.length).toBe(2)
    const colonne = righe.map(r => {
      const t = r.trimEnd()
      const m = /(AS X_SSCC_DEST|X_UDC_DEST)\s*$/.exec(t)!
      return t.length - m[1].length
    })
    console.log(`  colonne degli alias (AS compreso): ${JSON.stringify(colonne)}`)
    expect(new Set(colonne).size).toBe(1)
  })

  it('senza alias non si aggiungono spazi inutili', () => {
    const out = formatRoutineWithProfile(
      'create procedure p as\nbegin\n  select UDC_UDC, UDC_TAG\n  from T\n  where X = 1\nend',
      profile,
    )
    expect(out).toMatch(/^\s*,UDC_TAG$/m)
  })
})
