import type {
  AutocompleteResponse,
  AutocompleteStatus,
  BackupInfoResponse,
  BackupRequest,
  CertEntry,
  ConnectResponse,
  ConnectionRequest,
  ConnectionTestResult,
  DatabaseSummary,
  DbFileEntry,
  DbFileListResponse,
  DbMaintenanceResponse,
  MediaLabelResponse,
  QueryResult,
  RestoreRequest,
  SavedConnectionDto,
  SearchResult,
  UploadBackupResponse,
} from './types'

const API_BASE = '/api'

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (res.status === 204) return undefined as T
  if (!res.ok) {
    let msg = `Errore HTTP ${res.status}`
    try {
      const body = (await res.json()) as { message?: string }
      if (body?.message) msg = body.message
    } catch {
      /* corpo non JSON */
    }
    throw new Error(msg)
  }
  return (await res.json()) as T
}

export const api = {
  listConnections: () => http<SavedConnectionDto[]>('/connections'),

  testConnection: (req: ConnectionRequest) =>
    http<ConnectionTestResult>('/connections/test', { method: 'POST', body: JSON.stringify(req) }),

  connect: (req: ConnectionRequest) =>
    http<ConnectResponse>('/connections/connect', { method: 'POST', body: JSON.stringify(req) }),

  connectSaved: (id: number) =>
    http<ConnectResponse>(`/connections/saved/${id}/connect`, { method: 'POST' }),

  /** Cambia il database della sessione corrente (la password resta sul server). */
  switchDatabase: (connectionId: string, database: string) =>
    http<ConnectResponse>(`/connections/${connectionId}/switch-database`, {
      method: 'POST',
      body: JSON.stringify({ database }),
    }),

  deleteConnection: (id: number) =>
    http<void>(`/connections/${id}`, { method: 'DELETE' }),

  disconnect: (connectionId: string) =>
    http<void>(`/connections/${connectionId}/disconnect`, { method: 'POST' }),

  /**
   * Verifica di sintassi: esegue il testo dentro una transazione che viene SEMPRE
   * annullata (rollback) — gli errori reali di SQL Server arrivano con "Riga N:".
   */
  checkSyntax: (connectionId: string, sql: string) =>
    http<QueryResult>(`/query/${connectionId}/execute`, {
      method: 'POST',
      body: JSON.stringify({ sql, timeoutSeconds: 10, checkSyntax: true }),
    }),

  getSummary: (connectionId: string) =>
    http<DatabaseSummary>(`/metadata/${connectionId}/summary`),

  /** Anteprima dati di una tabella (SELECT TOP n *). */
  previewTable: (connectionId: string, schema: string, table: string, top = 30) =>
    http<QueryResult>(
      `/metadata/${connectionId}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/preview?top=${top}`,
    ),

  searchObjects: (connectionId: string, q: string) =>
    http<SearchResult[]>(`/metadata/${connectionId}/search?q=${encodeURIComponent(q)}`),

  /** Definizione (testo) di una stored procedure / funzione / vista / trigger. */
  getObjectDefinition: (connectionId: string, schema: string, name: string) =>
    http<{ definition: string }>(
      `/metadata/${connectionId}/objects/${encodeURIComponent(schema)}/${encodeURIComponent(name)}/definition`,
    ),

  execute: (connectionId: string, sql: string, timeoutSeconds?: number) =>
    http<QueryResult>(`/query/${connectionId}/execute`, {
      method: 'POST',
      body: JSON.stringify({ sql, timeoutSeconds }),
    }),

  /** Backup del database con le opzioni del dialogo SSMS. */
  backupDb: (
    connectionId: string,
    req: BackupRequest,
  ) =>
    http<DbMaintenanceResponse>(`/db/${connectionId}/backup`, {
      method: 'POST',
      body: JSON.stringify(req),
    }),
  /** Ripristina il database/log dal file, con REPLACE, NORECOVERY, STOPAT e MOVE. */
  restoreDb: (
    connectionId: string,
    req: RestoreRequest,
  ) =>
    http<DbMaintenanceResponse>(`/db/${connectionId}/restore`, {
      method: 'POST',
      body: JSON.stringify(req),
    }),
  /** Legge i backup set contenuti nel/i file (RESTORE HEADERONLY): periodi, LSN, dimensioni. */
  backupInfo: (connectionId: string, path: string, paths?: string[]) =>
    http<BackupInfoResponse>(`/db/${connectionId}/backup-info`, {
      method: 'POST',
      body: JSON.stringify(paths && paths.length > 0 ? { paths } : { path }),
    }),
  /** File contenuti nel backup set (RESTORE FILELISTONLY): per i MOVE del ripristino. */
  restoreFileList: (connectionId: string, path: string, filePosition?: number, paths?: string[]) =>
    http<DbFileListResponse>(`/db/${connectionId}/restore-filelist`, {
      method: 'POST',
      body: JSON.stringify(
        paths && paths.length > 0 ? { paths, filePosition } : { path, filePosition },
      ),
    }),
  /** Info del media (LABELONLY): family count e media set id per verificare i file selezionati. */
  backupLabel: (connectionId: string, path: string) =>
    http<MediaLabelResponse>(`/db/${connectionId}/backup-label`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  /** Upload di un .bak selezionato localmente → percorso lato server (cartella backup dell'istanza). */
  uploadBackup: async (connectionId: string, file: File): Promise<UploadBackupResponse> => {
    const res = await fetch(`${API_BASE}/db/${connectionId}/upload-backup?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `Upload non riuscito (HTTP ${res.status})`)
    }
    return (await res.json()) as UploadBackupResponse
  },
  /** File e filegroup del database attivo (BACKUP FILE/FILEGROUP e MOVE). */
  maintenanceFiles: (connectionId: string) =>
    http<DbFileEntry[]>(`/db/${connectionId}/files`),
  /** Certificati del server (crittografia del backup). */
  maintenanceCertificates: (connectionId: string) =>
    http<CertEntry[]>(`/db/${connectionId}/certificates`),

  autocomplete: (connectionId: string, sql: string, apiKey?: string) =>
    http<AutocompleteResponse>(`/autocomplete/${connectionId}`, {
      method: 'POST',
      body: JSON.stringify({ sql, apiKey }),
    }),

  autocompleteStatus: (connectionId: string) =>
    http<AutocompleteStatus>(`/autocomplete/${connectionId}/status`),
}
