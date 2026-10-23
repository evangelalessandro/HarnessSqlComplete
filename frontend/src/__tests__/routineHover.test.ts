// TOOLTIP DI UNA STORED PROCEDURE: parametri della firma e commento di testata
// (richiesta utente: "nella tooltip di una store mi puoi fare vedere commento e parametri?").
import { describe, expect, it } from 'vitest'
import {
  MAX_COMMENTO_HOVER,
  descrizioneParametro,
  estraiCommentoRoutine,
  routineHoverMarkdown,
  unisciParametri,
} from '../routineHover'
import type { ProcParamInfo } from '../types'

// Il sommario dell'API NON ha la chiocciola nei nomi e non ha le lunghezze: `errore nvarchar(255)`.
const sommario: ProcParamInfo[] = [
  { name: 's_Piazzola', dataType: 'int', mode: 'IN' },
  { name: 'mis_Operatore', dataType: 'nvarchar', mode: 'IN' },
  { name: 'errore', dataType: 'nvarchar', mode: 'OUTPUT' },
  { name: 'conDefault', dataType: 'bit', mode: 'IN', defaultValue: '0' },
]

// La definizione invece ha chiocciola, lunghezze esatte e OUTPUT scritto in fondo alla riga.
const definizione = `/* Routine per generazione missione da baia ingresso verso baia decisione o scarto. */
CREATE PROCEDURE [dbo].[ws_L2_GenMissIng]
  @s_Piazzola int,
  @mis_Operatore nvarchar(max),
  @errore nvarchar(255) OUTPUT,
  @conDefault bit = 0
AS
SELECT 1`

describe('estraiCommentoRoutine: il commento di testata della definizione', () => {
  it('blocco /* … */ in testa (anche prima della CREATE, come nelle store di questo DB)', () => {
    const def = `/* Routine per generazione missione da baia ingresso verso baia decisione o
   scarto.

   Parametri: Piazzola sorgente, udc della missione.
*/
CREATE PROCEDURE [dbo].[ws_L2_GenMissIng] @s_Piazzola int AS SELECT 1`
    const commento = estraiCommentoRoutine(def)
    expect(commento).toContain('Routine per generazione missione')
    expect(commento).toContain('Parametri: Piazzola sorgente')
    // i marcatori del commento NON restano nel testo
    expect(commento).not.toContain('/*')
    expect(commento).not.toContain('*/')
  })

  it('blocco con asterischi di apertura riga: gli asterischi di struttura si tolgono', () => {
    const def = `CREATE PROCEDURE dbo.p AS
/*
 * Descrizione della routine.
 * Seconda riga.
 */
SELECT 1`
    expect(estraiCommentoRoutine(def)).toBe('Descrizione della routine.\nSeconda riga.')
  })

  it('righe di commento "--" quando non c\'è un blocco', () => {
    const def = `-- Calcola i totali per missione
-- (seconda riga)
CREATE PROCEDURE dbo.p AS SELECT 1`
    expect(estraiCommentoRoutine(def)).toBe('Calcola i totali per missione\n(seconda riga)')
  })

  it('senza commenti → null (e non inventa nulla)', () => {
    expect(estraiCommentoRoutine('CREATE PROCEDURE dbo.p AS SELECT 1')).toBeNull()
    expect(estraiCommentoRoutine('')).toBeNull()
    expect(estraiCommentoRoutine(null)).toBeNull()
    expect(estraiCommentoRoutine(undefined)).toBeNull()
  })

  it('commento lunghissimo: si taglia con i puntini', () => {
    const lungo = '/* ' + 'x'.repeat(2000) + ' */'
    const commento = estraiCommentoRoutine(lungo)!
    expect(commento.length).toBeLessThanOrEqual(MAX_COMMENTO_HOVER)
    expect(commento.endsWith('…')).toBe(true)
  })
})

