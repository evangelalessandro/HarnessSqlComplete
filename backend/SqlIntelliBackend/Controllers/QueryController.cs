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

        // La VERIFICA DI SINTASSI non deve toccare la sessione: la usa solo per controllare il
        // testo, dentro una transazione ADO.NET sempre annullata. Va su una connessione a parte,
        // così non disturba una transazione aperta dall'utente.
        if (req.CheckSyntax)
            return Ok(await query.ExecuteAsync(cs, req.Sql, req.TimeoutSeconds, ct, checkSyntax: true));

        // Esecuzione normale: nella SESSIONE della connessione, così BEGIN TRAN/COMMIT/ROLLBACK e
        // le tabelle temporanee (#tmp) funzionano anche fra un'esecuzione e la successiva,
        // esattamente come in SSMS.
        await using var sessione = await hub.ApriSessioneAsync(connectionId, ct);
        if (sessione is null)
            return NotFound("Connessione non trovata o scaduta. Riconnettiti.");

        var result = await query.EseguiInSessioneAsync(sessione, req.Sql, req.TimeoutSeconds, ct);
        return Ok(result);
    }
}
