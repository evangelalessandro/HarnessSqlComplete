// SELEZIONE DELLE VOCI DELL'ALBERO LATERALE.
// Richiesta utente: "rendi le voci della treeview selezionabili, adesso non si capisce cosa è
// selezionato".
//
// La parte pura (chiavi stabili) è qui; la prova "vera" (clic su una riga → riga evidenziata, una
// sola selezione, tasto destro, colonne, memoria della scelta) è nel browser con
// `--verify-selezione-treeview`. Questo test blinda anche il COLLEGAMENTO nel Sidebar: se qualcuno
// toglie `data-nodo` da una famiglia di righe, la selezione smetterebbe di funzionare in silenzio.
import { describe, expect, it } from 'vitest'
import source from '../components/Sidebar.tsx?raw'
import { CLASSE_NODO_ATTIVO, attributiNodo, chiaveNodo } from '../treeSelection'

describe('chiaveNodo', () => {
  it('compone tipo:parti', () => {
    expect(chiaveNodo('db', 'WSGSDMALTA')).toBe('db:WSGSDMALTA')
    expect(chiaveNodo('tabella', 'dbo', 'DAT_UDC')).toBe('tabella:dbo:DAT_UDC')
    expect(chiaveNodo('colonna', 'dbo', 'DAT_UDC', 'UDC_UDC')).toBe('colonna:dbo:DAT_UDC:UDC_UDC')
    expect(chiaveNodo('indice', 'dbo', 'DAT_UDC', 'IX_UDC')).toBe('indice:dbo:DAT_UDC:IX_UDC')
    expect(chiaveNodo('sezione', 'Tabelle')).toBe('sezione:Tabelle')
  })

  it('salta le parti vuote e spazi in eccesso', () => {
    expect(chiaveNodo('procedura', '', 'ws_Prova')).toBe('procedura:ws_Prova')
    expect(chiaveNodo('procedura', undefined, ' ws_Prova ')).toBe('procedura:ws_Prova')
    expect(chiaveNodo('procedura', null, '  ', 'x')).toBe('procedura:x')
    expect(chiaveNodo('db')).toBe('db')
  })

  it('tipi diversi sulla stessa tabella non si confondono', () => {
    const a = chiaveNodo('tabella', 'dbo', 'DAT_UDC')
    const b = chiaveNodo('colonna', 'dbo', 'DAT_UDC')
    const c = chiaveNodo('colonna', 'dbo', 'DAT_UDC', 'UDC_UDC')
    expect(new Set([a, b, c]).size).toBe(3)
  })
})

describe('attributiNodo', () => {
  it('dichiara data-nodo e aggiunge la classe solo quando è selezionata', () => {
    expect(attributiNodo('tabella:dbo:X', false)).toEqual({ 'data-nodo': 'tabella:dbo:X', className: '' })
    expect(attributiNodo('tabella:dbo:X', true)).toEqual({
      'data-nodo': 'tabella:dbo:X',
      className: CLASSE_NODO_ATTIVO,
    })
  })

  it('conserva la classe di base', () => {
    expect(attributiNodo('tabella:dbo:X', true, 'riga').className).toBe(`riga ${CLASSE_NODO_ATTIVO}`)
    expect(attributiNodo('tabella:dbo:X', false, 'riga').className).toBe('riga')
  })
})

describe('collegamento nell albero (Sidebar)', () => {
  it('la selezione è delegata: clic e tasto destro sul contenitore', () => {
    expect(source).toContain('onClickCapture={selezionaDaClic}')
    expect(source).toContain('onContextMenuCapture={selezionaDaClic}')
    expect(source).toContain("closest?.('[data-nodo]')")
  })

  it('la scelta è memorizzata e ripristinata', () => {
    expect(source).toContain("localStorage.setItem('sql-intelli:nodoSel.v1', chiave)")
    expect(source).toContain("localStorage.getItem('sql-intelli:nodoSel.v1')")
  })

  it('ogni famiglia di voci dichiara la sua chiave data-nodo', () => {
    for (const famiglia of [
      "chiaveNodo('db',",
      "chiaveNodo('sezione',",
      "chiaveNodo('schema',",
      "chiaveNodo('tabella',",
      "chiaveNodo('colonna',",
      "chiaveNodo('indice',",
      "chiaveNodo('vincolo',",
      "chiaveNodo('trigger',",
      "chiaveNodo('vista',",
      "chiaveNodo('procedura',",
      "chiaveNodo('funzione',",
    ]) {
      expect(source, `manca ${famiglia}`).toContain(famiglia)
    }
  })

  it('le righe condivise (ObjectRow/TableRow) ricevono la chiave', () => {
    // i due componenti devono accettare `nodo` e scriverlo su data-nodo
    expect(source).toContain('nodo?: string')
    expect(source.match(/data-nodo=\{nodo\}/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('l evidenziazione si riapplica dopo ogni render (l albero si ridisegna)', () => {
    expect(source).toContain('classList.toggle(CLASSE_NODO_ATTIVO')
    expect(source).toContain("document.querySelectorAll('[data-nodo]')")
  })
})

// SOTTOGRUPPI ANNIDATI NEL NODO TABELLA.
// Richiesta utente: "annida nella treeview delle tabelle le colonne in un nodo, indici in un altro
// e fk in un altro ecc…" — Colonne / Indici / Chiavi esterne / Vincoli / Trigger sono nodi
// separati, ognuno con la sua freccia, il conteggio e la sua chiave per la selezione.
describe('sottogruppi annidati della tabella (Sidebar)', () => {
  it('esiste il componente NodoGruppo con freccia, titolo e conteggio', () => {
    expect(source).toContain('function NodoGruppo')
    expect(source).toContain('titolo: string')
    expect(source).toContain('quantita: number')
    expect(source).toContain('aperto: boolean')
  })

  it('i gruppi sono cinque e separati (le FK non stanno con gli altri vincoli)', () => {
    for (const titolo of ['titolo="Colonne"', 'titolo="Indici"', 'titolo="Chiavi esterne"', 'titolo="Vincoli"', 'titolo="Trigger"']) {
      expect(source, `manca il nodo ${titolo}`).toContain(titolo)
    }
    // i vincoli vengono divisi in due liste: FK a parte
    expect(source).toContain("vincoli.filter(v => v.tipo === 'FOREIGN KEY')")
    expect(source).toContain("vincoli.filter(v => v.tipo !== 'FOREIGN KEY')")
  })

  it('ogni gruppo ha la sua chiave data-nodo e il suo stato di apertura', () => {
    for (const gruppo of ['colonne', 'indici', 'fk', 'vincoli', 'trigger']) {
      expect(source, `manca la chiave ${gruppo}`).toContain(`\`\${tKey}|${gruppo}\``)
    }
    expect(source).toContain('openSottogruppi')
    expect(source).toContain('toggleSottogruppo')
  })

  it('aprendo una tabella si apre subito il nodo Colonne; chiudendola si richiudono i suoi gruppi', () => {
    expect(source).toContain('setOpenSottogruppi(s => new Set(s).add(`${key}|colonne`))')
    expect(source).toContain('if (k.startsWith(`${key}|`)) dopo.delete(k)')
  })
})
