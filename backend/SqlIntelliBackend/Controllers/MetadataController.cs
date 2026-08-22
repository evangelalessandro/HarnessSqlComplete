using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using SqlIntelliBackend.Models;
using SqlIntelliBackend.Services;

namespace SqlIntelliBackend.Controllers;

/// <summary>Espone i metadati del database (tabelle, colonne, viste, procedure, trigger, funzioni, ricerca).</summary>
[ApiController]
[Route("api/metadata/{connectionId}")]
public class MetadataController(
    ConnectionHub hub,
    MetadataService metadata,
    MetadataCache cache,
    QueryService query) : ControllerBase
{
    private bool TryGetConnectionString(string connectionId, out string cs)
    {
        cs = hub.Get(connectionId) ?? "";
        return cs.Length > 0;
    }

    [HttpGet("summary")]
    public async Task<ActionResult<DatabaseSummary>> Summary([FromRoute] string connectionId, CancellationToken ct)
    {
        if (!TryGetConnectionString(connectionId, out var cs))
            return NotFound("Connessione non trovata o scaduta. Riconnettiti.");

        var cached = cache.Get(connectionId);
        if (cached is not null)
            return Ok(cached);

        var summary = await metadata.GetSummaryAsync(cs, ct);
        cache.Set(connectionId, summary);
        return Ok(summary);
    }

    [HttpGet("tables/{schema}/{table}/columns")]
    public async Task<ActionResult<List<ColumnInfo>>> TableColumns(
        [FromRoute] string connectionId, string schema, string table, CancellationToken ct)
    {
        if (!TryGetConnectionString(connectionId, out var cs))
            return NotFound("Connessione non trovata o scaduta. Riconnettiti.");
        var columns = await metadata.GetTableColumnsAsync(cs, schema, table, ct);
        return Ok(columns);
    }

    /// <summary>Anteprima dei dati di una tabella: SELECT TOP n * (usata dall'hover nel treeview).</summary>
    [HttpGet("tables/{schema}/{table}/preview")]
    public async Task<ActionResult<QueryResult>> TablePreview(
        [FromRoute] string connectionId, string schema, string table,
        [FromQuery] int top = 30, CancellationToken ct = default)
    {
        if (!TryGetConnectionString(connectionId, out var cs))
            return NotFound("Connessione non trovata o scaduta. Riconnettiti.");

        var n = Math.Clamp(top, 1, 500);
        var sql = $"SELECT TOP {n} * FROM [{EscapeBracket(schema)}].[{EscapeBracket(table)}]";
        var result = await query.ExecuteAsync(cs, sql, timeoutSeconds: 30, ct);

        // Fallback: se la SELECT * fallisce (es. colonne geography/geometry/UDT non materializzabili),
        // ripete convertendo in nvarchar(max) le colonne problematiche.
        if (result.Error != null)
        {
            var safeSql = await BuildSafePreviewSqlAsync(cs, schema, table, n, ct);
            if (safeSql != null)
            {
                var retry = await query.ExecuteAsync(cs, safeSql, timeoutSeconds: 30, ct);
                if (retry.Error == null) return Ok(retry);
            }
        }
        return Ok(result);
    }

    private static async Task<string?> BuildSafePreviewSqlAsync(
        string connectionString, string schema, string table, int top, CancellationToken ct)
    {
        try
        {
            await using var conn = new SqlConnection(connectionString);
            await conn.OpenAsync(ct);
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT c.name, ty.name, ty.is_user_defined
                FROM sys.columns c
                INNER JOIN sys.types ty ON c.user_type_id = ty.user_type_id
                WHERE c.object_id = OBJECT_ID(@fullName)
                ORDER BY c.column_id;
                """;
            cmd.Parameters.AddWithValue("@fullName", $"[{EscapeBracket(schema)}].[{EscapeBracket(table)}]");

            var parts = new List<string>();
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var name = r.GetString(0);
                var typeName = r.GetString(1);
                var isUdt = r.GetBoolean(2);
                var problematic = isUdt || typeName is "geography" or "geometry" or "hierarchyid";
                parts.Add(problematic
                    ? $"CONVERT(nvarchar(max), [{EscapeBracket(name)}]) AS [{EscapeBracket(name)}]"
                    : $"[{EscapeBracket(name)}]");
            }
            if (parts.Count == 0) return null;
            return $"SELECT TOP {top} {string.Join(", ", parts)} FROM [{EscapeBracket(schema)}].[{EscapeBracket(table)}]";
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Definizione (testo) di una stored procedure / funzione / vista / trigger: per Alter o apertura in nuova tab.</summary>
    [HttpGet("objects/{schema}/{name}/definition")]
    public async Task<ActionResult<ObjectDefinitionResponse>> ObjectDefinition(
        [FromRoute] string connectionId, string schema, string name, CancellationToken ct)
    {
        if (!TryGetConnectionString(connectionId, out var cs))
            return NotFound("Connessione non trovata o scaduta. Riconnettiti.");

        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT OBJECT_DEFINITION(OBJECT_ID(@fullName));";
        cmd.Parameters.AddWithValue("@fullName", $"[{EscapeBracket(schema)}].[{EscapeBracket(name)}]");
        var definition = await cmd.ExecuteScalarAsync(ct) as string;

        if (string.IsNullOrWhiteSpace(definition))
            return NotFound("Oggetto non trovato o definizione crittografata.");
        return Ok(new ObjectDefinitionResponse(definition));
    }

    [HttpGet("search")]
    public async Task<ActionResult<List<SearchResult>>> Search(
        [FromRoute] string connectionId, [FromQuery] string q, CancellationToken ct)
    {
        if (!TryGetConnectionString(connectionId, out var cs))
            return NotFound("Connessione non trovata o scaduta. Riconnettiti.");
        var results = await metadata.SearchAsync(cs, q, ct);
        return Ok(results);
    }

    /// <summary>Escape dei nomi oggetto per l'uso tra parentesi quadre SQL Server.</summary>
    private static string EscapeBracket(string name) => name.Replace("]", "]]");
}
