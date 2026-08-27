using Microsoft.AspNetCore.Mvc;
using SqlIntelliBackend.Models;
using SqlIntelliBackend.Services;

namespace SqlIntelliBackend.Controllers;

/// <summary>Esegue query SQL e restituisce i result set e i messaggi (PRINT).</summary>
[ApiController]
[Route("api/query/{connectionId}")]
public class QueryController(ConnectionHub hub, QueryService query) : ControllerBase
{
    [HttpPost("execute")]
    public async Task<ActionResult<QueryResult>> Execute([FromRoute] string connectionId, [FromBody] ExecuteRequest req, CancellationToken ct)
    {
        var cs = hub.Get(connectionId);
        if (cs is null)
            return NotFound("Connessione non trovata o scaduta. Riconnettiti.");
        if (string.IsNullOrWhiteSpace(req.Sql))
            return BadRequest("SQL vuoto.");

        var result = await query.ExecuteAsync(cs, req.Sql, req.TimeoutSeconds, ct, req.CheckSyntax);
        return Ok(result);
    }
}
