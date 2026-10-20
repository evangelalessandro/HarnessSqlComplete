import type { ReactNode } from 'react'
import { Database, FileCode2, Keyboard, Lightbulb, Play, Table2 } from 'lucide-react'

export interface HelpItem {
  title: string
  detail: string
}

export interface HelpSection {
  id: string
  title: string
  icon: ReactNode
  items: HelpItem[]
}

/** Contenuto della guida: separato dal componente per renderlo testabile. */
export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'connessione',
    title: 'Connessione al database',
    icon: <Database className="h-4 w-4 text-sky-400" />,
    items: [
      {
        title: 'Login',
        detail:
          'Inserisci server, porta, database e credenziali (Windows o SQL auth). Le login salvate restano nel browser (password criptata con DPAPI) e si riusano al prossimo avvio.',
      },
      {
        title: 'Cambio database',
        detail:
          'Dalla combo in alto o cliccando un database nella sidebar: ogni tab dell\u2019editor resta legata al proprio database (bordo colorato).',
      },
      {
        title: 'Aggiorna schema',
        detail:
          'Il pulsante "Aggiorna schema" in alto (o Ctrl+Shift+R, come il Refresh di SSMS) rilegge tabelle, colonne, viste e routine dal database: serve dopo aver creato o modificato oggetti altrove, perché l\u2019intellisense e l\u2019albero laterale usino subito la versione nuova.',
      },
      {
        title: 'Colori per database',
        detail:
          'Tasto destro su un database nella sidebar → scegli un colore personalizzato (persistito). Il colore viene usato per la combo e il bordo delle tab.',
      },
    ],
  },
  {
    id: 'editor',
    title: 'Editor SQL',
    icon: <FileCode2 className="h-4 w-4 text-emerald-400" />,
    items: [
      {
        title: 'Multi-tab',
        detail:
          'Apri più query in tab separate: trascina per riordinarle, clicca la puntina per appuntarle (non chiudibili, restano in testa), chiudi con la X. Le tab vengono ripristinate al riavvio. Riaprendo una tab il cursore resta dov\'era (posizione e scorrimento sono ricordati per ogni tab), quindi non si torna mai all\'inizio del testo per sbaglio. Con l\'icona nota (o tasto destro → "Icona / titolo / descrizione…") puoi dare a ogni tab un simbolo/emoji (⭐ 🐞 ⚠️ …) che resta visibile nella barra.',
      },
      {
        title: 'Tante tab? Tasto destro e "»"',
        detail:
          'Tasto destro su una tab per chiudere in blocco come in SSMS: tutte le altre, quelle a destra, quelle a sinistra, o tutte le non appuntate (le appuntate sono protette). Le tab riempiono la riga e poi vanno a capo: ogni gruppo di figlie occupa la riga sotto la propria madre. Se le righe necessarie superano lo spazio disponibile compare il pulsante "»" che elenca tutte le tab aperte.',
      },
      {
        title: 'Dove si aprono le nuove tab',
        detail:
          'Il pulsante "Nuova" apre la query a destra, subito dopo quella attiva. Per aprirla come PRIMA tab, cioè a sinistra, tieni premuto Shift mentre clicchi (oppure clicca col tasto centrale del mouse). Un oggetto aperto da un link o da "Modifica" nasce invece FIGLIA della tab attiva: va a capo su una riga sotto la madre, rientrata e con una freccia come marcatore, fino a 5 livelli. Trascinando una tab fuori dal suo gruppo la si stacca e torna principale.',
      },
      {
        title: 'Esegui query',
        detail:
          'F5 o Ctrl+Invio esegue lo statement corrente. Supporta più batch separati da GO, cattura i PRINT e mostra più result set (limite 5000 righe per griglia).',
      },
      {
        title: 'File SQL',
        detail:
          'Trascina file .sql nell\u2019app o usa "Apri file" per aprirli in tab. "Salva" (Ctrl+S) sovrascrive l\u2019originale se aperto dal disco, "Salva con nome" (Ctrl+Shift+S) sceglie dove salvarlo.',
      },
      {
        title: 'Zoom e tema',
        detail:
          'Ctrl+rotella del mouse (o i pulsanti +/−) per ingrandire il testo. Il pulsante sole/luna alterna tema scuro e chiaro applicato a tutta la pagina.',
      },
      {
        title: 'Formatta',
        detail:
          'Ctrl+Shift+F formatta il SQL secondo il profilo T-SQL attivo (default: stile Redgate/SQL Prompt). Il pulsante ingranaggio (⚙) apre le impostazioni di formattazione: modifica le opzioni, importa un file formatprofile.xml o esporta il profilo corrente.',
      },
    ],
  },
  {
    id: 'sidebar',
    title: 'Sidebar (albero oggetti)',
    icon: <Table2 className="h-4 w-4 text-sky-400" />,
    items: [
      {
        title: 'Struttura stile SSMS',
        detail:
          'Database in alto, poi Tabelle (raggruppate per prefisso, con Colonne e Trigger annidati), Viste e Programmabilità (Stored Procedure, Funzioni, Trigger orfani).',
      },
      {
        title: 'Click su un oggetto',
        detail:
          'Inserisce il nome qualificato nel editor alla posizione del cursore. Passare sopra una tabella mostra le proprietà e l\u2019anteprima dati.',
      },
      {
        title: 'Tasto destro su un oggetto',
        detail:
          'Menu contestuale stile SSMS: per le tabelle "Seleziona le prime 1000 righe" e gli script per ogni operazione (Script CREATE, Script DROP, Script SELECT, Script INSERT, Script UPDATE, Script DELETE, Script MERGE); per procedure/funzioni/viste/trigger "Modifica" (CREATE OR ALTER), "Script …" (CREATE, CREATE OR ALTER, DROP, EXECUTE con i parametri) e "Diagramma chiamate".',
      },
      {
        title: 'Diagramma chiamate',
        detail:
          'Tasto destro su una stored procedure o una funzione → "Diagramma chiamate": il diagramma si apre in una TAB (icona 📈, una per routine: riaprendo lo stesso diagramma si torna su quella, e resta com\u2019è anche passando da un\u2019altra tab). Mostra i legami con le altre routine, salendo fino al chiamante più lontano (o scendendo verso quello che chiama). I cicli e le routine ricorsive sono segnalati con ↻ invece di bloccare il disegno. Clic su una routine per i dettagli, doppio clic per ricentrare il diagramma, e da lì si apre la definizione in una nuova tab.',
      },
      {
        title: 'Cerca',
        detail:
          'Il campo in alto cerca tabelle, viste, procedure, funzioni e trigger: gli spazi valgono come % (es. "dat udc" trova DAT_UDC).',
      },
      {
        title: 'Eliminare una colonna senza errori',
        detail:
          'Con "ALTER TABLE t DROP COLUMN " il popup propone, oltre alle colonne, uno snippet "DROP COLUMN sicuro": sostituisce lo statement con uno script che controlla che la colonna esista ancora (IF EXISTS su sys.columns), toglie prima i vincoli collegati (DEFAULT/CHECK sulla colonna, CHECK di tabella che la citano, chiavi esterne uscenti, PK/UNIQUE fatte sulla sola colonna), elimina la colonna e segnala con una PRINT le chiavi esterne di ALTRE tabelle che puntano lì (quelle vanno sistemate a mano). Nelle colonne proposte, il dettaglio dice già quali vincoli sono collegati (es. "vincoli collegati: CK_…, FK_…, PK_…").',
      },
      {
        title: 'Modifiche agli oggetti (chi, quando)',
        detail:
          'In fondo al pannello Database (o tasto destro sul database → "Modifiche agli oggetti…") c\u2019è la finestra con la GRIGLIA delle modifiche: ogni riga è un oggetto del database attivo (stored procedure, funzioni, viste, tabelle, trigger) con il giorno e l\u2019ORA dell\u2019ultima modifica e della creazione, più la colonna "Quando" in italiano ("ora", "5 minuti fa", "2 giorni fa"). Si ordina cliccando un\u2019intestazione (all\u2019apertura: dalla modifica più recente), si filtra per nome, per tipo (Store, Funzioni, Viste, Tabelle, Trigger, con il conteggio) e per periodo (ultime 24 ore, 7 o 30 giorni). Le date sono quelle registrate da SQL Server: per ogni oggetto c\u2019è SOLO l\u2019ultima modifica, non lo storico di tutte le modifiche. Doppio clic su una riga per aprire l\u2019oggetto e modificarlo (CREATE OR ALTER); il pulsante con la freccia ricarica l\u2019elenco.',
      },
      {
        title: 'Pannello dei risultati',
        detail:
          'Ctrl+R (o Cmd+R) nasconde/mostra il pannello dei risultati della TAB ATTIVA: la scelta resta legata a quella tab, quindi nascondendolo in una non sparisce nelle altre, e tornando sulla tab lo ritrovi come l\u2019avevi lasciato. Eseguendo una query il pannello ricompare da solo in quella tab. Nelle tab di RICERCA e nei DIAGRAMMI il pannello dei risultati non c\u2019\u00e8: l\u00ec lo spazio \u00e8 tutto del pannello.',
      },
      {
        title: 'Ricerca generale (stile Redgate SQL Search)',        detail:
          'Pulsante "Cerca" in alto: la ricerca si apre in una TAB (icona 🔎, una sola: riaprendola si torna su quella, e i risultati restano anche passando da un\u2019altra tab). Ricorda le ULTIME 10 parole cercate: il pulsante con l\u2019orologio le elenca (clic per ripetere la ricerca, × per toglierne una, "Svuota la cronologia" per azzerarle) e con le frecce su/giù nella casella si ripescano al volo (restano anche chiudendo l\u2019app). Cerca un testo qualunque nei NOMI e nelle DEFINIZIONI delle strutture (tabelle, viste, procedure, funzioni, trigger, vincoli CHECK/DEFAULT, colonne calcolate) e, spuntando "anche nei dati", anche nei VALORI delle colonne di testo delle tabelle. I risultati stanno sopra e l\u2019ANTEPRIMA sotto: per le routine compare lo script con il match evidenziato e la riga trovata, per le colonne la tabella con la colonna in evidenza, per i dati la riga trovata. Da un risultato si può MODIFICARE l\u2019oggetto (pulsante "Modifica" o doppio clic o tasto destro → menu): si apre CREATE OR ALTER in una nuova tab, figlia di quella attiva, come dal tasto destro nell\u2019albero; c\u2019è anche "Diagramma chiamate". La ricerca resta dentro il database attivo; la scansione dei dati è limitata (tabelle, tempo e righe per tabella) per non appesantire il database, e il riepilogo dice quante tabelle sono state lette.',
      },
    ],
  },
  {
    id: 'intellisense',
    title: 'Intellisense e autocompletamento',
    icon: <Lightbulb className="h-4 w-4 text-amber-400" />,
    items: [
      {
        title: 'Contesti intelligenti',
        detail:
          'I suggerimenti dipendono dalla posizione: dopo FROM/JOIN solo tabelle e viste, dopo EXEC solo stored procedure, nella select-list e in WHERE/ON/GROUP/ORDER solo colonne e funzioni, dopo un alias (r.) le colonne qualificate di quella tabella. Nella ORDER BY le direzioni ASC/DESC compaiono solo dopo aver scelto il campo.',
      },
      {
        title: 'Nomi dei DATABASE',
        detail:
          'Dopo "USE " il popup propone solo i database del server (quello corrente e gli altri), e in posizione di tabella (FROM/JOIN/INTO/UPDATE) i database compaiono in coda alle tabelle dello schema: servono per scrivere nomi in tre parti come "[WSBASE].dbo.Tabella". I nomi con spazi vengono inseriti fra parentesi quadre.',
      },
      {
        title: 'Abilitare o disabilitare un trigger',
        detail:
          'Le direttive sui trigger si scrivono con l\u2019intellisense: digitando "DIS" (o "ENA") a inizio statement esce lo snippet "DISABLE TRIGGER <trigger> ON <tabella>" (e la variante ALL), e dopo "DISABLE " la parola TRIGGER. Dopo il nome del trigger il popup propone "ON <tabella>" con la tabella SU CUI quel trigger è definito, e dopo ON propone solo le tabelle giuste (più DATABASE / ALL SERVER / ALL): così non si scrivono istruzioni che SQL Server rifiuta, come "DISABLE TRIGGER tr_X ON <altra tabella>". Anche la forma "ALTER TABLE t DISABLE TRIGGER " propone i trigger di quella tabella.',
      },
      {
        title: 'Parametri e variabili della routine che stai modificando',
        detail:
          'Mentre modifichi una stored procedure o una funzione (CREATE OR ALTER), scrivendo "@" l\u2019intellisense propone i PARAMETRI della firma (con il tipo, es. "nvarchar(255) · parametro della routine") INSIEME alle variabili dichiarate nel corpo (DECLARE): funziona con i parametri fra parentesi o senza, su più righe, con i valori di default, con lo stile "@param as tipo" e anche quando fra i parametri ci sono commenti (es. "/* da usare as default */"). Le voci si filtrano digitando parte del nome (@mI → @mId).',
      },
      {
        title: 'Scrivere su più righe',
        detail:
          'Due modi, come in SSMS/Visual Studio. 1) PIÙ CURSORI: Maiusc+Alt+Giù (o Maiusc+Alt+Su) aggiunge un cursore alla riga sotto/sopra, Alt+clic ne aggiunge uno dove clicchi, Ctrl+D seleziona l\u2019occorrenza successiva: quello che scrivi finisce su TUTTI i cursori, e incollando più righe il testo si distribuisce su un cursore per riga. (Ctrl+Alt+Su/Giù non fa più nulla: su Windows Ctrl+Alt è AltGr, la combinazione del multi cursore è Maiusc+Alt.) 2) SELEZIONE A BLOCCHI (pulsante "Scrittura su più righe" in alto, oppure Alt+C): trascinando col mouse si seleziona un RETTANGOLO di testo e quello che scrivi va su tutte le righe selezionate, nella stessa colonna; la scelta resta salvata anche dopo il riavvio. Per copiare una riga sotto usa Ctrl+C / Ctrl+V.',
      },
      {
        title: 'Alias delle tabelle',
        detail:
          'Dando un alias a una tabella, scrivendo "alias." vengono proposti i suoi campi (anche nella select-list): vale anche per le tabelle temporanee (#tmp.) e per le CTE definite nel documento ("with c as (...) select * from c pippo where pippo."), anche con le parentesi quadre ([pippo].). Se l\u2019alias \u00e8 quello di una FUNZIONE TABELLARE ("select * from dbo.fn_x() a where a.") arrivano i campi che la funzione restituisce.',
      },
      {
        title: 'Label di GOTO',
        detail:
          'Dopo "GOTO " vengono proposte tutte le label del documento, comprese quelle definite più sotto (il caso normale: si salta a "lblExit:" scritta in fondo). Quelle dentro il codice commentato vengono ignorate.',
      },
      {
        title: 'Affinità mentre digiti',
        detail:
          'Digitando mis_corr vengono proposti in testa i campi più simili (mis_d_corridoio, mis_s_corridoio) grazie al matching per token.',
      },
      {
        title: 'JOIN intelligenti',
        detail:
          'Dopo "FROM t JOIN " vengono proposte le tabelle collegate da FK con la clausola ON già compilata (una voce per vincolo FK, con parentesi come nelle SP reali). Se la query usa alias, il JOIN viene generato con alias brevi (es. MAG_CELLE AS mc).',
      },
      {
        title: 'Controparti e condizioni',
        detail:
          'Scrivendo "mis_d_cella = " il completamento propone la controparte cel_cella (FK esatte o token condivisi). Dentro una clausola ON con già una condizione, propone le altre coppie dello stesso vincolo (es. AND MIS_D_CELLA = CEL_CELLA).',
      },
      {
        title: 'Snippet statement',
        detail:
          'A inizio statement, digitando ins/sel/upd/del/mer propone il template completo con tab-stop (INSERT/SELECT/UPDATE/DELETE/MERGE).',
      },
      {
        title: 'EXEC',
        detail:
          'Dopo "EXEC nome_proc" suggerisce i parametri (IN con tab-stop e default se noti, OUTPUT marcati). Dal menu contestuale "Esegui" genera EXEC con i valori di default reali.',
      },
      {
        title: 'INSERT',
        detail:
          'Dentro "INSERT INTO tab (" suggerisce le colonne (con "tutte le colonne"); dentro i VALUES suggerisce i valori di default per la colonna corrente, con evidenziazione della coppia colonna↔valore.',
      },
      {
        title: 'Campo corrispondente',
        detail:
          'Con il cursore su un campo si illumina quello abbinato: colonna ↔ valore negli INSERT, colonna ↔ espressione nella SET di un UPDATE e, in una MERGE, i valori della USING ↔ le colonne di src, le coppie "a = b" della SET (ramo MATCHED) e della ON, e colonne ↔ valori dell INSERT del ramo NOT MATCHED.',
      },
      {
        title: 'Cronologia',
        detail:
          'Le tabelle e colonne che usi di frequente nelle query eseguite pesano di più nel ranking dei suggerimenti.',
      },
      {
        title: 'Errori: vai alla riga',
        detail:
          'Doppio clic su un messaggio di errore (o sulla barra rossa): il cursore va sulla riga indicata da SQL Server. Se l\'errore arriva da una procedura, la riga viene riportata sulla definizione aperta nella tab ("Procedura X, Riga 64" con la CREATE alla riga 101 → riga 164).',
      },
      {
        title: 'Diagnostica in tempo reale',
        detail:
          'Parentesi o apici non bilanciati e colonne qualificate inesistenti vengono sottolineati mentre scrivi (senza eseguire la query).',
      },
      {
        title: 'Autocompletamento IA',
        detail:
          'Con il toggle "Autocompletamento IA" attivo, l\u2019intellisense suggerisce il proseguimento della query (DeepSeek) dopo una breve pausa di digitazione.',
      },
    ],
  },
  {
    id: 'risultati',
    title: 'Risultati e anteprime',
    icon: <Play className="h-4 w-4 text-emerald-400" />,
    items: [
      {
        title: 'Griglia risultati',
        detail:
          'Ogni result set appare in una tabella con le colonne tipizzate. Le celle si possono selezionare e copiare; in alto il conteggio righe e il tempo di esecuzione. Il numero di riga sta nella prima colonna (insieme alla casella di selezione resta fisso a sinistra mentre si scorre), le colonne sono separate da una linea verticale e le righe hanno tre colori alternati. Trascinando l\'intestazione di una colonna la si può spostare: cambia solo la vista, mentre selezione e SQL generato seguono l\'ordine originale.',
      },
      {
        title: 'Stampa',
        detail:
          'La tab "Stampa" mostra una versione pronta per la stampa dei risultati (griglia e messaggi), con pulsante di stampa del browser.',
      },
      {
        title: 'Errori: quale procedura ha fallito e apri l oggetto',
        detail:
          'Se la query dà errore, il risultato si apre sui MESSAGGI (come in SSMS) anche quando restituisce delle righe: l\'errore si vede per primo, i risultati restano nella loro tab a un clic. Ogni errore riporta numero, livello, stato, la PROCEDURA che lo ha sollevato e la riga (es. "Msg 50000, Livello 16, Stato 1 · Procedura ws_X · Riga 42"). Sotto il messaggio compaiono i pulsanti degli oggetti CITATI nell\'errore (es. "Invalid object name \'dbo.X\'"): "Modifica" apre la definizione CREATE OR ALTER di procedure, funzioni, viste e trigger, "Apri CREATE" lo script della tabella; per la procedura che ha fallito il pulsante dice anche la riga e aprendola il cursore va DIRETTAMENTE su quella riga. Solo gli oggetti che esistono davvero hanno il pulsante.',
      },
      {
        title: 'Anteprima tabelle',
        detail:
          'Passando sopra una tabella nella sidebar (o usando il menu contestuale "Seleziona le prime 1000 righe") si apre una query di anteprima dati.',
      },
      {
        title: 'Generatore SQL e MERGE senza campi chiave',
        detail:
          'Nell\u2019anteprima dati (F4 su una tabella) o nei risultati di una query si selezionano righe e colonne e si genera INSERT, UPDATE, MERGE, DELETE o INSERT INTO #tmp. Nella MERGE la condizione ON usa la CHIAVE della tabella — le colonne della PRIMARY KEY, anche composita — e i campi chiave NON vengono mai messi nell\u2019UPDATE SET: restano solo nella ON e nell\u2019INSERT, perché sono già uguali e spesso sono identity o calcolati (SQL Server non li lascerebbe aggiornare). Se la chiave copre tutte le colonne selezionate, la clausola "WHEN MATCHED THEN UPDATE" non viene scritta affatto, con un commento che lo spiega. Anche lo "Script MERGE" del tasto destro su una tabella segue la stessa regola.',
      },
    ],
  },
  {
    id: 'scorciatoie',
    title: 'Scorciatoie da tastiera',
    icon: <Keyboard className="h-4 w-4 text-zinc-300" />,
    items: [
      { title: 'F5 / Ctrl+Invio', detail: 'Esegue la query corrente.' },
      { title: 'Ctrl+S', detail: 'Salva (sovrascrive l\u2019originale se aperto da file).' },
      { title: 'Ctrl+Shift+S', detail: 'Salva con nome.' },
      { title: 'Ctrl+Shift+F', detail: 'Formatta il SQL con il profilo attivo.' },
      { title: 'Ctrl+Shift+R', detail: 'Aggiorna lo schema (tabelle, colonne, viste e routine) rileggendolo dal database, come il Refresh di SSMS.' },
      { title: 'Ctrl+R', detail: 'Mostra/nasconde il pannello dei risultati.' },
      { title: 'Ctrl+U', detail: 'Rende MAIUSCOLA la selezione (con più cursori vale per tutte le selezioni; senza selezione, la parola sotto il cursore). Ctrl+Shift+U lo stesso, come in SSMS; Ctrl+Shift+L rende minuscolo.' },
      { title: 'Invio dopo la virgola', detail: 'La virgola va IN TESTA alla riga nuova, già incolonnata sotto il primo campo (stile del progetto): un campo per riga senza cancellare e ridigitare la virgola. Si spegne da ⚙ Impostazioni di formattazione → "Virgola a capo automatica".' },
      { title: 'Alt+P / pulsante Anteprima', detail: 'Anteprima delle modifiche: su un UPDATE o un DELETE mostra nel pannello dei risultati le righe che verrebbero toccate, usando la STESSA FROM/JOIN/WHERE dello statement. Nulla viene modificato: serve a scoprire subito un filtro sbagliato.' },
      { title: 'Shift+Alt+I / multi-cursore a colonna', detail: 'Seleziona più righe e premi Shift+Alt+I: mette un cursore a fine di ogni riga. Digitando, le righe più corte (tipicamente quelle vuote in mezzo) vengono RIEMPITE DI SPAZI fino alla colonna delle altre, così il testo resta allineato. E premendo Invio, ogni riga nuova nasce già col rientro della sua riga (le righe vuote prendono il rientro delle altre righe del blocco): è il comportamento di SSMS, che Monaco non ha di default.' },
      { title: 'Pulsanti Annulla / Ripeti', detail: 'Nella barra della tab ci sono due pulsanti (icone ↶ e ↷) che annullano o ripetono le modifiche; sono attivi solo quando c\u2019è qualcosa da annullare o da ripetere. Le stesse azioni da tastiera: Ctrl+Z per annullare, Ctrl+Y (o Ctrl+Shift+Z) per ripetere.' },
      { title: 'Tasto destro su una cella dei risultati', detail: 'Menu con "Copia valore" (il valore INTERO, anche se a video la cella è tagliata), "Copia riga" (valori separati da TAB: si incolla in Excel) e "Vedi valore intero" (finestra con il testo selezionabile).' },
      { title: 'Alt+E / pulsante Piano', detail: 'Piano di esecuzione STIMATO dello statement (SET SHOWPLAN_XML ON: la query NON viene eseguita): operatori con righe stimate e costo, e — quando SQL Server lo propone — l\u2019indice mancante con lo script CREATE INDEX pronto da aprire in una tab.' },
      { title: 'Ctrl+rotella mouse', detail: 'Ingrandisce/riduce il testo dell\u2019editor.' },
      { title: 'Ctrl+Spazio', detail: 'Forza l\u2019apertura dell\u2019autocompletamento.' },
    ],
  },
]

export const HELP_SEARCHABLE = HELP_SECTIONS.flatMap(s => s.items).map(i => `${i.title} ${i.detail}`)
