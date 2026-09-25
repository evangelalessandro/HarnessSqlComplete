// Snippet e suggerimenti contestuali T-SQL (manuale Microsoft, SQL 2019 e superiore):
// tipi di dato per DECLARE, opzioni SET con i valori possibili, snippet per ALTER TABLE.

import { stripSqlNoise } from './sqlGen'

export interface TypeSuggestion {
  name: string
  detail: string
  insertText: string
}

/** Tipi di dato T-SQL proponibili dopo "DECLARE @var". */
export const TSQL_TYPES: TypeSuggestion[] = [
  { name: 'INT', detail: 'intero (4 byte)', insertText: 'INT' },
  { name: 'BIGINT', detail: 'intero grande (8 byte)', insertText: 'BIGINT' },
  { name: 'SMALLINT', detail: 'intero piccolo (2 byte)', insertText: 'SMALLINT' },
  { name: 'TINYINT', detail: 'intero 0–255 (1 byte)', insertText: 'TINYINT' },
  { name: 'BIT', detail: '0/1/NULL', insertText: 'BIT' },
  { name: 'DECIMAL', detail: 'DECIMAL(p, s) — numero decimale esatto', insertText: 'DECIMAL' },
  { name: 'NUMERIC', detail: 'NUMERIC(p, s) — come DECIMAL', insertText: 'NUMERIC' },
  { name: 'MONEY', detail: 'valuta (8 byte)', insertText: 'MONEY' },
  { name: 'SMALLMONEY', detail: 'valuta (4 byte)', insertText: 'SMALLMONEY' },
  { name: 'FLOAT', detail: 'FLOAT(n) — virgola mobile', insertText: 'FLOAT' },
  { name: 'REAL', detail: 'virgola mobile (4 byte)', insertText: 'REAL' },
  { name: 'DATE', detail: 'data (AAAA-MM-GG)', insertText: 'DATE' },
  { name: 'DATETIME', detail: 'data e ora (8 byte)', insertText: 'DATETIME' },
  { name: 'DATETIME2', detail: 'DATETIME2(p) — data e ora ad alta precisione', insertText: 'DATETIME2' },
  { name: 'SMALLDATETIME', detail: 'data e ora (4 byte)', insertText: 'SMALLDATETIME' },
  { name: 'TIME', detail: 'TIME(p) — ora', insertText: 'TIME' },
  { name: 'DATETIMEOFFSET', detail: 'data e ora con fuso', insertText: 'DATETIMEOFFSET' },
  { name: 'CHAR', detail: 'CHAR(n) — stringa a lunghezza fissa', insertText: 'CHAR' },
  { name: 'VARCHAR', detail: 'VARCHAR(n|max) — stringa', insertText: 'VARCHAR' },
  { name: 'NCHAR', detail: 'NCHAR(n) — stringa Unicode fissa', insertText: 'NCHAR' },
  { name: 'NVARCHAR', detail: 'NVARCHAR(n|max) — stringa Unicode', insertText: 'NVARCHAR' },
  { name: 'TEXT', detail: 'testo (obsoleto: usare VARCHAR(max))', insertText: 'TEXT' },
  { name: 'NTEXT', detail: 'testo Unicode (obsoleto: usare NVARCHAR(max))', insertText: 'NTEXT' },
  { name: 'BINARY', detail: 'BINARY(n) — binario a lunghezza fissa', insertText: 'BINARY' },
  { name: 'VARBINARY', detail: 'VARBINARY(n|max) — binario', insertText: 'VARBINARY' },
  { name: 'IMAGE', detail: 'immagine (obsoleto: usare VARBINARY(max))', insertText: 'IMAGE' },
  { name: 'UNIQUEIDENTIFIER', detail: 'GUID (16 byte)', insertText: 'UNIQUEIDENTIFIER' },
  { name: 'XML', detail: 'dato XML', insertText: 'XML' },
  { name: 'SQL_VARIANT', detail: 'qualsiasi tipo di dato', insertText: 'SQL_VARIANT' },
  { name: 'ROWVERSION', detail: 'contatore binario automatico', insertText: 'ROWVERSION' },
  { name: 'TIMESTAMP', detail: 'sinonimo di ROWVERSION', insertText: 'TIMESTAMP' },
  { name: 'HIERARCHYID', detail: 'posizione nella gerarchia', insertText: 'HIERARCHYID' },
  { name: 'GEOGRAPHY', detail: 'dato geografico', insertText: 'GEOGRAPHY' },
  { name: 'GEOMETRY', detail: 'dato geometrico', insertText: 'GEOMETRY' },
]

export interface SetOptionSuggestion {
  name: string
  detail: string
  values: string[]
  /**
   * Valore con cui la direttiva si scrive normalmente (es. NOCOUNT → ON): accettando il
   * suggerimento l'opzione si completa da sola ("SET NOCOUNT ON") invece di lasciare la riga a
   * metà. Manca dove il valore va scelto di volta in volta (DATEFORMAT, LOCK_TIMEOUT,
   * TRANSACTION ISOLATION LEVEL…): in quel caso si propongono i valori dopo lo spazio.
   */
  predefinito?: string
}

/**
 * Opzioni SET (elenco completo delle istruzioni SET di SQL Server, dal manuale Microsoft:
 * "SET Statements (Transact-SQL)"), con i valori possibili e il valore con cui la direttiva si
 * scrive di solito. Le prime due sono quelle che aprono quasi tutte le stored procedure.
 */
