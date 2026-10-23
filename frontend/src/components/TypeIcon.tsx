// ICONE "STILE SOURCETREE" per l'albero del database.
//
// SourceTree (Atlassian) usa glifi PICCOLI, PIENI e COLORATI (cartelle blu, file grigi, etichette
// colorate), non line-icon sottili. Qui si riproducono gli stessi oggetti del database con la stessa
// idea: forme piene a 14 px, un colore per famiglia, così la riga si riconosce a colpo d'occhio
// senza leggere.
//
// Richiesta utente: "cambiamo le icone e facciamolo più simile allo stile di sourcetree di atlas".

export type TipoIcona =
  | 'database'
  | 'schema'
  | 'tabella'
  | 'vista'
  | 'procedura'
  | 'funzione'
  | 'trigger'
  | 'indice'
  | 'chiave'
  | 'chiaveEsterna'
  | 'check'
  | 'gruppo'

/** Colore per famiglia: è la "tavolozza SourceTree" (blu, verde, ambra, viola, rosa, grigio). */
const COLORI: Record<TipoIcona, string> = {
  database: 'text-sky-400',
  schema: 'text-sky-300',
  tabella: 'text-sky-400',
  vista: 'text-violet-400',
  procedura: 'text-emerald-400',
  funzione: 'text-amber-400',
  trigger: 'text-rose-400',
  indice: 'text-sky-300',
  chiave: 'text-amber-300',
  chiaveEsterna: 'text-violet-300',
  check: 'text-emerald-300',
  gruppo: 'text-zinc-500',
}

