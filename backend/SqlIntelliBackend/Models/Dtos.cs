using System.Text.Json.Serialization;

namespace SqlIntelliBackend.Models;

// ---------- Connessioni / Login ----------

public record ConnectionRequest(
    string? Name,
    string Server,
    int Port,
    string? Database,
    bool UseWindowsAuth,
    string? Username,
    string? Password,
    bool Save,
    bool? Encrypt,
    bool? TrustServerCertificate);

public record ConnectionTestResult(bool Success, string Message, string[]? Databases);

public record ConnectResponse(
    string ConnectionId,
    string Server,
    string Database,
    string[] Databases,
    string Message);

public record SavedConnectionDto(
    int Id,
    string Name,
    string Server,
    int Port,
    string? Database,
    bool UseWindowsAuth,
    string? Username,
    DateTime UpdatedAt);

public record SwitchDatabaseRequest(string Database);

public record DatabaseInfo(string Name);

// ---------- Metadati ----------

/// <summary>Metriche di utilizzo di una tabella nel database (per ranking dei suggerimenti JOIN).</summary>
public record TableUsage(int FkIncoming, int FkOutgoing, int DependencyCount, long RowCount);

/// <summary>Relazione di foreign key (una riga per COPPIA di colonne; le FK composite hanno lo stesso Name).</summary>
public record ForeignKeyInfo(
    string Name,
    string Schema,
    string Table,
    string Column,
    string RefSchema,
    string RefTable,
    string RefColumn);

/// <summary>Proprietà estesa (sys.extended_properties) di un oggetto o colonna.</summary>
public record ExtendedProperty(string Name, string Value);

public record ColumnInfo(
    string Name,
    string DataType,
    bool IsNullable,
    bool IsIdentity,
    bool IsComputed,
    int? MaxLength,
    string? Description,
    List<ExtendedProperty>? ExtendedProperties = null);

/// <summary>Indice di una tabella (nome, PK/UNIQUE e colonne chiave in ordine).</summary>
public record IndexInfo(string Name, bool IsPrimaryKey, bool IsUnique, List<string>? Columns = null);

public record TableInfo(
    string Schema,
    string Name,
    int ColumnCount,
    DateTime? CreateDate,
    List<ColumnInfo>? Columns = null,
    TableUsage? Usage = null,
    List<ExtendedProperty>? ExtendedProperties = null,
    List<IndexInfo>? Indexes = null);

public record ViewInfo(string Schema, string Name, DateTime? CreateDate);

public record ProcParamInfo(string Name, string DataType, string Mode, string? DefaultValue = null);

public record ProcedureInfo(
    string Schema,
    string Name,
    DateTime? CreateDate,
    List<ProcParamInfo>? Parameters = null);

public record TriggerInfo(string Schema, string TableName, string Name);

/// <summary>Vincolo CHECK di una tabella: nome, tabella di appartenenza e testo della condizione.</summary>
public record CheckConstraintInfo(
    string Schema,
    string TableName,
    string Name,
    string Definition,
    bool IsDisabled);

public record FunctionInfo(string Schema, string Name, string Type);

public record SearchResult(string Schema, string Name, string ObjectType);

/// <summary>Riga di dati trovata dalla ricerca testuale: intestazioni e valori (già troncati) delle colonne.</summary>
public record SearchHitRow(List<string> Columns, List<string> Values);

/// <summary>
/// Singolo risultato della ricerca testuale generale nel database: una STRUTTURA (match nel nome
/// o nella definizione) oppure un DATO (valore trovato in una colonna testuale).
/// </summary>
/// <param name="Kind">table | view | procedure | function | trigger | column | constraint | computed | data.</param>
/// <param name="Schema">Schema dell'oggetto (per le colonne: schema della tabella/vista).</param>
/// <param name="Name">Nome dell'oggetto; per le colonne il nome della COLONNA, per i dati il nome della TABELLA.</param>
/// <param name="Detail">Descrizione breve mostrata accanto al nome (es. "Stored procedure", "colonna di dbo.MAG_BAIE").</param>
/// <param name="MatchIn">definition | name | column | data.</param>
/// <param name="Line">Riga 1-based del match nella definizione, altrimenti null.</param>
/// <param name="Snippet">Riga (o estratto breve) che contiene il match, per l'anteprima.</param>
/// <param name="Row">Solo per kind="data": colonne e valori della riga trovata, altrimenti null.</param>
public record SearchHit(
    string Kind,
    string Schema,
    string Name,
    string Detail,
    string MatchIn,
    // Line/Snippet/Row sono SEMPRE serializzati, anche null: il contratto li prevede espliciti
    // e la configurazione globale del JSON li ometterebbe (DefaultIgnoreCondition = WhenWritingNull).
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] int? Line,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Snippet,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] SearchHitRow? Row);

