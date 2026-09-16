// MERGE (e UPDATE): evidenziazione del campo corrispondente al cursore.
//
// Segnalato dall'utente: in un MERGE, con il cursore su un valore, va illuminato il campo
// rispettivo — come succede per gli INSERT (colonne ↔ valori) e per gli UPDATE (colonna ↔
// espressione della SET). Il caso di riferimento è una MERGE reale con 26 colonne.
import { describe, expect, it } from 'vitest'
import {
  findMergeStatementAt,
  insertCorrespondingTarget,
  mergeCorrespondingTarget,
  pairHighlightTarget,
  updateCorrespondingTarget,
} from '../helpers'

const MERGE = `MERGE INTO TIPI_CAUSALI_MISSIONI AS tgt
USING (VALUES
    ('RETRN', 'Return in kitting', ' ', 1, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, '', 0, 0, 0, 0, 0, 0, 0)) AS src
     ([CAUM_CAUSMISS], [CAUM_DES], [CAUM_SCA_CAUSMISS], [CAUM_ESE_IF_OK], [CAUM_ESE_IF_FF], [CAUM_ESE_DEL_IF_FF],
      [CAUM_ESE_DEL_IF_ANN], [CAUM_ENTRATA], [CAUM_RIENTRO], [CAUM_DELUDC_IF_OK], [CAUM_DELUDC_IF_FF], [CAUM_SCARTO],
       [CAUM_NO_DECURT_GIAC], [CAUM_NO_OUT_IF_RESIDUO], [CAUM_NO_REG], [CAUM_NO_REG_FF], [CAUM_NO_RIALLOCA], [CAUM_GO_RILEV], [CAUM_RIE_SPOS_CAUSMISS],
        [CAUM_SMONTAGGIO], [CAUM_LGV_TOEND], [CAUM_ACCORPA], [CAUM_EVAC], [CAUM_SPLIT], [CAUM_VNA_TO_KITTING], [CAUM_VNA_TO_ABS])
ON tgt.[CAUM_CAUSMISS] = src.[CAUM_CAUSMISS]
WHEN MATCHED THEN UPDATE SET
    tgt.[CAUM_CAUSMISS] = src.[CAUM_CAUSMISS],
    tgt.[CAUM_DES] = src.[CAUM_DES],
    tgt.[CAUM_VNA_TO_ABS] = src.[CAUM_VNA_TO_ABS]
WHEN NOT MATCHED THEN INSERT ([CAUM_CAUSMISS], [CAUM_DES], [CAUM_VNA_TO_ABS])
    VALUES (src.[CAUM_CAUSMISS], src.[CAUM_DES], src.[CAUM_VNA_TO_ABS]);`

/** Testo evidenziato alla posizione data. */
function evidenziato(sql: string, offset: number): string | null {
  const t = pairHighlightTarget(sql, offset)
  return t ? sql.slice(t.start, t.end) : null
}

describe('MERGE: campo corrispondente', () => {
  it('riconosce l istruzione MERGE che contiene il cursore', () => {
    expect(findMergeStatementAt(MERGE, MERGE.indexOf('CAUM_DES'))).not.toBeNull()
    expect(findMergeStatementAt('SELECT 1; SELECT 2', 3)).toBeNull()
  })

  it('cursore su un valore della USING → evidenzia la colonna di src di pari indice', () => {
    // primo valore della tupla → prima colonna
    expect(evidenziato(MERGE, MERGE.indexOf("'RETRN'") + 2)).toBe('[CAUM_CAUSMISS]')
    // secondo valore → seconda colonna
    expect(evidenziato(MERGE, MERGE.indexOf("'Return in kitting'") + 3)).toBe('[CAUM_DES]')
    // ultimo valore (26°) → ultima colonna
    const ultimoValore = MERGE.indexOf('0)) AS src')
    expect(evidenziato(MERGE, ultimoValore)).toBe('[CAUM_VNA_TO_ABS]')
  })

  it('cursore su una colonna di src → evidenzia il valore di pari indice', () => {
    expect(evidenziato(MERGE, MERGE.indexOf('([CAUM_CAUSMISS]') + 3)).toBe("'RETRN'")
    // la colonna [CAUM_SCARTO] è la 12ª: il 12° valore è 0
    const colonna = MERGE.indexOf('[CAUM_SCARTO]')
    expect(evidenziato(MERGE, colonna + 2)).toBe('0')
  })

  it('coppie del SET (ramo MATCHED): colonna ↔ valore', () => {
    const set = MERGE.indexOf('tgt.[CAUM_DES] = src.[CAUM_DES]')
    expect(evidenziato(MERGE, set + 6)).toBe('src.[CAUM_DES]') // cursore sulla colonna di sinistra
    expect(evidenziato(MERGE, set + 22)).toBe('tgt.[CAUM_DES]') // cursore sul lato destro
  })

  it('coppia della condizione ON', () => {
    const on = MERGE.indexOf('ON tgt.[CAUM_CAUSMISS]')
    expect(evidenziato(MERGE, on + 5)).toBe('src.[CAUM_CAUSMISS]')
    expect(evidenziato(MERGE, on + 25)).toBe('tgt.[CAUM_CAUSMISS]')
  })

  it('ramo NOT MATCHED: come un INSERT (colonne ↔ valori)', () => {
    const insert = MERGE.indexOf('INSERT ([CAUM_CAUSMISS], [CAUM_DES]')
    // cursore sulla seconda colonna dell'INSERT → secondo valore
    expect(evidenziato(MERGE, MERGE.indexOf('[CAUM_DES]', insert) + 3)).toBe('src.[CAUM_DES]')
    // cursore sul secondo valore → la colonna corrispondente
    const valori = MERGE.indexOf('VALUES (src.[CAUM_CAUSMISS]')
    const secondoValore = MERGE.indexOf('src.[CAUM_DES]', valori)
    expect(evidenziato(MERGE, secondoValore + 5)).toBe('[CAUM_DES]')
  })

  it('cursore fuori dalle parti utili: nessuna evidenziazione', () => {
    expect(mergeCorrespondingTarget(MERGE, MERGE.indexOf('MERGE INTO') + 1)).toBeNull()
    expect(mergeCorrespondingTarget(MERGE, MERGE.indexOf('WHEN MATCHED') + 3)).toBeNull()
    expect(mergeCorrespondingTarget('SELECT 1', 2)).toBeNull()
  })

  it('MERGE con sorgente SELECT: nessun campo da abbinare (nessun errore)', () => {
    const sql = `MERGE INTO dbo.T AS tgt USING (SELECT a, b FROM dbo.S) AS src ON tgt.a = src.a
WHEN MATCHED THEN UPDATE SET tgt.b = src.b;`
    const t = mergeCorrespondingTarget(sql, sql.indexOf('tgt.b') + 2)
    expect(sql.slice(t!.start, t!.end)).toBe('src.b')
  })
})

