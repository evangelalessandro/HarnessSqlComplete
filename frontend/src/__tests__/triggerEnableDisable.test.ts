// INTELLISENSE per ABILITARE/DISABILITARE i trigger (richiesta utente: "l'intellisense non mi
// aiuta a scrivere correttamente l'abilitazione o disabilitazione di un trigger"). La sintassi ha
// DUE pezzi — il nome (o ALL) e poi "ON <tabella>" — e la tabella deve essere quella SU CUI il
// trigger è definito: proponendone un'altra si scrive un'istruzione che SQL Server rifiuta.
import { describe, expect, it } from 'vitest'
import completionsSource from '../sqlCompletions.ts?raw'
import { buildStatementSnippets } from '../helpers'
import {
  detectAlterTableTrigger,
  detectEnableDisableTriggerName,
  detectEnableDisableTriggerOn,
  detectObjectNameContext,
  nomiTriggerDigitati,
  tabellaDelTrigger,
} from '../tsqlSnippets'

const TRIGGERS = [
  { schema: 'dbo', name: 'tr_DAT_UDC', tableName: 'DAT_UDC' },
  { schema: 'dbo', name: 'tr_TIPI_UDC', tableName: 'TIPI_UDC' },
  { schema: 'AD', name: 'tr_AD_ORDINI', tableName: 'ORDINI' },
]