export const TSQL_SET_OPTIONS: SetOptionSuggestion[] = [
  { name: 'NOCOUNT', detail: 'evita il messaggio "righe interessate"', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'XACT_ABORT', detail: 'rollback automatico su errore runtime', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'ANSI_NULLS', detail: 'confronti con NULL secondo lo standard', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'QUOTED_IDENTIFIER', detail: 'identificatori tra doppi apici', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'ANSI_PADDING', detail: 'spaziatura dei valori', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'ANSI_WARNINGS', detail: 'avvisi standard (divisione per zero…)', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'ANSI_NULL_DFLT_ON', detail: 'colonne NULL per default', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'ANSI_NULL_DFLT_OFF', detail: 'colonne NOT NULL per default', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'ANSI_DEFAULTS', detail: 'attiva in blocco le opzioni ISO (ANSI_NULLS, ANSI_PADDING…)', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'ARITHABORT', detail: 'termina la query su errore aritmetico', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'ARITHIGNORE', detail: 'ignora gli errori aritmetici', values: ['ON', 'OFF'], predefinito: 'OFF' },
  { name: 'CONCAT_NULL_YIELDS_NULL', detail: 'concatenazione con NULL → NULL', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'CURSOR_CLOSE_ON_COMMIT', detail: 'chiude i cursori al COMMIT', values: ['ON', 'OFF'], predefinito: 'OFF' },
  { name: 'IMPLICIT_TRANSACTIONS', detail: 'transazioni implicite', values: ['ON', 'OFF'], predefinito: 'OFF' },
  { name: 'NUMERIC_ROUNDABORT', detail: 'errore su arrotondamento', values: ['ON', 'OFF'], predefinito: 'OFF' },
  { name: 'REMOTE_PROC_TRANSACTIONS', detail: 'transazione distribuita per le procedure remote', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'NOEXEC', detail: 'compila ma non esegue', values: ['ON', 'OFF'], predefinito: 'OFF' },
  { name: 'PARSEONLY', detail: 'solo controllo sintassi', values: ['ON', 'OFF'], predefinito: 'OFF' },
  { name: 'FMTONLY', detail: 'solo metadati (deprecata)', values: ['ON', 'OFF'], predefinito: 'OFF' },
  { name: 'FORCEPLAN', detail: 'rispetta l\'ordine dei JOIN nella FROM', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'SHOWPLAN_ALL', detail: 'piano di esecuzione stimato, in formato testo', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'SHOWPLAN_TEXT', detail: 'piano di esecuzione stimato, in testo semplice', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'SHOWPLAN_XML', detail: 'piano di esecuzione stimato, in XML', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'OFFSETS', detail: 'offset delle colonne nei comandi DB-Library (deprecata)', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'FIPS_FLAGGER', detail: 'controllo di conformità FIPS (deprecata)', values: ['OFF', 'ENTRY', 'INTERMEDIATE', 'FULL'], predefinito: 'OFF' },
  { name: 'STATISTICS IO', detail: 'attività I/O', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'STATISTICS TIME', detail: 'tempi di esecuzione', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'STATISTICS PROFILE', detail: 'profilo di esecuzione', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'STATISTICS XML', detail: 'piano di esecuzione reale, in XML', values: ['ON', 'OFF'], predefinito: 'ON' },
  { name: 'IDENTITY_INSERT', detail: 'inserimento esplicito di valori identity (serve la tabella: SET IDENTITY_INSERT dbo.T ON)', values: ['ON', 'OFF'] },
  { name: 'LOCK_TIMEOUT', detail: 'millisecondi di attesa sui lock (-1 = infinito)', values: ['-1', '0', '5000'] },
  { name: 'ROWCOUNT', detail: 'numero massimo di righe processate', values: ['0', '100', '1000'] },
  { name: 'TEXTSIZE', detail: 'dimensione massima dei dati text/ntext/image restituiti', values: ['0', '4096', '64512', '2147483647'] },
  { name: 'QUERY_GOVERNOR_COST_LIMIT', detail: 'costo massimo stimato di una query', values: ['0', '100', '1000'] },
  { name: 'DATEFORMAT', detail: 'ordine giorno/mese/anno', values: ['dmy', 'mdy', 'ymd', 'dym', 'myd', 'ydm'] },
  { name: 'DATEFIRST', detail: 'primo giorno della settimana', values: ['1', '7'] },
  { name: 'LANGUAGE', detail: 'lingua delle sessioni', values: ["'Italian'", "'English'", "'German'", "'French'", "'Spanish'"] },
  { name: 'DEADLOCK_PRIORITY', detail: 'priorità nei deadlock', values: ['LOW', 'NORMAL', 'HIGH'] },
  { name: 'CONTEXT_INFO', detail: 'valore binario di sessione (fino a 128 byte)', values: ['0x0'] },
  { name: 'TRANSACTION ISOLATION LEVEL', detail: 'livello di isolamento', values: ['READ COMMITTED', 'READ UNCOMMITTED', 'REPEATABLE READ', 'SNAPSHOT', 'SERIALIZABLE'] },
]

/**
 * Direttiva completa da inserire accettando il suggerimento di un'opzione SET:
 * "NOCOUNT ON" (il "SET" davanti è già scritto nel documento), oppure solo il nome quando il
 * valore va scelto ("DATEFORMAT", "TRANSACTION ISOLATION LEVEL").
 */
export function setOptionInsertText(opt: SetOptionSuggestion): string {
  return opt.predefinito ? `${opt.name} ${opt.predefinito}` : opt.name
}

/** Etichetta del suggerimento: la direttiva intera, come la si legge nel documento. */
export function setOptionLabel(opt: SetOptionSuggestion): string {
  return `SET ${setOptionInsertText(opt)}`
}

