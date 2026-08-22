using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using SqlIntelliBackend.Data;
using SqlIntelliBackend.Models;
using SqlIntelliBackend.Services;

namespace SqlIntelliBackend.Controllers;

/// <summary>Gestisce test, connessione, disconnessione e salvataggio delle login ai database SQL Server.</summary>
[ApiController]
[Route("api/connections")]
public class ConnectionsController(AppDbContext db, ConnectionHub hub, MetadataService metadata) : ControllerBase
{
    [HttpGet]
    public ActionResult<List<SavedConnectionDto>> List()
    {
        var items = db.SavedConnections
            .OrderBy(c => c.Name)
            .Select(c => new SavedConnectionDto(
                c.Id, c.Name, c.Server, c.Port, c.Database, c.UseWindowsAuth, c.Username, c.UpdatedAt))
            .ToList();
        return Ok(items);
    }

    [HttpPost("test")]
    public async Task<ActionResult<ConnectionTestResult>> Test([FromBody] ConnectionRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Server))
            return Ok(new ConnectionTestResult(false, "Il server è obbligatorio.", null));

        var cs = SqlConnectionStringFactory.Build(req);
        try
        {
            await using var conn = new SqlConnection(cs);
            await conn.OpenAsync(ct);
            var dbs = await metadata.ListDatabasesAsync(cs, ct);
            return Ok(new ConnectionTestResult(true, "Connessione riuscita.", dbs.ToArray()));
        }
        catch (Exception ex)
        {
            return Ok(new ConnectionTestResult(false, ex.Message, null));
        }
    }

    [HttpPost("connect")]
    public async Task<ActionResult<ConnectResponse>> Connect([FromBody] ConnectionRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Server))
            return BadRequest(new ConnectResponse("", "", "", [], "Il server è obbligatorio."));

        var cs = SqlConnectionStringFactory.Build(req);
        var (ok, message, actualDb, databases) = await TryConnectAsync(cs, req.Database, ct);
        if (!ok)
            return BadRequest(new ConnectResponse("", req.Server, "", [], message));

        if (req.Save)
        {
            var name = string.IsNullOrWhiteSpace(req.Name) ? DefaultName(req) : req.Name.Trim();
            var existing = await db.SavedConnections.FirstOrDefaultAsync(c => c.Name == name, ct);
            if (existing is null)
            {
                existing = new SavedConnection { Name = name, CreatedAt = DateTime.UtcNow };
                db.SavedConnections.Add(existing);
            }
            existing.Server = req.Server;
            existing.Port = req.Port is > 0 ? req.Port : 1433;
            existing.Database = req.Database;
            existing.UseWindowsAuth = req.UseWindowsAuth;
            existing.Username = req.Username;
            if (!req.UseWindowsAuth && !string.IsNullOrEmpty(req.Password))
                existing.EncryptedPassword = ConnectionCrypto.Encrypt(req.Password);
            existing.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
        }

        var connectionId = hub.Register(cs);
        return Ok(new ConnectResponse(connectionId, SqlConnectionStringFactory.ServerName(req), actualDb, databases, message));
    }

    [HttpPost("saved/{id:int}/connect")]
    public async Task<ActionResult<ConnectResponse>> ConnectSaved(int id, CancellationToken ct)
    {
        var saved = await db.SavedConnections.FindAsync([id], ct);
        if (saved is null)
            return NotFound("Login non trovata.");

        var cs = SqlConnectionStringFactory.Build(saved);
        var (ok, message, actualDb, databases) = await TryConnectAsync(cs, saved.Database, ct);
        if (!ok)
            return BadRequest(new ConnectResponse("", saved.Server, "", [], message));

        saved.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var connectionId = hub.Register(cs);
        return Ok(new ConnectResponse(connectionId, saved.Server, actualDb, databases, message));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var saved = await db.SavedConnections.FindAsync([id], ct);
        if (saved is null)
            return NotFound();
        db.SavedConnections.Remove(saved);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPost("{connectionId}/disconnect")]
    public IActionResult Disconnect(string connectionId)
    {
        hub.Remove(connectionId);
        return NoContent();
    }

    private static string DefaultName(ConnectionRequest req) =>
        $"{req.Server}{(req.Port is > 0 and not 1433 ? $",{req.Port}" : "")}" +
        (string.IsNullOrWhiteSpace(req.Database) ? "" : $" · {req.Database}") +
        (req.UseWindowsAuth ? " (Windows)" : $" ({req.Username})");

    private async Task<(bool Ok, string Message, string ActualDb, string[] Databases)> TryConnectAsync(
        string cs, string? requestedDb, CancellationToken ct)
    {
        try
        {
            await using var conn = new SqlConnection(cs);
            await conn.OpenAsync(ct);
            var dbs = await metadata.ListDatabasesAsync(cs, ct);
            return (true, "Connessione riuscita.", requestedDb ?? "master", dbs.ToArray());
        }
        catch (SqlException) when (!string.IsNullOrWhiteSpace(requestedDb))
        {
            // Fallback: il database richiesto potrebbe non esistere → connetti su master
            var master = new SqlConnectionStringBuilder(cs) { InitialCatalog = "master" };
            try
            {
                await using var conn = new SqlConnection(master.ConnectionString);
                await conn.OpenAsync(ct);
                var dbs = await metadata.ListDatabasesAsync(master.ConnectionString, ct);
                return (true,
                    "Connesso al server; il database richiesto non è disponibile, si usa 'master'.",
                    "master", dbs.ToArray());
            }
            catch (SqlException ex2)
            {
                return (false, ex2.Message, "", []);
            }
        }
        catch (SqlException ex)
        {
            return (false, ex.Message, "", []);
        }
    }
}
