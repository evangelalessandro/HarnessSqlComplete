// Tipi per la definizione della lingua SQL di Monaco: nel pacchetto i file delle lingue sono
// JavaScript senza dichiarazioni (.d.ts), quindi il modulo va dichiarato qui per poterlo importare
// in TypeScript (serve a estendere l'elenco delle PAROLE CHIAVE del coloratore).
declare module 'monaco-editor/languages/definitions/sql/sql' {
  import type { languages } from 'monaco-editor'

  export const language: languages.IMonarchLanguage
  export const conf: languages.LanguageConfiguration
}