describe('unisciParametri: tipi precisi dalla definizione, OUTPUT e default dal sommario', () => {
  it('dalla definizione prende chiocciola e lunghezza esatta, dal sommario OUTPUT e default', () => {
    const uniti = unisciParametri(definizione, sommario)
    expect(uniti.map(p => p.nome)).toEqual(['@s_Piazzola', '@mis_Operatore', '@errore', '@conDefault'])
    // `nvarchar(max)` e `nvarchar(255)`: la lunghezza c'è (il sommario diceva solo "nvarchar")
    expect(uniti[1].tipo).toBe('nvarchar(max)')
    expect(uniti[2].tipo).toBe('nvarchar(255)')
    expect(uniti[2].output).toBe(true)
    expect(uniti[0].output).toBe(false)
    expect(uniti[3].predefinito).toBe('0')
  })

  it('riconosce i parametri anche se il sommario li scrive con la chiocciola o con altro caso', () => {
    const uniti = unisciParametri('CREATE PROC dbo.p @Errore nvarchar(10) OUTPUT AS SELECT 1', [
      { name: '@ERRORE', dataType: 'nvarchar', mode: 'OUTPUT' },
    ])
    expect(uniti).toEqual([{ nome: '@Errore', tipo: 'nvarchar(10)', output: true, predefinito: undefined }])
  })

  it('definizione assente o non analizzabile → si usa il sommario, con la chiocciola aggiunta', () => {
    for (const def of [null, undefined, '', 'CREATE PROCEDURE dbo.p AS SELECT 1']) {
      const uniti = unisciParametri(def, sommario)
      expect(uniti).toHaveLength(4)
      expect(uniti[0]).toEqual({ nome: '@s_Piazzola', tipo: 'int', output: false, predefinito: undefined })
      expect(uniti[2].output).toBe(true)
      expect(uniti[2].nome).toBe('@errore') // il sommario diceva "errore", senza @
    }
  })

  it('senza né definizione né sommario → nessun parametro (e nessun errore)', () => {
    expect(unisciParametri(null, null)).toEqual([])
    expect(unisciParametri(null, [])).toEqual([])
  })

  it('scarta il valore di ritorno delle funzioni (riga di sys.parameters con nome nullo)', () => {
    const conRitorno = [
      { name: null as unknown as string, dataType: 'bit', mode: 'OUTPUT' },
      { name: '@a', dataType: 'int', mode: 'IN' },
    ]
    expect(unisciParametri(null, conRitorno)).toEqual([
      { nome: '@a', tipo: 'int', output: false, predefinito: undefined },
    ])
    // con la definizione davanti, la riga nulla non deve rompere l'unione con il sommario
    expect(unisciParametri('CREATE PROC dbo.p @a int AS SELECT 1', conRitorno)).toEqual([
      { nome: '@a', tipo: 'int', output: false, predefinito: undefined },
    ])
  })
})

describe('routineHoverMarkdown: firma + parametri + commento', () => {
  const rif = { schema: 'dbo', name: 'ws_L2_GenMissIng', kind: 'procedure' as const }

  it('mostra il nome, il tipo e TUTTI i parametri (con OUTPUT e default)', () => {
    const md = routineHoverMarkdown(rif, unisciParametri(definizione, sommario), null)
    expect(md).toContain('**ws_L2_GenMissIng** · stored procedure')
    expect(md).toContain('### Parametri (4)')
    for (const p of ['@s_Piazzola', '@mis_Operatore', '@errore', '@conDefault']) {
      expect(md).toContain(`\`${p}\``)
    }
    expect(md).toContain('`@errore` · `nvarchar(255)` · **OUTPUT**')
    expect(md).toContain('default `0`')
  })

  it('mostra il COMMENTO come citazione', () => {
    const md = routineHoverMarkdown(rif, unisciParametri(definizione, sommario), estraiCommentoRoutine(definizione))
    expect(md).toContain('### Commento')
    expect(md).toContain('> Routine per generazione missione')
  })

  it('commento multi-riga: ogni riga è una citazione', () => {
    const md = routineHoverMarkdown(rif, [], 'Prima riga.\nSeconda riga.')
    expect(md).toContain('> Prima riga.')
    expect(md).toContain('> Seconda riga.')
  })

  it('routine senza parametri e senza commento: lo dice, senza sezioni vuote', () => {
    const md = routineHoverMarkdown({ schema: 'dbo', name: 'fn_td', kind: 'function' }, null, null)
    expect(md).toContain('**fn_td** · funzione')
    expect(md).toContain('_Nessun parametro._')
    expect(md).not.toContain('### Commento')
  })

  it('schema diverso da dbo: nome qualificato', () => {
    const md = routineHoverMarkdown({ schema: 'AD', name: 'ws_X', kind: 'procedure' }, [], null)
    expect(md).toContain('**AD.ws_X**')
  })
})

describe('descrizioneParametro', () => {
  it('nome con chiocciola, tipo, OUTPUT e default', () => {
    expect(descrizioneParametro({ nome: '@a', tipo: 'int' })).toBe('`@a` · `int`')
    expect(descrizioneParametro({ nome: '@a', tipo: 'int', output: true })).toBe('`@a` · `int` · **OUTPUT**')
    expect(descrizioneParametro({ nome: '@a', tipo: 'bit', predefinito: '((0))' })).toBe(
      '`@a` · `bit` · default `((0))`',
    )
  })

  it('default vuoto non viene mostrato', () => {
    expect(descrizioneParametro({ nome: '@a', tipo: 'int', predefinito: '' })).toBe('`@a` · `int`')
    expect(descrizioneParametro({ nome: '@a', tipo: 'int', predefinito: undefined })).toBe('`@a` · `int`')
  })
})
