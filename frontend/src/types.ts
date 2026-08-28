// Tipi speculari ai DTO del backend (camelCase)

export interface ConnectionRequest {
  name?: string
  server: string
  port: number
  database?: string
  useWindowsAuth: boolean
  username?: string
  password?: string
  save: boolean
  encrypt?: boolean
  trustServerCertificate?: boolean
}

export interface ConnectionTestResult {
  success: boolean
  message: string
  databases: string[] | null
}

export interface ConnectResponse {
  connectionId: string
  server: string
  database: string
  databases: string[]
  message: string
}

export interface SavedConnectionDto {
  id: number
  name: string
  server: string
  port: number
  database: string | null
  useWindowsAuth: boolean
  username: string | null
  updatedAt: string
}

/** Proprietà estesa (MS_Description e altre) di tabella o colonna. */
export interface ExtendedProperty {
  name: string
  value: string
}

export interface ColumnInfo {
  name: string
  dataType: string
  isNullable: boolean
  isIdentity: boolean
  isComputed: boolean
  maxLength: number | null
  description: string | null
  extendedProperties: ExtendedProperty[] | null
}

/** Metriche di utilizzo reale di una tabella nel database (per ranking dei suggerimenti). */
export interface TableUsage {
  fkIncoming: number
  fkOutgoing: number
  dependencyCount: number
  rowCount: number
}

/** Relazione di foreign key (una riga per COPPIA di colonne; le FK composite hanno lo stesso name). */
export interface ForeignKeyInfo {
  name: string
  schema: string
  table: string
  column: string
  refSchema: string
  refTable: string
  refColumn: string
}

export interface IndexInfo {
  name: string
  isPrimaryKey: boolean
  isUnique: boolean
  columns: string[] | null
}

export interface TableInfo {
  schema: string
  name: string
  columnCount: number
  createDate: string | null
  columns: ColumnInfo[] | null
  usage: TableUsage | null
  extendedProperties: ExtendedProperty[] | null
  indexes?: IndexInfo[] | null
}

export interface ViewInfo {
  schema: string
  name: string
  createDate: string | null
}

export interface ProcParamInfo {
  name: string
  dataType: string
  mode: string
  /** Valore di default dichiarato nella definizione (es. "0", "N'x'"), se presente. */
  defaultValue?: string | null
}

export interface ProcedureInfo {
  schema: string
  name: string
  createDate: string | null
  parameters: ProcParamInfo[] | null
}

export interface TriggerInfo {
  schema: string
  tableName: string
  name: string
}

export interface FunctionInfo {
  schema: string
  name: string
  type: string
}

export interface DatabaseInfo {
  name: string
}

/** Coppia di tabelle che compaiono insieme nei JOIN reali delle stored procedure (per ranking). */
export interface TableCooccurrence {
  tableA: string
  tableB: string
  count: number
}

export interface DatabaseSummary {
  tables: TableInfo[]
  views: ViewInfo[]
  procedures: ProcedureInfo[]
  triggers: TriggerInfo[]
  functions: FunctionInfo[]
  foreignKeys: ForeignKeyInfo[]
  databases: DatabaseInfo[]
  cooccurrences?: TableCooccurrence[] | null
}

export interface SearchResult {
  schema: string
  name: string
  objectType: string
}

export interface ColumnResult {
  name: string
  dataType: string
}

export type CellValue = unknown

export interface QueryResultSet {
  columns: ColumnResult[]
  rows: CellValue[][]
  rowCount: number
  affectedRows: number
  truncated: boolean
}

export interface QueryResult {
  resultSets: QueryResultSet[]
  totalAffectedRows: number
  messages: string[]
  elapsedMs: number
  error: string | null
}

export interface SuggestionItem {
  text: string
  reason: string | null
}

export interface AutocompleteResponse {
  suggestions: SuggestionItem[] | null
  error: string | null
}

export interface AutocompleteStatus {
  configured: boolean
  model: string
  baseUrl: string
  hasApiKeyOverride: boolean
}

export type ObjectKind = 'table' | 'view' | 'procedure' | 'function' | 'trigger'

/** Esito di un backup/restore del database (messaggi del server + eventuale errore). */
export interface DbMaintenanceResponse {
  messages: string[]
  error: string | null
}

