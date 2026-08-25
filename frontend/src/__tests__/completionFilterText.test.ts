import { describe, expect, it } from 'vitest'
import { completionFilterText } from '../helpers'

/**
 * Replica il filtro del completion model di Monaco (completionModel.js): a ogni
 * carattere digitato Monaco RIFILTRA le voci già calcolate con la parola corrente;
 * una voce resta visibile solo se la parola digitata compare in ordine (fuzzy
 * subsequence, case-insensitive) nel suo `filterText`.
 */
function monacoRefilterKeepsItem(typed: string, filterText: string): boolean {
  const t = typed.toLowerCase()
  const f = filterText.toLowerCase()
  let i = 0
  for (const ch of f) {
    if (ch === t[i]) i += 1
    if (i === t.length) return true
  }
  return false
}

describe('completionFilterText: filterText stabile (bug "MIS_" che svuota il popup)', () => {
  it('ritorna il nome della colonna, mai la parola digitata', () => {
    expect(completionFilterText('MIS_UDC')).toBe('MIS_UDC')
    expect(completionFilterText('CEL_CORRIDOIO')).toBe('CEL_CORRIDOIO')
  })

  it('col filterText = nome colonna, ogni prefisso digitato continua a matchare (MIS → MIS_ → MIS_U)', () => {
    for (const typed of ['mis', 'mis_', 'mis_u', 'm', 'MIS_UDC']) {
      expect(monacoRefilterKeepsItem(typed, completionFilterText('MIS_UDC'))).toBe(true)
    }
  })

  it('REG RESSIONE: col vecchio filterText = parola digitata ("mis"), digitare "_" svuota il popup', () => {
    // la voce memorizzata aveva filterText "mis" (la parola al momento del trigger)
    expect(monacoRefilterKeepsItem('mis', 'mis')).toBe(true)
    // digitando "_" la parola corrente diventa "mis_" → non è più subsequence di "mis"
    expect(monacoRefilterKeepsItem('mis_', 'mis')).toBe(false)
    // e "mis_udc" continua invece a matchare (il fix)
    expect(monacoRefilterKeepsItem('mis_', 'MIS_UDC')).toBe(true)
  })

  it('snippet statement: filterText = label ("INSERT INTO") regge i prefissi digitati ins → inse', () => {
    for (const typed of ['ins', 'inse', 'insert', 'insert into']) {
      expect(monacoRefilterKeepsItem(typed, 'INSERT INTO')).toBe(true)
    }
    // il vecchio filterText = parola digitata ("ins") falliva già a "inse"
    expect(monacoRefilterKeepsItem('inse', 'ins')).toBe(false)
  })
})
