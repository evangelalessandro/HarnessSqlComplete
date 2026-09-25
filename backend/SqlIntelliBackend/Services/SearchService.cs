using System.Diagnostics;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using SqlIntelliBackend.Models;

namespace SqlIntelliBackend.Services;

/// <summary>
/// Ricerca testuale generale nel database della connessione (stile Redgate SQL Search), ristretta
/// al singolo database: cerca il testo nei NOMI e nelle DEFINIZIONI degli oggetti e, su richiesta
/// (<c>data=true</c>), anche nei DATI delle colonne testuali di tabelle e viste.
/// Solo lettura (SELECT), tutto parametrizzato, con limiti rigidi per non bloccare il database.
/// </summary>
public class SearchService(ILogger<SearchService> logger)
{
    /// <summary>Numero minimo di caratteri perché la ricerca tocchi il database.</summary>
    private const int MinQueryLength = 2;

    /// <summary>Numero massimo di hit sulle strutture (nomi + definizioni).</summary>
    private const int MaxStructureHits = 300;

    /// <summary>Numero massimo di hit sui dati.</summary>
    private const int MaxDataHits = 60;

    /// <summary>Numero massimo di tabelle/viste scansionate per i dati.</summary>
    private const int MaxScannedTables = 25;

    /// <summary>Righe lette al massimo da ogni tabella durante la ricerca nei dati.</summary>
    private const int DataRowsPerTable = 3;

    /// <summary>Timeout (secondi) della singola query sui dati: una tabella lenta non blocca la ricerca.</summary>
    private const int DataQueryTimeoutSeconds = 5;

    /// <summary>Timeout (secondi) della singola query sulle strutture.</summary>
    private const int StructureQueryTimeoutSeconds = 30;

    /// <summary>Budget complessivo (secondi) della fase sui dati.</summary>
    private const int DataBudgetSeconds = 20;

    /// <summary>Lunghezza massima di un valore mostrato nei risultati sui dati.</summary>
    private const int MaxValueLength = 200;

    /// <summary>Lunghezza massima dello snippet mostrato per il match.</summary>
    private const int MaxSnippetLength = 300;

    /// <summary>Tetto di sicurezza sul testo cercato (evita LIKE giganteschi).</summary>
    private const int MaxQueryLength = 200;

    /// <summary>Spazi/tab/ritorni a capo ripetuti in una definizione: per ripulire lo snippet.</summary>
    private static readonly Regex WhitespaceRegex = new(@"\s+", RegexOptions.Compiled);