/** Opzioni di backup stile dialogo SSMS. */
export interface BackupRequest {
  path: string
  /** "full" | "differential" | "log" */
  type: 'full' | 'differential' | 'log'
  /** "database" | "files" */
  component: 'database' | 'files'
  /** Database da sottoporre a backup (default: quello attivo). */
  database?: string
  files?: string[]
  filegroups?: string[]
  name?: string
  description?: string
  /** "append" | "overwrite" | "format" */
  overwriteMode: 'append' | 'overwrite' | 'format'
  mediaName?: string
  mediaDescription?: string
  verify?: boolean
  checksum?: boolean
  continueOnError?: boolean
  /** "default" | "on" | "off" */
  compression: 'default' | 'on' | 'off'
  encryptionAlgorithm?: 'AES_128' | 'AES_192' | 'AES_256'
  encryptionCertificate?: string
  copyOnly?: boolean
  /** per tipo log: "truncate" | "noTruncate" | "noRecovery" */
  logMode?: 'truncate' | 'noTruncate' | 'noRecovery'
  expiryDays?: number
  expiryDate?: string
}

/** Un backup set letto dal file con RESTORE HEADERONLY. */
export interface BackupSetInfo {
  name: string | null
  description: string | null
  /** 1 full, 2 log, 5 differential */
  type: number
  typeDescription: string | null
  position: number
  serverName: string | null
  databaseName: string | null
  startDate: string | null
  finishDate: string | null
  sizeBytes: number
  firstLsn: string | null
  lastLsn: string | null
  copyOnly: boolean
  hasChecksums: boolean
  isDamaged: boolean
}

export interface BackupInfoResponse {
  sets: BackupSetInfo[]
  error: string | null
}

export interface FileMove {
  logicalName: string
  physicalPath: string
}

/** Richiesta di ripristino: uno o più file (media set), posizione del set e opzioni SSMS. */
export interface RestoreRequest {
  /** Percorso singolo (compatibilità) o primo file del media set. */
  path?: string
  /** Media set: più file .bak (FROM DISK=…, DISK=…). */
  paths?: string[]
  filePosition?: number
  /** Database di destinazione (default: quello attivo). */
  databaseName?: string
  sourceDatabase?: string
  /** "database" | "log" (dalla lista HEADERONLY) */
  setType: 'database' | 'log'
  replace?: boolean
  /** NORECOVERY: lascia il DB in stato restoring per la catena di log. */
  leaveRestoring?: boolean
  /** Punto nel tempo ISO "yyyy-MM-ddTHH:mm:ss.fff" (solo set log). */
  stopAt?: string
  moveFiles?: FileMove[]
  /** Backup della coda del log prima del ripristino. */
  tailLogPath?: string
}

/** Esito dell'upload di un file .bak selezionato localmente: percorso lato server. */
export interface UploadBackupResponse {
  path: string
  sizeBytes: number
}

/** Info del media (LABELONLY): conteggio file e media set id per la verifica proattiva. */
export interface MediaLabelResponse {
  familyCount: number
  mediaSetId: string | null
  mediaName: string | null
  error: string | null
}

export interface DbFileEntry {
  logicalName: string
  physicalName: string
  type: string
  filegroup: string | null
  isDefaultFilegroup: boolean
}

export interface DbFileListResponse {
  files: DbFileEntry[]
  error: string | null
}

export interface CertEntry {
  name: string
}

/** Tab dell'editor (query o definizione oggetto). */
export interface EditorTab {
  id: string
  title: string
  sql: string
  /** Descrizione libera della tab (nota dell'utente). */
  description?: string
  /** Tab appuntata: resta in testa e non è chiudibile. */
  pinned?: boolean
  /** Database associato alla tab (per il colore). */
  database?: string
  /** Tab nata da un file (nome = file). */
  fromFile?: boolean
  /** Nome reale del file (senza .sql): usato per suggerire il salvataggio anche con titolo personalizzato. */
  fileName?: string
  /** Titolo rinominato manualmente dall'utente: non va sovrascritto al salvataggio. */
  titleCustom?: boolean
  /** Handle del file aperto col picker: permette di sovrascrivere l'originale. */
  fileHandle?: FileSystemFileHandle | null
}
