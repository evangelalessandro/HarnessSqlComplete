// @vitest-environment node
// "Modifica" (tasto destro su una routine) su definizioni REALI del database.
//
// Bug segnalato: su una SP il commento iniziale e "CREATE OR ALTER" finivano sulla STESSA
// riga ("/* ... */CREATE OR ALTER PROCEDURE ..."), mentre la voce corretta mandava il
// CREATE a capo. Gli header reali (uno o più commenti a blocco separati da righe vuote)
// sono esattamente il caso che faceva scattare il problema: qui si controlla su testo vero.
import { describe, expect, it } from 'vitest'
import { toCreateOrAlterStatement } from '../helpers'
import { realDefinitions } from './fixtures/realDefinitions'

/** Posizione dell'intestazione CREATE/ALTER della routine dentro la definizione. */
function headIndex(definition: string): number {
  return definition.search(/(CREATE|ALTER)\s+(OR\s+ALTER\s+)?(PROC|PROCEDURE|FUNCTION)/i)
}

/** Toglie "CREATE"/"ALTER"/"CREATE OR ALTER" dall'inizio, per confrontare il corpo. */
function stripHead(text: string): string {
  return text.replace(/^(?:CREATE|ALTER)\s+(?:OR\s+ALTER\s+)?/i, '')
}

describe('Modifica (CREATE OR ALTER) su definizioni reali', () => {
  it('il fixture contiene definizioni vere con header e intestazione', () => {
    expect(realDefinitions.length).toBeGreaterThan(0)
    for (const d of realDefinitions) {
      expect(d.name, 'nome mancante').toMatch(/^\w+\.\w+$/)
      expect(headIndex(d.definition), `${d.name}: intestazione CREATE/ALTER assente`).toBeGreaterThan(-1)
      expect(d.definition.length).toBeGreaterThan(50)
    }
  })

  it('l istruzione finisce SEMPRE su una riga nuova, mai attaccata al commento', () => {
    for (const d of realDefinitions) {
      const out = toCreateOrAlterStatement(d.definition)
      const where = `\n--- ${d.name} ---`
      // l'istruzione esiste e comincia a inizio riga
      expect(/^CREATE OR ALTER /m.test(out), `istruzione non trovata${where}`).toBe(true)
      // nessun commento incollato all'istruzione (era il bug segnalato)
      expect(out, `commento a blocco attaccato al CREATE${where}`).not.toMatch(/\*\/[ \t]*CREATE OR ALTER/)
      expect(out, `commento di riga che commenta il CREATE${where}`).not.toMatch(/--[^\n]*CREATE OR ALTER/)
      // il carattere che precede l'istruzione è un a capo
      const idx = out.indexOf('CREATE OR ALTER ')
      expect(out[idx - 1], `prima dell istruzione c e "${out[idx - 1]}" invece di un a capo${where}`).toBe('\n')
    }
  })

  it('nessun commento dell header viene perso o modificato', () => {
    for (const d of realDefinitions) {
      const out = toCreateOrAlterStatement(d.definition)
      const where = `\n--- ${d.name} ---`
      const originalHead = d.definition.slice(0, headIndex(d.definition))
      const comments = originalHead.match(/\/\*[\s\S]*?\*\/|--[^\n]*/g) ?? []
      expect(comments.length, `nessun commento nell header di ${d.name}`).toBeGreaterThan(0)
      for (const c of comments) {
        expect(out, `commento perso o modificato${where}`).toContain(c)
      }
    }
  })

  it('il corpo della routine dopo l intestazione resta identico', () => {
    for (const d of realDefinitions) {
      const out = toCreateOrAlterStatement(d.definition)
      const where = `\n--- ${d.name} ---`
      const originalBody = stripHead(d.definition.slice(headIndex(d.definition)))
      const newBody = stripHead(out.slice(out.indexOf('CREATE OR ALTER ')))
      expect(newBody, `corpo modificato${where}`).toBe(originalBody)
    }
  })
})
