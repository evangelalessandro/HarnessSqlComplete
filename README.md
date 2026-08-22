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
| Suggerimenti JOIN intelligenti | Quando scrivi `JOIN`, le tabelle collegate da **foreign key** alle tabelle già presenti nella query vengono proposte per prime **con la clausola `ON` già compilata**; le altre sono ordinate per **utilizzo reale nel database** (FK in entrata/uscita, dipendenze da viste/procedure/trigger, righe stimate). Se un nome di colonna è univoco tra le tabelle della query, il prefisso tabella viene omesso (`ON [id] = [customer_id]`) |
| Treeview laterale | Navigazione oggetti con conteggi; click per inserire il nome nell'editor; tooltip con le metriche di utilizzo sulle tabelle. Le tabelle sono **raggruppate per prefisso** (BCKUP_*, DAT_*, MAG_* …; le altre in "Varie") e i **campi restano chiusi** finché non espandi la tabella |
| Anteprima dati (hover) | Passando il mouse su una tabella si apre una card con le **prime 30 righe** (`SELECT TOP 30 *`), le proprietà estese della tabella e le metriche di utilizzo; pulsante "Esegui SELECT TOP 100" per aprire i dati nella griglia risultati (funziona anche senza hover, tramite l'icona 👁 sulle righe del treeview) |
| Proprietà estese colonne | Passando il mouse su una colonna si mostra **tutte** le proprietà estese (`MS_Description` e custom), tipo, lunghezza, NULL/IDENTITY/COMPUTED |
| Aiuto INSERT | Dentro `INSERT INTO tabella (` l'editor suggerisce le **colonne della tabella** (con tipo e flag) e uno snippet "tutte le colonne" che compila l'intero elenco |
| Colonne dopo SELECT | Nella select-list (tra `SELECT` e `FROM`) l'editor suggerisce le **colonne delle tabelle referenziate nello statement** (anche se il `FROM` è scritto dopo il cursore), escludendo quelle già digitate |
| Espansione `*` | Digitando `*` nella select-list, il suggerimento **"— tutti i campi (N) —"** sostituisce l'asterisco con l'elenco completo delle colonne (Tab per accettare): campi univoci senza prefisso, campi condivisi qualificati con tabella/alias |
| Parentesi intelligenti | Gli identificatori vengono inseriti **senza `[parentesi quadre]`** quando non servono (nomi semplici); le parentesi compaiono solo per spazi, caratteri speciali, parole riservate o nomi che iniziano con una cifra |
| Corrispondenza colonna↔valore | Negli INSERT, muovendosi tra i nomi dei campi o tra i valori di `VALUES`, si **evidenzia il campo corrispondente** (es. cursore su `nome` → evidenziato `'Mario'` in VALUES, e viceversa) |
| Parametri EXEC | Dopo `EXEC [schema].[proc]` l'editor suggerisce i **parametri della procedura** (tipo, IN/OUTPUT), esclude quelli già digitati e propone uno snippet "tutti i parametri" |
| Colori tabelle | Ogni tabella ha un **colore stabile** e le sue colonne condividono lo stesso colore nella query (nomi tabella in grassetto); le colonne ambigue (presenti in più tabelle dello statement) restano non colorate; la colorazione si aggiorna mentre scrivi |
| Query di default | Ogni nuova pagina dell'editor parte con il modello `BEGIN TRAN; SELECT * FROM [dbo].[Tabella] ORDER BY 1 DESC; ROLLBACK;` (pulsante "Nuova" in toolbar per ripartire dal modello) |
| Multi-tab editor | Barra delle tab sopra l'editor: più pagine di query aperte, "+ Nuova", chiusura con ×; il contenuto di ogni tab si conserva passando da una all'altra |
| Alter / Apri oggetti | Sulle righe **Stored Procedure** e **Funzioni** del treeview: **Alter** apre in una nuova tab `ALTER PROCEDURE/FUNCTION` con la definizione reale, **Apri** apre la definizione `CREATE` |
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

# Test automatici (vitest) — coprono TUTTE le funzionalità richieste
cd frontend && npm test          # 45 test in 7 file
```

La suite di test (`frontend/src/__tests__/`) verifica ogni funzionalità con gli scenari reali
(JOIN con colonne univoche/condivise e case-insensitive, INSERT con corrispondenza colonna↔valore,
EXEC con parametri, select-list ed espansione `*`, colori tabelle/colonne, parentesi intelligenti)
su uno schema mock ispirato a un DB reale (WSBRITVIC). Include anche test RUNTIME che applicano
le decorazioni su un vero modello Monaco (jsdom) e i check E2E sul backend.

## API principali

| Metodo | Endpoint | Descrizione |
|---|---|---|
| `POST` | `/api/connections/test` | Testa una connessione (restituisce i database disponibili) |
| `POST` | `/api/connections/connect` | Si connette; se `save:true` salva la login |
| `GET` | `/api/connections` | Elenco login salvate (senza password) |
| `POST` | `/api/connections/saved/{id}/connect` | Connetti con una login salvata |
| `POST` | `/api/connections/{connectionId}/disconnect` | Chiude la sessione |
| `GET` | `/api/metadata/{connectionId}/summary` | Metadati completi (cache 2 min) — include `foreignKeys`, `usage` (fkIncoming, fkOutgoing, dependencyCount, rowCount) e `extendedProperties` per tabella e colonna |
| `GET` | `/api/metadata/{connectionId}/tables/{schema}/{table}/preview?top=30` | Anteprima dati (`SELECT TOP n *`, n max 500) |
| `GET` | `/api/metadata/{connectionId}/search?q=` | Ricerca oggetti per nome |
| `GET` | `/api/metadata/{connectionId}/objects/{schema}/{name}/definition` | Definizione (testo) di proc/funzione/vista/trigger — per Alter o apertura in nuova tab |
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