/** Nomi delle opzioni SET in forma di regex ("STATISTICS IO" → "STATISTICS\s+IO"). */
const SET_OPTION_NAMES = TSQL_SET_OPTIONS.map(o => o.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|')

export interface AlterTableSnippet {
  label: string
  detail: string
  insertText: string
}

/** Snippet per ALTER TABLE: constraint, colonne, abilitazione/disabilitazione trigger. */
export const TSQL_ALTER_SNIPPETS: AlterTableSnippet[] = [
  { label: 'ADD CONSTRAINT PRIMARY KEY', detail: 'Aggiunge una chiave primaria', insertText: 'ADD CONSTRAINT [${1:nome}] PRIMARY KEY (${2:colonna})' },
  { label: 'ADD CONSTRAINT UNIQUE', detail: 'Vincolo di unicità', insertText: 'ADD CONSTRAINT [${1:nome}] UNIQUE (${2:colonna})' },
  { label: 'ADD CONSTRAINT FOREIGN KEY', detail: 'Chiave esterna', insertText: 'ADD CONSTRAINT [${1:nome}] FOREIGN KEY (${2:colonna}) REFERENCES [${3:tabella}](${4:colonna})' },
  { label: 'ADD CONSTRAINT CHECK', detail: 'Vincolo di controllo', insertText: 'ADD CONSTRAINT [${1:nome}] CHECK (${2:condizione})' },
  { label: 'ADD CONSTRAINT DEFAULT', detail: 'Valore di default per una colonna', insertText: 'ADD CONSTRAINT [${1:nome}] DEFAULT ${2:valore} FOR ${3:colonna}' },
  { label: 'WITH NOCHECK FOREIGN KEY', detail: 'Chiave esterna senza validare i dati esistenti', insertText: 'WITH NOCHECK ADD CONSTRAINT [${1:nome}] FOREIGN KEY (${2:colonna}) REFERENCES [${3:tabella}](${4:colonna})' },
  { label: 'ADD colonna', detail: 'Aggiunge una colonna', insertText: 'ADD ${1:colonna} ${2:tipo} ${3:NULL}' },
  { label: 'ALTER COLUMN', detail: 'Modifica il tipo di una colonna', insertText: 'ALTER COLUMN ${1:colonna} ${2:tipo} ${3:NULL}' },
  { label: 'DROP COLUMN', detail: 'Rimuove una colonna', insertText: 'DROP COLUMN ${1:colonna}' },
  { label: 'ENABLE TRIGGER', detail: 'Abilita un trigger della tabella', insertText: 'ENABLE TRIGGER [${1:nome}]' },
  { label: 'DISABLE TRIGGER', detail: 'Disabilita un trigger della tabella', insertText: 'DISABLE TRIGGER [${1:nome}]' },
  { label: 'ENABLE TRIGGER ALL', detail: 'Abilita tutti i trigger della tabella', insertText: 'ENABLE TRIGGER ALL' },
  { label: 'DISABLE TRIGGER ALL', detail: 'Disabilita tutti i trigger della tabella', insertText: 'DISABLE TRIGGER ALL' },
]

/** True se il cursore è nel punto in cui va il TIPO di una variabile: "DECLARE @var" (+ eventuale AS o parola parziale). */
export function detectDeclareTypeContext(textBefore: string): boolean {
  const m = /(?:^|;|\bGO\b|\n)[ \t]*DECLARE\b([\s\S]*)$/i.exec(textBefore)
  if (!m) return false
  const parts = m[1].split(',')
  const tail = parts[parts.length - 1].trim()
  return /^@[A-Za-z_][\w]*(\s+AS)?(\s+[A-Za-z_][\w]*)?$/i.test(tail)
}

export type SetContext =
  /**
   * Dopo "SET " (anche con l'opzione scritta a metà: "SET NO", "SET STATISTICS I") si propongono
   * le opzioni. `prefisso` è il testo già digitato (maiuscolo, senza spazi ai bordi) e
   * `sostituisci` quanti caratteri sostituire accettando il suggerimento: così anche le opzioni di
   * due parole ("STATISTICS IO") si completano senza duplicare quello che c'è già.
   */
  | { kind: 'options'; prefisso: string; sostituisci: number }
  /** Dopo "SET <opzione> " (spazio finale) si propongono i VALORI dell'opzione. */
  | { kind: 'values'; option: string }

/**
 * Contesto SET a inizio statement: dopo "SET " → opzioni; dopo "SET <opzione> " → valori (ON/OFF…).
 * Il SET è "a inizio statement" anche quando è su una riga NUOVA solo se la riga precedente
 * chiude uno statement (vuota, ';', GO/BEGIN/END/AS/ELSE…, oppure una direttiva SET già scritta:
 * due SET di fila, "SET NOCOUNT ON" e sotto "SET XACT_ABORT ON", sono due statement distinti):
 * NON se continua un UPDATE ("UPDATE dbo.T\nSET " deve proporre le colonne della tabella, non le
 * opzioni SET).
 */
export function detectSetContext(textBefore: string): SetContext | null {
  const lastNl = textBefore.lastIndexOf('\n')
  let eff = textBefore
  if (lastNl !== -1) {
    const before = textBefore.slice(0, lastNl)
    const prevLine = before.slice(before.lastIndexOf('\n') + 1).trimEnd()
    const closesStatement =
      prevLine === '' ||
      /;$/.test(prevLine) ||
      /^\s*(?:GO|BEGIN|END|ELSE|AS|THEN|DO|TRY|CATCH)\b/i.test(prevLine) ||
      // direttiva SET già scritta ("SET NOCOUNT ON", "SET ANSI_NULLS, QUOTED_IDENTIFIER ON")
      new RegExp(`^SET\\s+(?:${SET_OPTION_NAMES})\\b`, 'i').test(prevLine.trimStart())
    if (!closesStatement) {
      // la riga precedente continua lo statement: il SET non è un'opzione
      eff = before + ' ' + textBefore.slice(lastNl + 1)
    }
  }
  const boundary = '(?:^|;|\\bGO\\b|\\n)[ \\t]*'
  const m = new RegExp(boundary + 'SET\\b([ \\t]*)([^\\n;]*)$', 'i').exec(eff)
  if (!m) return null
  const resto = m[2]
  const senzaSpaziFinali = resto.replace(/[ \t]+$/, '')
  const testo = senzaSpaziFinali.trim().toUpperCase()
  // un'opzione SET è una sequenza di lettere (anche su più parole): qualunque altra cosa
  // ("SET @x = 1", "SET NOCOUNT = 1") non è una direttiva e la lasciano gestire agli altri
  // suggerimenti (es. le variabili dopo "SET @")
  if (testo !== '' && !/^[A-Z_][A-Z0-9_ ]*$/.test(testo)) return null
  // "SET NOCOUNT " (spazio dopo un'opzione completa) → si propongono i valori
  if (testo !== '' && resto.length > senzaSpaziFinali.length && TSQL_SET_OPTIONS.some(o => o.name.toUpperCase() === testo)) {
    return { kind: 'values', option: testo }
  }
  return { kind: 'options', prefisso: testo, sostituisci: testo.length }
}

/** True subito dopo "ALTER TABLE <tabella> " (per proporre gli snippet). */
export function detectAlterTableContext(textBefore: string): boolean {
  return /(?:^|;|\bGO\b|\n)[ \t]*ALTER\s+TABLE\s+(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*))?\s*$/i.test(textBefore)
}

/** Nome di tabella qualificato: "T", "dbo.T", "[dbo].[T]". */
const NOME_TABELLA = '(?:\\[[^\\]]+\\]|[A-Za-z_][A-Za-z0-9_]*)(?:\\s*\\.\\s*(?:\\[[^\\]]+\\]|[A-Za-z_][A-Za-z0-9_]*))?'
/** Nome (anche parziale) già digitato dopo COLUMN / CONSTRAINT. */
const NOME_PARZIALE = '(?:\\[[^\\]]*|[A-Za-z_][A-Za-z0-9_]*)'

export type AlterTableDropContext =
  /** Subito dopo "… DROP " (o con la parola chiave a metà): si propongono COLUMN e CONSTRAINT. */
  | { kind: 'keywords'; senzaTable?: boolean; tableAt?: number }
  /** Dopo "… DROP COLUMN " (o a metà del nome): si propongono le colonne della tabella. */
  | { kind: 'column'; schema: string; table: string; senzaTable?: boolean; tableAt?: number }
  /** Dopo "… DROP CONSTRAINT ": si propongono i vincoli della tabella (CHECK, FK, PK, UNIQUE…). */
  | { kind: 'constraint'; schema: string; table: string; senzaTable?: boolean; tableAt?: number }

/** Divide "dbo.T" / "[dbo].[T]" in schema e tabella (schema '' se non indicato). */
export function splitQualifiedName(nome: string): { schema: string; table: string } {
  const parti = nome.split('.').map(p => p.trim().replace(/^\[|\]$/g, ''))
  return parti.length > 1 ? { schema: parti[0], table: parti[1] } : { schema: '', table: parti[0] }
}

/** "[dbo].[DAT_UDC]": nome qualificato con parentesi quadre, come serve a OBJECT_ID. */
export function quotedQualifiedName(nome: string): string {
  const { schema, table } = splitQualifiedName(nome)
  const t = `[${table.replace(/\]/g, ']]')}]`
  return schema ? `[${schema.replace(/\]/g, ']]')}].${t}` : t
}