    /// <summary>
    /// Esegue la ricerca testuale: prima le strutture (nome, poi definizione), quindi — solo se
    /// <paramref name="includeData"/> — i dati. Con testo troppo corto non tocca il database.
    /// </summary>
    public async Task<TextSearchResponse> SearchAsync(
        string connectionString, string? query, bool includeData, CancellationToken ct = default)
    {
        var sw = Stopwatch.StartNew();
        var hits = new List<SearchHit>();
        var q = (query ?? "").Trim();
        if (q.Length > MaxQueryLength) q = q[..MaxQueryLength];

        if (q.Length < MinQueryLength)
        {
            sw.Stop();
            logger.LogInformation(
                "Ricerca testuale \"{Query}\" (dati: {Data}): testo troppo corto, nessuna query eseguita",
                q, includeData);
            return new TextSearchResponse(hits, false, 0, 0, sw.ElapsedMilliseconds,
                $"Testo di ricerca troppo corto: minimo {MinQueryLength} caratteri.");
        }

        var truncated = false;
        var scannedTables = 0;
        var totalTables = 0;

        await using var conn = new SqlConnection(connectionString);
        await conn.OpenAsync(ct);

        // "%testo%": il testo dell'utente non entra MAI nell'SQL, solo in questo parametro.
        var pat = "%" + EscapeLikePattern(q) + "%";

        // --- STRUTTURE ---
        var pending = new List<PendingHit>();
        await CollectNameHitsAsync(conn, pat, pending, ct);
        // Un oggetto già trovato per NOME non genera anche l'hit sulla DEFINIZIONE: la prima riga
        // della definizione E' la CREATE con il nome, quindi lo stesso oggetto comparirebbe due
        // volte nei risultati (segnalazione utente: "la ricerca per nome store procedure ritorna 2
        // elementi, tipo ws_CUSTOM_TRANSFER"). Gli hit sulle definizioni restano per gli oggetti
        // che NON hanno il testo nel nome (es. la colonna usata nel corpo di una store).
        var trovatiPerNome = pending
            .Where(h => h.Hit.MatchIn == "name")
            .Select(h => ChiaveOggetto(h.Hit.Kind, h.Hit.Schema, h.Hit.Name))
            .ToHashSet(StringComparer.Ordinal);
        await CollectDefinitionHitsAsync(conn, pat, q, pending, trovatiPerNome, ct);

        // Ordine: prima i match nel NOME, poi quelli nelle definizioni; a parità, per tipo e nome.
        var ordered = pending
            .OrderBy(h => h.MatchRank)
            .ThenBy(h => h.KindRank)
            .ThenBy(h => h.Schema, StringComparer.OrdinalIgnoreCase)
            .ThenBy(h => h.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (ordered.Count > MaxStructureHits)
        {
            truncated = true;
            ordered = ordered.Take(MaxStructureHits).ToList();
        }
        hits.AddRange(ordered.Select(h => h.Hit));

        // --- DATI (solo su richiesta) ---
        if (includeData)
        {
            var (dataHits, dataTruncated, scanned, total) = await SearchDataAsync(conn, pat, q, ct);
            hits.AddRange(dataHits);
            truncated |= dataTruncated;
            scannedTables = scanned;
            totalTables = total;
        }

        sw.Stop();
        logger.LogInformation(
            "Ricerca testuale \"{Query}\" (dati: {Data}): {Hits} hit, {Scanned}/{Total} tabelle scansionate, {Elapsed} ms",
            q, includeData, hits.Count, scannedTables, totalTables, sw.ElapsedMilliseconds);
        return new TextSearchResponse(hits, truncated, scannedTables, totalTables, sw.ElapsedMilliseconds);
    }

    // ---------- STRUTTURE ----------

    /// <summary>Hit sui NOMI: oggetti (tabelle, viste, procedure, funzioni, trigger) e colonne.</summary>
    private static async Task CollectNameHitsAsync(
        SqlConnection conn, string pat, List<PendingHit> pending, CancellationToken ct)
    {
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT s.name, o.name, RTRIM(o.type)
                FROM sys.objects o
                INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
                WHERE o.is_ms_shipped = 0
                  AND o.type IN ('U', 'V', 'P', 'FN', 'IF', 'TF', 'TR')
                  AND o.name LIKE @pat ESCAPE '\'
                ORDER BY s.name, o.name;
                """;
            cmd.CommandTimeout = StructureQueryTimeoutSeconds;
            cmd.Parameters.AddWithValue("@pat", pat);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var kind = KindFromObjectType(r.GetString(2));
                if (kind is null) continue;
                var schema = r.GetString(0);
                var name = r.GetString(1);
                pending.Add(NewHit(kind, schema, name, TypeLabel(kind), "name", null, null, null));
            }
        }

        // Colonne: solo tabelle e viste utente (il nome della colonna è il "name" dell'hit).
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT s.name, o.name, c.name
                FROM sys.columns c
                INNER JOIN sys.objects o ON o.object_id = c.object_id
                INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
                WHERE o.is_ms_shipped = 0
                  AND o.type IN ('U', 'V')
                  AND c.name LIKE @pat ESCAPE '\'
                ORDER BY s.name, o.name, c.name;
                """;
            cmd.CommandTimeout = StructureQueryTimeoutSeconds;
            cmd.Parameters.AddWithValue("@pat", pat);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var schema = r.GetString(0);
                var table = r.GetString(1);
                var column = r.GetString(2);
                pending.Add(NewHit("column", schema, column, $"colonna di {schema}.{table}", "column", null, null, null));
            }
        }
    }

    /// <summary>
    /// Hit sulle DEFINIZIONI: moduli SQL (viste, procedure, funzioni, trigger), vincoli CHECK e
    /// DEFAULT e colonne calcolate, tutti con <c>LIKE @pat</c>. Per ogni definizione che contiene il
    /// testo si riporta la PRIMA occorrenza (riga + snippet), così un oggetto non genera decine di
    /// hit identici. Gli oggetti già trovati per nome (<paramref name="trovatiPerNome"/>) vengono
    /// saltati: la definizione comincia con la CREATE che contiene il nome, quindi comparirebbero
    /// due volte.
    /// </summary>
    private static async Task CollectDefinitionHitsAsync(
        SqlConnection conn, string pat, string q, List<PendingHit> pending,
        HashSet<string> trovatiPerNome, CancellationToken ct)
    {
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT s.name, o.name, RTRIM(o.type), m.definition
                FROM sys.sql_modules m
                INNER JOIN sys.objects o ON o.object_id = m.object_id
                INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
                WHERE o.is_ms_shipped = 0
                  AND o.type IN ('V', 'P', 'FN', 'IF', 'TF', 'TR')
                  AND m.definition LIKE @pat ESCAPE '\'
                ORDER BY s.name, o.name;
                """;
            cmd.CommandTimeout = StructureQueryTimeoutSeconds;
            cmd.Parameters.AddWithValue("@pat", pat);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var kind = KindFromObjectType(r.GetString(2));
                if (kind is null) continue;
                var schema = r.GetString(0);
                var name = r.GetString(1);
                if (trovatiPerNome.Contains(ChiaveOggetto(kind, schema, name))) continue;
                AddDefinitionHit(pending, kind, schema, name, TypeLabel(kind), r.GetString(3), q);
            }
        }

        // Vincoli CHECK
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT s.name, t.name, cc.name, cc.definition
                FROM sys.check_constraints cc
                INNER JOIN sys.tables t ON cc.parent_object_id = t.object_id
                INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE cc.is_ms_shipped = 0 AND t.is_ms_shipped = 0
                  AND cc.definition LIKE @pat ESCAPE '\'
                ORDER BY s.name, t.name, cc.name;
                """;
            cmd.CommandTimeout = StructureQueryTimeoutSeconds;
            cmd.Parameters.AddWithValue("@pat", pat);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var schema = r.GetString(0);
                var table = r.GetString(1);
                AddDefinitionHit(pending, "constraint", schema, r.GetString(2),
                    $"vincolo CHECK di {schema}.{table}", r.GetString(3), q);
            }
        }

        // Vincoli DEFAULT
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT s.name, t.name, dc.name, dc.definition
                FROM sys.default_constraints dc
                INNER JOIN sys.tables t ON dc.parent_object_id = t.object_id
                INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE dc.is_ms_shipped = 0 AND t.is_ms_shipped = 0
                  AND dc.definition LIKE @pat ESCAPE '\'
                ORDER BY s.name, t.name, dc.name;
                """;
            cmd.CommandTimeout = StructureQueryTimeoutSeconds;
            cmd.Parameters.AddWithValue("@pat", pat);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var schema = r.GetString(0);
                var table = r.GetString(1);
                AddDefinitionHit(pending, "constraint", schema, r.GetString(2),
                    $"vincolo DEFAULT di {schema}.{table}", r.GetString(3), q);
            }
        }

        // Colonne calcolate (nome della COLONNA, definizione dell'espressione)
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT s.name, o.name, c.name, cc.definition
                FROM sys.computed_columns cc
                INNER JOIN sys.columns c ON c.object_id = cc.object_id AND c.column_id = cc.column_id
                INNER JOIN sys.objects o ON o.object_id = cc.object_id
                INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
                WHERE o.is_ms_shipped = 0
                  AND o.type IN ('U', 'V')
                  AND cc.definition LIKE @pat ESCAPE '\'
                ORDER BY s.name, o.name, c.name;
                """;
            cmd.CommandTimeout = StructureQueryTimeoutSeconds;
            cmd.Parameters.AddWithValue("@pat", pat);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var schema = r.GetString(0);
                var table = r.GetString(1);
                AddDefinitionHit(pending, "computed", schema, r.GetString(2),
                    $"colonna calcolata di {schema}.{table}", r.GetString(3), q);
            }
        }
    }

    private static void AddDefinitionHit(
        List<PendingHit> pending, string kind, string schema, string name,
        string detail, string definition, string q)
    {
        var (line, snippet) = FindLineAndSnippet(definition, q);
        pending.Add(NewHit(kind, schema, name, detail, "definition", line, snippet, null));
    }

    // ---------- DATI ----------

    /// <summary>
    /// Cerca il testo nei DATI: una query per tabella/vista candidata (colonne testuali), con
    /// timeout breve, tetto di 25 tabelle, 60 hit e un budget complessivo di 20 secondi.
    /// Una tabella che fallisce viene saltata e non fa fallire la ricerca.
    /// </summary>
    private async Task<(List<SearchHit> Hits, bool Truncated, int ScannedTables, int TotalTables)> SearchDataAsync(
        SqlConnection conn, string pat, string q, CancellationToken ct)
    {
        var dataHits = new List<SearchHit>();
        var truncated = false;
        var scanned = 0;

        // Candidate: tabelle/viste utente con almeno una colonna di tipo testuale (i tipi binari
        // restano fuori per costruzione). Il tipo si risolve sul tipo di BASE, così valgono anche
        // i tipi alias definiti dall'utente (es. dbo.Codice → varchar).
        var candidates = new List<(string Schema, string Name, List<string> Columns)>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT s.name, o.name, c.name
                FROM sys.columns c
                INNER JOIN sys.objects o ON o.object_id = c.object_id
                INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
                INNER JOIN sys.types ty ON ty.user_type_id = c.user_type_id
                INNER JOIN sys.types bt ON bt.user_type_id = ty.system_type_id
                WHERE o.is_ms_shipped = 0
                  AND o.type IN ('U', 'V')
                  AND bt.name IN ('char', 'varchar', 'nchar', 'nvarchar', 'text', 'ntext', 'sysname')
                ORDER BY s.name, o.name, c.column_id;
                """;
            cmd.CommandTimeout = StructureQueryTimeoutSeconds;
            await using var r = await cmd.ExecuteReaderAsync(ct);

            var index = new Dictionary<(string, string), List<string>>();
            while (await r.ReadAsync(ct))
            {
                var key = (r.GetString(0), r.GetString(1));
                if (!index.TryGetValue(key, out var cols))
                {
                    cols = [];
                    index[key] = cols;
                    candidates.Add((key.Item1, key.Item2, cols));
                }
                cols.Add(r.GetString(2));
            }
        }

        var totalTables = candidates.Count;

        // Budget complessivo collegato al ct della richiesta: se scade, si restituisce quello
        // che si è trovato (truncated = true) senza lasciare la richiesta appesa.
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(ct);
        budget.CancelAfter(TimeSpan.FromSeconds(DataBudgetSeconds));
        try
        {
            foreach (var table in candidates)
            {
                if (dataHits.Count >= MaxDataHits || scanned >= MaxScannedTables)
                {
                    truncated = true;
                    break;
                }
                if (budget.IsCancellationRequested)
                {
                    truncated = true;
                    break;
                }

                scanned++;
                try
                {
                    if (await SearchTableAsync(conn, table, pat, q, dataHits, budget.Token))
                    {
                        truncated = true;
                        break;
                    }
                }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    // budget dei 20 secondi esaurito (o timeout della singola query)
                    truncated = true;
                    break;
                }
                catch (SqlException)
                {
                    /* tabella non scansionabile (permessi, tipo non convertibile…): si salta */
                }
                catch (InvalidOperationException)
                {
                    /* idem: la ricerca non deve fallire per una singola tabella */
                }
            }
        }
        finally
        {
            budget.Dispose();
        }

        return (dataHits, truncated, scanned, totalTables);
    }

    /// <summary>
    /// Una query per tabella: <c>SELECT TOP (@max) &lt;colonne testuali&gt; FROM ... WHERE c LIKE @pat OR ...</c>.
    /// Restituisce true se si è raggiunto il tetto di hit sui dati (la scansione deve fermarsi).
    /// </summary>
    private static async Task<bool> SearchTableAsync(
        SqlConnection conn,
        (string Schema, string Name, List<string> Columns) table,
        string pat, string q, List<SearchHit> dataHits, CancellationToken ct)
    {
        var columns = table.Columns;
        var select = string.Join(", ", columns.Select(c => $"[{EscapeBracket(c)}]"));
        var where = string.Join(" OR ", columns.Select(c => $"[{EscapeBracket(c)}] LIKE @pat ESCAPE '\\'"));

        await using var cmd = conn.CreateCommand();
        cmd.CommandText =
            $"SELECT TOP (@max) {select} FROM [{EscapeBracket(table.Schema)}].[{EscapeBracket(table.Name)}] WHERE {where}";
        cmd.CommandTimeout = DataQueryTimeoutSeconds;
        cmd.Parameters.AddWithValue("@max", DataRowsPerTable);
        cmd.Parameters.AddWithValue("@pat", pat);

        var raw = new string[columns.Count];
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            for (var i = 0; i < columns.Count; i++)
                raw[i] = r.IsDBNull(i) ? "" : r.GetString(i);

            // La riga completa (tutte le colonne testuali) accompagna ogni hit: serve all'anteprima.
            var rowValues = raw.Select(v => Clip(v, MaxValueLength)).ToList();
            for (var i = 0; i < columns.Count; i++)
            {
                if (raw[i].Length == 0) continue;
                if (raw[i].IndexOf(q, StringComparison.OrdinalIgnoreCase) < 0) continue;

                if (dataHits.Count >= MaxDataHits) return true;

                var value = Clip(raw[i], MaxValueLength);
                dataHits.Add(new SearchHit(
                    "data",
                    table.Schema,
                    table.Name,
                    $"{table.Schema}.{table.Name} · {columns[i]} = {value}",
                    "data",
                    null,
                    Clip($"{columns[i]} = {value}", MaxSnippetLength),
                    new SearchHitRow([.. columns], rowValues)));
            }
        }
        return false;
    }

    // ---------- SUPPORTO ----------

    /// <summary>Chiave di un oggetto per capire se è già stato trovato (kind|schema|nome).</summary>
    private static string ChiaveOggetto(string kind, string schema, string name) =>
        $"{kind}|{schema.ToLowerInvariant()}|{name.ToLowerInvariant()}";

    /// <summary>Hit in attesa dell'ordinamento finale (prima i nomi, poi le definizioni, poi i dati).</summary>
    private sealed record PendingHit(int MatchRank, int KindRank, string Schema, string Name, SearchHit Hit);

    private static PendingHit NewHit(
        string kind, string schema, string name, string detail, string matchIn,
        int? line, string? snippet, SearchHitRow? row)
    {
        var hit = new SearchHit(kind, schema, name, detail, matchIn, line, snippet, row);
        return new PendingHit(MatchRank(matchIn), KindRank(kind), schema, name, hit);
    }

    private static int MatchRank(string matchIn) => matchIn switch
    {
        // "column" è un match nel NOME (della colonna): sta nello stesso gruppo di "name",
        // prima delle definizioni.
        "name" or "column" => 0,
        "definition" => 1,
        _ => 2,
    };

    private static int KindRank(string kind) => kind switch
    {
        "table" => 1,
        "view" => 2,
        "procedure" => 3,
        "function" => 4,
        "trigger" => 5,
        "column" => 6,
        "constraint" => 7,
        "computed" => 8,
        _ => 9,
    };

    /// <summary>Tipo di oggetto di sys.objects → kind del contratto JSON (null se non gestito).</summary>
    private static string? KindFromObjectType(string objectType) => objectType.Trim() switch
    {
        "U" => "table",
        "V" => "view",
        "P" => "procedure",
        "FN" or "IF" or "TF" => "function",
        "TR" => "trigger",
        _ => null,
    };

    private static string TypeLabel(string kind) => kind switch
    {
        "table" => "Tabella",
        "view" => "Vista",
        "procedure" => "Stored procedure",
        "function" => "Funzione",
        "trigger" => "Trigger",
        _ => kind,
    };

    /// <summary>Riga (1-based) e snippet della PRIMA occorrenza del testo nella definizione.</summary>
    private static (int? Line, string? Snippet) FindLineAndSnippet(string? text, string q)
    {
        if (string.IsNullOrEmpty(text)) return (null, null);
        var idx = text.IndexOf(q, StringComparison.OrdinalIgnoreCase);
        if (idx < 0) return (null, null);

        var lineStart = text.LastIndexOf('\n', idx) + 1;
        var lineEnd = text.IndexOf('\n', idx);
        if (lineEnd < 0) lineEnd = text.Length;

        var line = text.AsSpan(0, idx).Count('\n') + 1;
        var raw = text[lineStart..lineEnd];
        var snippet = ClipAround(WhitespaceRegex.Replace(raw, " ").Trim(), idx - lineStart, MaxSnippetLength);
        return (line, snippet);
    }

    /// <summary>Tronca al massimo <paramref name="max"/> caratteri, con "…" se tagliato.</summary>
    private static string Clip(string text, int max) =>
        text.Length <= max ? text : text[..(max - 1)] + "…";

    /// <summary>Ritaglia la riga attorno al match (non solo l'inizio), con "…" ai lati tagliati.</summary>
    private static string ClipAround(string text, int matchOffset, int max)
    {
        if (text.Length <= max) return text;
        matchOffset = Math.Clamp(matchOffset, 0, text.Length - 1);
        var start = Math.Clamp(matchOffset - max / 3, 0, text.Length - max);
        var window = text.Substring(start, max).Trim();
        return (start > 0 ? "…" : "") + window + (start + max < text.Length ? "…" : "");
    }

    /// <summary>
    /// Neutralizza i caratteri jolly di LIKE nel testo dell'utente (il backslash è il carattere
    /// di escape dichiarato con ESCAPE '\' nelle query).
    /// </summary>
    private static string EscapeLikePattern(string value) => value
        .Replace("\\", "\\\\")
        .Replace("%", "\\%")
        .Replace("_", "\\_")
        .Replace("[", "\\[");

    /// <summary>Escape dei nomi oggetto per l'uso tra parentesi quadre SQL Server.</summary>
    private static string EscapeBracket(string name) => name.Replace("]", "]]");
}
