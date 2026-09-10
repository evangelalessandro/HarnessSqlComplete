// Import di file SQL come testo grezzo (usati dai test del formattatore).
declare module '*.sql?raw' {
  const content: string
  export default content
}

// Sorgente dei componenti come testo (test che controllano le voci di menu registrate).
declare module '*.tsx?raw' {
  const content: string
  export default content
}