/** Caratteri che in uno snippet Monaco vanno protetti (altrimenti diventano segnaposto). */
function escapeSnippet(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/\}/g, '\\}')
}

/**
 * SNIPPET "DROP COLUMN sicuro" (richiesta utente): elimina la colonna dopo aver tolto i vincoli
 * collegati (DEFAULT/CHECK sulla colonna, CHECK che la citano, chiavi esterne uscenti, PK/UNIQUE
 * fatte sulla sola colonna) e controlla che la colonna esista ancora.
 * Il nome della tabella è già quello dello statement; la colonna è dichiarata in UNA variabile
 * (@colonna, il segnaposto si scrive una volta sola) e usata sotto da tutte le query.
 */
export function dropColumnSnippet(tabella: string): string {
  const t = quotedQualifiedName(tabella)
  // La colonna si scrive con un token che sopravvive all'escaping: il segnaposto Monaco
  // ${1:colonna} si mette DOPO, altrimenti verrebbe protetto come testo normale.
  const col = '__COLONNA__'
  const sql = `/* DROP COLUMN sicuro: prima i vincoli collegati, controllando che la colonna esista */
DECLARE @colonna SYSNAME = N'${col}'; /* nome senza parentesi quadre: le aggiunge QUOTENAME */

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'${t}') AND name = @colonna)
BEGIN
  DECLARE @drop NVARCHAR(MAX) = N'';

  /* DEFAULT legati alla singola colonna (sys.default_constraints: ha parent_column_id) */
  SELECT @drop = @drop + N'ALTER TABLE ${t} DROP CONSTRAINT ' + QUOTENAME(dc.name) + N';' + CHAR(10)
  FROM sys.default_constraints dc
    INNER JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID(N'${t}') AND c.name = @colonna;

  /* CHECK che citano la colonna: a livello colonna O di tabella (il filtro e' sulla
     definizione: sys.objects NON ha parent_column_id, si usano le viste dei vincoli) */
  SELECT @drop = @drop + N'ALTER TABLE ${t} DROP CONSTRAINT ' + QUOTENAME(cc.name) + N';' + CHAR(10)
  FROM sys.check_constraints cc
  WHERE cc.parent_object_id = OBJECT_ID(N'${t}') AND cc.definition LIKE N'%' + @colonna + N'%';

  /* chiavi esterne USCENTI che usano la colonna */
  SELECT @drop = @drop + N'ALTER TABLE ${t} DROP CONSTRAINT ' + QUOTENAME(fk.name) + N';' + CHAR(10)
  FROM sys.foreign_key_columns fkc
    INNER JOIN sys.foreign_keys fk ON fk.object_id = fkc.constraint_object_id
  WHERE fkc.parent_object_id = OBJECT_ID(N'${t}') AND COL_NAME(fkc.parent_object_id, fkc.parent_column_id) = @colonna;

  /* PK / UNIQUE fatte sulla SOLA colonna */
  SELECT @drop = @drop + N'ALTER TABLE ${t} DROP CONSTRAINT ' + QUOTENAME(kc.name) + N';' + CHAR(10)
  FROM sys.key_constraints kc
    INNER JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
  WHERE kc.parent_object_id = OBJECT_ID(N'${t}') AND ic.is_included_column = 0
    AND COL_NAME(ic.object_id, ic.column_id) = @colonna
  GROUP BY kc.name
  HAVING COUNT(*) = 1;

  /* la colonna: DROP COLUMN non accetta variabili, quindi entra nello script dinamico */
  SET @drop = @drop + N'ALTER TABLE ${t} DROP COLUMN ' + QUOTENAME(@colonna) + N';' + CHAR(10);

  IF @drop <> N''
    EXEC sp_executesql @drop;
END
ELSE
  PRINT N'Colonna ' + @colonna + N' non presente in ${t}: niente da fare.';`
  // prima si protegge il testo, poi si mette il segnaposto (così resta un segnaposto vero,
  // ripetuto: scrivendo la colonna una volta si riempie in tutte le righe)
  return escapeSnippet(sql).split(col).join('${1:colonna}')
}

/** Tipo di vincolo collegato a una colonna (per i suggerimenti). */
export interface VincoloCollegato {
  name: string
  kind: string
}

/**
 * Vincoli che "toccano" una colonna, letti dallo schema già caricato: CHECK che la citano nella
 * condizione, chiavi esterne (uscenti e di altre tabelle che puntano qui) e PK/UNIQUE che la
 * contengono. Serve a dire all'utente cosa dovrà togliere prima di eliminarla.
 */
export function vincoliCollegati(
  summary: { checkConstraints?: { schema: string; tableName: string; name: string; definition: string }[] | null; foreignKeys: { name: string; schema: string; table: string; column: string; refSchema: string; refTable: string; refColumn: string }[] },
  schema: string,
  table: string,
  column: string,
  indexes: { name: string; isPrimaryKey: boolean; isUnique: boolean; columns: string[] | null }[] | null | undefined,
): VincoloCollegato[] {
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const out: VincoloCollegato[] = []
  const colonna = column.toLowerCase()
  for (const cc of summary.checkConstraints ?? []) {
    if (!eq(cc.tableName, table)) continue
    if (schema && !eq(cc.schema, schema)) continue
    // confronto "grezzo" ma efficace: la condizione cita il nome della colonna
    if (!cc.definition.toLowerCase().includes(colonna)) continue
    out.push({ name: cc.name, kind: 'CHECK' })
  }
  for (const fk of summary.foreignKeys) {
    if (eq(fk.table, table) && eq(fk.column, column) && (!schema || eq(fk.schema, schema))) {
      out.push({ name: fk.name, kind: `FOREIGN KEY → ${fk.refSchema}.${fk.refTable}.${fk.refColumn}` })
    } else if (eq(fk.refTable, table) && eq(fk.refColumn, column)) {
      out.push({ name: fk.name, kind: `FOREIGN KEY da ${fk.schema}.${fk.table}.${fk.column} (altra tabella)` })
    }
  }
  for (const ix of indexes ?? []) {
    if (!ix.isPrimaryKey && !ix.isUnique) continue
    if (!(ix.columns ?? []).some(c => eq(c, column))) continue
    out.push({ name: ix.name, kind: ix.isPrimaryKey ? 'PRIMARY KEY' : 'UNIQUE' })
  }
  return out
}

/**
 * Contesto di un "ALTER TABLE <tabella> DROP …":
 * - "DROP " (anche "DROP COL") → COLUMN / CONSTRAINT;
 * - "DROP COLUMN [nome…]" → colonne della tabella;
 * - "DROP CONSTRAINT [nome…]" → vincoli della tabella.
 * La parola TABLE può mancare ("ALTER DAT_SPEDIZIONI DROP CONSTRAINT", come capita di scrivere):
 * in quel caso il contesto viene riconosciuto lo stesso e `senzaTable`/`tableAt` dicono al
 * chiamante dove inserirla per correggere lo statement.
 */
