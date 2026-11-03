# Ho costruito il client SQL che volevo usare. Ora mi serve una mano per la 1.0

**SQL Intelligence Assistant: intellisense che conosce il tuo database, formattatore T-SQL, diagramma delle chiamate. 63 giorni di lavoro, 1.522 test, licenza MIT. E una 1.0 da portare a casa.**

---

Ciao, sono Alessandro. Faccio lo sviluppatore e passo una buona parte delle mie giornate dentro SQL Server.

Due mesi fa mi sono stufato. Non del SQL: del contorno. Il formattatore aperto in un'altra scheda, il tool per i diagrammi, Excel per incollare i risultati, SSMS con venti tab e la sensazione di non sapere più quale database stavo guardando.

Così il 22 agosto ho aperto un repository vuoto e ho iniziato a costruire il client che avrei voluto avere: uno che conoscesse **il mio** database, non solo le parole chiave del T-SQL. Oggi quel progetto si chiama **SQL Intelligence Assistant**, ha 250 commit e 1.522 test automatici. E questo è il primo post in cui te lo racconto.

> **TL;DR** — un client SQL nel browser con intellisense consapevole dello schema, formattatore T-SQL, generatore di statement e diagramma delle chiamate. Open source, MIT, nessuna telemetria. La prossima release è la 1.0 e sto cercando sostegno per arrivarci.

---

## Il problema (che probabilmente conosci)

Ti è mai capitato di:

- scrivere una `JOIN` e doverti ricordare a memoria il nome della colonna di appoggio?
- riformattare a mano una procedura da 400 righe, sperando di non cambiare nemmeno uno spazio dentro una stringa?
- aprire tre strumenti diversi per capire chi chiama una stored procedure?
- copiare trenta righe di risultato e costruire l'`INSERT` a mano, pregando di non invertire due colonne?
- perdere una tab fra le venti aperte e non ricordare più su quale database stavi lavorando?

A me sì. Ogni giorno. E ogni volta sono trenta secondi che se ne vanno: moltiplicati per cinque giorni a settimana, per anni, fanno un bel pezzo di vita.

Il punto è che gli strumenti che usiamo conoscono la *sintassi* del SQL, quasi mai il *contesto* in cui la scriviamo: le nostre tabelle, le nostre foreign key, le nostre procedure, i nostri alias. E la differenza tra un editor e un buon editor sta tutta lì.

## L'idea, in tre righe

Un client SQL che gira **nel browser** e parla con **SQL Server**, usando lo schema reale come contesto: backend ASP.NET Core su .NET 10, frontend React 19 + TypeScript, Monaco Editor in bundle locale (niente CDN), SQLite per le login salvate.

Le credenziali restano sulla tua macchina, cifrate con DPAPI; le connection string delle sessioni vivono solo in memoria e non tornano mai al client. Senza l'AI opzionale, lo schema non esce di casa. La licenza è MIT, il codice è pubblico su GitHub.

Non ho cercato di clonare SSMS. Ho cercato di togliere l'attrito: scrivere, formattare, capire, confrontare, generare. Senza cambiare finestra.

È pensato per chi scrive T-SQL di mestiere: sviluppatori, DBA, consulenti che entrano in database che non hanno scritto e hanno bisogno di capirli in fretta. Non serve installare niente sul server: l'app gira sulla tua macchina e si connette come farebbe SSMS.

## I numeri

Non sono stime: li ho contati nel repository, nei test e nel database su cui sviluppo.

- 🗓️ **63 giorni** di sviluppo e **250 commit**
- 💻 **31.500 righe** di codice applicativo e **17.600 righe** di test
- ✅ **1.522 test** automatici, tutti verdi, in **129 file**
- 🔌 **21 endpoint** REST e **25 componenti** React
- 🖼️ **72 screenshot** e **56 funzioni** raccontate nel README
- 🗄️ test su uno schema reale di **286 tabelle**, **260 funzioni** (di cui 81 tabellari), **400 foreign key**, **138 trigger** e **460 vincoli CHECK**
- 🕸️ **2.200+ legami** nel grafo delle chiamate, verificati partendo da **ogni** routine del database
- ⚡ metadati letti in **1,6 s** invece di 2,6 s, risposta da **358 KB** invece di 3,5 MB
- 📵 **zero telemetria**: nessun tracciamento, nessuna analisi d'uso; l'unica chiamata esterna è l'AI opzionale, se la attivi

