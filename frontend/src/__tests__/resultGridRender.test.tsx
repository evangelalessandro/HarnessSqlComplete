// @vitest-environment node
// La griglia risultati viene RENDERIZZATA davvero (render lato server) per controllare
// quello che l'utente vede: numero di riga nella prima colonna, linee verticali fra le
// colonne, righe alternate a gruppi di TRE colori e header trascinabile.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SelectableResultGrid from '../components/SelectableResultGrid'
import { ZEBRA_CLASSES } from '../resultGrid'

const columns = [
  { name: 'MIS_UDC', dataType: 'nvarchar' },
  { name: 'MIS_OPERATORE', dataType: 'nvarchar' },
  { name: 'MIS_MISSIONE', dataType: 'int' },
]
const rows = [
  ['UDC1', 'MARIO', 1],
  ['UDC2', 'LUCA', 2],
  ['UDC3', 'ANNA', 3],
  ['UDC4', 'SARA', 4],
  ['UDC5', 'PINO', 5],
  ['UDC6', 'GINO', 6],
]

const render = (props: Partial<Parameters<typeof SelectableResultGrid>[0]> = {}) =>
  renderToStaticMarkup(
    <SelectableResultGrid columns={columns} rows={rows} initialTarget="dbo.RUN_MISSIONI" {...props} />,
  )

/** Celle <td> … </td> della prima riga di dati. */
function firstRowCells(html: string): string[] {
  const body = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'))
  const tr = body.slice(0, body.indexOf('</tr>'))
  return [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1].replace(/<[^>]*>/g, '').trim())
}

/** Intestazione della tabella (React rende <thead class="…">). */
function headerMarkup(html: string): string {
  return html.slice(html.indexOf('<thead'), html.indexOf('</thead>'))
}

/** Corpo della tabella. */
function bodyMarkup(html: string): string {
  return html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'))
}

describe('griglia risultati: struttura', () => {
  it('la prima colonna è il NUMERO DI RIGA, con le linee delle colonne', () => {
    const html = render()
    const head = headerMarkup(html)
    const headers = [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
    expect(headers.length).toBe(columns.length + 2)
    expect(headers[0][1].replace(/<[^>]*>/g, '').trim()).toBe('#') // numero di riga per primo
    // intestazione: linea verticale fra le colonne e cella fissa a sinistra
    expect(headers[0][0]).toContain('border-r')
    expect(headers[0][0]).toContain('sticky')
    for (const h of headers.slice(2)) expect(h[0]).toContain('border-r')
  })

  it('numera le righe da 1 in poi, nella prima cella', () => {
    const html = render()
    const cells = firstRowCells(html)
    expect(cells[0]).toBe('1')
    // la seconda cella è la casella di selezione (senza testo), poi i dati
    expect(cells.slice(2)).toEqual(['UDC1', 'MARIO', '1'])
    // e ogni riga ha il suo numero
    const numbers = [...html.matchAll(/sticky left-0[^>]*>\s*(\d+)\s*</g)].map(m => m[1])
    expect(numbers).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('colora le righe alternate a gruppi di TRE', () => {
    const html = render()
    const body = bodyMarkup(html)
    const trClasses = [...body.matchAll(/<tr class="([^"]*)"/g)].map(m => m[1])
    expect(trClasses).toHaveLength(rows.length)
    expect(trClasses[0]).toContain(ZEBRA_CLASSES[0])
    expect(trClasses[1]).toContain(ZEBRA_CLASSES[1])
    expect(trClasses[2]).toContain(ZEBRA_CLASSES[2])
    expect(trClasses[3]).toContain(ZEBRA_CLASSES[0])
    expect(trClasses[4]).toContain(ZEBRA_CLASSES[1])
    expect(trClasses[5]).toContain(ZEBRA_CLASSES[2])
    // e la stessa fascia è ripetuta sulle celle fisse (che devono coprire lo scorrimento)
    for (const c of ZEBRA_CLASSES) expect(body).toContain(c)
  })

  it('le colonne si possono spostare: header trascinabile con indicatore', () => {
    const head = headerMarkup(render())
    const draggable = (head.match(/draggable="true"/g) ?? []).length
    expect(draggable).toBe(columns.length)
    expect(head).toContain('cursor-grab')
    expect(head).toContain('trascina per spostare la colonna')
  })

  it('mostra i nomi e i tipi delle colonne', () => {
    const html = render()
    expect(html).toContain('MIS_UDC')
    expect(html).toContain('nvarchar')
    expect(html).toContain('MIS_OPERATORE')
  })

  it('celle vuote (NULL) e valori particolari non rompono la griglia', () => {
    const html = render({
      rows: [[null, true, 'testo lungo']],
    })
    expect(html).toContain('NULL')
    expect(html).toContain('true')
    expect(html).toContain('testo lungo')
  })

  it('senza colonne mostra il messaggio, non una tabella vuota', () => {
    const html = render({ columns: [], rows: [] })
    expect(html).toContain('Nessun dato.')
    expect(html).not.toContain('<tbody>')
  })

  it('riga più corta delle colonne: cella vuota, non un finto NULL', () => {
    const html = render({ rows: [['solo-prima']] })
    const cells = firstRowCells(html)
    expect(cells[2]).toBe('solo-prima')
    expect(cells.slice(3)).toEqual(['', ''])
    // nessun "NULL" inventato per le colonne mancanti
    expect(html).not.toContain('NULL')
  })
})

describe('numerazione con la paginazione', () => {
  it('la prima riga mostrata può partire da un numero diverso da 1 (pagina 2)', () => {
    const html = renderToStaticMarkup(
      <SelectableResultGrid columns={columns} rows={rows.slice(0, 2)} firstRowNumber={51} />,
    )
    const numbers = [...html.matchAll(/sticky left-0[^>]*>\s*(\d+)\s*</g)].map(m => m[1])
    expect(numbers).toEqual(['51', '52'])
  })
})
