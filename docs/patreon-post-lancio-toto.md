# Signori si nasce. Il client SQL, modestamente, me lo sono costruito.

**SQL Intelligence Assistant: intellisense che conosce il tuo database, formattatore T-SQL, diagramma delle chiamate. 63 giorni, 250 commit, 1.522 test. E una 1.0 da portare in scena.**

---

Signore e signori, pubblico di sviluppatori, DBA e anime in pena che hanno appena visto un `MERGE` di quattrocento righe: accomodatevi.

Mi chiamo Alessandro. Sono un uomo di mondo — di quelli che, però, invece di girare il mondo girano intorno a SQL Server — e come tutti gli uomini di mondo ho un problema: passo le giornate a litigare con il contorno del SQL.

Il SQL, quello no. Il SQL è bravo. È il contorno che mi rovina la digestione: il formattatore aperto in un'altra scheda, il tool per i diagrammi, Excel che mi guarda dall'alto in basso, SSMS con venti tab aperte e la mia memoria che mi chiede: "Alessandro, ma su quale database stavi lavorando?". A prescindere, io non lo sapevo.

Così il 22 agosto ho fatto la cosa più sensata che potessi fare: ho aperto un repository vuoto e mi sono messo a costruire il client SQL che avrei voluto usare. Oggi si chiama **SQL Intelligence Assistant**, ha 250 commit e 1.522 test automatici. E questo è il primo post in cui ve lo racconto. Con tutto il rispetto, s'intende.

> **TL;DR** — un client SQL nel browser con intellisense consapevole dello schema, formattatore T-SQL, generatore di statement e diagramma delle chiamate. Open source, MIT, nessuna telemetria. La prossima release è la 1.0 e sto cercando sostegno per arrivarci. A prescindere.

---

## Atto primo — La sceneggiata

Voi lo sapete, io lo so, lo sa anche il collega che vi chiede "ma è andata?" mentre fate partire una query su produzione. La giornata tipo è questa:

- scrivete una `JOIN` e vi dovete ricordare a memoria il nome della colonna di appoggio, come se foste al tavolo di un quiz televisivo;
- riformattate a mano una procedura da quattrocento righe e pregate di non cambiare uno spazio dentro una stringa, perché poi parte il dramma;
- aprite tre strumenti diversi per capire chi chiama una stored procedure, e alla fine chiamate un collega che non lo sa nemmeno lui;
- copiate trenta righe di risultato e costruite l'`INSERT` a mano, con la paura di invertire due colonne e scrivere nella tabella sbagliata. E poi? E poi sono dolori;
- perdete una tab tra le venti aperte e non sapete più su quale database state lavorando. A prescindere.

Siamo uomini o caporali? Siamo sviluppatori o copiatori di query? La differenza tra un editor e un buon editor sta tutta in una parola: **contesto**. Le vostre tabelle, le vostre foreign key, le vostre procedure, i vostri alias. E gli strumenti che usiamo, di solito, il contesto non lo conoscono. Ma mi faccia il piacere!

## Atto secondo — Il colpo di genio

L'idea è semplice, e come tutte le idee semplici è geniale soprattutto perché non l'ha avuta nessun altro prima di me. (Modestamente.)

Un client SQL che gira **nel browser** e parla con **SQL Server**, usando lo schema reale come contesto: backend ASP.NET Core su .NET 10, frontend React 19 + TypeScript, Monaco Editor in bundle locale (niente CDN), SQLite per le login salvate.

Le credenziali restano sulla vostra macchina, cifrate con DPAPI; le connection string delle sessioni vivono solo in memoria e non tornano mai al client. Senza l'AI opzionale, lo schema non esce di casa. Licenza MIT, codice pubblico su GitHub. E non ho cercato di clonare SSMS: ho cercato di togliere l'attrito. Clonare SSMS, signori, è come rifare la copia di un quadro: viene male e ci si sporca.

È pensato per chi scrive T-SQL di mestiere: sviluppatori, DBA, consulenti che entrano in database che non hanno scritto e hanno bisogno di capirli in fretta. Non serve installare niente sul server: l'app gira sulla vostra macchina e si connette come farebbe SSMS — solo con più educazione.

## Atto terzo — I numeri, quelli veri

Non sono stime da osteria: li ho contati nel repository, nei test e nel database su cui sviluppo. Signori, i numeri:

