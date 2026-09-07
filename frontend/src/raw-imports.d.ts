// Import di file SQL come testo grezzo (usati dai test del formattatore).
declare module '*.sql?raw' {
  const content: string
  export default content
}
