using Microsoft.AspNetCore.Mvc;
using SqlIntelliBackend.Models;
using SqlIntelliBackend.Services;

namespace SqlIntelliBackend.Controllers;

/// <summary>
/// Debug delle chiamate SQL: sessione con connessione PERSISTENTE, esecuzione
/// batch per batch (Step/Run) con risultati e messaggi per ogni passo.
/// </summary>
[ApiController]
[Route("api/debug/{connectionId}")]
public class DebugController(ConnectionHub hub, DebugSessionService debug) : ControllerBase
{
    private bool TryGetCs(out string cs)
    {
        cs = hub.Get(RouteData.Values["connectionId"] as string ?? "");
        return cs.Length > 0;
    }

    /// <summary>Avvia la sessione di debug: apre la connessione e splitta lo script in batch.</summary>
    [HttpPost("start")]
    public async Task<ActionResult<DebugStartResponse>> Start([FromBody] DebugStartRequest req, CancellationToken ct)
    {
        if (!TryGetCs(out var cs)) return NotFound("Connessione non trovata o scaduta. Riconnettiti.");
        if (string.IsNullOrWhiteSpace(req.Sql)) return BadRequest("SQL vuoto.");
        try
        {
            var res = await debug.StartAsync(cs, req.Sql, ct);
            return Ok(res);
        }
        catch (Exception ex)
        {
            return BadRequest(ex.Message);
        }
    }

    /// <summary>Esegue il batch successivo.</summary>
    [HttpPost("step")]
    public async Task<ActionResult<DebugStepResponse>> Step(CancellationToken ct)
    {
        if (!TryGetCs(out var cs)) return NotFound("Connessione non trovata o scaduta.");
        try
        {
            return Ok(await debug.StepAsync(cs, ct));
        }
        catch (Exception ex)
        {
            return BadRequest(ex.Message);
        }
    }

    /// <summary>Esegue tutti i batch rimanenti.</summary>
    [HttpPost("run")]
    public async Task<ActionResult<DebugRunResponse>> Run(CancellationToken ct)
    {
        if (!TryGetCs(out var cs)) return NotFound("Connessione non trovata o scaduta.");
        try
        {
            return Ok(await debug.RunAsync(cs, ct));
        }
        catch (Exception ex)
        {
            return BadRequest(ex.Message);
        }
    }

    /// <summary>Chiude la sessione di debug.</summary>
    [HttpPost("stop")]
    public async Task<ActionResult> Stop(CancellationToken ct)
    {
        if (TryGetCs(out var cs))
        {
            await debug.StopAsync(cs, ct);
        }
        return NoContent();
    }
}
