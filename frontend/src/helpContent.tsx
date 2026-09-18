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
          'Tasto destro su una tab per chiudere in blocco come in SSMS: tutte le altre, quelle a destra, quelle a sinistra, o tutte le non appuntate (le appuntate sono protette). Quando le tab non stanno in una riga vanno a capo su una seconda riga; se non bastano nemmeno due righe compare il pulsante "»" che elenca tutte le tab aperte.',
      },
      {
        title: 'Dove si aprono le nuove tab',
        detail:
          'Il pulsante col segno "<" accanto a "Nuova" apre la query come PRIMA tab, cioè a sinistra; lo stesso vale per Shift+clic o clic col tasto centrale su "Nuova". Nel tasto destro su una tab scegli dove aprire le nuove tab — a sinistra, dopo quella attiva o in fondo — e la scelta resta salvata.',
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
          'Menu contestuale stile SSMS: per le tabelle "Seleziona le prime 1000 righe" e gli script per ogni operazione (Script CREATE, Script DROP, Script SELECT, Script INSERT, Script UPDATE, Script DELETE, Script MERGE); per procedure/funzioni/viste/trigger "Modifica" (CREATE OR ALTER), "Apri definizione" ed EXEC con parametri.',
      },
      {
        title: 'Diagramma chiamate',
        detail:
          'Tasto destro su una stored procedure o una funzione → "Diagramma chiamate": mostra i legami con le altre routine, salendo fino al chiamante più lontano (o scendendo verso quello che chiama). I cicli e le routine ricorsive sono segnalati con ↻ invece di bloccare il disegno. Clic su una routine per i dettagli, doppio clic per ricentrare il diagramma, e da lì si apre la definizione in una nuova tab.',
      },
      {
        title: 'Cerca',
        detail:
          'Il campo in alto cerca tabelle, viste, procedure, funzioni e trigger: gli spazi valgono come % (es. "dat udc" trova DAT_UDC).',
      },
      {
        title: 'Ricerca generale (stile Redgate SQL Search)',
        detail:
          'Pulsante "Cerca" in alto: cerca un testo qualunque nei NOMI e nelle DEFINIZIONI delle strutture (tabelle, viste, procedure, funzioni, trigger, vincoli CHECK/DEFAULT, colonne calcolate) e, spuntando "anche nei dati", anche nei VALORI delle colonne di testo delle tabelle. I risultati stanno sopra e l\u2019ANTEPRIMA sotto: per le routine compare lo script con il match evidenziato e la riga trovata, per le colonne la tabella con la colonna in evidenza, per i dati la riga trovata. Da un risultato si può MODIFICARE l\u2019oggetto (pulsante "Modifica" o doppio clic o tasto destro → menu): si apre CREATE OR ALTER in una nuova tab, figlia di quella attiva, come dal tasto destro nell\u2019albero; ci sono anche "Apri definizione" e "Diagramma chiamate". La ricerca resta dentro il database attivo; la scansione dei dati è limitata (tabelle, tempo e righe per tabella) per non appesantire il database, e il riepilogo dice quante tabelle sono state lette.',
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
        title: 'Alias delle tabelle',
        detail:
          'Dando un alias a una tabella, scrivendo "alias." vengono proposti i suoi campi (anche nella select-list): vale anche per le tabelle temporanee (#tmp.) e per le CTE definite nel documento ("with c as (...) select * from c pippo where pippo."), anche con le parentesi quadre ([pippo].).',
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
      { title: 'Ctrl+rotella mouse', detail: 'Ingrandisce/riduce il testo dell\u2019editor.' },
      { title: 'Ctrl+Spazio', detail: 'Forza l\u2019apertura dell\u2019autocompletamento.' },
    ],
  },
]

export const HELP_SEARCHABLE = HELP_SECTIONS.flatMap(s => s.items).map(i => `${i.title} ${i.detail}`)
