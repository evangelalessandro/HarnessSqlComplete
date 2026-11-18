// Nomi LOCALI (#tmp, @variabili tabella): niente parentesi quadre e niente doppio carattere.
//
// Segnalazione utente: "se ho una tabella temporanea tipo #tmpRows e la cerco con l'intellisense e scrivo
// # lui mi mette #[#tmpRows]".
import { describe, expect, it } from 'vitest'
import { sqlIdent, qualified } from '../helpers'

describe('sqlIdent con tabelle temporanee e variabili tabella', () => {
  it('#tmpRows resta senza parentesi', () => {
    expect(sqlIdent('#tmpRows')).toBe('#tmpRows')
    expect(sqlIdent('##globale')).toBe('##globale')
    expect(sqlIdent('@tab')).toBe('@tab')
  })

  it('i nomi normali restano com erano', () => {
    expect(sqlIdent('DAT_ORDINI')).toBe('DAT_ORDINI')
    expect(sqlIdent('nome con spazi')).toBe('[nome con spazi]')
    expect(sqlIdent('select')).toBe('[select]')
  })

  it('qualified non aggiunge schema ai nomi locali', () => {
    expect(qualified('dbo', '#tmpRows')).toBe('#tmpRows')
    expect(qualified('dbo', 'DAT_ORDINI')).toBe('DAT_ORDINI')
  })
})
