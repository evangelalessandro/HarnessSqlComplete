// Il SEGNO digitato non deve sparire: "@@" (ROWCOUNT e funzioni di sistema) e "@" (variabili) fanno parte
// della parola completata; solo il "#" delle temporanee resta fuori dal range e va tolto dall'insert.
//
// Segnalazione utente: "se provo a scrivere @@rowcount non scrive solo rowcount usando l'intellisense, così
// anche per le variabili, metti un test per non romperlo più".
import { describe, expect, it } from 'vitest'
import { insertSenzaSegnoLocale } from '../helpers'

describe('insertSenzaSegnoLocale: il segno resta', () => {
  it('@@ROWCOUNT non perde i due segni', () => {
    expect(insertSenzaSegnoLocale('select @@', '@@ROWCOUNT')).toBe('@@ROWCOUNT')
    expect(insertSenzaSegnoLocale('select @@ro', '@@ROWCOUNT')).toBe('@@ROWCOUNT')
    expect(insertSenzaSegnoLocale('@@', '@@TRANCOUNT')).toBe('@@TRANCOUNT')
  })

  it('le variabili non perdono la @', () => {
    expect(insertSenzaSegnoLocale('select @pi', '@pippo')).toBe('@pippo')
    expect(insertSenzaSegnoLocale('select ', '@pippo')).toBe('@pippo')
    expect(insertSenzaSegnoLocale('DECLARE @x INT = ', '@x')).toBe('@x')
  })

  it('le tabelle temporanee invece perdono il # (il segno resta nel testo)', () => {
    // il PREFISSO è il testo prima della parola in corso: finisce con "#" quando si sta scrivendo "#t"
    expect(insertSenzaSegnoLocale('select * from #', '#tmpRows')).toBe('tmpRows')
    expect(insertSenzaSegnoLocale('select * from ##', '##globale')).toBe('globale')
    // prefisso che NON finisce con '#': insert invariato
    expect(insertSenzaSegnoLocale('select * from x', '#tmpRows')).toBe('#tmpRows')
  })

  it('senza segno nel testo insertText invariato', () => {
    expect(insertSenzaSegnoLocale('select ', 'ESE_UDC')).toBe('ESE_UDC')
    expect(insertSenzaSegnoLocale('select * from ', 'DAT_ORDINI')).toBe('DAT_ORDINI')
  })
})
