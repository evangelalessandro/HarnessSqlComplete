# Valutazione motori intellisense alternativi (branch `intellisense-engine`)

Prototipo di valutazione eseguito il 26/08/2026 su Windows, Node 24, .NET 10.
Obiettivo: capire se conviene sostituire il motore intellisense attuale (regex + ranking
per utilizzo reale) con un parser vero o con l'LSP ufficiale di Microsoft.

## 1. dt-sql-parser — NON praticabile per T-SQL

- `dt-sql-parser@4.5.1` (attuale): **non include un parser T-SQL**. Export disponibili:
  MySQL, FlinkSQL, SparkSQL, HiveSQL, PostgreSQL, TrinoSQL, ImpalaSQL, GenericSQL.
  Il suggerimento "impostare il linguaggio su flinksql o tsql" del testo di partenza
  non corrisponde alla realtà del pacchetto.
- `dt-sql-parser@2.0.11` (2020): include `TransactSQL`, ma si **rompe su Node 24**
  (dipendenza `antlr4` vecchia, subpath `./error` non esportato), non mantenuto, senza
  tipi. Non utilizzabile in un progetto moderno.

**Verdetto**: strada chiusa. Un parser T-SQL vero andrebbe generato con antlr4ts a
partire dalla grammatica ufficiale (antlr/grammars-v4 `sql/tsql`) — lavoro autonomo.

## 2. sqltoolsservice (LSP ufficiale Microsoft) — FUNZIONA, ma non sostituisce il motore

### Cosa funziona (verificato con probe JSON-RPC reali)

- Spawn del binario `MicrosoftSqlToolsServiceLayer.exe` (release
  `6.0.20260825.2`, ~88 MB, framework-dependent su .NET 10) come processo Node,
  comunicazione LSP **standard** con framing `Content-Length` (non newline).
- `initialize`/`initialized` OK; il server pubblica `textDocument/publishDiagnostics`
  (diagnostica reale) e supporta hover, signatureHelp, definition, references.
- `connection/connect` al DB reale **richiede i parametri giusti**: `serverName`,
  `databaseName`, `authenticationType` (non `server`/`database`). Connessione a
  `localhost\SQL2022 / WSBRITVIC` verificata (notification `connection/complete`).
- `textDocument/completion` con connessione restituisce lo **schema reale**:
  - a `FROM ` → 483 voci: **286 tabelle** (kind 17 = Struct) + viste/funzioni;
  - a `FROM MAG_` → 57 voci schema (le MAG_* reali).

### Limiti rilevati (perché NON sostituisce il motore attuale)

1. **Riproduce il bug che abbiamo corretto**: allo scenario esatto dell'utente
   `... group by COR_CORRIDOIO ,` restituisce le **tabelle**, non le colonne della
   FROM né le funzioni scalari — lo stesso problema risolto con la regola
   "virgola che continua liste di colonne" (`intellisenseContext.ts`).
2. **Niente ranking per utilizzo reale**: le tabelle arrivano in ordine alfabetico;
   si perdono FK in ingresso/uscita, co-occorrenza nei JOIN reali, storico utente
   (`historyTableBoost`), suggerimenti di JOIN con ON pronti, self-join con alias,
   controparti, INSERT/VALUES, EXEC con parametri, DECLARE tipi, @@ variabili di
   sistema, guide di blocco, colori per-tabella, ecc.
3. **Dipendenze pesanti**: binario ~88 MB, processo da gestire (crash/restart),
   per il completion richiede la connessione attiva al DB (parametri/credenziali da
   inoltrare al processo).

### Uso consigliato (se si vuole sfruttarlo)

Integrare sqltoolsservice come **fonte di diagnostica/validazione** (errori di
sintassi reali con riga/colonna, al posto o in aggiunta alla diagnostica regex
attuale) e come verifica incrociata dello schema, mantenendo il motore attuale
come "cervello" del completamento. Il protocollo di connessione (connection/connect
con `serverName`/`databaseName`) è già validato dai probe in `C:\temp\lsp-probe*.cjs`.

## 3. Conclusione

| Opzione | Fattibile | Sostituisce il motore? |
|---|---|---|
| dt-sql-parser | No (niente T-SQL) | — |
| sqltoolsservice LSP (completion) | Sì (validato) | No: perde ranking/feature e ha lo stesso buco GROUP BY-virgola |
| sqltoolsservice LSP (diagnostica) | **No** (verificato) | Il servizio pubblica SEMPRE 0 diagnostica via `textDocument/publishDiagnostics` anche per SQL palesemente invalido (`SELEC 1`, `SELECT * FORM …`, parentesi non chiuse), sia con didOpen che didChange, con o senza `connection/languageflavorchanged`. |
| Motore attuale | Sì | È la strada da percorrere |

Raccomandazione: **mantenere il motore attuale** per i suggerimenti. La "diagnostica
reale" (errori con riga/colonna) è stata ottenuta senza LSP con la **verifica di
sintassi via transazione con rollback** (`checkSyntax`): il backend esegue il testo
dentro `BEGIN TRANSACTION … ROLLBACK` e restituisce gli errori VERI di SQL Server
con riga assoluta ("Riga N: …") — più precisi dell'LSP e senza dipendenze.
Un parser T-SQL vero (antlr4ts + grammatica ufficiale) resta l'unica via per chiudere
i buchi di scope (CTE, derived table) senza perdere il ranking — progetto futuro.
