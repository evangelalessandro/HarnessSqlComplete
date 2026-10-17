// DRAGO NEI SUGGERIMENTI DI JOIN (richiesta utente: "mettimi delle icone di drago, animate, per i
// suggerimenti dei join dell'intellisense").
//
// Il drago (🐉, la mascotte dell'app) precede l'etichetta dei suggerimenti che inseriscono la
// clausola ON; l'animazione è in index.css sulle righe della lista che contengono il drago.
//
// Nel fare questo è saltato fuori un bug contestuale: in posizione JOIN il contesto veniva
// AZZERATO (isTablePosition è vero anche per "… JOIN ") e le voci perdevano la clausola ON —
// restavano i nomi delle tabelle, senza join pronto. Qui si verifica che l'ON ci sia.
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import * as monaco from 'monaco-editor'
import { provideSqlCompletions } from '../sqlCompletions'
import { DRAGO, etichettaDrago } from '../dragon'
import { demoStoreLikeSummary } from './schema'
import type { DatabaseSummary } from '../types'

const base = demoStoreLikeSummary()

function voci(sql: string, summary: DatabaseSummary = base) {
  const model = monaco.editor.createModel(sql, 'sql')
  try {
    return (
      provideSqlCompletions({
        model,
        position: model.getPositionAt(sql.length),
        state: { connectionId: 'test', summary, aiEnabled: false, onExecute: () => {} },
      })?.suggestions ?? []
    )
  } finally {
    model.dispose()
  }
}
const etichette = (sql: string) => voci(sql).map(s => String(s.label))

describe('etichettaDrago', () => {
  it('mette il drago davanti al testo', () => {
    expect(etichettaDrago('RUN_MISSIONI')).toBe(`${DRAGO} RUN_MISSIONI`)
    expect(DRAGO).toBe('🐉')
  })
})

describe('i suggerimenti di JOIN hanno il drago (e la clausola ON)', () => {
  it('dopo "FROM DAT_UDC INNER JOIN " le voci con relazione hanno drago e ON', () => {
    const sql = 'SELECT * FROM dbo.DAT_UDC INNER JOIN '
    const s = voci(sql)
    const conDrago = s.filter(x => String(x.label).startsWith(DRAGO))
    console.log(`  voci: ${s.length}, col drago: ${conDrago.length}`)
    for (const v of conDrago.slice(0, 5)) console.log(`    ${String(v.label)} → ${String(v.insertText)}`)
    expect(conDrago.length).toBeGreaterThan(0)
    // il drago sta SOLO sulle voci che inseriscono davvero la clausola ON
    for (const v of conDrago) expect(String(v.insertText)).toContain(' ON (')
    // e viceversa: chi inserisce un ON ha il drago
    for (const v of s.filter(x => String(x.insertText).includes(' ON ('))) {
      expect(String(v.label).startsWith(DRAGO)).toBe(true)
    }
    // RUN_MISSIONI è la tabella collegata da FK a DAT_UDC: deve esserci col join pronto
    const missioni = s.find(x => String(x.label).includes('RUN_MISSIONI'))
    expect(missioni).toBeTruthy()
    expect(String(missioni!.label)).toBe(`${DRAGO} RUN_MISSIONI`)
    expect(String(missioni!.insertText)).toBe('RUN_MISSIONI ON (UDC_UDC = MIS_UDC)')
  })

  it('stessa cosa partendo da RUN_MISSIONI verso DAT_UDC', () => {
    const s = voci('SELECT * FROM dbo.RUN_MISSIONI inner join ')
    const udc = s.find(x => String(x.label).includes('DAT_UDC') && String(x.insertText).includes(' ON ('))
    expect(udc).toBeTruthy()
    expect(String(udc!.label)).toBe(`${DRAGO} DAT_UDC`)
    expect(String(udc!.insertText)).toBe('DAT_UDC ON (MIS_UDC = UDC_UDC)')
  })

  it('fuori dalla posizione JOIN non c è nessun drago', () => {
    expect(etichette('SELECT * FROM dbo.DAT_UDC ').some(l => l.startsWith(DRAGO))).toBe(false)
  })

  it('il filtro continua a usare il NOME della tabella (il drago non rompe la ricerca)', () => {
    const s = voci('SELECT * FROM dbo.DAT_UDC INNER JOIN ')
    const missioni = s.find(x => String(x.label).includes('RUN_MISSIONI'))!
    // filterText senza drago: Monaco filtra su questo, non sull'etichetta
    expect(String(missioni.filterText)).toBe('RUN_MISSIONI')
  })
})

// L'animazione (index.css: dragon-join-row / dragon-join-name sulle righe con il drago) è
// verificata nel browser vero da `--verify-drago-join`, che legge il computed style della riga:
// qui non si può leggere index.css (Vitest azzera i CSS importati).
