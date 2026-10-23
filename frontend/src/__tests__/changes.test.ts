// Finestra "Modifiche": la griglia con gli oggetti del database e QUANDO sono stati modificati.
// Richiesta utente: "mi fai una finestra dove vedo la lista delle cose modificate e quando?
// tipo una griglia con la store x il giorno ora".
import { describe, expect, it } from 'vitest'
import {
  TIPI_MODIFICA,
  contaPerTipo,
  etichettaTipo,
  filtraModifiche,
  formatDataOra,
  formatGiorno,
  modificatoOggi,
  nomeModifica,
  ordinaModifiche,
  quantoFa,
  raggruppaPerGiorno,
  riepilogoModifiche,
  tipoDaCodice,
  tipoOggettoApp,
} from '../changes'
import type { ObjectChangeRow } from '../types'

/** ISO di una data LOCALE: così i test non dipendono dal fuso orario della macchina. */
function iso(anno: number, mese: number, giorno: number, ore = 12, minuti = 0, secondi = 0): string {
  return new Date(anno, mese - 1, giorno, ore, minuti, secondi).toISOString()
}

function riga(
  name: string,
  typeCode: string,
  modifiedAt: string | null,
  schema = 'dbo',
  createdAt: string | null = iso(2020, 1, 1),
): ObjectChangeRow {
  return { schema, name, typeCode, typeDesc: typeCode, createdAt, modifiedAt }
}

describe('tipoDaCodice', () => {
  it('riconosce store, funzioni, viste, tabelle e trigger', () => {
    expect(tipoDaCodice('P')).toBe('procedura')
    expect(tipoDaCodice('FN')).toBe('funzione')
    expect(tipoDaCodice('IF')).toBe('funzione')
    expect(tipoDaCodice('TF')).toBe('funzione')
    expect(tipoDaCodice('V')).toBe('vista')
    expect(tipoDaCodice('U')).toBe('tabella')
    expect(tipoDaCodice('TR')).toBe('trigger')
  })

  it('accetta spazi e minuscole, e ignora i tipi che non ci interessano', () => {
    expect(tipoDaCodice(' p ')).toBe('procedura')
    expect(tipoDaCodice('C')).toBeNull()
    expect(tipoDaCodice('D')).toBeNull()
  })

  it('ogni tipo ha la sua etichetta per i filtri', () => {
    expect(TIPI_MODIFICA.map(etichettaTipo)).toEqual(['Store', 'Funzioni', 'Viste', 'Tabelle', 'Trigger'])
  })

  it('il tipo della finestra diventa il kind usato per aprire l\'oggetto', () => {
    expect(tipoOggettoApp('procedura')).toBe('procedure')
    expect(tipoOggettoApp('funzione')).toBe('function')
    expect(tipoOggettoApp('vista')).toBe('view')
    expect(tipoOggettoApp('trigger')).toBe('trigger')
    expect(tipoOggettoApp('tabella')).toBeNull()
  })
})

describe('date leggibili', () => {
  it('mostra giorno e ora in formato italiano', () => {
    expect(formatDataOra(iso(2024, 3, 12, 14, 30))).toBe('12/03/2024 14:30')
    expect(formatDataOra(iso(2024, 12, 5, 9, 5))).toBe('05/12/2024 09:05')
  })

  it('senza data mostra un trattino invece di "Invalid Date"', () => {
    expect(formatDataOra(null)).toBe('—')
    expect(formatGiorno(null)).toBe('—')
    expect(formatDataOra('non-una-data')).toBe('non-una-data')
  })

  it('"quanto fa" in italiano', () => {
    const adesso = new Date(2024, 2, 12, 15, 0)
    expect(quantoFa(iso(2024, 3, 12, 14, 59), adesso)).toBe('1 minuto fa')
    expect(quantoFa(iso(2024, 3, 12, 14, 55), adesso)).toBe('5 minuti fa')
    expect(quantoFa(iso(2024, 3, 12, 13, 0), adesso)).toBe('2 ore fa')
    expect(quantoFa(iso(2024, 3, 10, 15, 0), adesso)).toBe('2 giorni fa')
    expect(quantoFa(iso(2024, 3, 12, 14, 59, 40), adesso)).toBe('ora')
    expect(quantoFa(iso(2024, 3, 12, 15, 0), adesso)).toBe('ora')
  })

  it('oltre il mese mostra la data, non i giorni', () => {
    const adesso = new Date(2024, 5, 1, 12, 0)
    expect(quantoFa(iso(2023, 12, 25, 10, 0), adesso)).toBe('il 25/12/2023')
  })

  it('modificatoOggi è vero solo per oggi', () => {
    const adesso = new Date(2024, 2, 12, 15, 0)
    expect(modificatoOggi(iso(2024, 3, 12, 0, 5), adesso)).toBe(true)
    expect(modificatoOggi(iso(2024, 3, 11, 23, 55), adesso)).toBe(false)
    expect(modificatoOggi(null, adesso)).toBe(false)
  })
})

describe('nomeModifica', () => {
  it('nasconde lo schema dbo e mostra gli altri', () => {
    expect(nomeModifica(riga('sp_x', 'P', null))).toBe('sp_x')
    expect(nomeModifica(riga('sp_x', 'P', null, 'vendite'))).toBe('vendite.sp_x')
  })
})