describe('ENABLE/DISABLE TRIGGER: riconoscimento del contesto', () => {
  it('dopo "DISABLE TRIGGER " (e ENABLE) si propongono i trigger', () => {
    expect(detectObjectNameContext('DISABLE TRIGGER ')).toBe('trigger')
    expect(detectObjectNameContext('ENABLE TRIGGER ')).toBe('trigger')
    expect(detectObjectNameContext('disable trigger ')).toBe('trigger')
    expect(detectObjectNameContext('  DISABLE TRIGGER ')).toBe('trigger')
    expect(detectObjectNameContext('select 1;\nENABLE TRIGGER ')).toBe('trigger')
    // con un nome già scritto si continua a proporre (elenchi separati da virgola)
    expect(detectObjectNameContext('DISABLE TRIGGER tr_x')).toBeNull()
    expect(detectEnableDisableTriggerName('DISABLE TRIGGER tr_x, ')).toBe(true)
    expect(detectEnableDisableTriggerName('ENABLE TRIGGER [tr x]')).toBe(true)
    expect(detectEnableDisableTriggerName('DROP TRIGGER tr_x')).toBe(false)
  })

  it('dopo "... ON " si propone la tabella (o DATABASE / ALL SERVER)', () => {
    expect(detectEnableDisableTriggerOn('DISABLE TRIGGER tr_x ON ')).toBe(true)
    expect(detectEnableDisableTriggerOn('ENABLE TRIGGER ALL ON ')).toBe(true)
    expect(detectEnableDisableTriggerOn('DISABLE TRIGGER tr_x ON dbo')).toBe(false)
    expect(detectEnableDisableTriggerOn('ALTER TRIGGER tr_x ON ')).toBe(false)
  })

  it('nomiTriggerDigitati: i nomi scritti dopo TRIGGER (anche più di uno)', () => {
    expect(nomiTriggerDigitati('DISABLE TRIGGER tr_DAT_UDC ')).toEqual(['tr_DAT_UDC'])
    expect(nomiTriggerDigitati('ENABLE TRIGGER tr_a, tr_b ')).toEqual(['tr_a', 'tr_b'])
    expect(nomiTriggerDigitati('DISABLE TRIGGER [tr x]')).toEqual(['tr x'])
    expect(nomiTriggerDigitati('DISABLE TRIGGER ALL ')).toEqual(['ALL'])
    // dopo ON restituisce comunque i nomi scritti prima (le tabelle vengono dopo)
    expect(nomiTriggerDigitati('DISABLE TRIGGER tr_DAT_UDC ON ')).toEqual(['tr_DAT_UDC'])
    expect(nomiTriggerDigitati('DISABLE TRIGGER tr_a, tr_b ON dbo')).toEqual(['tr_a', 'tr_b'])
    // non è il nostro contesto
    expect(nomiTriggerDigitati('DISABLE TRIGGER ')).toBeNull()
    expect(nomiTriggerDigitati('DROP TRIGGER tr_x ')).toBeNull()
    expect(nomiTriggerDigitati('select 1')).toBeNull()
  })

  it('tabellaDelTrigger: la tabella di QUEL trigger (con o senza schema)', () => {
    expect(tabellaDelTrigger(TRIGGERS, 'tr_DAT_UDC')).toBe('DAT_UDC')
    expect(tabellaDelTrigger(TRIGGERS, 'tr_dat_udc')).toBe('DAT_UDC')
    expect(tabellaDelTrigger(TRIGGERS, '[tr_DAT_UDC]')).toBe('DAT_UDC')
    expect(tabellaDelTrigger(TRIGGERS, 'dbo.tr_TIPI_UDC')).toBe('TIPI_UDC')
    expect(tabellaDelTrigger(TRIGGERS, 'AD.tr_AD_ORDINI')).toBe('ORDINI')
    // trigger sconosciuto o "ALL": nessuna tabella (si ripiega su "ON" e basta)
    expect(tabellaDelTrigger(TRIGGERS, 'tr_inesistente')).toBe('')
    expect(tabellaDelTrigger(TRIGGERS, 'ALL')).toBe('')
  })

  it('detectAlterTableTrigger: la forma "ALTER TABLE t DISABLE TRIGGER"', () => {
    expect(detectAlterTableTrigger('ALTER TABLE dbo.DAT_UDC DISABLE TRIGGER ')).toEqual({ schema: 'dbo', table: 'DAT_UDC' })
    expect(detectAlterTableTrigger('ALTER TABLE DAT_UDC ENABLE TRIGGER ')).toEqual({ schema: '', table: 'DAT_UDC' })
    expect(detectAlterTableTrigger('ALTER TABLE [dbo].[DAT_UDC] DISABLE TRIGGER ')).toEqual({ schema: 'dbo', table: 'DAT_UDC' })
    expect(detectAlterTableTrigger('select 1;\nALTER TABLE dbo.T DISABLE TRIGGER ')).toEqual({ schema: 'dbo', table: 'T' })
    // altre forme non sono questa
    expect(detectAlterTableTrigger('ALTER TABLE dbo.T DISABLE TRIGGER tr_x')).toBeNull()
    expect(detectAlterTableTrigger('DISABLE TRIGGER tr_x ON ')).toBeNull()
    expect(detectAlterTableTrigger('ALTER TABLE dbo.T ADD COLUMN ')).toBeNull()
  })
})

// Segnalazione utente: "la parola enable o disable non viene fuori dall'intellisense".
describe('ENABLE/DISABLE TRIGGER: parole e snippet proposti', () => {
  it('le parole ENABLE, DISABLE e TRIGGER sono fra le keyword dell intellisense', () => {
    // il modulo importa Monaco (non eseguibile nei test): si guarda il sorgente
    expect(completionsSource).toContain("'ENABLE', 'DISABLE', 'TRIGGER'")
  })

  it('digitando "dis"/"ena" esce la direttiva completa (nome + ON tabella)', () => {
    expect(buildStatementSnippets('dis').some(s => s.label === 'DISABLE TRIGGER')).toBe(true)
    expect(buildStatementSnippets('ena').some(s => s.label === 'ENABLE TRIGGER')).toBe(true)
    expect(buildStatementSnippets('dis').some(s => s.label === 'DISABLE TRIGGER ALL')).toBe(true)
    expect(buildStatementSnippets('ena').some(s => s.label === 'ENABLE TRIGGER ALL')).toBe(true)
  })
})
