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

// ---------- Query ----------

public record ExecuteRequest(string Sql, int? TimeoutSeconds, bool CheckSyntax = false);

public record ColumnResult(string Name, string DataType);

public record QueryResultSet(
    List<ColumnResult> Columns,
    List<List<object?>> Rows,
    long RowCount,
    long AffectedRows,
    bool Truncated);

public record QueryResult(
    List<QueryResultSet> ResultSets,
    long TotalAffectedRows,
    List<string> Messages,
    long ElapsedMs,
    string? Error);

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
