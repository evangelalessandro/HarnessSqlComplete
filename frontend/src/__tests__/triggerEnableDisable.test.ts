// INTELLISENSE per ABILITARE/DISABILITARE i trigger (richiesta utente): dopo
// "DISABLE TRIGGER " (o "ENABLE TRIGGER ") si propongono i trigger, dopo "... ON " la tabella.
import { describe, expect, it } from 'vitest'
import { detectEnableDisableTriggerName, detectEnableDisableTriggerOn, detectObjectNameContext } from '../tsqlSnippets'

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
})