- 🗓️ **63 giorni** di sviluppo e **250 commit**
- 💻 **31.500 righe** di codice applicativo e **17.600 righe** di test
- ✅ **1.522 test** automatici, tutti verdi, in **129 file**
- 🔌 **21 endpoint** REST e **25 componenti** React
- 🖼️ **72 screenshot** e **56 funzioni** documentate
- 🗄️ test su uno schema reale di **286 tabelle**, **260 funzioni** (di cui 81 tabellari), **400 foreign key**, **138 trigger** e **460 vincoli CHECK**
- 🕸️ **2.200+ legami** nel grafo delle chiamate, verificati partendo da **ogni** routine del database
- ⚡ metadati in **1,6 s** invece di 2,6 s, risposta da **358 KB** invece di 3,5 MB
- 📵 **zero telemetria**: nessuno vi guarda. A prescindere

Ammazza, direte voi. E avete ragione. **1.522 test** non sono un numero da post su Patreon: sono la ragione per cui posso toccare il motore di intellisense senza rompere tutto il resto. Non testano solo funzioni pure: leggono lo schema vero di un database di produzione, esplorano il grafo delle chiamate da ogni routine, montano la griglia in un DOM reale, simulano il trascinamento delle colonne, eseguono il provider di completamento a ogni posizione di una query. C'è pure un test che rilegge tutti i sorgenti e si arrabbia se ricompare testo con doppia codifica.

Questa è la parte noiosa che vi salva la vita. E siccome è noiosa, nessuno la vede — ma io la faccio lo stesso. Ho detto tutto.

## Atto quarto — Il gioiellino

### 🧠 L'intellisense che conosce il vostro database

- Dopo `FROM`/`JOIN` propone tabelle, viste e **funzioni tabellari**; dopo `EXEC` solo stored procedure; nella select-list e in `WHERE`/`ON`/`GROUP BY`/`ORDER BY` solo colonne e funzioni.
- Dopo un alias (`r.`, `[r].`, `#tmp.`, `pippo.`) arrivano le colonne giuste, anche per **CTE** e **tabelle temporanee** definite nel documento.
- Dopo `FROM t JOIN` propone le tabelle collegate da **foreign key** con la clausola `ON` già compilata. Le altre le ordina per **utilizzo reale**, non in ordine alfabetico. Perché l'ordine alfabetico va bene per l'elenco del telefono, non per i JOIN.
- Dopo `EXEC proc` propone i parametri con tipo, default e tab-stop. Dentro `INSERT ... VALUES` propone i valori di default e illumina la coppia colonna ↔ valore.
- **Mai un popup vuoto**: se lo schema non c'è, propone snippet, funzioni e keyword, e si ricarica da solo. Come un cameriere che, se manca il vino, vi porta comunque l'acqua.
- Se volete, l'**AI di DeepSeek** (opzionale) completa la query usando lo schema come contesto. Senza chiave, tutto il resto funziona lo stesso. Non è che senza AI il programma muore: mica siamo in un film di fantascienza.

### ⌨️ L'editor che non vi fa combattere

- **Multi-tab** con tab figlie (fino a cinque livelli), pin, ripristino al riavvio e chiusura in blocco stile SSMS. Le tab appuntate non si chiudono: sono come i parenti, le tenete lì e non le toccate.
- **Multi-cursore** e **selezione a blocchi**: scrivete su più righe davvero, non solo in teoria.
- F5 esegue lo statement corrente o la selezione; batch `GO`, cattura dei `PRINT`, più result set.
- **Formattatore T-SQL** (Ctrl+Shift+F) idempotente, con profilo importabile/esportabile: non perde un token. Uno spazio sì, ma un token no.
- Tema chiaro/scuro, zoom e Ctrl+Shift+R per rileggere lo schema senza riavviare: il tasto del panico, ma con dignità.

### 📊 I risultati che si possono usare

- Griglia con numero di riga, paginazione, righe a gruppi di tre colori, colonne spostabili e copia del valore intero.
- **Generatore di statement dai risultati**: selezionate righe e colonne e ottenete `INSERT`, `UPDATE`, `MERGE`, `DELETE` o `INSERT INTO #tmp`. Nella `MERGE` la chiave è la primary key (anche composita) e **non finisce mai** nell'`UPDATE SET`. A prescindere. Questa è poesia.
- Ogni result set è limitato a 5.000 righe, con badge di troncamento e tempi di esecuzione.
- Tab **Stampa** con la versione pronta per la stampa di risultati e messaggi. Perché il capo vuole sempre il foglio.