C'è un numero che mi rende più orgoglioso degli altri, ed è **1.522**. Non perché sia grande, ma perché è la ragione per cui posso toccare il motore di intellisense senza rompere tutto il resto. Ci torno tra un attimo.

## Cosa sa fare

### 🧠 Intellisense che conosce il tuo schema

- Dopo `FROM`/`JOIN` propone tabelle, viste e **funzioni tabellari**; dopo `EXEC` solo stored procedure; nella select-list e in `WHERE`/`ON`/`GROUP BY`/`ORDER BY` solo colonne e funzioni.
- Dopo un alias (`r.`, `[r].`, `#tmp.`, `pippo.`) arrivano le colonne giuste, anche per **CTE** e **tabelle temporanee** definite nel documento.
- Dopo `FROM t JOIN` propone le tabelle collegate da **foreign key** con la clausola `ON` già compilata. Le altre sono ordinate per **utilizzo reale** nel database, non in ordine alfabetico.
- Dopo `EXEC proc` propone i parametri con tipo, default e tab-stop. Dentro `INSERT ... VALUES` propone i valori di default e illumina la coppia colonna ↔ valore.
- **Mai un popup vuoto**: se lo schema non è disponibile propone comunque snippet, funzioni e keyword, e ricarica i metadati da solo.
- Se vuoi, l'**AI di DeepSeek** (opzionale) completa la query usando lo schema come contesto. Senza chiave, tutto il resto funziona lo stesso.

### ⌨️ Un editor che non ti fa combattere

- **Multi-tab** con tab figlie (fino a 5 livelli), pin, ripristino al riavvio e chiusura in blocco stile SSMS.
- **Multi-cursore** e **selezione a blocchi**: scrivi su più righe davvero, non solo in teoria.
- F5 esegue lo statement corrente o la selezione; batch `GO`, cattura dei `PRINT`, più result set.
- **Formattatore T-SQL** (Ctrl+Shift+F) idempotente, con profilo importabile/esportabile: non perde un token.
- Tema chiaro/scuro, zoom, Ctrl+Shift+R per rileggere lo schema senza riavviare.

### 📊 Risultati che si possono usare

- Griglia con numero di riga, paginazione, righe a gruppi di tre colori, colonne spostabili e copia del valore intero.
- **Generatore di statement dai risultati**: selezioni righe e colonne e ottieni `INSERT`, `UPDATE`, `MERGE`, `DELETE` o `INSERT INTO #tmp`. Nella `MERGE` la chiave è la primary key (anche composita) e **non finisce mai** nell'`UPDATE SET`.
- Ogni result set è limitato a 5.000 righe, con badge di troncamento e tempi di esecuzione.
- Tab **Stampa** con la versione pronta per la stampa di risultati e messaggi.

### 🕸️ Diagramma delle chiamate

- Tasto destro su una procedura o una funzione: vedi chi la chiama, **fino al chiamante più lontano**, oppure cosa chiama lei.
- Cicli e ricorsioni segnalati con ↻ e tratteggiati, senza far esplodere il disegno.
- Legami reali da SQL Server, comprese le chiamate scritte senza schema. Doppio clic per ricentrare, zoom, apertura della definizione in una tab.

### 🔎 Ricerca, oggetti, manutenzione

- Ricerca generale stile Redgate su **nomi, definizioni e dati**, con anteprima e match evidenziato.
- Albero oggetti SSMS-style: script `CREATE`/`DROP`/`SELECT`/`INSERT`/`UPDATE`/`DELETE`/`MERGE`, "Modifica", anteprima delle prime 30 righe, proprietà estese.
- Report utilizzo tabelle, elenco delle modifiche agli oggetti con giorno e ora, colori per database.
- Login Windows o SQL salvate, cambio database, guida in-app con 59 voci e tutte le scorciatoie.

### 🎮 Il fronzolo che non ti aspetti

- Ogni tab conta tempo di lavoro, esecuzioni ed errori, con **XP, livelli** (🥚 → 🏆), medaglie e serie di giorni. Perché passare otto ore su una `MERGE` merita almeno una medaglia.

## Dietro le quinte: la parte noiosa che rende il resto possibile

La cosa di cui vado più fiero non è una funzione: è la suite di test.

**1.522 test in 129 file**, tutti verdi. Non testano solo funzioni pure:

