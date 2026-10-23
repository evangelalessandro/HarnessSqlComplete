// F5 GLOBALE: esegue la tab attiva anche quando il fuoco NON è nell'editor, senza ricaricare la
// pagina. Richiesta utente: "e l'f5 se no ho il focus sulla scheda mi ricarica tutta la pagina, c'è
// modo di prenderlo e non fare aggiornare la pagina, ma eseguire f5 sulla tab attiva del codice?".
//
// Con il fuoco nell'editor F5 lo gestisce già Monaco (che registra anche l'uso delle tabelle);
// altrove ci pensa un listener a livello di finestra. Qui si blinda il COLLEGAMENTO (il
// comportamento vero è verificato nel browser da `--verify-f5-globale`).
import { describe, expect, it } from 'vitest'
import app from '../App.tsx?raw'

const blocco = (() => {
  const i = app.indexOf('F5 GLOBALE')
  return i < 0 ? '' : app.slice(Math.max(0, i - 200), i + 2400)
})()

describe('F5 globale (App)', () => {
  it('c\'è un listener di tastiera sulla finestra, in fase di cattura', () => {
    expect(blocco).toContain("window.addEventListener('keydown', onKeyDown, true)")
    expect(blocco).toContain('e.preventDefault()')
    expect(blocco).toContain('e.stopPropagation()')
  })

  it('riconosce F5 e ignora le combinazioni con altri tasti', () => {
    expect(blocco).toMatch(/e\.key === 'F5' \|\| e\.keyCode === 116/)
    expect(blocco).toContain('e.ctrlKey || e.altKey || e.metaKey || e.shiftKey')
  })

  it('lascia fare a Monaco quando il fuoco è nell\'editor (niente doppia esecuzione)', () => {
    expect(blocco).toContain('editor?.hasTextFocus()')
  })

  it('senza connessione non intercetta (schermata di login)', () => {
    expect(blocco).toContain('if (!connection) return')
  })

  it('esegue la selezione o tutto il testo della tab attiva, come il pulsante Esegui', () => {
    expect(blocco).toContain('pickSqlToExecute(')
    expect(blocco).toContain('handleExecute(sql)')
  })

  it('nelle tab che non sono query (ricerca, diagramma) ferma il tasto senza eseguire nulla', () => {
    expect(blocco).toContain("tab.kind !== 'query'")
  })
})