export function detectAlterTableDropContext(textBefore: string): AlterTableDropContext | null {
  // "ALTER TABLE" oppure "ALTER" + nome (ma non ALTER PROCEDURE/VIEW/INDEX/...)
  const testa = `ALTER\\s+(?:TABLE\\s+)?(?!(?:PROCEDURE|PROC|VIEW|FUNCTION|TRIGGER|INDEX|SCHEMA|DATABASE|SERVER|ASSEMBLY|ROLE|USER|LOGIN|PARTITION|COLUMN)\\b)`
  const varianti: { kind: AlterTableDropContext['kind']; re: RegExp }[] = [
    { kind: 'column', re: new RegExp(`${testa}(${NOME_TABELLA})\\s+DROP\\s+COLUMN(?:\\s+${NOME_PARZIALE})?\\s*$`, 'i') },
    { kind: 'constraint', re: new RegExp(`${testa}(${NOME_TABELLA})\\s+DROP\\s+CONSTRAINT(?:\\s+${NOME_PARZIALE})?\\s*$`, 'i') },
    { kind: 'keywords', re: new RegExp(`${testa}(${NOME_TABELLA})\\s+DROP\\s*$`, 'i') },
  ]
  const conNome = (kind: AlterTableDropContext['kind'], m: RegExpExecArray): AlterTableDropContext => {
    const senzaTable = !/^ALTER\s+TABLE\b/i.test(m[0])
    const tableAt = m.index + m[0].indexOf(m[1])
    const nome = splitQualifiedName(m[1])
    if (kind === 'column') return { kind: 'column', ...nome, senzaTable, tableAt }
    if (kind === 'constraint') return { kind: 'constraint', ...nome, senzaTable, tableAt }
    return { kind: 'keywords', senzaTable, tableAt }
  }
  for (const v of varianti) {
    const m = v.re.exec(textBefore)
    if (m) return conNome(v.kind, m)
  }
  // parola chiave a metà ("DROP COL", "DROP CONS"): solo COLUMN/CONSTRAINT
  const parz = new RegExp(`${testa}(${NOME_TABELLA})\\s+DROP\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*$`, 'i').exec(textBefore)
  if (parz) {
    const u = parz[2].toUpperCase()
    if ('COLUMN'.startsWith(u) || 'CONSTRAINT'.startsWith(u)) return conNome('keywords', parz)
  }
  return null
}

export interface SystemVariableSuggestion {
  name: string
  detail: string
}

/** Variabili di sistema T-SQL (@@…): da proporre quando si digita "@@". */
export const TSQL_SYSTEM_VARIABLES: SystemVariableSuggestion[] = [
  { name: '@@ROWCOUNT', detail: 'righe interessate dall\'ultima istruzione' },
  { name: '@@TRANCOUNT', detail: 'transazioni attive (annidate)' },
  { name: '@@ERROR', detail: 'codice dell\'ultimo errore' },
  { name: '@@IDENTITY', detail: 'ultimo valore identity inserito' },
  { name: '@@FETCH_STATUS', detail: 'stato dell\'ultimo FETCH (0 = riuscito)' },
  { name: '@@SPID', detail: 'ID della sessione corrente' },
  { name: '@@SERVERNAME', detail: 'nome dell\'istanza locale di SQL Server' },
  { name: '@@SERVICENAME', detail: 'nome del servizio SQL Server' },
  { name: '@@VERSION', detail: 'versione e build di SQL Server' },
  { name: '@@LANGUAGE', detail: 'lingua corrente' },
  { name: '@@LANGID', detail: 'ID della lingua corrente' },
  { name: '@@DATEFIRST', detail: 'primo giorno della settimana (1=lunedì…7=domenica)' },
  { name: '@@LOCK_TIMEOUT', detail: 'timeout dei lock in millisecondi (-1 = infinito)' },
  { name: '@@NESTLEVEL', detail: 'livello di annidamento corrente' },
  { name: '@@PROCID', detail: 'ID dell\'oggetto (procedura/trigger) corrente' },
  { name: '@@OPTIONS', detail: 'opzioni SET correnti (bitmask)' },
  { name: '@@TEXTSIZE', detail: 'massima lunghezza del testo restituito' },
  { name: '@@CURSOR_ROWS', detail: 'righe del cursore aperto' },
  { name: '@@CONNECTIONS', detail: 'tentativi di connessione dall\'avvio' },
  { name: '@@CPU_BUSY', detail: 'tempo CPU (ticks) dall\'avvio' },
  { name: '@@IDLE', detail: 'tempo di inattività (ticks) dall\'avvio' },
  { name: '@@IO_BUSY', detail: 'tempo di I/O (ticks) dall\'avvio' },
  { name: '@@MAX_CONNECTIONS', detail: 'numero massimo di connessioni' },
  { name: '@@MAX_PRECISION', detail: 'precisione massima di decimal/numeric' },
  { name: '@@PACK_RECEIVED', detail: 'pacchetti ricevuti dall\'avvio' },
  { name: '@@PACK_SENT', detail: 'pacchetti inviati dall\'avvio' },
  { name: '@@PACKET_ERRORS', detail: 'errori di pacchetto dall\'avvio' },
  { name: '@@REMSERVER', detail: 'nome del server remoto' },
  { name: '@@TIMETICKS', detail: 'microsecondi per tick' },
  { name: '@@TOTAL_ERRORS', detail: 'errori di I/O dall\'avvio' },
  { name: '@@TOTAL_READ', detail: 'letture disco dall\'avvio' },
  { name: '@@TOTAL_WRITE', detail: 'scritture disco dall\'avvio' },
  { name: '@@DBTS', detail: 'ultimo timestamp del database corrente' },
]

/** True se il cursore è dopo "@@" (o "@@" + prefisso parziale): propone le variabili di sistema. */
export function detectSystemVariableContext(textBefore: string): boolean {
  return systemVariablePrefixLen(textBefore) > 0
}

/**
 * Lunghezza (in caratteri) del testo da SOSTITUIRE quando si sceglie una variabile
 * di sistema: il "@@" già digitato + l'eventuale prefisso parziale (+ spazi finali).
 * Es. "if @@ERRO" → 6 (sostituisce "@@ERRO"); "if @@" → 2.
 */
export function systemVariablePrefixLen(textBefore: string): number {
  const trimmed = textBefore.trimEnd()
  const m = /@@[A-Za-z_]*$/i.exec(trimmed)
  return m ? m[0].length + (textBefore.length - trimmed.length) : 0
}

// ---------- Contesti oggetti (DROP/TRUNCATE/ALTER/USE) ----------

export type ObjectKind = 'table' | 'view' | 'procedure' | 'function' | 'trigger' | 'database'