- leggono lo **schema vero** di un database di produzione (le 286 tabelle di cui sopra);
- esplorano il **grafo reale** delle chiamate partendo da ogni singola routine, senza limiti di profondità;
- montano la griglia in un DOM reale e **simulano il trascinamento** delle colonne;
- eseguono il provider di completamento **a ogni posizione** di diverse query, fallendo se non propone nulla o se lancia un'eccezione;
- rileggono **tutti i sorgenti** e si arrabbiano se ricompare testo con doppia codifica.

Questa noia è ciò che mi permette di modificare il motore di intellisense senza paura, e di prometterti una 1.0 che non si rompe alla prima query strana. È anche la parte che costa più tempo, e la ragione per cui il progetto ha bisogno di sostegno.

## La prossima release: la 1.0

Il progetto è già usabile, ma non è ancora "pronto per chi non compila software di mestiere". La prossima release è la **1.0**, e l'obiettivo è uno solo: farla provare a chiunque in pochi minuti.

Ecco cosa sto mettendo dentro, in ordine di priorità:

1. **Installazione senza attrito.** Oggi servono .NET 10, Node 20 e due comandi. Voglio un pacchetto Windows che scarica, avvia e apre il browser. Fine.
2. **Onboarding.** Un database demo come `DEMO_STORE` (quello degli screenshot) e un tour guidato per orientarsi nei primi cinque minuti.
3. **Export dei risultati.** Oggi si copia negli appunti; voglio CSV ed Excel fatti bene, con tipi, colonne e NULL gestiti.
4. **Documentazione allineata.** La guida in-app ha 59 voci, il README è rimasto indietro (dice 873 test, oggi sono 1.522). Voglio che raccontino la stessa cosa.
5. **Un parser T-SQL vero.** Il cantiere più ambizioso: antlr4ts + grammatica ufficiale per chiudere gli ultimi buchi di scope (CTE e tabelle derivate) senza perdere il ranking per utilizzo reale. Nel repo ho già scritto la valutazione delle alternative: la strada è tracciata.

Non ti do una data che non posso mantenere: la 1.0 esce quando l'installer funziona e i test sono verdi. Gli aggiornamenti sull'avanzamento arrivano qui su Patreon, man mano che le cose succedono.

## Perché Patreon (e a cosa servono i soldi)

Premessa onesta: **non vendo licenze**. Il codice è MIT, resta pubblico, chi vuole può clonarlo e compilarlo gratis. Non c'è un piano a pagamento che sblocca funzioni.

Patreon serve a una cosa sola: **comprare tempo**. Ogni riga di questo progetto è scritta, testata e documentata da una persona sola, con il tempo che riesco a ritagliare per il progetto. Non c'è un team, non c'è un investitore, non c'è un reparto marketing. Ci sono io, un IDE, un SQL Server di test e una lista di cose da fare che non finisce mai.

Il tuo sostegno finanzia, concretamente:

- le ore che servono per arrivare alla 1.0 (installer, onboarding, documentazione);
- l'infrastruttura per provare su più database e più versioni di SQL Server;
- la manutenzione silenziosa: sicurezza, dipendenze, regressioni. Nelle ultime settimane ho sanato una CVE transitiva in `System.Security.Cryptography.Pkcs`: non la vede nessuno, ma va fatta;
- le funzioni che la community chiede: i sostenitori sono i primi a sapere cosa bolle in pentola e a poter dire la loro sulla roadmap.

Se il progetto ti fa risparmiare anche solo mezz'ora a settimana, un caffè al mese è il modo più semplice per dirmi "continua".

## Come sostenere il progetto

