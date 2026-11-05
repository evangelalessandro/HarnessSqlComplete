// XML in una scheda: riconoscimento, indentazione e pezzi colorabili (richiesta utente: "se il campo è
// un xml aprimi una scheda che me lo faccia vedere … indentato, ogni nodo con un colore, e che ci possa
// fare delle ricerche sopra").
import { describe, expect, it } from 'vitest'
import {
  contaOccorrenze,
  eXml,
  formattaXml,
  righeConMatch,
  tokenPerRiga,
  tokenizzaXml,
} from '../xmlFormat'

const XML_ORDINE = `<?xml version="1.0" encoding="utf-8"?><Ordine id="123" stato="aperto"><Cliente><Nome>Mario Rossi</Nome><Email>mario@example.com</Email></Cliente><Righe><Riga sku="A-1" qta="2"/><Riga sku="B-7" qta="1"/></Righe><!-- nota finale --></Ordine>`

describe('riconoscere un valore XML', () => {
  it('riconosce XML con e senza prologo, anche con spazi davanti', () => {
    expect(eXml(XML_ORDINE)).toBe(true)
    expect(eXml('  <root><a/></root>')).toBe(true)
    expect(eXml('<x/>')).toBe(true)
  })

  it('non scambia per XML un numero, un testo o un confronto', () => {
    expect(eXml(42)).toBe(false)
    expect(eXml('Mario Rossi')).toBe(false)
    expect(eXml('< 5')).toBe(false) // manca '>'
    expect(eXml('a < b > c')).toBe(false) // non comincia con '<'
    expect(eXml('')).toBe(false)
  })
})

describe('formattazione indentata', () => {
  it('mette ogni elemento su una riga e indenta i figli', () => {
    const fuori = formattaXml(XML_ORDINE)
    console.log(fuori.split('\n').slice(0, 8).join('\n'))
    const righe = fuori.split('\n')
    expect(righe[0]).toBe('<?xml version="1.0" encoding="utf-8"?>')
    expect(righe[1]).toBe('<Ordine id="123" stato="aperto">')
    expect(righe[2]).toBe('  <Cliente>')
    expect(righe[3]).toBe('    <Nome>Mario Rossi</Nome>')
    expect(fuori).toContain('    <Riga sku="A-1" qta="2"/>')
    expect(fuori).toContain('  <!-- nota finale -->')
    expect(righe[righe.length - 1]).toBe('</Ordine>')
  })

  it('è IDEMPOTENTE: riformattare non cambia niente', () => {
    const una = formattaXml(XML_ORDINE)
    expect(formattaXml(una)).toBe(una)
  })

  it('lascia stare CDATA e testo con spazi interni', () => {
    const xml = '<r><![CDATA[<non> & un tag]]><t>due  parole</t></r>'
    const fuori = formattaXml(xml)
    expect(fuori).toContain('<![CDATA[<non> & un tag]]>')
    expect(fuori).toContain('<t>due parole</t>')
  })

  it('non si rompe su XML malformato (tag non chiusi)', () => {
    const fuori = formattaXml('<a><b>testo')
    expect(fuori).toContain('<a>')
    expect(fuori).toContain('  <b>')
    expect(fuori).toContain('    testo')
  })
})

describe('colori: i pezzi del tag hanno un tipo', () => {
  it('distingue nome, attributi e valori', () => {
    const token = tokenizzaXml('<Ordine id="123" stato="aperto">')
    const tipi = token.map(t => t.tipo)
    expect(tipi).toContain('tag')
    expect(tipi).toContain('nome')
    expect(tipi).toContain('attributo')
    expect(tipi).toContain('valore')
    expect(token.find(t => t.tipo === 'nome')?.testo).toBe('Ordine')
    expect(token.filter(t => t.tipo === 'attributo').map(t => t.testo)).toEqual(['id', 'stato'])
    expect(token.filter(t => t.tipo === 'valore').map(t => t.testo)).toEqual(['"123"', '"aperto"'])
  })

  it('riconosce commenti, CDATA, prologo e testo', () => {
    const token = tokenizzaXml('<?xml version="1.0"?><!-- c --><r><![CDATA[x]]>ciao</r>')
    const tipi = new Set(token.map(t => t.tipo))
    expect(tipi.has('prologo')).toBe(true)
    expect(tipi.has('commento')).toBe(true)
    expect(tipi.has('cdata')).toBe(true)
    expect(tipi.has('testo')).toBe(true)
  })

  it('i tag di chiusura hanno nome e punteggiatura', () => {
    const token = tokenPerRiga('</Ordine>')
    expect(token[0]).toEqual({ tipo: 'tag', testo: '</' })
    expect(token[1]).toEqual({ tipo: 'nome', testo: 'Ordine' })
    expect(token[token.length - 1]).toEqual({ tipo: 'tag', testo: '>' })
  })

  it('un attributo con > dentro le virgolette non chiude il tag', () => {
    const token = tokenizzaXml('<x a="1 > 0">testo</x>')
    expect(token.find(t => t.tipo === 'valore')?.testo).toBe('"1 > 0"')
    expect(token.some(t => t.tipo === 'testo' && t.testo === 'testo')).toBe(true)
  })
})

describe('ricerca sopra l XML', () => {
  it('conta le occorrenze senza badare alle maiuscole', () => {
    const testo = formattaXml(XML_ORDINE)
    expect(contaOccorrenze(testo, 'riga')).toBe(2) // i due elementi <Riga (…<Righe> non contiene 'riga')
    expect(contaOccorrenze(testo, 'MARIO')).toBe(2) // «Mario Rossi» e «mario@example.com»
    expect(contaOccorrenze(testo, 'Rossi')).toBe(1)
    expect(contaOccorrenze(testo, 'zzz')).toBe(0)
    expect(contaOccorrenze(testo, '')).toBe(0)
  })

  it('dice su quali righe si trova, per saltare da un risultato all altro', () => {
    const testo = formattaXml(XML_ORDINE)
    const righe = righeConMatch(testo, 'sku')
    expect(righe.length).toBe(2)
    expect(righe[0]).toBeLessThan(righe[1])
    expect(righeConMatch(testo, 'niente')).toEqual([])
  })
})
