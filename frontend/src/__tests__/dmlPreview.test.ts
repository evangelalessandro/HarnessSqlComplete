// ANTEPRIMA DELLE MODIFICHE (motore puro).
// Richiesta utente: "fai anteprima delle modifiche": da un UPDATE/DELETE alla SELECT che mostra le
// righe che verrebbero toccate, senza modificare niente.
import { describe, expect, it } from 'vitest'
import { MAX_RIGHE_ANTEPRIMA, costruisciAnteprima, trovaParolaChiave, tutteParoleChiave } from '../dmlPreview'
import { demoStoreLikeSummary } from './schema'

const summary = demoStoreLikeSummary()
const anteprima = (sql: string) => costruisciAnteprima(sql, summary)

describe('anteprima: UPDATE', () => {
  it('con FROM e JOIN tiene lo stesso filtro nel SELECT', () => {
    const a = anteprima(
      "UPDATE dbo.MAG_CELLE SET CEL_DESCR = 'x' FROM MAG_CELLE c INNER JOIN MAG_BAIE b ON b.BAI_BAIA = c.CEL_BAIA WHERE c.CEL_CELLA = 12",
    )
    expect(a).not.toBeNull()
    expect(a!.tipo).toBe('update')
    console.log(`  ${a!.sql}`)
    expect(a!.sql).toMatch(new RegExp(`^SELECT TOP \\(${MAX_RIGHE_ANTEPRIMA}\\) `))
    expect(a!.sql).toContain('FROM MAG_CELLE c INNER JOIN MAG_BAIE b ON b.BAI_BAIA = c.CEL_BAIA')
    expect(a!.sql).toContain('WHERE c.CEL_CELLA = 12')
    // non contiene la SET: l'anteprima non deve modificare nulla
    expect(a!.sql).not.toMatch(/\bSET\b/i)
  })

  it('se la FROM usa un ALIAS le colonne si qualificano con l alias, non col nome tabella', () => {
    // era il bug: "MAG_CELLE.[col]" con "FROM MAG_CELLE c" → "Impossibile associare l'identificatore"
    const a = anteprima(
      'UPDATE dbo.Ordini SET totale = 1 FROM Ordini o INNER JOIN Clienti c ON c.id = o.idCliente WHERE o.id = 5',
    )
    console.log(`  ${a!.sql}`)
    expect(a!.sql).toContain('o.[id]')
    expect(a!.sql).not.toContain('Ordini.[id]')
    expect(a!.sql).toContain('FROM Ordini o INNER JOIN Clienti c ON c.id = o.idCliente')
  })

  it('senza FROM prende la WHERE e la tabella del bersaglio', () => {
    const a = anteprima('UPDATE dbo.Ordini SET totale = 0 WHERE id = 5')
    expect(a!.sql).toContain('FROM dbo.Ordini')
    expect(a!.sql).toContain('WHERE id = 5')
    expect(a!.sql).not.toMatch(/\bSET\b/i)
  })

  it('usa le colonne VERE della tabella, qualificate con l alias', () => {
    const a = anteprima('UPDATE dbo.Ordini o SET o.totale = 1 FROM Ordini o WHERE o.id = 1')
    console.log(`  ${a!.sql}`)
    expect(a!.sql).toMatch(/o\.\[id\]/)
    expect(a!.sql).toMatch(/o\.\[totale\]/)
  })

  it('tabella non nel sommario (o temporanea) → colonne *', () => {
    const a = anteprima('UPDATE #tmpMission SET X_QTY = 0 WHERE X_QTY > 10')
    expect(a!.sql).toContain('*')
    expect(a!.sql).toContain('FROM #tmpMission')
  })

  it('con commento in testa e punto e virgola finale', () => {
    const a = anteprima('-- controllo\nUPDATE dbo.Ordini SET totale = 0 WHERE id = 5;')
    expect(a!.sql).not.toContain('--')
    expect(a!.sql.endsWith(';')).toBe(true)
    expect(a!.sql.match(/;/g)?.length).toBe(1)
  })
})

describe('anteprima: DELETE', () => {
  it('DELETE FROM tabella WHERE …', () => {
    const a = anteprima('DELETE FROM dbo.Ordini WHERE id = 5')
    expect(a!.tipo).toBe('delete')
    console.log(`  ${a!.sql}`)
    expect(a!.sql).toContain('FROM dbo.Ordini')
    expect(a!.sql).toContain('WHERE id = 5')
  })

  it('DELETE alias FROM tabella JOIN … (mantiene i JOIN)', () => {
    const a = anteprima('DELETE o FROM Ordini o INNER JOIN Clienti c ON c.id = o.idCliente WHERE c.nome = \'x\'')
    console.log(`  ${a!.sql}`)
    expect(a!.sql).toContain('FROM Ordini o INNER JOIN Clienti c ON c.id = o.idCliente')
    expect(a!.sql).toContain("WHERE c.nome = 'x'")
  })

  it('DELETE con alias e WHERE senza FROM', () => {
    const a = anteprima('DELETE o WHERE o.id = 5')
    expect(a!.sql).toContain('FROM o')
    expect(a!.sql).toContain('WHERE o.id = 5')
  })

  it('DELETE FROM con sorgente separata (DELETE … FROM … JOIN)', () => {
    const a = anteprima('DELETE FROM o FROM Ordini o JOIN Clienti c ON c.id = o.idCliente WHERE c.nome = \'y\'')
    expect(a!.sql).toContain('FROM Ordini o JOIN Clienti c')
  })
})

describe('anteprima: quando non si applica', () => {
  it('SELECT/INSERT/MERGE/altro → null', () => {
    expect(anteprima('SELECT * FROM dbo.Ordini')).toBeNull()
    expect(anteprima('INSERT INTO dbo.Ordini (id) VALUES (1)')).toBeNull()
    expect(anteprima('MERGE dbo.Ordini AS t USING x AS s ON 1 = 1 WHEN MATCHED THEN DELETE;')).toBeNull()
    expect(anteprima('')).toBeNull()
    expect(anteprima('   -- solo commento')).toBeNull()
  })

  it('UPDATE senza SET non è un update valido', () => {
    expect(anteprima('UPDATE dbo.Ordini WHERE id = 1')).toBeNull()
  })

  it('un testo con più statement non confonde (l app passa lo statement isolato)', () => {
    // l'app ritaglia lo statement sotto il cursore prima di chiamare questa funzione
    const a = anteprima('DELETE FROM dbo.Ordini WHERE id = 9')
    expect(a).not.toBeNull()
    expect(a!.sql).toContain('WHERE id = 9')
    expect(a!.sql).not.toContain('SELECT 2')
  })
})

describe('scanner di parole chiave', () => {
  it('ignora quelle dentro stringhe, commenti e parentesi', () => {
    const sql = "UPDATE t SET x = 'FROM dentro una stringa' -- FROM in commento\nWHERE id IN (SELECT id FROM u)"
    // FROM è solo dentro la stringa e nel commento: nessuna occorrenza reale
    expect(trovaParolaChiave(sql, 'FROM')).toBe(-1)
    expect(tutteParoleChiave(sql, 'WHERE')).toHaveLength(1)
    // SELECT è dentro le parentesi della IN (…): non è di primo livello
    expect(tutteParoleChiave(sql, 'SELECT')).toHaveLength(0)
    // …ma una SELECT di primo livello viene trovata
    expect(tutteParoleChiave('SELECT 1 WHERE 1 = 1', 'SELECT')).toHaveLength(1)
  })
})