/** Dopo "DROP TABLE ", "TRUNCATE TABLE ", "ALTER PROCEDURE ", "USE " → tipo di oggetto da proporre. */
export function detectObjectNameContext(textBefore: string): ObjectKind | null {
  const t = textBefore.trimEnd()
  const map = (w: string): ObjectKind | null => {
    switch (w) {
      case 'TABLE': return 'table'
      case 'VIEW': return 'view'
      case 'PROCEDURE': case 'PROC': return 'procedure'
      case 'FUNCTION': return 'function'
      case 'TRIGGER': return 'trigger'
      default: return null
    }
  }
  const m1 = /(?:^|;|\bGO\b|\n)[ \t]*(?:DROP|TRUNCATE)\s+(TABLE|VIEW|PROCEDURE|PROC|FUNCTION|TRIGGER)\s*$/i.exec(t)
  if (m1) return map(m1[1].toUpperCase())
  const m2 = /(?:^|;|\bGO\b|\n)[ \t]*ALTER\s+(PROCEDURE|PROC|FUNCTION|TRIGGER|VIEW)\s*$/i.exec(t)
  if (m2) return map(m2[1].toUpperCase())
  // ENABLE/DISABLE TRIGGER → i trigger da abilitare/disabilitare (con il loro "ON tabella")
  const m3 = /(?:^|;|\bGO\b|\n)[ \t]*(?:ENABLE|DISABLE)\s+TRIGGER\s*$/i.exec(t)
  if (m3) return 'trigger'
  if (/(?:^|;|\bGO\b|\n)[ \t]*USE\s*$/i.test(t)) return 'database'
  return null
}

// ---------- ENABLE/DISABLE TRIGGER (nome del trigger e "ON tabella") ----------

/**
 * Dopo "DISABLE TRIGGER " / "ENABLE TRIGGER " (anche con più nomi separati da virgola) → true:
 * l'elenco dei trigger lo propone il ramo degli oggetti. Dopo il nome serve "ON".
 */
export function detectEnableDisableTriggerName(textBefore: string): boolean {
  const t = textBefore.trimEnd()
  return /(?:^|;|\bGO\b|\n)[ \t]*(?:ENABLE|DISABLE)\s+TRIGGER\s+[^\n;]*$/i.test(t)
}

/**
 * Dopo "ENABLE/DISABLE TRIGGER nome ON " → si propongono le tabelle su cui il trigger è definito
 * (più ALL, DATABASE e ALL SERVER, che la sintassi accetta al posto dell'oggetto).
 */
export function detectEnableDisableTriggerOn(textBefore: string): boolean {
  const t = textBefore.trimEnd()
  return /(?:^|;|\bGO\b|\n)[ \t]*(?:ENABLE|DISABLE)\s+TRIGGER\b[^\n;]*\bON\s*$/i.test(t)
}

/**
 * Nomi di trigger già digitati dopo "ENABLE/DISABLE TRIGGER " (anche più nomi separati da virgola):
 * serve a sapere su QUALE tabella va completata la direttiva. null se non siamo in quel punto.
 * Dopo "ON" restituisce comunque i nomi scritti prima di ON (le tabelle vengono dopo).
 */
export function nomiTriggerDigitati(textBefore: string): string[] | null {
  const m = /(?:^|;|\bGO\b|\n)[ \t]*(?:ENABLE|DISABLE)\s+TRIGGER\s+([^\n;]*)$/i.exec(textBefore.trimEnd())
  if (!m) return null
  // si tiene solo la parte PRIMA di ON: dopo ON ci sono le tabelle
  const prima = m[1].split(/\bON\b/i)[0].trim()
  if (prima === '') return null
  return prima
    .split(',')
    .map(s => s.trim().replace(/^\[|\]$/g, ''))
    .filter(Boolean)
}

/**
 * Tabella su cui è definito un trigger, dal nome scritto dall'utente (anche "schema.nome" o
 * "[schema].[nome]"). Vuoto se il trigger non si trova: in quel caso non si sa dove va il "ON".
 */
export function tabellaDelTrigger(
  triggers: { schema: string; name: string; tableName: string }[],
  nome: string,
): string {
  const pulito = nome.trim()
  const parti = pulito.split('.').map(p => p.trim().replace(/^\[|\]$/g, ''))
  const tab = parti[parti.length - 1]
  const schema = parti.length > 1 ? parti[parti.length - 2] : ''
  const t = triggers.find(
    x =>
      x.name.toLowerCase() === tab.toLowerCase() &&
      (!schema || x.schema.toLowerCase() === schema.toLowerCase()),
  )
  return t?.tableName ?? ''
}

/**
 * "ALTER TABLE <tabella> ENABLE|DISABLE TRIGGER " → la tabella di cui proporre i trigger
 * (forma ALTER TABLE, diversa da "DISABLE TRIGGER nome ON tabella").
 */
export function detectAlterTableTrigger(textBefore: string): { schema: string; table: string } | null {
  const m =
    /(?:^|;|\bGO\b|\n)[ \t]*ALTER\s+TABLE\s+((?:\[[^\]]+\]|[A-Za-z_][\w]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_][\w]*))?)\s+(?:ENABLE|DISABLE)\s+TRIGGER\s*$/i.exec(
      textBefore.trimEnd(),
    )
  if (!m) return null
  const parti = m[1].split('.').map(p => p.trim().replace(/^\[|\]$/g, ''))
  return parti.length > 1
    ? { schema: parti[0], table: parti[1] }
    : { schema: '', table: parti[0] }
}

// ---------- CREATE TABLE (colonna → tipo) ----------

