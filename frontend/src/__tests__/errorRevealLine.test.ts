// Doppio clic su un errore → riga giusta nell'editor.
//
// Segnalato dall'utente: con "Msg 156 … Procedura ws_X_TOSOSASA · Riga 64" ci si aspetta di
// finire sulla riga 164, perché nella tab la procedura inizia alla riga 101 (SQL Server conta
// le righe DENTRO la definizione).
import { describe, expect, it } from 'vitest'
import { firstErrorMessage, messageRevealLine, routineStartLine } from '../sqlMessages'
import type { QueryMessage, QueryResult } from '../types'

/** Tab con 100 righe di intestazione: la definizione inizia alla riga 101. */
const TAB = `${Array.from({ length: 100 }, (_, i) => `-- riga ${i + 1}`).join('\n')}
CREATE OR ALTER PROCEDURE [dbo].[ws_CIDEDO_HUSOBUME_KIPEVUBEGUSEV_St1_GIVOSEB_TOSOSASA]
(
  @user nvarchar(50)
)
AS
BEGIN
  SELECT 1
END`

const msg = (extra: Partial<QueryMessage> = {}): QueryMessage => ({
  text: "Invalid object name 'X'.",
  display: "Msg 156, Livello 15, Stato 1 · Procedura ws_CIDEDO_HUSOBUME_KIPEVUBEGUSEV_St1_GIVOSEB_TOSOSASA · Riga 64",
  number: 156,
  severity: 15,
  state: 1,
  procedure: 'ws_CIDEDO_HUSOBUME_KIPEVUBEGUSEV_St1_GIVOSEB_TOSOSASA',
  line: 64,
  isError: true,
  ...extra,
})

describe('routineStartLine', () => {
  it('trova la riga della definizione, anche con schema e parentesi', () => {
    expect(routineStartLine(TAB, 'ws_CIDEDO_HUSOBUME_KIPEVUBEGUSEV_St1_GIVOSEB_TOSOSASA')).toBe(101)
    expect(routineStartLine('CREATE PROCEDURE dbo.p AS SELECT 1', 'p')).toBe(1)
    expect(routineStartLine('alter proc [dbo].[Altro] as select 1', 'ALTRO')).toBe(1)
    expect(routineStartLine('CREATE FUNCTION dbo.f () RETURNS INT AS BEGIN RETURN 1 END', 'f')).toBe(1)
    expect(routineStartLine(TAB, 'non_esiste')).toBeNull()
  })
})

describe('messageRevealLine: riga dell editor', () => {
  it('procedura che inizia alla riga 101 → "Riga 64" diventa 164', () => {
    expect(messageRevealLine(msg(), TAB)).toBe(164)
  })

  it('procedura creata NELLO STESSO batch: la riga è già quella dello script', () => {
    const batch = [
      '-- intestazione',
      '-- altra riga',
      'CREATE PROCEDURE #prova AS',
      'BEGIN',
      '  DECLARE @a int = 1',
      '  SELECT 1 / (@a - 1)',
      'END',
      'GO',
      'EXEC #prova',
    ].join('\n')
    // SQL Server riporta la riga 6 (quella dello script): va usata così com'è
    expect(messageRevealLine(msg({ procedure: '#prova', line: 6 }), batch)).toBe(6)
  })

  it('definizione alla riga 1 → la riga resta quella di SQL Server', () => {
    const soloProc = 'CREATE PROCEDURE dbo.p AS\nSELECT 1'
    expect(messageRevealLine(msg({ line: 2 }), soloProc)).toBe(2)
  })

  it('la procedura non è nel testo (script/EXEC): si usa la riga così com è', () => {
    expect(messageRevealLine(msg({ line: 64 }), 'EXEC dbo.altra_proc')).toBe(64)
    expect(messageRevealLine(msg({ procedure: null, line: 12 }), TAB)).toBe(12)
  })

  it('senza riga non si salta da nessuna parte', () => {
    expect(messageRevealLine(msg({ line: undefined }), TAB)).toBeNull()
    expect(messageRevealLine(msg({ line: 0 }), TAB)).toBeNull()
  })
})

describe('firstErrorMessage', () => {
  it('prende il primo messaggio di errore del risultato', () => {
    const result = {
      errors: [{ ...msg(), isError: false }, msg({ line: 7 }), msg({ line: 9 })],
    } as unknown as Pick<QueryResult, 'errors'>
    expect(firstErrorMessage(result)?.line).toBe(7)
    expect(firstErrorMessage({ errors: [] })).toBeNull()
  })
})
