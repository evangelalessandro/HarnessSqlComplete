// INDICATORE "FORMAZIONE IN CORSO" (richiesta utente: "metti qualcosa che indichi che ancora la
// formattazione è in corso"): con SQLFluff la risposta arriva dal backend e può metterci secondi,
// quindi l'app deve dirlo invece di sembrare bloccata.
import { describe, expect, it } from 'vitest'
import source from '../components/SqlEditor.tsx?raw'

describe('indicatore della formattazione in corso', () => {
  it('c\'è uno stato "formatting" che viene acceso e spento attorno alla formattazione', () => {
    expect(source).toContain('const [formatting, setFormatting] = useState(false)')
    expect(source).toContain('setFormatting(true)')
    expect(source).toContain('} finally {')
    expect(source).toContain('setFormatting(false)')
  })

  it('il pulsante Formatta mostra il caricamento e il testo "Formattazione…"', () => {
    expect(source).toContain('loading={formatting}')
    expect(source).toContain('disabled={formatting}')
    expect(source).toContain("data-formatta={formatting ? 'in-corso' : 'pronto'}")
    expect(source).toContain("formatting ? 'Formattazione…' : 'Formatta'")
  })

  it('c\'è anche un avviso dentro l\'editor, con la rotellina e il motore in uso', () => {
    expect(source).toContain('data-formatta="in-corso"')
    expect(source).toContain('Formattazione in corso…')
    expect(source).toContain("formatter === 'sqlfluff' ? 'SQLFluff' : 'formattatore dell")
    expect(source).toContain('animate-spin')
  })

  it('non si può lanciare due formattazioni insieme e l\'indicatore si dipinge prima di aspettare', () => {
    expect(source).toContain('if (!ed || !model || formattingRef.current) return')
    // lascia dipingere l'indicatore prima di bloccare sul backend
    expect(source).toContain('await new Promise(r => window.setTimeout(r, 0))')
  })
})