### 🕸️ Il diagramma delle chiamate

- Tasto destro su una procedura o una funzione: vedete chi la chiama, **fino al chiamante più lontano**, oppure cosa chiama lei.
- Cicli e ricorsioni segnalati con ↻ e tratteggiati, senza far esplodere il disegno. Come l'albero genealogico, ma senza zii che chiedono soldi.
- Legami reali da SQL Server, comprese le chiamate scritte senza schema. Doppio clic per ricentrare, zoom, apertura della definizione in una tab.

### 🔎 Ricerca, oggetti, manutenzione

- Ricerca generale stile Redgate su **nomi, definizioni e dati**, con anteprima e match evidenziato.
- Albero oggetti SSMS-style: script `CREATE`/`DROP`/`SELECT`/`INSERT`/`UPDATE`/`DELETE`/`MERGE`, "Modifica", anteprima delle prime 30 righe, proprietà estese.
- Report utilizzo tabelle, elenco delle modifiche agli oggetti con giorno e ora, colori per database.
- Login Windows o SQL salvate, cambio database, guida in-app con 59 voci e tutte le scorciatoie.

### 🎮 Il fronzolo che non ti aspetti

- Ogni tab conta tempo di lavoro, esecuzioni ed errori, con **XP, livelli** (🥚 → 🏆), medaglie e serie di giorni. Perché passare otto ore su una `MERGE` merita almeno una medaglia. E se non ve la danno, ve la date da soli.

## Atto quinto — La prossima release: la 1.0

La commedia non è finita. Il progetto è usabile, ma non è ancora "pronto per chi non compila software di mestiere". La prossima release è la **1.0**, e l'obiettivo è uno solo: farla provare a chiunque in pochi minuti.

Ecco cosa sto mettendo dentro, in ordine di priorità:

1. **Installazione senza attrito.** Oggi servono .NET 10, Node 20 e due comandi. Voglio un pacchetto Windows che scarica, avvia e apre il browser. Fine. Come il caffè: uno, e basta.
2. **Onboarding.** Un database demo come `DEMO_STORE` (quello degli screenshot) e un tour guidato per orientarsi nei primi cinque minuti. Perché nessuno nasce imparato, e nemmeno io.
3. **Export dei risultati.** Oggi si copia negli appunti; voglio CSV ed Excel fatti bene, con tipi, colonne e NULL gestiti. I NULL gestiti, signori. Non "a prescindere".
4. **Documentazione allineata.** La guida in-app ha 59 voci, il README è rimasto indietro (dice 873 test, oggi sono 1.522). Voglio che raccontino la stessa cosa. Altrimenti che figura ci facciamo?
5. **Un parser T-SQL vero.** Il cantiere più ambizioso: antlr4ts + grammatica ufficiale per chiudere gli ultimi buchi di scope (CTE e tabelle derivate) senza perdere il ranking per utilizzo reale. Nel repo ho già scritto la valutazione delle alternative: la strada è tracciata.

Non vi do una data che non posso mantenere: la 1.0 esce quando l'installer funziona e i test sono verdi. A prescindere dalle promesse.

## Atto sesto — La questua (con dignità)

E ora la parte che tutti aspettavano: il cappello. Ma non abbiate paura: **non vendo licenze**. Il codice è MIT, resta pubblico, chi vuole se lo compila. Non c'è un piano a pagamento che sblocca funzioni. E io pago! (cit.)

Patreon serve a una cosa sola: **comprare tempo**. Ogni riga di questo progetto è scritta, testata e documentata da una persona sola, con il tempo che riesco a ritagliare. Non c'è un team, non c'è un investitore, non c'è un reparto marketing. Ci sono io, un IDE, un SQL Server di test e una lista di cose da fare che non finisce mai. Come la lista della spesa di mia nonna: sembra finita, e poi c'è sempre il pane.

Il vostro sostegno finanzia, concretamente:

- le ore che servono per arrivare alla 1.0 (installer, onboarding, documentazione);
- l'infrastruttura per provare su più database e più versioni di SQL Server;
- la manutenzione silenziosa: sicurezza, dipendenze, regressioni. Nelle ultime settimane ho sanato una CVE transitiva in `System.Security.Cryptography.Pkcs`: non la vede nessuno, ma va fatta. E io pago! (stavolta io, non voi);
- le funzioni che la community chiede: i sostenitori sono i primi a sapere cosa bolle in pentola e a poter dire la loro sulla roadmap.