👉 **[Sostieni SQL Intelligence Assistant su Patreon](https://www.patreon.com/c/alessandroevangelisti)**

Anche l'adesione gratuita aiuta: mi dice quante persone seguono il progetto e mi dà la carica per la prossima release. Se poi decidi di sostenermi con un contributo mensile, ogni euro diventa codice, test e documentazione — non pubblicità.

E se non puoi sostenere economicamente, ci sono tre cose che valgono quanto un abbonamento:

1. **Provalo e raccontami cosa si rompe.** Un bug report ben scritto vale oro.
2. **Metti una stella al repository:** [github.com/evangelalessandro/HarnessSqlComplete](https://github.com/evangelalessandro/HarnessSqlComplete).
3. **Condividi questo post** con la persona del tuo team che vive in SSMS.

## Grazie

Grazie per essere arrivato fino in fondo. Questo è il primo post di un percorso: qui racconterò cosa costruisco, i numeri, i fallimenti e le release. Se ti va di seguire il viaggio, ci sei.

Alla prossima release.
**Alessandro**

*P.S. Lo so che "SQL Intelligence Assistant" è lunghissimo. Nei commenti accetto soprannomi.*

---
---

## Appendice per la pubblicazione (da non copiare nel post)

### Titoli alternativi

1. **Ho costruito il client SQL che volevo usare. Ora mi serve una mano per la 1.0** (consigliato)
2. **Due mesi, 250 commit, 1.522 test: benvenuto su SQL Intelligence Assistant**
3. **Il client SQL che conosce il tuo database (e che ora ha bisogno di te)**

### Immagini consigliate (da caricare su Patreon)

| Posizione | File | Didascalia suggerita |
|---|---|---|
| Copertina del post | `docs/patreon-stats-card.png` | I numeri del progetto |
| Apertura / dopo "I numeri" | `docs/screenshots/02-schema-editor.png` | L'editor con lo schema reale in sidebar |
| Sezione "Cosa sa fare" / intellisense | `docs/screenshots/03-intellisense.png` | I suggerimenti conoscono tabelle e colonne |
| Sezione "Diagramma delle chiamate" | `docs/screenshots/05-diagramma-chiamate.png` | Chi chiama chi, fino al chiamante più lontano |
| Sezione "Risultati" | `docs/screenshots/04-risultati.png` | Griglia, paginazione, generatore di statement |
| Sezione "Editor" | `docs/screenshots/tab-gerarchia.png` | Tab figlie e gerarchia |

La card si rigenera con `powershell -File scripts/make-patreon-card.ps1`: se aggiorni i numeri nel post, aggiornali anche lì.

Le immagini usano `DEMO_STORE`, un database dimostrativo con nomi inventati: nessun dato reale finisce online.

### Come impaginarlo

Patreon non interpreta il Markdown: incolla il testo e riapplica titoli, grassetti e liste con la toolbar (sono una ventina di blocchi, cinque minuti). Le immagini vanno caricate dai file indicati qui sopra. La prima riga del file è il titolo del post; la riga in grassetto sotto è il sottotitolo/anteprima.

### Da personalizzare prima di pubblicare

- **Versione della release**: il post la chiama "1.0". Se la numerazione è diversa, cambiala in tutto il testo (compare 7 volte).
- **Roadmap**: i cinque punti della sezione "La prossima release" sono ricavati dal repo (installazione, onboarding, export, documentazione, parser). Se hai già una lista diversa, sostituiscila: è la parte che i sostenitori leggono con più attenzione.
- **Livelli Patreon**: il post non promette livelli né funzioni riservate, ma la pagina oggi mostra solo l'adesione gratuita. Se vuoi raccogliere contributi, crea almeno un livello a pagamento prima di pubblicare.
- **Visibilità**: pubblicalo come post pubblico, non riservato ai sostenitori: è la pagina che deve farti trovare.
- **Data e numeri**: le statistiche sono verificate al **24 ottobre 2026** (1.522 test in 129 file, 250 commit, 63 giorni). Se pubblichi più avanti, riaggiorna almeno test e commit.

### Versione breve (per i social o per la descrizione della pagina)

> Ho costruito SQL Intelligence Assistant: un client SQL nel browser con intellisense che conosce lo schema del tuo database, formattatore T-SQL, generatore di statement e diagramma delle chiamate. 63 giorni di lavoro, 250 commit, 1.522 test, licenza MIT, zero telemetria. La prossima release è la 1.0: se il progetto ti è utile, puoi sostenermi su Patreon. ❤️

### Nota sui numeri

Tutti i dati del post sono contati il 24/10/2026:

- `git log`: 250 commit, 63 giorni (22/08/2026 → 24/10/2026);
- `npm test`: 1.522 test passati in 129 file;
- sorgenti: 28.062 righe frontend + 3.460 righe backend = 31.522 righe applicative; 17.633 righe di test;
- README: 56 punti nell'elenco delle funzioni, 72 screenshot in `docs/screenshots`;
- fixture dei test: 286 tabelle, 260 funzioni (81 tabellari), 400 FK, 138 trigger, 460 vincoli CHECK, oltre 2.200 legami nel grafo;
- endpoint: 21 attributi `[Http...]` nei controller;
- guida in-app: 6 sezioni, 59 voci;
- performance: commit `e4f7c6c` (metadati da 2,6 s a 1,6 s, risposta da 3,5 MB a 358 KB).