/** True dopo "CREATE TABLE t (id " (nome colonna dentro le parentesi): propone i tipi di dato. */
export function detectCreateTableColumnContext(textBefore: string): boolean {
  const t = textBefore.trimEnd()
  const m = /(?:^|;|\bGO\b|\n)[ \t]*CREATE\s+TABLE\s+\S+\s*\(([^()]*)$/i.exec(t)
  if (!m) return false
  const inner = m[1].trimEnd()
  // se finisce con una keyword di constraint il tipo non serve (es. "PRIMARY KEY")
  if (/PRIMARY|FOREIGN|CONSTRAINT|UNIQUE|CHECK|DEFAULT|REFERENCES|NOT|NULL$/i.test(inner)) return false
  // deve finire con un identificatore (nome colonna) — una virgola finale esclude
  return /\[?[A-Za-z_][\w]*\]?$/.test(inner)
}

// ---------- OPTION ( hint di query ----------

export interface OptionHintSuggestion {
  name: string
  detail: string
  insertText: string
}

/** Hint di query per "OPTION (". */
export const TSQL_OPTION_HINTS: OptionHintSuggestion[] = [
  { name: 'RECOMPILE', detail: 'ricompila il piano a ogni esecuzione', insertText: 'RECOMPILE' },
  { name: 'MAXDOP', detail: 'limita il parallelismo', insertText: 'MAXDOP (${1:n})' },
  { name: 'OPTIMIZE FOR', detail: 'valore ottimistico per il piano', insertText: 'OPTIMIZE FOR (${1:colonna} = ${2:valore})' },
  { name: 'FORCE ORDER', detail: 'rispetta l\'ordine dei JOIN', insertText: 'FORCE ORDER' },
  { name: 'USE PLAN', detail: 'usa un piano specifico', insertText: 'USE PLAN (${1:\'xml\'})' },
  { name: 'LOOP JOIN', detail: 'forza i loop join', insertText: 'LOOP JOIN' },
  { name: 'MERGE JOIN', detail: 'forza i merge join', insertText: 'MERGE JOIN' },
  { name: 'HASH JOIN', detail: 'forza gli hash join', insertText: 'HASH JOIN' },
  { name: 'ROBUST PLAN', detail: 'piano robusto', insertText: 'ROBUST PLAN' },
  { name: 'KEEP PLAN', detail: 'riusa il piano più a lungo', insertText: 'KEEP PLAN' },
]

/** True dopo "OPTION (" (o "OPTION ( "): propone gli hint di query. */
export function detectOptionHintsContext(textBefore: string): boolean {
  return /\bOPTION\s*\(\s*$/i.test(textBefore.trimEnd())
}

// ---------- CREATE INDEX ----------

/** Dopo "CREATE INDEX " → 'name' (snippet); dopo "... ON " → 'table' (tabelle); altrimenti null. */
export function detectCreateIndexContext(textBefore: string): 'name' | 'table' | null {
  const t = textBefore.trimEnd()
  const head = '(?:^|;|\\bGO\\b|\\n)[ \\t]*CREATE\\s+(?:UNIQUE\\s+)?(?:NONCLUSTERED\\s+|CLUSTERED\\s+)?INDEX'
  if (new RegExp(head + '\\s*$', 'i').test(t)) return 'name'
  if (new RegExp(head + '\\s+\\[?[A-Za-z_][\\w]*\\]?\\s+ON\\s*$', 'i').test(t)) return 'table'
  return null
}

// ---------- Hint di tabella WITH ( ----------

export interface TableHintSuggestion {
  name: string
  detail: string
}

/** Hint di tabella per "FROM t WITH (". */
export const TSQL_TABLE_HINTS: TableHintSuggestion[] = [
  { name: 'NOLOCK', detail: 'letture senza lock (dirty read)' },
  { name: 'ROWLOCK', detail: 'lock a livello di riga' },
  { name: 'UPDLOCK', detail: 'lock di aggiornamento' },
  { name: 'XLOCK', detail: 'lock esclusivo' },
  { name: 'HOLDLOCK', detail: 'lock fino alla fine della transazione' },
  { name: 'READPAST', detail: 'salta le righe bloccate' },
  { name: 'NOWAIT', detail: 'errore immediato se la riga è bloccata' },
  { name: 'TABLOCK', detail: 'lock di tabella' },
  { name: 'TABLOCKX', detail: 'lock esclusivo di tabella' },
  { name: 'READCOMMITTED', detail: 'livello read committed' },
  { name: 'READUNCOMMITTED', detail: 'livello read uncommitted' },
  { name: 'REPEATABLEREAD', detail: 'livello repeatable read' },
  { name: 'SERIALIZABLE', detail: 'livello serializzabile' },
  { name: 'INDEX', detail: 'forza un indice: INDEX(idex)' },
]

/** True dopo "FROM t WITH (" / "JOIN t WITH (": propone gli hint di tabella. */
export function detectTableHintsContext(textBefore: string): boolean {
  return /(?:FROM|JOIN)\s+(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*\[?[A-Za-z_][\w]*\]?)?(?:\s+(?:AS\s+)?[A-Za-z_][A-Za-z0-9_]*)?\s+WITH\s*\(\s*$/i.test(textBefore.trimEnd())
}

// ---------- Funzioni finestra: OVER( ... ) ----------

export interface OverSuggestion {
  name: string
  detail: string
  insertText: string
}

/** Dentro la parentesi VUOTA di OVER(): prime clausole della finestra. */
export const TSQL_OVER_STARTS: OverSuggestion[] = [
  { name: 'PARTITION BY', detail: 'partiziona la finestra', insertText: 'PARTITION BY ${1:colonna}' },
  { name: 'ORDER BY', detail: 'ordina la finestra', insertText: 'ORDER BY ${1:colonna}' },
  { name: 'ROWS frame', detail: 'frame per righe (tra righe)', insertText: 'ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW' },
  { name: 'RANGE frame', detail: 'frame per intervallo (tra valori)', insertText: 'RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW' },
]

/** Dopo una colonna di PARTITION BY/ORDER BY: prossime clausole. */
export const TSQL_OVER_CONTINUE: OverSuggestion[] = [
  { name: 'ORDER BY', detail: 'ordina la finestra', insertText: 'ORDER BY ${1:colonna}' },
  { name: 'ROWS frame', detail: 'frame per righe', insertText: 'ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW' },
  { name: 'RANGE frame', detail: 'frame per intervallo', insertText: 'RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW' },
]

/** Dopo ROWS/RANGE: clausole del frame. */
export const TSQL_OVER_FRAMES: OverSuggestion[] = [
  { name: 'BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW', detail: 'dall\'inizio della partizione alla riga corrente', insertText: 'BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW' },
  { name: 'BETWEEN n PRECEDING AND CURRENT ROW', detail: 'le n righe precedenti + la corrente', insertText: 'BETWEEN ${1:n} PRECEDING AND CURRENT ROW' },
  { name: 'BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING', detail: 'dalla riga corrente alla fine', insertText: 'BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING' },
  { name: 'BETWEEN n FOLLOWING AND UNBOUNDED FOLLOWING', detail: 'dalle n successive alla fine', insertText: 'BETWEEN ${1:n} FOLLOWING AND UNBOUNDED FOLLOWING' },
  { name: 'UNBOUNDED PRECEDING', detail: 'dall\'inizio della partizione', insertText: 'UNBOUNDED PRECEDING' },
  { name: 'CURRENT ROW', detail: 'solo la riga corrente', insertText: 'CURRENT ROW' },
]

export type OverContext = 'empty' | 'continue' | 'frame' | null

/**
 * Contesto dentro la parentesi di OVER() di una funzione finestra (RANK/ROW_NUMBER/SUM…):
 * - parentesi vuota → prime clausole (PARTITION BY/ORDER BY/ROWS/RANGE);
 * - dopo un identificatore completo + spazio → continuazione (ORDER BY/frame);
 * - dopo ROWS/RANGE → clausole del frame.
 * Le posizioni di colonna (PARTITION BY x / ORDER BY x) restano al columnContext.
 */
export function detectOverContext(textBefore: string): OverContext {
  // usa il testo GREZZO: lo spazio finale serve a distinguere "colonna finita" da "colonna in corso"
  const m = /\bOVER\s*\(([^()]*)$/i.exec(textBefore)
  if (!m) return null
  const inner = m[1]
  const trimmed = inner.trimEnd()
  if (trimmed === '') return 'empty'
  if (/(?:ROWS|RANGE)\s*$/i.test(trimmed)) return 'frame'
  if (/(?:PARTITION\s+BY|ORDER\s+BY)\s*$/i.test(trimmed)) return null // sta per arrivare una colonna
  // identificatore completo seguito da spazio → la colonna è finita: prossima clausola
  if (/[A-Za-z_][\w]*\s*$/i.test(trimmed) && /\s$/.test(inner)) return 'continue'
  return null
}

// ---------- Variabili dichiarate (DECLARE @var) ----------

export interface DeclaredVariable {
  name: string
  dataType: string
}

/**
 * Estrae le variabili dichiarate con DECLARE, incluse le continuazioni su più righe:
 * sia con virgola iniziale (",@prova INT") sia allineate senza virgola (" @prova INT").
 * Lo statement DECLARE finisce a ';' oppure alla prima riga che non inizia con '@' o ','.
 */
export function extractDeclaredVariables(text: string): DeclaredVariable[] {
  const out: DeclaredVariable[] = []
  const declRe = /\bDECLARE\b/gi
  let m: RegExpExecArray | null
  while ((m = declRe.exec(text)) !== null) {
    let i = m.index + m[0].length
    const n = text.length
    const span: string[] = []
    while (i < n) {
      const eol = text.indexOf('\n', i)
      const line = text.slice(i, eol === -1 ? n : eol)
      const t = line.trimStart()
      if (t === '') {
        i = eol === -1 ? n : eol + 1
        continue
      }
      if (span.length === 0 || t[0] === '@' || t[0] === ',') {
        const semi = t.indexOf(';')
        span.push(semi === -1 ? t : t.slice(0, semi))
        if (semi !== -1) break
        i = eol === -1 ? n : eol + 1
        continue
      }
      break
    }
    const vr = /@([A-Za-z_][\w]*)\s+(?:as\s+)?([A-Za-z_][\w]*)/gi
    let v: RegExpExecArray | null
    while ((v = vr.exec(span.join('\n'))) !== null) {
      out.push({ name: `@${v[1]}`, dataType: v[2] })
    }
  }
  return out
}

/** True se il cursore è dopo "@nome" (una sola @) in una posizione di espressione. */
export function detectVariableContext(textBefore: string): boolean {
  const t = textBefore.trimEnd()
  if (/@@[A-Za-z_]*$/i.test(t)) return false // variabili di sistema → altro ramo
  return /(?:^|[^@])@[A-Za-z_]*$/i.test(t)
}

/** Lunghezza del testo "@nome" (o "@") da sostituire scegliendo una variabile. */
export function variablePrefixLen(textBefore: string): number {
  const t = textBefore.trimEnd()
  if (/@@[A-Za-z_]*$/i.test(t)) return 0
  const m = /@[A-Za-z_]*$/i.exec(t)
  return m ? m[0].length : 0
}

// ---------- Parametri della routine aperta in modifica ----------

/**
 * Firma della routine: la parte fra il nome e la chiusura della firma.
 * - forma con parentesi ("CREATE PROC p ( @a int, @b int )"): si prende il contenuto della prima
 *   coppia di parentesi (le parentesi dei tipi, es. decimal(11, 3), sono annidate e vengono contate);
 * - forma senza parentesi ("CREATE PROC p @a int, @b int AS"): si arriva fino all'`AS` di chiusura,
 *   saltando gli `AS` che dichiarano il tipo di un parametro ("@p AS int").
 * Commenti e stringhe sono già stati neutralizzati: un "as" in un commento non deve chiudere la
 * firma (prima faceva perdere tutti i parametri successivi).
 */
function firmaDellaRoutine(code: string, da: number): string {
  let i = da
  while (i < code.length && /\s/.test(code[i])) i += 1
  if (code[i] === '(') {
    let livello = 0
    for (let j = i; j < code.length; j++) {
      if (code[j] === '(') livello += 1
      else if (code[j] === ')') {
        livello -= 1
        if (livello === 0) return code.slice(i + 1, j)
      }
    }
    return code.slice(i + 1)
  }
  let livello = 0
  for (let j = i; j < code.length; j++) {
    const ch = code[j]
    if (ch === '(') livello += 1
    else if (ch === ')') livello = Math.max(0, livello - 1)
    else if (livello === 0 && (ch === 'A' || ch === 'a') && /^AS\b/i.test(code.slice(j, j + 3))) {
      const parolaPrima = /([A-Za-z0-9_@]+)\s*$/.exec(code.slice(0, j))?.[1] ?? ''
      if (parolaPrima.startsWith('@')) continue // "@p AS int": è il tipo, non la fine della firma
      return code.slice(i, j)
    }
  }
  return code.slice(i)
}

/**
 * Parametri della stored procedure/funzione che contiene il cursore: quando si
 * modifica una routine ("CREATE OR ALTER PROCEDURE …") l'intellisense deve
 * proporre anche i PARAMETRI (@… della firma), non solo le variabili DECLARATE
 * dentro il corpo. Restituisce quelli dell'ULTIMO header (CREATE/ALTER …
 * PROC/FUNCTION) presente nel testo prima del cursore; per un trigger → vuoto.
 * Commenti e stringhe vengono neutralizzati prima dell'analisi: dentro un commento
 * o un valore di default può comparire la parola "as", che non deve chiudere la firma.
 */
export function extractRoutineParameters(text: string): DeclaredVariable[] {
  const code = stripSqlNoise(text)
  const headerRe =
    /(?:^|;|\bGO\b|(?:\r?\n)\s*)(?:ALTER|CREATE)\s+(?:OR\s+ALTER\s+)?(?:PROC(?:EDURE)?|PROCEDURE|FUNCTION|FUN)\s+(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*))?/gi
  let last: RegExpExecArray | null = null
  let m: RegExpExecArray | null
  while ((m = headerRe.exec(code)) !== null) last = m
  if (!last) return []

  const out: DeclaredVariable[] = []
  const signature = firmaDellaRoutine(code, last.index + last[0].length)
  // nome@(eventuale AS) tipo(con lunghezza opzionale tipo "nvarchar(50)")
  const paramRe =
    /@([A-Za-z_][A-Za-z0-9_]*)\s+(?:(?:AS\s+)?)((?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:\(\s*\d+(?:\s*,\s*\d+)?\s*\))?)/gi
  let p: RegExpExecArray | null
  while ((p = paramRe.exec(signature)) !== null) {
    out.push({ name: `@${p[1]}`, dataType: p[2].replace(/\[|\]/g, '') })
  }
  return out
}