/** Piccolo glifo PIENO per un tipo di oggetto (14x14), nello stile di SourceTree. */
export default function TypeIcon({ tipo, size = 14, className = '' }: { tipo: TipoIcona; size?: number; className?: string }) {
  const comune = `shrink-0 ${COLORI[tipo]} ${className}`
  const s = { width: size, height: size }
  switch (tipo) {
    case 'database':
      // cilindro
      return (
        <svg viewBox="0 0 16 16" style={s} className={comune} aria-hidden>
          <path fill="currentColor" d="M8 1c-3 0-5 .7-5 1.6v10.8C3 14.3 5 15 8 15s5-.7 5-1.6V2.6C13 1.7 11 1 8 1Zm0 1.2c2.4 0 3.8.5 3.8.9s-1.4.9-3.8.9S4.2 3.5 4.2 3.1 5.6 2.2 8 2.2Z" />
        </svg>
      )
    case 'schema':
      // cartella piena (come le "cartelle" blu di SourceTree)
      return (
        <svg viewBox="0 0 16 16" style={s} className={comune} aria-hidden>
          <path fill="currentColor" d="M1.5 3.5c0-.6.5-1 1-1h3.4l1.4 1.6h6.2c.6 0 1 .4 1 1v7.4c0 .6-.4 1-1 1H2.5c-.5 0-1-.4-1-1V3.5Z" />
        </svg>
      )
    case 'tabella':
      // griglia: banda di intestazione + due righe
      return (
        <svg viewBox="0 0 16 16" style={s} className={comune} aria-hidden>
          <path fill="currentColor" d="M2 3.2c0-.7.6-1.2 1.2-1.2h9.6c.6 0 1.2.5 1.2 1.2v1.6H2V3.2Zm0 2.8h12v2.2H2V6Zm0 3.4h12v2.2H2V9.4Zm0 3.4h12v.4c0 .7-.6 1.2-1.2 1.2H3.2C2.6 14.4 2 13.9 2 13.2v-.4Z" />
        </svg>
      )
    case 'vista':
      // occhio pieno
      return (
        <svg viewBox="0 0 16 16" style={s} className={comune} aria-hidden>
          <path fill="currentColor" d="M8 3.4c3 0 5.6 1.9 6.8 4.6-1.2 2.7-3.8 4.6-6.8 4.6S2.4 10.7 1.2 8C2.4 5.3 5 3.4 8 3.4Zm0 2a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z" />
        </svg>
      )
    case 'procedura':
      // documento con righe
      return (
        <svg viewBox="0 0 16 16" style={s} className={comune} aria-hidden>
          <path fill="currentColor" d="M4 1.6h5.2L13 5.4v8.4c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V2.6c0-.6.4-1 1-1Zm5 1.2v2.4h2.4L9 2.8ZM5 8h6v1.1H5V8Zm0 2.2h6v1.1H5v-1.1Z" />
        </svg>
      )
    case 'funzione':
      // "ƒ" in un quadrato pieno
      return (
        <svg viewBox="0 0 16 16" style={s} className={comune} aria-hidden>
          <path fill="currentColor" d="M3 2h10c.6 0 1 .4 1 1v10c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V3c0-.6.4-1 1-1Zm6.6 3.1h-1.2v.9h1v1h-1v4.6H7.1V7h-.9V6h.9v-.8c0-1 .4-1.6 1.5-1.6h1v1.5Z" />
        </svg>
      )
    case 'trigger':
      // fulmine pieno
      return (
        <svg viewBox="0 0 16 16" style={s} className={comune} aria-hidden>
          <path fill="currentColor" d="M9.4 1 3.5 9h3.4l-.8 6L13 6.4H9.2L9.4 1Z" />
        </svg>
      )
    case 'indice':
      // elenco con pallino (l'indice come "lista ordinata")
      return (
        <svg viewBox="0 0 16 16" style={s} className={comune} aria-hidden>
          <path fill="currentColor" d="M2 3.4h2.4v2.4H2V3.4Zm4 0h8v2.4H6V3.4ZM2 6.8h2.4v2.4H2V6.8Zm4 0h8v2.4H6V6.8ZM2 10.2h2.4v2.4H2v-2.4Zm4 0h8v2.4H6v-2.4Z" />
        </svg>
      )
    case 'chiave':
      // chiave piena (PK/UNIQUE)
      return (
        <svg viewBox="0 0 16 16" style={s} className={comune} aria-hidden>
          <path fill="currentColor" d="M6.2 2a4 4 0 0 0-3.9 5l-.9.9v2.2h2.1l.9-.9V7.7h1.5l.9-.9A4 4 0 1 0 6.2 2Zm-1.3 2a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Zm5.3 5.2-1 1 .8.8-.8.8.8.8-.8.8 1.4 1.4 3.6-3.6-2.4-2.4-1.6.4Z" />
        </svg>
      )
    case 'chiaveEsterna':
      // catena / collegamento (FK)
      return (
        <svg viewBox="0 0 16 16" style={s} className={comune} aria-hidden>
          <path fill="currentColor" d="M6.4 2.6a3.4 3.4 0 0 1 4.8 4.8l-1.3 1.3-1.3-1.3 1.3-1.3a1.5 1.5 0 0 0-2.2-2.2L6.4 5.2 5.1 3.9l1.3-1.3Zm3.2 9.5a3.4 3.4 0 0 1-4.8-4.8l1.3-1.3 1.3 1.3-1.3 1.3a1.5 1.5 0 0 0 2.2 2.2l1.3-1.3 1.3 1.3-1.3 1.3Z" />
        </svg>
      )
    case 'check':
      // scudo con spunta
      return (
        <svg viewBox="0 0 16 16" style={s} className={comune} aria-hidden>
          <path fill="currentColor" d="M8 1.2 13.5 3v5c0 3.1-2.2 5.9-5.5 6.8C4.7 13.9 2.5 11.1 2.5 8V3L8 1.2Zm-1 8.9 3.7-3.7-1.1-1.1L7 7.9 5.6 6.5 4.5 7.6 7 10.1Z" />
        </svg>
      )
    case 'gruppo':
    default:
      // "scatola" del gruppo (Colonne/Indici/Vincoli…)
      return (
        <svg viewBox="0 0 16 16" style={s} className={comune} aria-hidden>
          <path fill="currentColor" d="M2 4.2c0-.6.4-1 1-1h3.1l1.2 1.4h4.7c.6 0 1 .4 1 1v6.2c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V4.2Z" />
        </svg>
      )
  }
}
