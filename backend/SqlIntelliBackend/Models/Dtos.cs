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

public record FunctionInfo(string Schema, string Name, string Type);

public record SearchResult(string Schema, string Name, string ObjectType);

/// <summary>Definizione (testo) di un oggetto: stored procedure, funzione, vista, trigger.</summary>
public record ObjectDefinitionResponse(string Definition);

public record DatabaseSummary(
    List<TableInfo> Tables,
    List<ViewInfo> Views,
    List<ProcedureInfo> Procedures,
    List<TriggerInfo> Triggers,
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

// ---------- Manutenzione database (backup / restore) ----------

/// <summary>Semplice richiesta con percorso file (usata per HEADERONLY).</summary>
public record DbMaintenanceRequest(string Path);

/// <summary>Richiesta di lettura header con uno o più file (media set multi-file).</summary>
public record BackupInfoRequest(string? Path, List<string>? Paths = null);

/// <summary>Esito dell'upload di un file di backup selezionato localmente.</summary>
public record UploadBackupResponse(string Path, long SizeBytes);

/// <summary>Info del media (RESTORE LABELONLY): conteggio file e media set id.</summary>
public record MediaLabelResponse(int FamilyCount, string? MediaSetId, string? MediaName, string? Error);

/// <summary>Tipo di backup: 1 = completo, 5 = differenziale, 2 = log transazioni.</summary>
public record BackupRequest(
    string Path,
    string Type, // "full" | "differential" | "log"
    string Component, // "database" | "files"
    string? Database = null, // database da sottoporre a backup (default: quello attivo)
    List<string>? Files = null, // nomi logici dei file (component = files)
    List<string>? Filegroups = null, // nomi dei filegroup (component = files)
    string? Name = null, // nome del backup set
    string? Description = null,
    string OverwriteMode = "append", // "append" | "overwrite" | "format"
    string? MediaName = null, // per "format": nome del nuovo media set
    string? MediaDescription = null,
    bool Verify = false, // VERIFYONLY al termine
    bool Checksum = false,
    bool ContinueOnError = false,
    string Compression = "default", // "default" | "on" | "off"
    string? EncryptionAlgorithm = null, // "AES_128" | "AES_192" | "AES_256"
    string? EncryptionCertificate = null, // certificato server (sys.certificates)
    bool CopyOnly = false,
    string LogMode = "truncate", // per tipo log: "truncate" | "noTruncate" | "noRecovery"
    int? ExpiryDays = null,
    string? ExpiryDate = null // "yyyy-MM-dd"
);

/// <summary>Ripristino: uno o più file (media set), posizione del set e opzioni SSMS.</summary>
public record RestoreRequest(
    string? Path = null,
    List<string>? Paths = null, // media set: più file .bak (FROM DISK=…, DISK=…)
    int? FilePosition = null,
    string? DatabaseName = null, // database di destinazione (default: quello attivo)
    string? SourceDatabase = null, // nome db dentro il backup (per i MOVE)
    string SetType = "database", // "database" | "log" (dalla lista HEADERONLY)
    bool Replace = false,
    bool LeaveRestoring = false, // NORECOVERY
    string? StopAt = null, // punto nel tempo ISO "yyyy-MM-ddTHH:mm:ss.fff"
    List<FileMove>? MoveFiles = null,
    string? TailLogPath = null // backup della coda del log prima del restore
);

public record FileMove(string LogicalName, string PhysicalPath);

/// <summary>Un backup set letto con RESTORE HEADERONLY (colonne standard).</summary>
public record BackupSetInfo(
    string? Name,
    string? Description,
    int Type, // 1 full, 2 log, 5 differential
    string? TypeDescription,
    int Position,
    string? ServerName,
    string? DatabaseName,
    string? StartDate,
    string? FinishDate,
    long SizeBytes,
    string? FirstLsn,
    string? LastLsn,
    bool CopyOnly,
    bool HasChecksums,
    bool IsDamaged
);

public record BackupInfoResponse(List<BackupSetInfo> Sets, string? Error);

public record DbFileListResponse(List<DbFileEntry> Files, string? Error);

/// <summary>File del database (per BACKUP FILE/FILEGROUP e per i MOVE del restore).</summary>
public record DbFileEntry(string LogicalName, string PhysicalName, string Type, string? Filegroup, bool IsDefaultFilegroup);

public record CertEntry(string Name);

public record DbMaintenanceResponse(List<string> Messages, string? Error);
