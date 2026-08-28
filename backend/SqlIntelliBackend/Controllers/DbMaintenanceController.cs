using Microsoft.Data.SqlClient;
using Microsoft.AspNetCore.Mvc;
using SqlIntelliBackend.Models;
using SqlIntelliBackend.Services;

namespace SqlIntelliBackend.Controllers;

/// <summary>
/// Manutenzione del database della connessione: BACKUP DATABASE (con tutte le opzioni
/// stile SSMS), lettura dei periodi/backup set dal file (RESTORE HEADERONLY), elenco
/// dei file del backup (RESTORE FILELISTONLY) e RESTORE DATABASE/LOG con punto nel
/// tempo (STOPAT), MOVE dei file e backup della coda del log.
/// Il restore viene eseguito da una connessione a MASTER e usa REPLACE solo se richiesto:
/// attenzione, sovrascrive il database.
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

    private static string Esc(string s) => s.Replace("'", "''");
    private static string EscBracket(string s) => s.Replace("]", "]]");

    /// <summary>Unisce path singolo (legacy) e lista media set in un elenco pulito di percorsi.</summary>
    private static List<string> ResolvePaths(string? single, List<string>? many)
    {
        var outList = new List<string>();
        if (!string.IsNullOrWhiteSpace(single)) outList.Add(single.Trim());
        if (many is not null)
            foreach (var p in many)
                if (!string.IsNullOrWhiteSpace(p) && !outList.Contains(p.Trim()))
                    outList.Add(p.Trim());
        return outList;
    }

    /// <summary>"DISK = N'p1', DISK = N'p2'" per i media set multi-file.</summary>
    private static string FromDisks(List<string> paths) =>
        string.Join(", ", paths.Select(p => $"DISK = N'{Esc(p)}'"));

    private ActionResult Bad(string message) => BadRequest(message);

    private string? ActiveDbName(string cs, out string? error)
    {
        error = null;
        var dbName = new SqlConnectionStringBuilder(cs).InitialCatalog;
        if (string.IsNullOrWhiteSpace(dbName))
            error = "Nessun database nella connessione corrente.";
        return dbName;
    }

    /// <summary>Backup del database con le opzioni del dialogo SSMS (tipo, componenti, compressione, crittografia…).</summary>
    [HttpPost("backup")]
    public async Task<ActionResult<DbMaintenanceResponse>> Backup([FromBody] BackupRequest req, CancellationToken ct)
    {
        if (!TryGetCs(out var cs)) return NotFound("Connessione non trovata o scaduta. Riconnettiti.");
        string? dbName;
        string? dbErr = null;
        if (!string.IsNullOrWhiteSpace(req.Database))
            dbName = req.Database;
        else
            dbName = ActiveDbName(cs, out dbErr);
        if (dbErr != null) return Bad(dbErr);
        if (string.IsNullOrWhiteSpace(req.Path)) return Bad("Specifica il percorso del file di backup (.bak).");

        var sql = BuildBackupSql(dbName!, req);
        var messages = new List<string>();
        var result = await query.ExecuteAsync(cs, sql, timeoutSeconds: 600, ct);
        if (result.Error != null)
            return Ok(new DbMaintenanceResponse(result.Messages, result.Error));
        messages.AddRange(result.Messages);

        // "Verifica backup al termine" (come SSMS): RESTORE VERIFYONLY sul file appena scritto
        if (req.Verify)
        {
            var verifySql = $"RESTORE VERIFYONLY FROM DISK = N'{Esc(req.Path)}'{(req.Checksum ? " WITH CHECKSUM" : "")};";
            var vres = await query.ExecuteAsync(cs, verifySql, timeoutSeconds: 600, ct);
            messages.AddRange(vres.Messages);
            if (vres.Error != null)
                messages.Add($"VERIFYONLY: {vres.Error}");
            else
                messages.Add("Verifica del backup completata (VERIFYONLY).");
        }

        return Ok(new DbMaintenanceResponse(messages, null));
    }

    private static string BuildBackupSql(string dbName, BackupRequest req)
    {
        var sb = new System.Text.StringBuilder();
        var verb = req.Type switch
        {
            "log" => $"BACKUP LOG [{EscBracket(dbName)}]",
            "differential" => $"BACKUP DATABASE [{EscBracket(dbName)}]",
            _ => $"BACKUP DATABASE [{EscBracket(dbName)}]",
        };
        sb.Append(verb);

        // Componente: file e filegroup (BACKUP DATABASE … FILE = N'…', FILEGROUP = N'…')
        if (req.Type != "log" && req.Component == "files")
        {
            var items = new List<string>();
            if (req.Files is { Count: > 0 })
                items.AddRange(req.Files.Select(f => $"FILE = N'{Esc(f)}'"));
            if (req.Filegroups is { Count: > 0 })
                items.AddRange(req.Filegroups.Select(g => $"FILEGROUP = N'{Esc(g)}'"));
            if (items.Count > 0) sb.Append(' ').Append(string.Join(", ", items));
        }

        sb.Append($" TO DISK = N'{Esc(req.Path)}'");

        var opts = new List<string>();
        if (req.Type == "differential") opts.Add("DIFFERENTIAL");
        if (!string.IsNullOrWhiteSpace(req.Name)) opts.Add($"NAME = N'{Esc(req.Name)}'");
        if (!string.IsNullOrWhiteSpace(req.Description)) opts.Add($"DESCRIPTION = N'{Esc(req.Description)}'");

        // Supporto di destinazione
        switch (req.OverwriteMode)
        {
            case "format":
                opts.Add("FORMAT");
                if (!string.IsNullOrWhiteSpace(req.MediaName)) opts.Add($"MEDIANAME = N'{Esc(req.MediaName)}'");
                if (!string.IsNullOrWhiteSpace(req.MediaDescription)) opts.Add($"MEDIADESCRIPTION = N'{Esc(req.MediaDescription)}'");
                break;
            case "overwrite":
                opts.Add("INIT");
                break;
            default:
                opts.Add("NOINIT"); // append al set esistente
                break;
        }

        if (req.CopyOnly) opts.Add("COPY_ONLY");
        if (req.Checksum) opts.Add("CHECKSUM");
        if (req.ContinueOnError) opts.Add("CONTINUE_AFTER_ERROR");
        if (req.Compression == "on") opts.Add("COMPRESSION");
        else if (req.Compression == "off") opts.Add("NO_COMPRESSION");

        if (req.Type == "log")
        {
            if (req.LogMode == "noTruncate") opts.Add("NO_TRUNCATE");
            else if (req.LogMode == "noRecovery") opts.Add("NORECOVERY");
        }

        if (req.ExpiryDays is > 0) opts.Add($"RETAINDAYS = {req.ExpiryDays.Value}");
        else if (!string.IsNullOrWhiteSpace(req.ExpiryDate)) opts.Add($"EXPIREDATE = N'{Esc(req.ExpiryDate)}'");

        if (!string.IsNullOrWhiteSpace(req.EncryptionAlgorithm) && !string.IsNullOrWhiteSpace(req.EncryptionCertificate))
            opts.Add($"ENCRYPTION (ALGORITHM = {req.EncryptionAlgorithm}, SERVER CERTIFICATE = N'{Esc(req.EncryptionCertificate)}')");

        opts.Add("STATS = 10");
        sb.Append(" WITH ").Append(string.Join(", ", opts)).Append(';');
        return sb.ToString();
    }

    /// <summary>Legge i backup set contenuti nel/i file (RESTORE HEADERONLY): tipo, periodi, LSN, dimensioni.</summary>
    [HttpPost("backup-info")]
    public async Task<ActionResult<BackupInfoResponse>> BackupInfo([FromBody] BackupInfoRequest req, CancellationToken ct)
    {
        if (!TryGetCs(out var cs)) return NotFound("Connessione non trovata o scaduta. Riconnettiti.");
        var paths = ResolvePaths(req.Path, req.Paths);
        if (paths.Count == 0) return Bad("Specifica almeno un percorso di file di backup (.bak).");

        var sql = $"RESTORE HEADERONLY FROM {FromDisks(paths)};";
        var result = await query.ExecuteAsync(cs, sql, timeoutSeconds: 120, ct);
        if (result.Error != null)
            return Ok(new BackupInfoResponse([], result.Error));
        if (result.ResultSets.Count == 0 || result.ResultSets[0].Rows.Count == 0)
        {
            // con FireInfoMessageEventOnUserErrors gli errori del dispositivo arrivano nei Messages
            var detail = result.Messages.Count > 0
                ? string.Join(Environment.NewLine, result.Messages)
                : "Nessun backup set trovato nel file.";
            return Ok(new BackupInfoResponse([], detail));
        }

        var set = result.ResultSets[0];
        var idx = set.Columns
            .Select((c, i) => (c.Name, i))
            .ToDictionary(x => x.Name, x => x.i, StringComparer.OrdinalIgnoreCase);

        string? At(string col, List<object?> row) =>
            idx.TryGetValue(col, out var i) && i < row.Count && row[i] != null ? Convert.ToString(row[i], System.Globalization.CultureInfo.InvariantCulture) : null;
        bool BoolAt(string col, List<object?> row) => At(col, row) is "True" or "true" or "1";
        long LongAt(string col, List<object?> row) => long.TryParse(At(col, row), out var v) ? v : 0;

        var sets = new List<BackupSetInfo>();
        foreach (var row in set.Rows)
        {
            sets.Add(new BackupSetInfo(
                At("BackupName", row),
                At("BackupDescription", row),
                int.TryParse(At("BackupType", row), out var t) ? t : 0,
                At("BackupTypeDescription", row),
                int.TryParse(At("Position", row), out var p) ? p : 0,
                At("ServerName", row),
                At("DatabaseName", row),
                At("BackupStartDate", row),
                At("BackupFinishDate", row),
                LongAt("CompressedBackupSize", row),
                At("FirstLSN", row),
                At("LastLSN", row),
                BoolAt("IsCopyOnly", row),
                BoolAt("HasBackupChecksums", row),
                BoolAt("IsDamaged", row)));
        }
        return Ok(new BackupInfoResponse(sets, null));
    }

    /// <summary>File contenuti nel backup set (RESTORE FILELISTONLY): per i MOVE del ripristino.</summary>
    [HttpPost("restore-filelist")]
    public async Task<ActionResult<DbFileListResponse>> RestoreFileList([FromBody] RestoreRequest req, CancellationToken ct)
    {
        if (!TryGetCs(out var cs)) return NotFound("Connessione non trovata o scaduta. Riconnettiti.");
        var paths = ResolvePaths(req.Path, req.Paths);
        if (paths.Count == 0) return Bad("Specifica almeno un percorso di file di backup (.bak).");

        var sql = $"RESTORE FILELISTONLY FROM {FromDisks(paths)}" + (req.FilePosition is > 0 ? $" WITH FILE = {req.FilePosition}" : "") + ";";
        var result = await query.ExecuteAsync(cs, sql, timeoutSeconds: 120, ct);
        if (result.Error != null)
            return Ok(new DbFileListResponse([], result.Error));
        if (result.ResultSets.Count == 0 || result.ResultSets[0].Rows.Count == 0)
        {
            // con FireInfoMessageEventOnUserErrors gli errori del dispositivo arrivano nei Messages
            var detail = result.Messages.Count > 0
                ? string.Join(Environment.NewLine, result.Messages)
                : "Nessun file trovato nel backup set.";
            return Ok(new DbFileListResponse([], detail));
        }

        var rows = result.ResultSets[0].Rows;
        var idx = result.ResultSets[0].Columns.Select((c, i) => (c.Name, i)).ToDictionary(x => x.Name, x => x.i, StringComparer.OrdinalIgnoreCase);
        var files = new List<DbFileEntry>();
        foreach (var row in rows)
        {
            string? Col(string name) => idx.TryGetValue(name, out var i) && i < row.Count && row[i] != null
                ? Convert.ToString(row[i], System.Globalization.CultureInfo.InvariantCulture)
                : null;
            files.Add(new DbFileEntry(
                Col("LogicalName") ?? "",
                Col("PhysicalName") ?? "",
                Col("Type") ?? "",
                Col("FileGroupName"),
                false));
        }
        return Ok(new DbFileListResponse(files, null));
    }

    /// <summary>Ripristina il database (o il log) dal file, con REPLACE, RECOVERY/NORECOVERY, STOPAT e MOVE.</summary>
    [HttpPost("restore")]
    public async Task<ActionResult<DbMaintenanceResponse>> Restore([FromBody] RestoreRequest req, CancellationToken ct)
    {
        if (!TryGetCs(out var cs)) return NotFound("Connessione non trovata o scaduta. Riconnettiti.");
        var dbName = ActiveDbName(cs, out var dbErr);
        if (dbErr != null) return Bad(dbErr);
        var paths = ResolvePaths(req.Path, req.Paths);
        if (paths.Count == 0) return Bad("Specifica almeno un percorso di file di backup (.bak).");

        // il restore del database in uso fallisce: ci colleghiamo a master
        var masterCs = new SqlConnectionStringBuilder(cs) { InitialCatalog = "master" }.ConnectionString;
        var messages = new List<string>();
        var dest = string.IsNullOrWhiteSpace(req.DatabaseName) ? dbName! : req.DatabaseName;

        // Backup della coda del log prima del ripristino (come SSMS)
        if (!string.IsNullOrWhiteSpace(req.TailLogPath))
        {
            var tailSql = $"BACKUP LOG [{EscBracket(dest)}] TO DISK = N'{Esc(req.TailLogPath)}' WITH NORECOVERY, STATS = 10;";
            var tailRes = await query.ExecuteAsync(masterCs, tailSql, timeoutSeconds: 300, ct);
            messages.AddRange(tailRes.Messages);
            if (tailRes.Error != null)
                return Ok(new DbMaintenanceResponse(messages, $"Backup della coda del log fallito: {tailRes.Error}"));
            messages.Add("Backup della coda del log completato (NORECOVERY).");
        }

        var sql = BuildRestoreSql(dest, req);
        var result = await query.ExecuteAsync(masterCs, sql, timeoutSeconds: 900, ct);
        messages.AddRange(result.Messages);
        return Ok(new DbMaintenanceResponse(messages, result.Error));
    }

    private static string BuildRestoreSql(string destDb, RestoreRequest req)
    {
        var verb = req.SetType == "log" ? "RESTORE LOG" : "RESTORE DATABASE";
        var sb = new System.Text.StringBuilder($"{verb} [{EscBracket(destDb)}] FROM {FromDisks(ResolvePaths(req.Path, req.Paths))}");
        var opts = new List<string>();
        if (req.FilePosition is > 0) opts.Add($"FILE = {req.FilePosition}");
        if (req.Replace) opts.Add("REPLACE");
        opts.Add(req.LeaveRestoring ? "NORECOVERY" : "RECOVERY");
        if (req.SetType == "log" && !string.IsNullOrWhiteSpace(req.StopAt))
            opts.Add($"STOPAT = N'{Esc(req.StopAt)}'");
        if (req.MoveFiles is { Count: > 0 })
            opts.AddRange(req.MoveFiles.Select(m => $"MOVE N'{Esc(m.LogicalName)}' TO N'{Esc(m.PhysicalPath)}'"));
        opts.Add("STATS = 10");
        sb.Append(" WITH ").Append(string.Join(", ", opts)).Append(';');
        return sb.ToString();
    }

    /// <summary>File e filegroup del database attivo (per BACKUP FILE/FILEGROUP e per i MOVE).</summary>
    [HttpGet("files")]
    public async Task<ActionResult<List<DbFileEntry>>> Files(CancellationToken ct)
    {
        if (!TryGetCs(out var cs)) return NotFound("Connessione non trovata o scaduta. Riconnettiti.");
        var sql = """
            SELECT f.name AS LogicalName, f.physical_name AS PhysicalName,
                   f.type_desc AS TypeDesc, fg.name AS FilegroupName,
                   CAST(CASE WHEN fg.is_default = 1 THEN 1 ELSE 0 END AS bit) AS IsDefault
            FROM sys.master_files f
            LEFT JOIN sys.filegroups fg ON fg.data_space_id = f.data_space_id
            WHERE f.database_id = DB_ID()
            ORDER BY f.type, fg.name, f.name;
            """;
        var result = await query.ExecuteAsync(cs, sql, timeoutSeconds: 30, ct);
        if (result.Error != null) return Bad(result.Error);
        var outList = new List<DbFileEntry>();
        if (result.ResultSets.Count == 0) return Ok(outList);
        var idx = result.ResultSets[0].Columns.Select((c, i) => (c.Name, i)).ToDictionary(x => x.Name, x => x.i, StringComparer.OrdinalIgnoreCase);
        foreach (var row in result.ResultSets[0].Rows)
        {
            string? Col(string name) => idx.TryGetValue(name, out var i) && i < row.Count && row[i] != null
                ? Convert.ToString(row[i], System.Globalization.CultureInfo.InvariantCulture)
                : null;
            outList.Add(new DbFileEntry(
                Col("LogicalName") ?? "",
                Col("PhysicalName") ?? "",
                Col("TypeDesc") ?? "",
                Col("FilegroupName"),
                Col("IsDefault") == "True"));
        }
        return Ok(outList);
    }

    /// <summary>Certificati del server (per la crittografia del backup).</summary>
    [HttpGet("certificates")]
    public async Task<ActionResult<List<CertEntry>>> Certificates(CancellationToken ct)
    {
        if (!TryGetCs(out var cs)) return NotFound("Connessione non trovata o scaduta. Riconnettiti.");
        var result = await query.ExecuteAsync(cs, "SELECT name FROM sys.certificates ORDER BY name;", timeoutSeconds: 30, ct);
        if (result.Error != null) return Bad(result.Error);
        var outList = new List<CertEntry>();
        if (result.ResultSets.Count == 0) return Ok(outList);
        foreach (var row in result.ResultSets[0].Rows)
            if (row.Count > 0 && row[0] != null)
                outList.Add(new CertEntry(Convert.ToString(row[0], System.Globalization.CultureInfo.InvariantCulture) ?? ""));
        return Ok(outList);
    }

    /// <summary>
    /// Upload di un file .bak selezionato localmente (browser → server): il file viene salvato
    /// nella cartella di backup predefinita dell'istanza (leggibile da SQL Server) e si restituisce
    /// il percorso completo lato server, usabile da RESTORE.
    /// </summary>
    [HttpPost("upload-backup")]
    [RequestSizeLimit(20L * 1024 * 1024 * 1024)] // fino a 20 GB
    public async Task<ActionResult<UploadBackupResponse>> UploadBackup([FromQuery] string? name, CancellationToken ct)
    {
        if (!TryGetCs(out var cs)) return NotFound("Connessione non trovata o scaduta. Riconnettiti.");

        // cartella di backup predefinita dell'istanza (SQL Server ci può leggere/scrivere)
        var dir = Path.Combine(Path.GetTempPath(), "SqlIntelliUploads");
        try
        {
            var res = await query.ExecuteAsync(cs,
                "SELECT CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS nvarchar(500));", timeoutSeconds: 30, ct);
            if (res.Error == null && res.ResultSets.Count > 0 && res.ResultSets[0].Rows.Count > 0
                && res.ResultSets[0].Rows[0].Count > 0 && res.ResultSets[0].Rows[0][0] is string s && !string.IsNullOrWhiteSpace(s))
            {
                dir = s.Trim();
            }
        }
        catch
        {
            /* fallback a %TEMP% */
        }

        try
        {
            Directory.CreateDirectory(dir);
        }
        catch (Exception ex)
        {
            return Bad($"Impossibile creare la cartella di upload '{dir}': {ex.Message}");
        }

        var safeName = string.IsNullOrWhiteSpace(name)
            ? "backup.bak"
            : Path.GetFileName(name.Replace('\\', '/').Replace(':', '_'));
        var dest = Path.Combine(dir, $"{Guid.NewGuid():N}_{safeName}");
        try
        {
            await using (var fs = System.IO.File.Create(dest))
            {
                await Request.Body.CopyToAsync(fs, ct);
            }
            var info = new System.IO.FileInfo(dest);
            return Ok(new UploadBackupResponse(dest, info.Length));
        }
        catch (Exception ex)
        {
            try { System.IO.File.Delete(dest); } catch { /* ignora */ }
            return Bad($"Upload non riuscito: {ex.Message}");
        }
    }
}