Se il progetto vi fa risparmiare anche solo mezz'ora a settimana, un caffè al mese è il modo più semplice per dirmi "continua". Se non potete, non fa niente: ci sono tre cose che valgono quanto un abbonamento:

1. **Provatelo e raccontatemi cosa si rompe.** Un bug report ben scritto vale oro.
2. **Mettete una stella al repository:** [github.com/evangelalessandro/HarnessSqlComplete](https://github.com/evangelalessandro/HarnessSqlComplete).
3. **Condividete questo post** con la persona del vostro team che vive in SSMS. Sì, quella. La conoscete.

## Agli ordini!

👉 **[Sostenete SQL Intelligence Assistant su Patreon](https://www.patreon.com/c/alessandroevangelisti)**

Anche l'adesione gratuita aiuta: mi dice quante persone seguono il progetto e mi dà la carica per la prossima release. Se poi decidete di sostenermi con un contributo mensile, ogni euro diventa codice, test e documentazione — non pubblicità.

## Sipario

Grazie per essere arrivati fino in fondo. Questo è il primo post di un percorso: qui racconterò cosa costruisco, i numeri, i fallimenti e le release. Se vi va di seguire il viaggio, ci siete.

Alla prossima release. E che il Signore vi conservi il backup.

**Alessandro**

*P.S. Signori si nasce. Io, modestamente, lo nacqui. Il client SQL, invece, me lo sono dovuto costruire.*

---
---

## Appendice per la pubblicazione (da non copiare nel post)

### Titoli alternativi

1. **Signori si nasce. Il client SQL, modestamente, me lo sono costruito.** (consigliato)
2. **A prescindere, il client SQL che volevo usare l'ho costruito io**
3. **Ma mi faccia il piacere: un client SQL che conosce il tuo database**

### Immagini consigliate

| Posizione | File | Didascalia |
|---|---|---|
| Copertina | `docs/patreon-stats-card.png` | I numeri del progetto |
| Apertura / dopo i numeri | `docs/screenshots/02-schema-editor.png` | L'editor con lo schema reale in sidebar |
| Atto quarto / intellisense | `docs/screenshots/03-intellisense.png` | I suggerimenti conoscono tabelle e colonne |
| Atto quarto / diagramma | `docs/screenshots/05-diagramma-chiamate.png` | Chi chiama chi, fino al chiamante più lontano |
| Atto quarto / risultati | `docs/screenshots/04-risultati.png` | Griglia, paginazione, generatore di statement |
| Atto quarto / editor | `docs/screenshots/tab-gerarchia.png` | Tab figlie e gerarchia |

La card si rigenera con `powershell -File scripts/make-patreon-card.ps1`.

### Da personalizzare

- **Versione**: il post parla di "1.0". Se la numerazione è diversa, cambiala ovunque.
- **Roadmap**: i cinque punti dell'Atto quinto sono ricavati dal repo (installer, onboarding, export, documentazione, parser). Se hai una lista tua, mettila lì: è la parte che i sostenitori leggono davvero.
- **Patreon**: la pagina oggi mostra solo l'adesione gratuita. Se vuoi raccogliere contributi, crea almeno un livello a pagamento prima di pubblicare.
- **Visibilità**: pubblicalo come post pubblico, non riservato ai sostenitori.
- **Numeri**: verificati al 24 ottobre 2026 (1.522 test in 129 file, 250 commit, 63 giorni). Se pubblichi dopo, riaggiorna almeno test e commit.

### Nota sul tono

Il post è una sceneggiata in sei atti, con citazioni totosiane sparse (a prescindere, siamo uomini o caporali, ma mi faccia il piacere, e io pago, agli ordini, signori si nasce). Se qualche battuta non ti convince, si toglie senza toccare i contenuti: i numeri e le funzioni restano quelli veri.

### Versione breve (social o descrizione della pagina)

> Signori si nasce. Il client SQL, modestamente, me lo sono costruito: intellisense che conosce lo schema, formattatore T-SQL, diagramma delle chiamate. 63 giorni, 250 commit, 1.522 test, licenza MIT, zero telemetria. La prossima release è la 1.0: se vi è utile, sostenetemi su Patreon. A prescindere. ❤️
