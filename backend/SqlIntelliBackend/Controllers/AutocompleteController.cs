using Microsoft.AspNetCore.Mvc;
using SqlIntelliBackend.Models;
using SqlIntelliBackend.Services;

namespace SqlIntelliBackend.Controllers;

/// <summary>Autocompletamento IA: invia la query parziale + schema del DB a DeepSeek e restituisce i suggerimenti.</summary>
[ApiController]
[Route("api/autocomplete/{connectionId}")]
public class AutocompleteController(
    ConnectionHub hub,
    DeepSeekService deepSeek,
    MetadataService metadata,
    MetadataCache cache) : ControllerBase
{
    [HttpGet("status")]
    public AutocompleteStatus Status()
    {
        var configured = deepSeek.IsConfigured;
        var apiKeyOverride = HttpContext.Request.Headers["X-DeepSeek-Key"].ToString();
        return new AutocompleteStatus(configured || !string.IsNullOrWhiteSpace(apiKeyOverride), deepSeek.Model, deepSeek.BaseUrl, !string.IsNullOrWhiteSpace(apiKeyOverride));
    }

    [HttpPost]
    public async Task<ActionResult<AutocompleteResponse>> Complete([FromRoute] string connectionId, [FromBody] AutocompleteRequest req, CancellationToken ct)
    {
        var cs = hub.Get(connectionId);
        if (cs is null)
            return NotFound("Connessione non trovata o scaduta. Riconnettiti.");
        if (string.IsNullOrWhiteSpace(req.Sql))
            return BadRequest(new AutocompleteResponse(null, "Nessun testo da completare."));

        var summary = cache.Get(connectionId);
        if (summary is null)
        {
            summary = await metadata.GetSummaryAsync(cs, ct);
            cache.Set(connectionId, summary);
        }

        var schemaContext = deepSeek.BuildSchemaContext(summary, req.Sql);
        var response = await deepSeek.CompleteAsync(req.Sql, schemaContext, req.ApiKey, req.MaxTokens, ct);
        return Ok(response);
    }
}
