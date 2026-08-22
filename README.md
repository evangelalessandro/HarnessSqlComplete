# SQL Intelligence Assistant

Web App locale: client SQL intelligente + assistente avanzato per **SQL Server**.

- **Backend**: ASP.NET Core Web API (.NET 10) con `Microsoft.Data.SqlClient`
- **Frontend**: React + Vite + TypeScript, Tailwind CSS 4, Monaco Editor (`@monaco-editor/react`)
- **IA**: autocompletamento inline tramite API **DeepSeek** (`deepseek-chat`), con lo schema del DB come contesto

## Funzionalità

| Funzionalità | Dettagli |
|---|---|
| Login ai database | Windows Auth o SQL Auth, test connessione, elenco database disponibili |
| Login salvate | Salvate in SQLite locale con password cifrata (DPAPI, scope utente) |
| Metadati DB | Tabelle (con colonne, tipi, identità, descrizioni), viste, stored procedure (con parametri), trigger, funzioni, database |
| Treeview laterale | Navigazione oggetti con conteggi; click per inserire il nome nell'editor |
| Ricerca veloce | Filtro istantaneo per tabella / vista / procedura (client-side) + endpoint server `GET /api/metadata/{id}/search?q=` |
| Editor Monaco | Syntax highlighting T-SQL, completamento schema locale (tabelle/colonne/procedure con parametri), **completamento inline IA** (DeepSeek) con debounce, F5 / Ctrl+Invio per eseguire, Ctrl+Shift+F per formattare |
| Formatter SQL | Pulsante "Formatta" (libreria `sql-formatter`, keyword uppercase) |
| Risultati query | Griglia dati responsive con paginazione (25/50/100/200), header sticky, più result set, badge truncation, tempi di esecuzione |
| Tab Messaggi / PRINT | Mostra l'output dei `PRINT` (evento InfoMessage) e le righe modificate |

## Struttura

```
HarnessSqlComplete/
├── backend/SqlIntelliBackend/        # ASP.NET Core Web API
│   ├── Controllers/                  # connections, metadata, query, autocomplete
│   ├── Services/                     # ConnectionHub, MetadataService, QueryService, DeepSeekService, ...
│   ├── Models/                       # DTO
│   └── Data/                         # AppDbContext (SQLite per le login salvate)
└── frontend/                         # Vite + React + TS
    └── src/
        ├── components/               # LoginScreen, Sidebar, SqlEditor, ResultsPanel, PrintPanel
        ├── api.ts                    # client HTTP verso /api
        └── monacoSetup.ts            # Monaco + web worker (bundling locale, niente CDN)
```

## Prerequisiti

- [.NET SDK 10](https://dotnet.microsoft.com/download) (target `net10.0`)
- [Node.js 20+](https://nodejs.org) e npm
- Un'istanza SQL Server raggiungibile in locale (es. `localhost\SQLEXPRESS`, `localhost,1433`, LocalDB)
- (Opzionale) Chiave API DeepSeek per l'autocompletamento IA

## Avvio

### 1. Backend

```bash
cd backend/SqlIntelliBackend
dotnet run
```

Il server ascolta su `http://localhost:5213` (vedi `appsettings.json` → `Urls`).
Alla prima esecuzione crea `sqlintelli.db` (SQLite) per le login salvate.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Apri **http://localhost:5173** — Vite inoltra `/api/*` al backend (`vite.config.ts`).

### 3. Chiave DeepSeek (opzionale)

Inserisci la chiave in `backend/SqlIntelliBackend/appsettings.json`:

```json
"DeepSeek": { "ApiKey": "sk-...", "Model": "deepseek-chat" }
```

oppure come variabile d'ambiente:

```powershell
$env:DEEPSEEK__APIKEY = "sk-..."
```

Se non configurata, l'editor funziona comunque con il completamento basato sullo schema;
l'autocompletamento IA mostrerà lo stato "chiave non configurata" nella toolbar.
In alternativa la chiave può essere passata per-request dal client (`AutocompleteRequest.apiKey`).

## Build di verifica

```bash
# Backend
cd backend/SqlIntelliBackend && dotnet build

# Frontend (TypeScript + bundle di produzione)
cd frontend && npm run build     # output in frontend/dist
```

## API principali

| Metodo | Endpoint | Descrizione |
|---|---|---|
| `POST` | `/api/connections/test` | Testa una connessione (restituisce i database disponibili) |
| `POST` | `/api/connections/connect` | Si connette; se `save:true` salva la login |
| `GET` | `/api/connections` | Elenco login salvate (senza password) |
| `POST` | `/api/connections/saved/{id}/connect` | Connetti con una login salvata |
| `POST` | `/api/connections/{connectionId}/disconnect` | Chiude la sessione |
| `GET` | `/api/metadata/{connectionId}/summary` | Metadati completi (cache 2 min) |
| `GET` | `/api/metadata/{connectionId}/search?q=` | Ricerca oggetti per nome |
| `POST` | `/api/query/{connectionId}/execute` | Esegue SQL (multi-batch `GO`, PRINT, multi result set) |
| `GET` | `/api/autocomplete/{connectionId}/status` | Stato config DeepSeek |
| `POST` | `/api/autocomplete/{connectionId}` | Suggerimento inline da DeepSeek (SQL parziale + schema) |

## Note

- Le connection string delle sessioni attive vivono **solo in RAM** (mai restituite al client);
  ogni richiesta apre una connessione fresca.
- Il batch SQL viene splittato sui separatori `GO` (limite noto: `GO` dentro stringhe letterali non è gestito).
- I result set sono limitati a 5000 righe (flag `truncated`); il client mostra la paginazione.
- Le password salvate sono cifrate con DPAPI (`DataProtectionScope.CurrentUser`);
  su piattaforme non Windows il fallback è Base64 (non sicuro — documentato nel codice).
