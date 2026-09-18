// Due segnalazioni dell'utente sulla formattazione di una stored procedure:
//  1) "END / ELSE" dove l'ELSE era avanti di 2 spazi rispetto al suo END/BEGIN;
//  2) un CASE dentro la select-list di un INSERT … SELECT che restava su una riga sola
//     (non indentato) invece di essere espanso come gli altri elementi della lista.
import { describe, expect, it } from 'vitest'
import { buildFormatProfile } from '../formatProfile'
import { formatRoutineWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)

/** Sequenza dei token senza commenti: prova che il formatter non perde né inventa niente. */
function tokeniUtili(sql: string): string[] {
  return tokenizeSqlText(sql)
    .filter(t => t.type !== 'comment')
    .map(t => (t.type === 'word' ? t.text.toUpperCase() : t.text))
}

describe('END / ELSE allo stesso livello (caso segnalato)', () => {
  const sql = `create procedure p as
begin
  if @order_exists = 0
  begin
    if @op = 'D'
    begin
      print 'x'
      return 0
    end

  end
    else
  if @order_exists = 1
  begin
    if @op = 'A'
    begin
      print 'y'
    end
    else
    begin
      print 'z'
    end
  end
end`

  it('l ELSE esterno si allinea al suo END, non all IF interno', () => {
    const out = formatRoutineWithProfile(sql, profile)
    const righe = out.split('\n')
    const rientro = (t: string) => (t.match(/^\s*/) ?? [''])[0].length
    const iEndEsterno = righe.findIndex(r => r.trim() === 'END' && rientro(r) === 4)
    const iElse = righe.findIndex(r => r.trim() === 'ELSE')
    const iEndInterno = righe.findIndex(r => r.trim() === 'END' && rientro(r) === 6)
    expect(iEndInterno).toBeGreaterThan(-1)
    expect(iEndEsterno).toBeGreaterThan(-1)
    expect(iElse).toBeGreaterThan(iEndEsterno)
    // l'ELSE NON è avanti di 2 rispetto all'END dello stesso livello
    expect(rientro(righe[iElse])).toBe(rientro(righe[iEndEsterno]))
    expect(rientro(righe[iElse])).not.toBe(rientro(righe[iEndEsterno]) + 2)
  })

  it('dopo l ELSE un IF allo stesso livello resta allineato', () => {
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toMatch(/^    END\n    ELSE\n    IF @order_exists = 1$/m)
  })

  it('nessun token perso', () => {
    expect(tokeniUtili(formatRoutineWithProfile(sql, profile))).toEqual(tokeniUtili(sql))
  })
})

describe('CASE dentro la select-list di un INSERT … SELECT (caso segnalato)', () => {
  const sql = `create procedure p as
begin
  insert into DAT_ORDINI (ORD_ORDINE, ORD_ORDTYPE, ORD_ORDSTATUS, ORD_ATTRIBUTES, ORD_DES)
  select
  /* ORD_ORDINE     */
  rtrim (ORD_ORDER), /* ORD_ORDTYPE */
    case
      when @tosplit = 1
        then 'ROOT:TOSPLIT'
      else 'ROOT:NOSPLIT'
    end
    ,/* ORD_ORDSTATUS */ case when @tosplit = 1 then 'SPLIT:AUTO:WAIT' else concat ('SCHED:', @launch, ':WAIT') end, /* ORD_ATTRIBUTES */ concat (',SCHED:', @launch, ','), /* ORD_DES */ isnull (rtrim (ORD_DESC), '')
  from #IMP_ORDERS
end`

  it('ogni valore sta su righe proprie e i CASE sono espansi e rientrati', () => {
    const out = formatRoutineWithProfile(sql, profile)
    // un elemento per riga: niente più valori accodati alla stessa riga
    expect(out).toMatch(/^\s+,(\/\* ORD_DES \*\/ )?isnull \(rtrim \(ORD_DESC\), ''\)$/m)
    expect(out).toMatch(/^\s+,(\/\* ORD_ATTRIBUTES \*\/ )?concat \(',SCHED:', @launch, ','\)$/m)
    // i CASE sono su righe proprie con WHEN/THEN/ELSE/END rientrati
    const righeCase = out.split('\n').filter(r => r.trim() === 'CASE')
    expect(righeCase.length).toBe(2)
    expect(out).toMatch(/^\s+(\/\* ORD_ORDTYPE \*\/\s*)?CASE$/m)
    expect(out).toMatch(/^\s+WHEN @tosplit = 1$/m)
    expect(out).toMatch(/^\s+THEN 'ROOT:TOSPLIT'$/m)
    expect(out).toMatch(/^\s+END$/m)
    // nessuna riga lunga con più valori (era il caso segnalato)
    expect(out).not.toMatch(/END, \/\* ORD_ATTRIBUTES \*\//)
  })

  it('nessun token perso (nemmeno una virgola in più)', () => {
    expect(tokeniUtili(formatRoutineWithProfile(sql, profile))).toEqual(tokeniUtili(sql))
  })

  it('una SELECT con CASE (senza INSERT) resta impilata come prima', () => {
    const sel = `create procedure p as
begin
  select /* a */ rtrim (X), case when @t = 1 then 'x' else 'y' end, isnull (Z, '')
  from SRC
end`
    const out = formatRoutineWithProfile(sel, profile)
    expect(out).toMatch(/^    SELECT \/\* a \*\/ rtrim \(X\)$/m)
    expect(out).toMatch(/^\s+,isnull \(Z, ''\)$/m)
    expect(out).toMatch(/^\s+,CASE$/m)
    expect(tokeniUtili(out)).toEqual(tokeniUtili(sel))
  })
})
