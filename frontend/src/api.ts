import type {
  AutocompleteResponse,
  AutocompleteStatus,
  ConnectResponse,
  ConnectionRequest,
  ConnectionTestResult,
  DatabaseSummary,
  QueryResult,
  SavedConnectionDto,
  SearchResult,
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

  deleteConnection: (id: number) =>
    http<void>(`/connections/${id}`, { method: 'DELETE' }),

  disconnect: (connectionId: string) =>
    http<void>(`/connections/${connectionId}/disconnect`, { method: 'POST' }),

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

  autocomplete: (connectionId: string, sql: string, apiKey?: string) =>
    http<AutocompleteResponse>(`/autocomplete/${connectionId}`, {
      method: 'POST',
      body: JSON.stringify({ sql, apiKey }),
    }),

  autocompleteStatus: (connectionId: string) =>
    http<AutocompleteStatus>(`/autocomplete/${connectionId}/status`),
}
