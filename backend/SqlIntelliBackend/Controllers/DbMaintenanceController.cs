using Microsoft.Data.SqlClient;
using Microsoft.AspNetCore.Mvc;
using SqlIntelliBackend.Models;
using SqlIntelliBackend.Services;

namespace SqlIntelliBackend.Controllers;

/// <summary>
/// Manutenzione del database della connessione: BACKUP DATABASE e RESTORE DATABASE.
/// Il restore viene eseguito da una connessione a MASTER (il database va ripristinato
/// sopra quello in uso) e usa WITH REPLACE: attenzione, sovrascrive il database.
/// </summary>
[ApiController]
[Route("api/db/{connectionId}")]
public class DbMaintenanceController(ConnectionHub hub, QueryService query) : ControllerBase
{
    private bool TryGetCs(out string cs)
    {
        cs = hub.Get(RouteData.Values["connectionId"] as string ?? "");
        return cs.Length > 0;
    }

    /// <summary>Backup del database corrente su file (BACKUP DATABASE … TO DISK).</summary>
    [HttpPost("backup")]
    public async Task<ActionResult<DbMaintenanceResponse>> Backup([FromBody] DbMaintenanceRequest req, CancellationToken ct)
    {
        if (!TryGetCs(out var cs)) return NotFound("Connessione non trovata o scaduta. Riconnettiti.");
        var dbName = new SqlConnectionStringBuilder(cs).InitialCatalog;
        if (string.IsNullOrWhiteSpace(dbName))
            return BadRequest("Nessun database nella connessione corrente.");
        if (string.IsNullOrWhiteSpace(req.Path))
            return BadRequest("Specifica il percorso del file di backup (.bak).");

        var sql = $"BACKUP DATABASE [{dbName.Replace("]", "]]")}] TO DISK = N'{req.Path.Replace("'", "''")}' WITH FORMAT, INIT, STATS = 10;";
        var result = await query.ExecuteAsync(cs, sql, timeoutSeconds: 600, ct);
        return Ok(new DbMaintenanceResponse(result.Messages, result.Error));
    }

    /// <summary>Ripristina il database da file (.bak) — ATTENZIONE: sovrascrive (WITH REPLACE).</summary>
    [HttpPost("restore")]
    public async Task<ActionResult<DbMaintenanceResponse>> Restore([FromBody] DbMaintenanceRequest req, CancellationToken ct)
    {
        if (!TryGetCs(out var cs)) return NotFound("Connessione non trovata o scaduta. Riconnettiti.");
        var dbName = new SqlConnectionStringBuilder(cs).InitialCatalog;
        if (string.IsNullOrWhiteSpace(dbName))
            return BadRequest("Nessun database nella connessione corrente.");
        if (string.IsNullOrWhiteSpace(req.Path))
            return BadRequest("Specifica il percorso del file di backup (.bak).");

        // il restore del database in uso fallisce: ci colleghiamo a master
        var masterCs = new SqlConnectionStringBuilder(cs) { InitialCatalog = "master" }.ConnectionString;
        var sql = $"RESTORE DATABASE [{dbName.Replace("]", "]]")}] FROM DISK = N'{req.Path.Replace("'", "''")}' WITH REPLACE, RECOVERY, STATS = 10;";
        var result = await query.ExecuteAsync(masterCs, sql, timeoutSeconds: 900, ct);
        return Ok(new DbMaintenanceResponse(result.Messages, result.Error));
    }
}