/// <summary>Esito della ricerca testuale generale: hit, troncamento e contatori della scansione dei dati.</summary>
/// <param name="Truncated">true se i risultati (strutture o dati) sono stati tagliati dai limiti.</param>
/// <param name="ScannedTables">Tabelle/viste effettivamente scansionate per i dati (0 se data=false).</param>
/// <param name="TotalTables">Tabelle/viste candidate alla scansione dei dati (0 se data=false).</param>
/// <param name="Message">Messaggio facoltativo (es. testo di ricerca troppo corto).</param>
public record TextSearchResponse(
    List<SearchHit> Hits,
    bool Truncated,
    int ScannedTables,
    int TotalTables,
    long ElapsedMs,
    string? Message = null);

/// <summary>Definizione (testo) di un oggetto: stored procedure, funzione, vista, trigger.</summary>
public record ObjectDefinitionResponse(string Definition);

public record DatabaseSummary(
    List<TableInfo> Tables,
    List<ViewInfo> Views,
    List<ProcedureInfo> Procedures,
    List<TriggerInfo> Triggers,
    List<CheckConstraintInfo> CheckConstraints,
    List<FunctionInfo> Functions,
    List<ForeignKeyInfo> ForeignKeys,
    List<DatabaseInfo> Databases,
    List<TableCooccurrence>? Cooccurrences = null);

/// <summary>Coppia di tabelle che compaiono insieme nei JOIN reali delle stored procedure (per ranking).</summary>
public record TableCooccurrence(string TableA, string TableB, int Count);

/// <summary>
/// Legame di chiamata fra due routine (chi chiama → chi è chiamato), ricavato dalle
/// dipendenze reali registrate da SQL Server (sys.sql_expression_dependencies).
/// </summary>
public record RoutineCallEdge(
    string CallerSchema,
    string CallerName,
    string CallerType,
    string CalleeSchema,
    string CalleeName,
    string CalleeType);

/// <summary>
/// Grafo delle chiamate fra routine: solo i legami DIRETTI. Il percorso fino al chiamante
/// più lontano si calcola lato client, che è anche il posto dove si gestiscono i cicli.
/// </summary>
public record RoutineCallGraph(List<RoutineCallEdge> Edges, bool Truncated);

// ---------- Query ----------

public record ExecuteRequest(string Sql, int? TimeoutSeconds, bool CheckSyntax = false);

public record ColumnResult(string Name, string DataType);

public record QueryResultSet(
    List<ColumnResult> Columns,
    List<List<object?>> Rows,
    long RowCount,
    long AffectedRows,
    bool Truncated);

/// <summary>
/// Messaggio prodotto da SQL Server con gli stessi dati che mostra SSMS nei "Messaggi":
/// numero, livello, stato, PROCEDURA e riga. Serve a capire subito quale stored procedure
/// ha dato errore quando una query ne richiama diverse.
/// </summary>
/// <param name="Text">Testo del messaggio (senza intestazione).</param>
/// <param name="Display">Testo già pronto da mostrare, intestazione compresa (come in SSMS).</param>
public record QueryMessage(
    string Text,
    string Display,
    int Number = 0,
    int Severity = 0,
    int State = 0,
    string? Procedure = null,
    int Line = 0,
    bool IsError = false);

public record QueryResult(
    List<QueryResultSet> ResultSets,
    long TotalAffectedRows,
    List<string> Messages,
    long ElapsedMs,
    string? Error,
    /// <summary>Messaggi con numero/livello/procedura/riga (SSMS), per l'elenco dettagliato.</summary>
    List<QueryMessage>? Errors = null);

// ---------- Autocompletamento IA ----------

public record AutocompleteRequest(string Sql, string? ApiKey, int? MaxTokens);

public record SuggestionItem(string Text, string? Reason);

public record AutocompleteResponse(List<SuggestionItem>? Suggestions, string? Error);

public record AutocompleteStatus(bool Configured, string Model, string BaseUrl, bool HasApiKeyOverride);

// ---------- Report utilizzo tabelle ----------

/// <summary>Riga del report: spazio riservato/usato (KB), righe, indici e utilizzo.</summary>
public record TableReportRow(
    string Schema,
    string Name,
    string? CreateDate,
    long RowCount,
    long ReservedKb,
    long UsedKb,
    long DataKb,
    long IndexKb,
    long UnusedKb,
    int IndexCount,
    long Reads,
    long Writes,
    string? LastRead,
    string? LastWrite);
