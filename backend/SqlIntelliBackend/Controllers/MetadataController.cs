using Microsoft.AspNetCore.Mvc;
using SqlIntelliBackend.Models;
using SqlIntelliBackend.Services;

namespace SqlIntelliBackend.Controllers;

/// <summary>Espone i metadati del database (tabelle, colonne, viste, procedure, trigger, funzioni, ricerca).</summary>
[ApiController]
[Route("api/metadata/{connectionId}")]
public class MetadataController(ConnectionHub hub, MetadataService metadata, MetadataCache cache) : ControllerBase
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

    [HttpGet("search")]
    public async Task<ActionResult<List<SearchResult>>> Search(
        [FromRoute] string connectionId, [FromQuery] string q, CancellationToken ct)
    {
        if (!TryGetConnectionString(connectionId, out var cs))
            return NotFound("Connessione non trovata o scaduta. Riconnettiti.");
        var results = await metadata.SearchAsync(cs, q, ct);
        return Ok(results);
    }
}
