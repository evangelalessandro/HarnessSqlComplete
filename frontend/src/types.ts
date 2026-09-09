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

/** Vincolo CHECK di una tabella: nome, tabella e testo della condizione. */
export interface CheckConstraintInfo {
  schema: string
  tableName: string
  name: string
  /** Testo della condizione (es. "([importo]>=(0))"). */
  definition: string
  isDisabled?: boolean
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
  /** Vincoli CHECK delle tabelle (per mostrarli e modificarli). */
  checkConstraints?: CheckConstraintInfo[] | null
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

/** Riga del report utilizzo tabelle: spazio riservato/usato (KB), righe, indici e accessi. */
export interface TableReportRow {
  schema: string
  name: string
  createDate: string | null
  rowCount: number
  reservedKb: number
  usedKb: number
  dataKb: number
  indexKb: number
  unusedKb: number
  indexCount: number
  reads: number
  writes: number
  lastRead: string | null
  lastWrite: string | null
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
