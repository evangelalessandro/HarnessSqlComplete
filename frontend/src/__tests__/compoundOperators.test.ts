// Operatori composti di assegnazione: "+=" e "-=" non devono MAI diventare "+ =" e "- =".
//
// Segnalato dall'utente: "@corr_choice + = concat (...)" nell'output formattato. Il tokenizer
// univa ">=", "<=", "<>", "!=" ma non "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=": i due
// caratteri finivano come token separati e il layout li univa con uno spazio.
import { describe, expect, it } from 'vitest'
import { formatRoutineWithProfile, formatSqlWithProfile, tokenizeSqlText } from '../tsqlFormatter'
import { buildFormatProfile, loadFormatProfileXml } from '../formatProfile'

const profile = buildFormatProfile(loadFormatProfileXml())

describe('operatori composti: mai separati', () => {
  it('il tokenizer li tiene come UN token', () => {
    const testi = tokenizeSqlText('set @x += 1, @y -= 2, @z *= 3, @w /= 4')
      .filter(t => t.type === 'punct')
      .map(t => t.text)
    expect(testi).toContain('+=')
    expect(testi).toContain('-=')
    expect(testi).toContain('*=')
    expect(testi).toContain('/=')
    expect(testi).not.toContain('+')
    expect(testi).not.toContain('-')
  })

  it('formattando una query: restano attaccati', () => {
    const out = formatSqlWithProfile('select @tot += RIG_QTAR, @n -= 1 from dbo.T', profile)
    expect(out).toContain('@tot += RIG_QTAR')
    expect(out).toContain('@n -= 1')
    expect(out).not.toMatch(/[+-]\s+=/)
  })

  it('dentro una store: restano attaccati (anche con gli a capo del layout)', () => {
    const sql = `CREATE PROCEDURE p AS
BEGIN
  SELECT @corr_choice += concat (@corridoio, ','), @tot -= 1
  SELECT @a *= 2, @b /= 2, @c %= 3
END`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toContain('@corr_choice += concat (@corridoio')
    expect(out).toContain('@tot -= 1')
    expect(out).toContain('@a *= 2')
    expect(out).toContain('@b /= 2')
    expect(out).toContain('@c %= 3')
    expect(out).not.toMatch(/[+\-*/%]\s+=/)
    // idempotente
    expect(formatRoutineWithProfile(out, profile)).toBe(out)
  })

  it('ripara il testo già formattato da una versione precedente ("+ =")', () => {
    const rotto = 'CREATE PROCEDURE p AS\nBEGIN\n  SELECT @tot + = 1, @n - = 2\nEND'
    const out = formatRoutineWithProfile(rotto, profile)
    expect(out).toMatch(/@tot\s*\+=\s*1/)
    expect(out).toMatch(/@n\s*-=\s*2/)
    // anche una query formattata da sola
    const q = formatSqlWithProfile('select @tot + = 1, @n - = 2', profile)
    expect(q).toContain('@tot += 1')
    expect(q).toContain('@n -= 2')
  })

  it('la riparazione NON tocca il contenuto delle stringhe', () => {
    const out = formatSqlWithProfile("select 'a + = b' as s, @x += 1 from dbo.T", profile)
    expect(out).toContain("'a + = b'")
    expect(out).toContain('@x += 1')
  })

  it('non tocca gli operatori di confronto né il meno unario', () => {
    const out = formatSqlWithProfile('select * from dbo.T where a >= 1 and b <= 2 and c <> 3 and d = -1', profile)
    expect(out).toContain('a >= 1')
    expect(out).toContain('b <= 2')
    expect(out).toContain('c <> 3')
    expect(out).toContain('d = - 1')
  })
})