describe('UPDATE: colonna ↔ espressione della SET', () => {
  const sql = `UPDATE DAT_ORDINI_RIGHE
  SET RIG_QTAR = isnull (@pRIG_QTAR, RIG_QTAR)
     ,RIG_REQ_NOTE = 'x'
WHERE RIG_RIGA = 1;`

  it('cursore sulla colonna → evidenzia l espressione', () => {
    expect(evidenziato(sql, sql.indexOf('RIG_QTAR =') + 2)).toBe('isnull (@pRIG_QTAR, RIG_QTAR)')
  })

  it('cursore sull espressione → evidenzia la colonna', () => {
    expect(evidenziato(sql, sql.indexOf("'x'") + 1)).toBe('RIG_REQ_NOTE')
  })

  it('cursore nella WHERE: nessuna evidenziazione', () => {
    expect(updateCorrespondingTarget(sql, sql.indexOf('WHERE') + 2)).toBeNull()
  })
})

describe('MERGE non in prima posizione (bug segnalato: "nella seconda non funziona")', () => {
  // Con più MERGE/query nel file, gli offset delle liste vanno confrontati con la posizione
  // RELATIVA allo statement: usando quella assoluta l'indice finiva sull'ULTIMO campo.
  const M = `MERGE INTO TIPI_CAUSALI_MISSIONI AS tgt
USING (VALUES ('RETRN', 'Return in kitting', 'X3', 'X4', 'X5')) AS src ([CAUM_CAUSMISS], [CAUM_DES], [C3], [C4], [C5])
ON tgt.[CAUM_CAUSMISS] = src.[CAUM_CAUSMISS]
WHEN MATCHED THEN UPDATE SET tgt.[C3] = src.[C3]
WHEN NOT MATCHED THEN INSERT ([CAUM_CAUSMISS], [CAUM_DES], [C3], [C4], [C5]) VALUES (src.[CAUM_CAUSMISS], src.[CAUM_DES], src.[C3], src.[C4], src.[C5])`

  const posizioni: [string, string][] = [
    ['da sola', M],
    ['dopo un altra query', `SELECT 1 AS x\n${M}`],
    ['seconda di due MERGE (senza ;)', `${M}\n${M}`],
    ['seconda di due MERGE (con ;)', `${M};\n${M};`],
  ]

  for (const [nome, testo] of posizioni) {
    it(`${nome}: evidenzia il campo giusto (non l ultimo)`, () => {
      const base = testo.lastIndexOf('MERGE INTO')
      // 3º valore della USING → 3ª colonna; 4ª colonna → 4º valore
      expect(evidenziato(testo, testo.indexOf("'X3'", base) + 1)).toBe('[C3]')
      const colonne = testo.indexOf('([CAUM_CAUSMISS]', base)
      expect(evidenziato(testo, testo.indexOf('[C4]', colonne) + 2)).toBe("'X4'")
      // ramo NOT MATCHED: 3ª colonna → 3º valore
      const insert = testo.indexOf('INSERT (', base)
      expect(evidenziato(testo, testo.indexOf('[C3]', insert) + 2)).toBe('src.[C3]')
    })
  }
})

describe('pairHighlightTarget: comportamento invariato per INSERT', () => {
  it('un INSERT continua a evidenziare colonna ↔ valore', () => {
    const sql = "INSERT INTO dbo.Clienti (id, nome) VALUES (1, 'Mario');"
    expect(evidenziato(sql, sql.indexOf('nome') + 1)).toBe("'Mario'")
    expect(insertCorrespondingTarget(sql, sql.indexOf('nome') + 1)).not.toBeNull()
  })

  it('un statement qualunque non evidenzia nulla', () => {
    expect(evidenziato('SELECT a, b FROM dbo.T WHERE a = 1', 8)).toBeNull()
  })
})
