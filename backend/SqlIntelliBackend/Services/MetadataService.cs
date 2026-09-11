using Microsoft.Data.SqlClient;
using SqlIntelliBackend.Models;

namespace SqlIntelliBackend.Services;

/// <summary>Legge i metadati (tabelle, colonne, viste, procedure, trigger, funzioni, database) da SQL Server.</summary>
public class MetadataService
{
    public async Task<List<string>> ListDatabasesAsync(string connectionString, CancellationToken ct = default)
    {
        var dbs = new List<string>();
        await using var conn = new SqlConnection(connectionString);
        await conn.OpenAsync(ct);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT name FROM sys.databases ORDER BY name;";
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            dbs.Add(reader.GetString(0));
        return dbs;
    }

    public async Task<DatabaseSummary> GetSummaryAsync(string connectionString, CancellationToken ct = default)
    {
        await using var conn = new SqlConnection(connectionString);
        await conn.OpenAsync(ct);

        var tables = new List<TableInfo>();
        var columns = new Dictionary<(string, string), List<ColumnInfo>>();
        var views = new List<ViewInfo>();
        var procs = new List<ProcedureInfo>();
        var procParams = new Dictionary<(string, string), List<ProcParamInfo>>();
        var triggers = new List<TriggerInfo>();
        var checkConstraints = new List<CheckConstraintInfo>();
        var functions = new List<FunctionInfo>();
        var foreignKeys = new List<ForeignKeyInfo>();
        var dependencyCounts = new Dictionary<(string, string), int>();
        var rowCounts = new Dictionary<(string, string), long>();

        // Tabelle
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT s.name, t.name, t.create_date, t.modify_date,
                       (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = t.object_id) AS ColumnCount
                FROM sys.tables t
                INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE t.is_ms_shipped = 0
                ORDER BY s.name, t.name;
                """;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                tables.Add(new TableInfo(r.GetString(0), r.GetString(1), r.GetInt32(4), r.GetDateTime(2)));
        }

        // Colonne (una sola query per tutte le tabelle)
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT s.name, t.name, c.name, ty.name, c.max_length, c.precision, c.scale,
                       c.is_nullable, c.is_identity, c.is_computed
                FROM sys.columns c
                INNER JOIN sys.tables t ON c.object_id = t.object_id
                INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
                INNER JOIN sys.types ty ON c.user_type_id = ty.user_type_id
                WHERE t.is_ms_shipped = 0
                ORDER BY s.name, t.name, c.column_id;
                """;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var key = (r.GetString(0), r.GetString(1));
                if (!columns.TryGetValue(key, out var list))
                    columns[key] = list = [];
                list.Add(new ColumnInfo(
                    r.GetString(2),
                    r.GetString(3),
                    r.GetBoolean(7),
                    r.GetBoolean(8),
                    r.GetBoolean(9),
                    r.IsDBNull(4) ? null : (int)r.GetInt16(4),
                    Description: null));
            }
        }

        // Indici per tabella (una riga per indice, colonne chiave in ordine)
        var tableIndexes = new Dictionary<(string, string), List<IndexInfo>>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT s.name, t.name, i.name, i.is_primary_key, i.is_unique,
                       ISNULL(STUFF((
                         SELECT ', ' + c.name
                         FROM sys.index_columns ic
                         INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                         WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
                         ORDER BY ic.key_ordinal
                         FOR XML PATH('')), 1, 2, ''), '') AS Cols
                FROM sys.tables t
                INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
                INNER JOIN sys.indexes i ON i.object_id = t.object_id
                WHERE t.is_ms_shipped = 0 AND i.index_id > 0
                ORDER BY s.name, t.name, i.index_id;
                """;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var key = (r.GetString(0), r.GetString(1));
                if (!tableIndexes.TryGetValue(key, out var list))
                    tableIndexes[key] = list = [];
                var cols = r.GetString(5)
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .ToList();
                list.Add(new IndexInfo(r.GetString(2), r.GetBoolean(3), r.GetBoolean(4), cols));
            }
        }

        // Proprietà estese a livello di tabella
        var tableProps = new Dictionary<(string, string), List<ExtendedProperty>>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT s.name, t.name, ep.name, ISNULL(CONVERT(nvarchar(4000), ep.value), '')
                FROM sys.extended_properties ep
                INNER JOIN sys.tables t ON ep.major_id = t.object_id AND t.is_ms_shipped = 0
                INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
                WHERE ep.class = 1 AND ep.minor_id = 0
                ORDER BY s.name, t.name, ep.name;
                """;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var key = (r.GetString(0), r.GetString(1));
                if (!tableProps.TryGetValue(key, out var list))
                    tableProps[key] = list = [];
                list.Add(new ExtendedProperty(r.GetString(2), r.GetString(3)));
            }
        }

        // Proprietà estese a livello di colonna
        var columnProps = new Dictionary<(string, string, string), List<ExtendedProperty>>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT s.name, t.name, c.name, ep.name, ISNULL(CONVERT(nvarchar(4000), ep.value), '')
                FROM sys.extended_properties ep
                INNER JOIN sys.tables t ON ep.major_id = t.object_id AND t.is_ms_shipped = 0
                INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
                INNER JOIN sys.columns c ON c.object_id = ep.major_id AND c.column_id = ep.minor_id
                WHERE ep.class = 1 AND ep.minor_id > 0
                ORDER BY s.name, t.name, c.column_id, ep.name;
                """;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var key = (r.GetString(0), r.GetString(1), r.GetString(2));
                if (!columnProps.TryGetValue(key, out var list))
                    columnProps[key] = list = [];
                list.Add(new ExtendedProperty(r.GetString(3), r.GetString(4)));
            }
        }

        for (var i = 0; i < tables.Count; i++)
        {
            var t = tables[i];
            if (columns.TryGetValue((t.Schema, t.Name), out var cols))
            {
                var withProps = cols.Select(c =>
                {
                    if (!columnProps.TryGetValue((t.Schema, t.Name, c.Name), out var props))
                        return c;
                    var description = props.FirstOrDefault(p => p.Name == "MS_Description")?.Value;
                    return c with { Description = description, ExtendedProperties = props };
                }).ToList();
                cols = withProps;
            }
            tables[i] = t with
            {
                Columns = cols,
                ExtendedProperties = tableProps.GetValueOrDefault((t.Schema, t.Name)),
                Indexes = tableIndexes.GetValueOrDefault((t.Schema, t.Name)),
            };
        }

        // Viste
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT s.name, v.name, v.create_date, v.modify_date
                FROM sys.views v
                INNER JOIN sys.schemas s ON v.schema_id = s.schema_id
                WHERE v.is_ms_shipped = 0
                ORDER BY s.name, v.name;
                """;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                views.Add(new ViewInfo(r.GetString(0), r.GetString(1), r.GetDateTime(2)));
        }

        // Stored procedure
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT s.name, p.name, p.create_date, p.modify_date
                FROM sys.procedures p
                INNER JOIN sys.schemas s ON p.schema_id = s.schema_id
                WHERE p.is_ms_shipped = 0
                ORDER BY s.name, p.name;
                """;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                procs.Add(new ProcedureInfo(r.GetString(0), r.GetString(1), r.GetDateTime(2)));
        }

        // Parametri delle procedure
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT s.name, p.name, par.name, ty.name, par.is_output
                FROM sys.procedures p
                INNER JOIN sys.schemas s ON p.schema_id = s.schema_id
                INNER JOIN sys.parameters par ON par.object_id = p.object_id
                INNER JOIN sys.types ty ON par.user_type_id = ty.user_type_id
                ORDER BY s.name, p.name, par.parameter_id;
                """;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var key = (r.GetString(0), r.GetString(1));
                if (!procParams.TryGetValue(key, out var list))
                    procParams[key] = list = [];
                list.Add(new ProcParamInfo(r.GetString(2).TrimStart('@'), r.GetString(3), r.GetBoolean(4) ? "OUTPUT" : "IN"));
            }
        }
        for (var i = 0; i < procs.Count; i++)
        {
            var p = procs[i];
            if (procParams.TryGetValue((p.Schema, p.Name), out var pars))
                procs[i] = p with { Parameters = pars };
        }

        // Default dei parametri: sys.parameters.has_default_value è inaffidabile su alcuni server
        // (restituisce 0 anche con "= 0" esplicito), quindi estraiamo i default dalla DEFINIZIONE.
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT s.name, p.name, m.definition
                FROM sys.procedures p
                INNER JOIN sys.schemas s ON p.schema_id = s.schema_id
                INNER JOIN sys.sql_modules m ON p.object_id = m.object_id
                WHERE p.is_ms_shipped = 0
                  AND EXISTS (SELECT 1 FROM sys.parameters par
                              WHERE par.object_id = p.object_id AND par.parameter_id > 0);
                """;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var schema = r.GetString(0);
                var name = r.GetString(1);
                var definition = r.GetString(2);
                if (!procParams.TryGetValue((schema, name), out var pars)) continue;
                var defaults = ExtractParameterDefaults(definition);
                if (defaults.Count == 0) continue;
                for (var i = 0; i < pars.Count; i++)
                {
                    if (defaults.TryGetValue(pars[i].Name.ToLowerInvariant(), out var def))
                        pars[i] = pars[i] with { DefaultValue = def };
                }
            }
        }

        // Trigger
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT ISNULL(s.name, ''), ISNULL(OBJECT_NAME(tr.parent_id), ''), tr.name
                FROM sys.triggers tr
                LEFT JOIN sys.objects o ON tr.parent_id = o.object_id
                LEFT JOIN sys.schemas s ON o.schema_id = s.schema_id
                WHERE tr.is_ms_shipped = 0
                ORDER BY s.name, OBJECT_NAME(tr.parent_id), tr.name;
                """;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                triggers.Add(new TriggerInfo(r.GetString(0), r.GetString(1), r.GetString(2)));
        }

        // Vincoli CHECK (una riga per vincolo: nome, tabella e testo della condizione)
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT s.name, t.name, cc.name, cc.definition, cc.is_disabled
                FROM sys.check_constraints cc
                INNER JOIN sys.tables t ON cc.parent_object_id = t.object_id
                INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE cc.is_ms_shipped = 0 AND t.is_ms_shipped = 0
                ORDER BY s.name, t.name, cc.name;
                """;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                checkConstraints.Add(new CheckConstraintInfo(
                    r.GetString(0),
                    r.GetString(1),
                    r.GetString(2),
                    r.GetString(3),
                    r.GetBoolean(4)));
        }

        // Funzioni utente
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT s.name, f.name, f.type_desc
                FROM sys.objects f
                INNER JOIN sys.schemas s ON f.schema_id = s.schema_id
                WHERE f.type IN ('FN','IF','TF') AND f.is_ms_shipped = 0
                ORDER BY s.name, f.name;
                """;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                functions.Add(new FunctionInfo(r.GetString(0), r.GetString(1), r.GetString(2)));
        }

        // Foreign key (TUTTE le coppie di colonne: le composite generano più righe con lo stesso Name,
        // così ogni relazione utilizzabile — es. MIS_D_CELLA = CEL_CELLA — è suggeribile)
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT fk.name,
                       OBJECT_SCHEMA_NAME(fk.parent_object_id), OBJECT_NAME(fk.parent_object_id),
                       OBJECT_SCHEMA_NAME(fk.referenced_object_id), OBJECT_NAME(fk.referenced_object_id),
                       pc.name, rc.name
                FROM sys.foreign_keys fk
                INNER JOIN sys.foreign_key_columns fkc
                        ON fkc.constraint_object_id = fk.object_id
                INNER JOIN sys.columns pc ON pc.object_id = fk.parent_object_id AND pc.column_id = fkc.parent_column_id
                INNER JOIN sys.columns rc ON rc.object_id = fk.referenced_object_id AND rc.column_id = fkc.referenced_column_id
                WHERE fk.is_ms_shipped = 0
                ORDER BY 1, 2;
                """;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                foreignKeys.Add(new ForeignKeyInfo(
                    r.GetString(0),
                    r.GetString(1), r.GetString(2), r.GetString(5),
                    r.GetString(3), r.GetString(4), r.GetString(6)));
        }

        // Numero di oggetti (viste, procedure, funzioni, trigger) che referenziano ogni tabella
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT o.name, s.name, d.cnt
                FROM (
                    SELECT referenced_id AS oid, COUNT(DISTINCT referencing_id) AS cnt
                    FROM sys.sql_expression_dependencies
                    WHERE referenced_class = 1 AND referenced_id IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM sys.objects ro
                          WHERE ro.object_id = referencing_id AND ro.type IN ('F','D'))
                    GROUP BY referenced_id
                ) d
                INNER JOIN sys.objects o ON o.object_id = d.oid
                INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
                WHERE o.type = 'U' AND o.is_ms_shipped = 0;
                """;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                dependencyCounts[(r.GetString(1), r.GetString(0))] = r.GetInt32(2);
        }

        // Righe stimate per tabella (heap index_id 0 + clustered index_id 1)
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT s.name, o.name, SUM(p.rows)
                FROM sys.partitions p
                INNER JOIN sys.objects o ON o.object_id = p.object_id
                INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
                WHERE p.index_id IN (0, 1) AND o.type = 'U' AND o.is_ms_shipped = 0
                GROUP BY s.name, o.name;
                """;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                rowCounts[(r.GetString(0), r.GetString(1))] = r.GetInt64(2);
        }

        // Metriche di utilizzo per tabella
        var fkOutgoing = foreignKeys.GroupBy(f => (f.Schema, f.Table)).ToDictionary(g => g.Key, g => g.Count());
        var fkIncoming = foreignKeys.GroupBy(f => (f.RefSchema, f.RefTable)).ToDictionary(g => g.Key, g => g.Count());
        for (var i = 0; i < tables.Count; i++)
        {
            var t = tables[i];
            var key = (t.Schema, t.Name);
            tables[i] = t with
            {
                Usage = new TableUsage(
                    fkIncoming.GetValueOrDefault(key),
                    fkOutgoing.GetValueOrDefault(key),
                    dependencyCounts.GetValueOrDefault(key),
                    rowCounts.GetValueOrDefault(key)),
            };
        }

        // Co-occorrenza: coppie di tabelle che compaiono negli stessi JOIN delle definizioni
        // (procedure + viste + funzioni). Base per i suggerimenti "quali tabelle si uniscono insieme".
        // Il testo SQL contiene anche funzioni tabellari (FROM dbo.fn_X), viste di sistema
        // (FROM sys.databases) e alias: si tengono SOLO i nomi di tabelle reali, altrimenti
        // si accumulano coppie fasulle che non corrispondono ad alcun suggerimento possibile.
        var cooccurrencePairs = new Dictionary<string, int>();
        var realTableNames = new HashSet<string>(tables.Select(t => t.Name), StringComparer.OrdinalIgnoreCase);
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT m.definition
                FROM sys.sql_modules m
                INNER JOIN sys.objects o ON o.object_id = m.object_id
                WHERE o.is_ms_shipped = 0
                  AND o.type IN ('P', 'V', 'FN', 'IF', 'TF');
                """;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var definition = r.GetString(0);
                foreach (var pair in ExtractCooccurrencePairs(definition))
                {
                    // scarta funzioni/viste di sistema/alias: solo coppie tra tabelle esistenti
                    if (!realTableNames.Contains(pair.Item1) || !realTableNames.Contains(pair.Item2)) continue;
                    var key = pair.Item1 + "|" + pair.Item2;
                    cooccurrencePairs[key] = cooccurrencePairs.GetValueOrDefault(key) + 1;
                }
            }
        }
        var cooccurrences = cooccurrencePairs
            .Where(kv => kv.Value >= 2) // solo relazioni ricorrenti (almeno 2 volte nel codice)
            .Select(kv =>
            {
                var parts = kv.Key.Split('|');
                return new TableCooccurrence(parts[0], parts[1], kv.Value);
            })
            .OrderByDescending(c => c.Count)
            .Take(500)
            .ToList();

        var databases = (await ListDatabasesAsync(connectionString, ct)).Select(d => new DatabaseInfo(d)).ToList();
        return new DatabaseSummary(tables, views, procs, triggers, checkConstraints, functions, foreignKeys, databases, cooccurrences);
    }

    /// <summary>Numero massimo di legami restituiti (protezione per database molto grandi).</summary>
    private const int MaxCallEdges = 20000;

    /// <summary>
    /// Grafo delle chiamate fra routine: chi chiama chi, letto dalle dipendenze reali che
    /// SQL Server registra per procedure, funzioni, trigger e viste.
    /// Sono inclusi anche i legami di una routine verso SE STESSA (procedure/funzioni
    /// ricorsive): il percorso si calcola lato client, che protegge dai cicli.
    /// </summary>
    public async Task<RoutineCallGraph> GetRoutineCallGraphAsync(string connectionString, CancellationToken ct = default)
    {
        await using var conn = new SqlConnection(connectionString);
        await conn.OpenAsync(ct);
        await using var cmd = conn.CreateCommand();
        // Un solo giro sul catalogo: si leggono i legami diretti, il resto si calcola dopo.
        // - chi chiama: procedure, trigger, funzioni e viste (una vista che usa una funzione
        //   è un punto di partenza reale della catena);
        // - chi è chiamato: solo routine (procedure e funzioni), non tabelle o viste.
        cmd.CommandText = """
            SELECT DISTINCT
                   s1.name AS CallerSchema, o1.name AS CallerName, RTRIM(o1.type) AS CallerType,
                   s2.name AS CalleeSchema, o2.name AS CalleeName, RTRIM(o2.type) AS CalleeType
            FROM sys.sql_expression_dependencies d
            INNER JOIN sys.objects o1 ON o1.object_id = d.referencing_id
            INNER JOIN sys.schemas s1 ON s1.schema_id = o1.schema_id
            INNER JOIN sys.objects o2 ON o2.object_id = d.referenced_id
            INNER JOIN sys.schemas s2 ON s2.schema_id = o2.schema_id
            WHERE d.referenced_id IS NOT NULL
              AND o1.is_ms_shipped = 0
              AND o2.is_ms_shipped = 0
              AND o1.type IN ('P', 'TR', 'FN', 'IF', 'TF', 'V')
              AND o2.type IN ('P', 'FN', 'IF', 'TF')
            ORDER BY CallerSchema, CallerName, CalleeSchema, CalleeName;
            """;

        var edges = new List<RoutineCallEdge>();
        var truncated = false;
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            if (edges.Count >= MaxCallEdges)
            {
                truncated = true;
                break;
            }
            edges.Add(new RoutineCallEdge(
                r.GetString(0), r.GetString(1), r.GetString(2),
                r.GetString(3), r.GetString(4), r.GetString(5)));
        }
        return new RoutineCallGraph(edges, truncated);
    }

    public async Task<List<ColumnInfo>> GetTableColumnsAsync(string connectionString, string schema, string table, CancellationToken ct = default)
    {
        await using var conn = new SqlConnection(connectionString);
        await conn.OpenAsync(ct);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT c.name, ty.name, c.max_length, c.precision, c.scale,
                   c.is_nullable, c.is_identity, c.is_computed,
                   ISNULL(CONVERT(nvarchar(4000), ep.value), '')
            FROM sys.columns c
            INNER JOIN sys.types ty ON c.user_type_id = ty.user_type_id
            LEFT JOIN sys.extended_properties ep
                   ON ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description'
            WHERE c.object_id = OBJECT_ID(@fullName)
            ORDER BY c.column_id;
            """;
        cmd.Parameters.AddWithValue("@fullName", $"[{schema}].[{table}]");
        var result = new List<ColumnInfo>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            result.Add(new ColumnInfo(
                r.GetString(0), r.GetString(1),
                r.GetBoolean(5), r.GetBoolean(6), r.GetBoolean(7),
                r.IsDBNull(2) ? null : r.GetInt32(2),
                r.IsDBNull(8) ? null : r.GetString(8)));
        }
        return result;
    }

    public async Task<List<SearchResult>> SearchAsync(string connectionString, string query, CancellationToken ct = default)
    {
        var results = new List<SearchResult>();
        if (string.IsNullOrWhiteSpace(query)) return results;

        await using var conn = new SqlConnection(connectionString);
        await conn.OpenAsync(ct);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT TOP 200 s.name, o.name,
                   CASE o.type
                       WHEN 'U' THEN 'table' WHEN 'V' THEN 'view' WHEN 'P' THEN 'procedure'
                       WHEN 'FN' THEN 'function' WHEN 'IF' THEN 'function' WHEN 'TF' THEN 'function'
                       ELSE o.type END
            FROM sys.objects o
            INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
            WHERE o.is_ms_shipped = 0
              AND o.type IN ('U','V','P','FN','IF','TF')
              AND o.name LIKE @pattern
            ORDER BY CASE o.type WHEN 'U' THEN 1 WHEN 'V' THEN 2 WHEN 'P' THEN 3 ELSE 4 END, o.name;
            """;
        cmd.Parameters.AddWithValue("@pattern", $"%{query}%");
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
            results.Add(new SearchResult(r.GetString(0), r.GetString(1), r.GetString(2)));
        return results;
    }

    /// <summary>
    /// Estrae i valori di default dei parametri dalla definizione CREATE PROCEDURE
    /// (sys.parameters.has_default_value è inaffidabile: restituisce 0 anche con default espliciti).
    /// Gestisce tipi con parentesi (nvarchar(50)), OUTPUT, commenti e virgole nei default (es. GETDATE()).
    /// </summary>
    internal static Dictionary<string, string> ExtractParameterDefaults(string definition)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(definition)) return result;

        // Trova la prima parentesi aperta dopo il nome della procedura (inizio della lista parametri)
        var openIdx = definition.IndexOf('(');
        if (openIdx < 0) return result;
        // Chiude bilanciando le parentesi (i default possono contenere chiamate con parentesi)
        var depth = 0;
        var closeIdx = -1;
        for (var i = openIdx; i < definition.Length; i++)
        {
            var ch = definition[i];
            if (ch == '(') depth++;
            else if (ch == ')')
            {
                depth--;
                if (depth == 0) { closeIdx = i; break; }
            }
        }
        if (closeIdx < 0) return result;

        var signature = definition.Substring(openIdx + 1, closeIdx - openIdx - 1);
        // Divide in parametri: virgole fuori da parentesi e stringhe
        foreach (var raw in SplitSignatureParams(signature))
        {
            var m = System.Text.RegularExpressions.Regex.Match(
                raw,
                @"@\s*([A-Za-z_][A-Za-z0-9_]*)\s+([^=]+?)\s*=\s*(.+?)\s*$",
                System.Text.RegularExpressions.RegexOptions.Singleline | System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (!m.Success) continue;
            var defaultValue = m.Groups[3].Value.Trim();
            // toglie OUTPUT/READONLY residui dal default (raro ma possibile)
            defaultValue = System.Text.RegularExpressions.Regex.Replace(
                defaultValue, @"\s+(OUTPUT|READONLY)\s*$", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            result[m.Groups[1].Value.Trim()] = defaultValue;
        }
        return result;
    }

    /// <summary>Divide la firma in segmenti (parametri) rispettando parentesi e stringhe.</summary>
    private static IEnumerable<string> SplitSignatureParams(string signature)
    {
        var parts = new List<string>();
        var start = 0;
        var depth = 0;
        var inString = false;
        for (var i = 0; i < signature.Length; i++)
        {
            var ch = signature[i];
            if (ch == '\'')
            {
                // gestisce '' come escape
                inString = !inString && (i == 0 || signature[i - 1] != '\'');
            }
            else if (!inString)
            {
                if (ch == '(') depth++;
                else if (ch == ')') depth--;
                else if (ch == ',' && depth == 0)
                {
                    parts.Add(signature.Substring(start, i - start));
                    start = i + 1;
                }
            }
        }
        parts.Add(signature.Substring(start));
        return parts;
    }

    /// <summary>
    /// Estrae le coppie ordinate (A,B) di tabelle che compaiono nello stesso statement
    /// (FROM A ... JOIN B): in pratica quali tabelle vengono unite insieme nel codice.
    /// </summary>
    internal static IEnumerable<(string, string)> ExtractCooccurrencePairs(string definition)
    {
        // estrae la sequenza di tabelle referenziate (FROM/JOIN/UPDATE/INTO/TABLE) ignorando commenti e stringhe
        var clean = StripCommentsAndStrings(definition);
        var re = new System.Text.RegularExpressions.Regex(
            @"\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+((?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*))?)",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        var names = new List<string>();
        foreach (System.Text.RegularExpressions.Match m in re.Matches(clean))
        {
            var token = m.Groups[1].Value.Replace("[", "").Replace("]", "").Trim();
            if (token.Length == 0) continue;
            var parts = token.Split('.');
            var name = parts[parts.Length - 1];
            if (name.Length > 0 && !IsSqlKeyword(name)) names.Add(name);
        }
        // coppie consecutive nella sequenza (la tabella A è unita a B nel JOIN successivo)
        var pairs = new List<(string, string)>();
        for (var i = 1; i < names.Count; i++)
            pairs.Add((names[i - 1], names[i]));
        return pairs;
    }

    private static bool IsSqlKeyword(string word)
    {
        return word.Equals("SELECT", StringComparison.OrdinalIgnoreCase)
            || word.Equals("WHERE", StringComparison.OrdinalIgnoreCase)
            || word.Equals("ON", StringComparison.OrdinalIgnoreCase)
            || word.Equals("SET", StringComparison.OrdinalIgnoreCase)
            || word.Equals("VALUES", StringComparison.OrdinalIgnoreCase)
            || word.Equals("GROUP", StringComparison.OrdinalIgnoreCase)
            || word.Equals("ORDER", StringComparison.OrdinalIgnoreCase)
            || word.Equals("BY", StringComparison.OrdinalIgnoreCase)
            || word.Equals("TOP", StringComparison.OrdinalIgnoreCase)
            || word.Equals("DISTINCT", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Rimuove commenti (-- e /* */) e stringhe (tra apici) da una definizione SQL.</summary>
    private static string StripCommentsAndStrings(string sql)
    {
        var sb = new System.Text.StringBuilder(sql.Length);
        var i = 0;
        var n = sql.Length;
        while (i < n)
        {
            var ch = sql[i];
            if (ch == '\'' && i + 1 < n && sql[i + 1] == '\'') { sb.Append("  "); i += 2; continue; } // '' escape
            if (ch == '\'')
            {
                sb.Append(' ');
                i++;
                while (i < n && !(sql[i] == '\'' && (i + 1 >= n || sql[i + 1] != '\''))) i++;
                if (i < n) { sb.Append(' '); i++; }
                continue;
            }
            if (ch == '-' && i + 1 < n && sql[i + 1] == '-')
            {
                while (i < n && sql[i] != '\n') { sb.Append(' '); i++; }
                continue;
            }
            if (ch == '/' && i + 1 < n && sql[i + 1] == '*')
            {
                i += 2;
                while (i + 1 < n && !(sql[i] == '*' && sql[i + 1] == '/')) i++;
                i = Math.Min(n, i + 2);
                continue;
            }
            sb.Append(ch);
            i++;
        }
        return sb.ToString();
    }
}
