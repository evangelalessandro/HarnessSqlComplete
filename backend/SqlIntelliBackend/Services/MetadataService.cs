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

        // Foreign key (TUTTE le coppie di colonne: le composite generano più righe,
        // così ogni relazione utilizzabile — es. MIS_D_CELLA = CEL_CELLA — è suggeribile)
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT OBJECT_SCHEMA_NAME(fk.parent_object_id), OBJECT_NAME(fk.parent_object_id),
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
                    r.GetString(0), r.GetString(1), r.GetString(4),
                    r.GetString(2), r.GetString(3), r.GetString(5)));
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

        var databases = (await ListDatabasesAsync(connectionString, ct)).Select(d => new DatabaseInfo(d)).ToList();
        return new DatabaseSummary(tables, views, procs, triggers, functions, foreignKeys, databases);
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
}
