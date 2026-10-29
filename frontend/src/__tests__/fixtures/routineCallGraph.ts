// GRAFO DELLE CHIAMATE per i test di SCALA e di PROTEZIONE DAI CICLI.
//
// Prima era il grafo VERO del database di produzione dell'autore (1696-2200 legami, con i nomi reali
// di clienti e procedure). Ora è un grafo SINTETICO di dimensioni equivalenti con nomi pubblici
// (proc_0001, app.*, …): conserva ciò che i test devono dimostrare (migliaia di legami, quattro
// routine ricorsive, un ciclo a due, un "hub" molto chiamato) senza alcun nome reale.
/* eslint-disable */

export interface EdgeFixture {
  callerSchema: string
  callerName: string
  callerType: string
  calleeSchema: string
  calleeName: string
  calleeType: string
}

function grafoSintetico(): EdgeFixture[] {
  const edges: EdgeFixture[] = []
  const N = 520
  const nome = (i: number) => `proc_${String(i).padStart(4, '0')}`
  const schema = (i: number) => (i % 7 === 0 ? 'app' : 'dbo')
  const tipo = (i: number) => (i % 11 === 0 ? 'FN' : i % 13 === 0 ? 'TR' : 'P')

  // catena: ognuna chiama le 2 successive
  for (let i = 1; i <= N; i++) {
    for (const salto of [1, 2, 3]) {
      const j = i + salto
      if (j > N) continue
      edges.push({
        callerSchema: schema(i),
        callerName: nome(i),
        callerType: tipo(i),
        calleeSchema: schema(j),
        calleeName: nome(j),
        calleeType: tipo(j),
      })
    }
  }
  // "hub" molto usato: proc_0001 chiamata da 300 routine
  for (let i = 101; i <= 400; i++) {
    edges.push({
      callerSchema: schema(i),
      callerName: nome(i),
      callerType: tipo(i),
      calleeSchema: 'dbo',
      calleeName: nome(1),
      calleeType: 'P',
    })
  }
  // chiamate "trasversali" fra schemi diversi
  for (let i = 1; i <= 200; i++) {
    const j = ((i * 37) % N) + 1
    if (j === i) continue
    edges.push({
      callerSchema: 'dbo',
      callerName: nome(i),
      callerType: tipo(i),
      calleeSchema: 'app',
      calleeName: nome(j),
      calleeType: tipo(j),
    })
  }
  // QUATTRO routine RICORSIVE (chiamano se stesse): il caso che la protezione dai cicli deve gestire
  for (const i of [300, 301, 302, 303]) {
    edges.push({
      callerSchema: schema(i),
      callerName: nome(i),
      callerType: 'FN',
      calleeSchema: schema(i),
      calleeName: nome(i),
      calleeType: 'FN',
    })
  }
  // ciclo a DUE: proc_0200 ↔ proc_0201
  edges.push(
    {
      callerSchema: 'dbo',
      callerName: nome(200),
      callerType: 'P',
      calleeSchema: 'dbo',
      calleeName: nome(201),
      calleeType: 'P',
    },
    {
      callerSchema: 'dbo',
      callerName: nome(201),
      callerType: 'P',
      calleeSchema: 'dbo',
      calleeName: nome(200),
      calleeType: 'P',
    },
  )
  // niente legami duplicati: i test confrontano il conteggio dell'indice con la lunghezza dell'array
  const unici = new Map<string, EdgeFixture>()
  for (const e of edges) unici.set(`${e.callerSchema}.${e.callerName}->${e.calleeSchema}.${e.calleeName}`, e)
  return [...unici.values()]
}

/** Grafo sintetico grande (oltre 2000 legami) usato dai test di scala e di cicli. */
export const realCallEdges: EdgeFixture[] = grafoSintetico()
