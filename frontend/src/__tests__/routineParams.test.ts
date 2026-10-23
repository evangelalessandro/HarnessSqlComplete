// INTELLISENSE nella STORE che sto modificando: oltre alle variabili DECLARATE, il popup di "@…"
// deve proporre i PARAMETRI della firma (segnalazione utente: "l'intellisense non legge anche i
// parametri della store procedure che sto modificando"). Qui si usano le definizioni REALI.
import { describe, expect, it } from 'vitest'
import avvisi from './fixtures/routine_ws_L2_HAVO_IEDUGI_AESIPE.sql?raw'
import kittingReturn from './fixtures/routine_ws_CIDEDO_HUSOBUME_KIPEVUBEGUSEV_St1_GIVOSEB.sql?raw'
import { extractRoutineParameters, extractDeclaredVariables, detectVariableContext } from '../tsqlSnippets'

/** Nomi dei parametri, nell'ordine della firma. */
const nomi = (testo: string) => extractRoutineParameters(testo).map(p => p.name)

describe('parametri della routine in modifica (definizioni reali)', () => {
  it('legge i parametri della store reale ws_L2_HAVO_IEDUGI_AESIPE', () => {
    expect(nomi(avvisi)).toContain('@pOPERAZIONE')
    expect(nomi(avvisi)).toContain('@pSPLIT')
    expect(nomi(avvisi)).toContain('@pRIG_ARTICOLO')
    expect(nomi(avvisi)).toContain('@pRIG_QTAR')
    expect(nomi(avvisi)).toContain('@pRIG_LU_CODE')
    // tutti i 16 parametri della firma, con il tipo
    expect(nomi(avvisi)).toHaveLength(16)
    const tipo = extractRoutineParameters(avvisi).find(p => p.name === '@pRIG_STAMATE')
    expect(tipo?.dataType.toLowerCase()).toBe('nvarchar(5)')
  })

  it('legge i parametri anche della store reale ws_…_St1_GIVOSEB', () => {
    const p = nomi(kittingReturn)
    expect(p.length).toBeGreaterThan(0)
    expect(p.every(n => n.startsWith('@'))).toBe(true)
    console.log(`  parametri letti da St1_GIVOSEB: ${p.length} → ${JSON.stringify(p.slice(0, 6))}`)
  })

  it('con il cursore DENTRO il corpo i parametri ci sono comunque (testo troncato al cursore)', () => {
    // come fa l'editor: si passa il testo dal'inizio fino al cursore
    const taglio = avvisi.indexOf('SET NOCOUNT ON')
    expect(taglio).toBeGreaterThan(0)
    const primaDelCursore = avvisi.slice(0, taglio) + '\nSELECT @p'
    expect(detectVariableContext(primaDelCursore)).toBe(true)
    expect(nomi(primaDelCursore)).toHaveLength(16)
  })

  it('i parametri con valore di default (anche stringhe e commenti) non rompono la lettura', () => {
    const testo = [
      'CREATE OR ALTER PROCEDURE dbo.sp_prova',
      '  @a int = 1,',
      "  @b varchar(20) = 'valore as default',",
      '  @c bit = 0',
      'AS',
      'BEGIN',
      '  SELECT @a',
      'END',
    ].join('\n')
    expect(nomi(testo)).toEqual(['@a', '@b', '@c'])
  })

  // Causa vera del problema segnalato ("l'intellisense non legge i parametri della store che sto
  // modificando"): la firma veniva tagliata al primo "as", che nel codice reale compare spesso
  // dentro l'elenco dei parametri — come stile "@param as tipo" o dentro un commento.
  it('stile "@param as tipo": TUTTI i parametri, non solo quelli prima del primo "as"', () => {
    const testo = [
      'CREATE PROCEDURE [dbo].[ws_HDL_TestPrio]',
      '(',
      ' @mId as int,',
      ' @fExist as bit OUTPUT,',
      ' @Errore nvarchar(255) OUTPUT',
      ')',
      'AS',
      'SET NOCOUNT ON',
    ].join('\r\n')
    expect(nomi(testo)).toEqual(['@mId', '@fExist', '@Errore'])
  })

  it('commento con "as" dentro la firma: i parametri successivi non si perdono', () => {
    const testo = [
      'CREATE PROCEDURE dbo.ws_APS_Process_CalcBestGrip_CheckEncumbrance (',
      '   @pSU                   int      /* SU code to return as best to use */',
      '  ,@nCheckEncumbrance     int      /* Check code to use */',
      '  ,@nBestRoute            int',
      ')',
      'AS',
      'SELECT 1',
    ].join('\r\n')
    expect(nomi(testo)).toEqual(['@pSU', '@nCheckEncumbrance', '@nBestRoute'])
  })

  it('un "as" nel CORPO non entra nella firma (il corpo resta fuori)', () => {
    const testo = [
      'CREATE PROCEDURE dbo.ws_HMI_BayForPLC (@pMacc int)',
      'AS',
      "DECLARE @Comp as NVARCHAR(MAX)=''",
      'SELECT @Comp',
    ].join('\r\n')
    expect(nomi(testo)).toEqual(['@pMacc'])
  })

  it('parametri su più righe con virgola iniziale e tipi con parentesi', () => {
    const testo = [
      'CREATE OR ALTER PROC dbo.sp_x',
      ' (',
      '   @a decimal(11, 3),',
      '  ,@b nvarchar(max)',
      '  ,@c bit = 0',
      ' )',
      'AS',
      'SELECT 1',
    ].join('\r\n')
    expect(nomi(testo)).toEqual(['@a', '@b', '@c'])
  })

  it('senza parentesi, con "as" anche nella dichiarazione dei parametri', () => {
    const testo = 'CREATE PROCEDURE dbo.sp_y @a AS int, @b int AS SELECT 1'
    expect(nomi(testo)).toEqual(['@a', '@b'])
  })

  it('i parametri si sommano alle variabili dichiarate, senza doppioni', () => {
    const testo = [
      'CREATE PROCEDURE dbo.sp_x',
      '  @chiave int',
      'AS',
      'BEGIN',
      '  DECLARE @tmp int, @chiave2 int',
      '  SELECT @',
    ].join('\n')
    const params = extractRoutineParameters(testo).map(p => p.name)
    const locals = extractDeclaredVariables(testo).map(v => v.name)
    expect(params).toEqual(['@chiave'])
    expect(locals).toContain('@tmp')
    expect(locals).toContain('@chiave2')
    // l'elenco finale del popup: prima i parametri, poi le variabili, senza duplicati
    const tutti = [...new Set([...params, ...locals])]
    expect(tutti).toEqual(['@chiave', '@tmp', '@chiave2'])
  })

  it('vale anche per le funzioni (scalari e tabella) e non per i trigger', () => {
    expect(nomi('CREATE FUNCTION dbo.f_x (@n int, @s varchar(10)) RETURNS int AS BEGIN RETURN 1 END')).toEqual([
      '@n',
      '@s',
    ])
    expect(nomi('CREATE FUNCTION dbo.f_t (@n int) RETURNS TABLE AS RETURN (SELECT @n AS n)')).toEqual(['@n'])
    expect(nomi('CREATE TRIGGER tr ON dbo.T FOR INSERT AS SELECT 1')).toEqual([])
  })
})