describe('filtraModifiche', () => {
  const righe = [
    riga('sp_ordini', 'P', iso(2024, 3, 12, 10, 0)),
    riga('sp_clienti', 'P', iso(2024, 3, 1, 10, 0)),
    riga('fn_totale', 'FN', iso(2024, 3, 12, 11, 0), 'vendite'),
    riga('v_ordini', 'V', iso(2023, 1, 1, 10, 0)),
    riga('DAT_ORDINI', 'U', iso(2024, 2, 2, 10, 0)),
  ]
  const adesso = new Date(2024, 2, 12, 12, 0)

  it('cerca nel nome, anche con lo schema', () => {
    expect(filtraModifiche(righe, { testo: 'ordini' }, adesso).map(r => r.name)).toEqual([
      'sp_ordini',
      'v_ordini',
      'DAT_ORDINI',
    ])
    expect(filtraModifiche(righe, { testo: 'vendite.fn' }, adesso).map(r => r.name)).toEqual(['fn_totale'])
  })

  it('filtra per tipo (più tipi insieme)', () => {
    expect(filtraModifiche(righe, { tipi: ['procedura'] }, adesso).map(r => r.name)).toEqual([
      'sp_ordini',
      'sp_clienti',
    ])
    expect(filtraModifiche(righe, { tipi: ['vista', 'tabella'] }, adesso).map(r => r.name)).toEqual([
      'v_ordini',
      'DAT_ORDINI',
    ])
  })

  it('filtra per periodo (ultime 24 ore / 7 giorni)', () => {
    expect(filtraModifiche(righe, { periodo: '1' }, adesso).map(r => r.name)).toEqual([
      'sp_ordini',
      'fn_totale',
    ])
    expect(filtraModifiche(righe, { periodo: '7' }, adesso).map(r => r.name)).toEqual(['sp_ordini', 'fn_totale'])
    expect(filtraModifiche(righe, { periodo: 'tutto' }, adesso)).toHaveLength(5)
  })

  it('i filtri si sommano', () => {
    expect(filtraModifiche(righe, { testo: 'ordini', tipi: ['procedura'], periodo: '1' }, adesso).map(r => r.name)).toEqual([
      'sp_ordini',
    ])
  })
})

describe('ordinaModifiche', () => {
  const righe = [
    riga('b_store', 'P', iso(2024, 3, 1, 9, 0)),
    riga('a_store', 'P', iso(2024, 3, 12, 9, 0)),
    riga('c_store', 'V', iso(2024, 3, 5, 9, 0)),
  ]

  it('per data: più recente in cima (default della finestra)', () => {
    expect(ordinaModifiche(righe, 'modifiedAt', 'desc').map(r => r.name)).toEqual([
      'a_store',
      'c_store',
      'b_store',
    ])
  })

  it('per nome, crescente e decrescente', () => {
    expect(ordinaModifiche(righe, 'name', 'asc').map(r => r.name)).toEqual(['a_store', 'b_store', 'c_store'])
    expect(ordinaModifiche(righe, 'name', 'desc').map(r => r.name)).toEqual(['c_store', 'b_store', 'a_store'])
  })

  it('per tipo: prima le store, poi le viste', () => {
    expect(ordinaModifiche(righe, 'tipo', 'asc').map(r => r.name)).toEqual(['a_store', 'b_store', 'c_store'])
  })

  it('a parità di data l\'ordine è stabile (nome crescente)', () => {
    const pari = [riga('zeta', 'P', iso(2024, 3, 1)), riga('alfa', 'P', iso(2024, 3, 1))]
    expect(ordinaModifiche(pari, 'modifiedAt', 'desc').map(r => r.name)).toEqual(['alfa', 'zeta'])
  })

  it('non modifica l\'array originale', () => {
    const copia = [...righe]
    ordinaModifiche(righe, 'name', 'asc')
    expect(righe).toEqual(copia)
  })
})

describe('raggruppaPerGiorno', () => {
  it('raggruppa per giorno, dal più recente', () => {
    const gruppi = raggruppaPerGiorno([
      riga('sp_a', 'P', iso(2024, 3, 12, 10, 0)),
      riga('sp_b', 'P', iso(2024, 3, 12, 8, 0)),
      riga('sp_c', 'P', iso(2024, 3, 10, 8, 0)),
    ])
    expect(gruppi.map(g => g.giorno)).toEqual(['12/03/2024', '10/03/2024'])
    expect(gruppi[0].righe.map(r => r.name)).toEqual(['sp_a', 'sp_b'])
  })

  it('le righe senza data finiscono in fondo, in un gruppo a parte', () => {
    const gruppi = raggruppaPerGiorno([riga('sp_a', 'P', null), riga('sp_b', 'P', iso(2024, 3, 12))])
    expect(gruppi[gruppi.length - 1].giorno).toBe('senza data')
  })
})

describe('contaPerTipo / riepilogoModifiche', () => {
  const righe = [
    riga('sp_a', 'P', iso(2024, 3, 12, 10, 0)),
    riga('sp_b', 'P', iso(2024, 3, 1, 10, 0)),
    riga('fn_a', 'FN', iso(2024, 3, 12, 10, 0)),
    riga('v_a', 'V', iso(2024, 3, 12, 10, 0)),
    riga('tr_a', 'TR', iso(2024, 3, 12, 10, 0)),
  ]

  it('conta gli oggetti per tipo', () => {
    const c = contaPerTipo(righe)
    expect(c.procedura).toBe(2)
    expect(c.funzione).toBe(1)
    expect(c.vista).toBe(1)
    expect(c.tabella).toBe(0)
    expect(c.trigger).toBe(1)
  })

  it('riepiloga il contenuto della griglia', () => {
    const testo = riepilogoModifiche(righe, new Date(2024, 2, 12, 15, 0))
    expect(testo).toContain('5 oggetti')
    expect(testo).toContain('2 store')
    expect(testo).toContain('1 funzioni')
    expect(testo).toContain('1 viste')
    expect(testo).toContain('4 modificati oggi')
    expect(testo).not.toContain('tabelle')
  })
})
