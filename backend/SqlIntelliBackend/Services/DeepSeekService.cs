using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using SqlIntelliBackend.Models;

namespace SqlIntelliBackend.Services;

/// <summary>
/// Invia query SQL parziali a DeepSeek (API OpenAI-compatible) per ottenere suggerimenti di completamento inline.
/// La chiave API viene letta da configurazione (DeepSeek:ApiKey) o può essere passata per-request.
/// </summary>
public partial class DeepSeekService(HttpClient http, IConfiguration config, ILogger<DeepSeekService> logger)
{
    public bool IsConfigured => !string.IsNullOrWhiteSpace(config["DeepSeek:ApiKey"]);
    public string Model => config["DeepSeek:Model"] ?? "deepseek-chat";
    public string BaseUrl => config["DeepSeek:BaseUrl"] ?? "https://api.deepseek.com";

    public async Task<AutocompleteResponse> CompleteAsync(
        string sql,
        string schemaContext,
        string? apiKeyOverride,
        int? maxTokens,
        CancellationToken ct)
    {
        var apiKey = apiKeyOverride ?? config["DeepSeek:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return new AutocompleteResponse(
                null,
                "Chiave API DeepSeek non configurata. Impostala in appsettings.json (DeepSeek:ApiKey) " +
                "o come variabile d'ambiente DEEPSEEK__APIKEY.");
        }

        var payload = new
        {
            model = Model,
            messages = new[]
            {
                new { role = "system", content = BuildSystemPrompt(schemaContext) },
                new { role = "user", content = BuildUserPrompt(sql) },
            },
            temperature = 0.2,
            max_tokens = maxTokens ?? 256,
            stream = false,
        };

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl.TrimEnd('/')}/chat/completions");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            req.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

            using var resp = await http.SendAsync(req, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);

            if (!resp.IsSuccessStatusCode)
            {
                logger.LogWarning("DeepSeek ha risposto {Status}: {Body}", resp.StatusCode, body.Truncate(500));
                return new AutocompleteResponse(null, $"DeepSeek ha risposto {(int)resp.StatusCode}: {ExtractApiError(body)}");
            }

            using var doc = JsonDocument.Parse(body);
            var choices = doc.RootElement.GetProperty("choices");
            if (choices.GetArrayLength() == 0)
                return new AutocompleteResponse(null, "DeepSeek non ha restituito suggerimenti.");

            var content = choices[0].GetProperty("message").GetProperty("content").GetString() ?? "";
            var cleaned = Sanitize(content, sql);

            if (string.IsNullOrWhiteSpace(cleaned))
                return new AutocompleteResponse(null, "Il modello non ha prodotto un completamento valido.");

            return new AutocompleteResponse(
                [new SuggestionItem(cleaned, "DeepSeek · " + Model)],
                null);
        }
        catch (OperationCanceledException)
        {
            return new AutocompleteResponse(null, "Timeout nella chiamata a DeepSeek.");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Errore chiamata DeepSeek");
            return new AutocompleteResponse(null, "Errore nella chiamata a DeepSeek: " + ex.Message);
        }
    }

    public string BuildSchemaContext(DatabaseSummary summary, string sql)
    {
        const int budget = 12000;
        var sb = new StringBuilder();
        sb.AppendLine("Database SQL Server — schema:");
        var remaining = budget;

        var words = WordRegex().Matches(sql).Select(m => m.Value.ToLowerInvariant()).ToHashSet();

        var orderedTables = summary.Tables
            .OrderByDescending(t => words.Contains(t.Name.ToLowerInvariant()) || words.Contains($"{t.Schema}.{t.Name}".ToLowerInvariant()) ? 1 : 0)
            .ThenBy(t => t.Schema)
            .ThenBy(t => t.Name)
            .ToList();

        foreach (var t in orderedTables)
        {
            var line = $"TABELLA {t.Schema}.{t.Name}";
            if (t.Columns is { Count: > 0 })
            {
                var cols = string.Join(", ", t.Columns.Select(c =>
                    $"{c.Name} {c.DataType}{(c.MaxLength is > 0 ? $"({c.MaxLength})" : "")}{(c.IsNullable ? "?" : "")}{(c.IsIdentity ? " identity" : "")}"));
                line += $" (colonne: {cols})";
            }
            line += ";";
            if (line.Length > remaining) break;
            sb.AppendLine(line);
            remaining -= line.Length;
        }

        foreach (var v in summary.Views)
        {
            var line = $"VISTA {v.Schema}.{v.Name};";
            if (line.Length > remaining) break;
            sb.AppendLine(line);
            remaining -= line.Length;
        }

        foreach (var p in summary.Procedures)
        {
            var line = $"PROCEDURA {p.Schema}.{p.Name}";
            if (p.Parameters is { Count: > 0 })
                line += $" (parametri: {string.Join(", ", p.Parameters.Select(x => $"@{x.Name} {x.DataType} {x.Mode}"))})";
            line += ";";
            if (line.Length > remaining) break;
            sb.AppendLine(line);
            remaining -= line.Length;
        }

        foreach (var tr in summary.Triggers)
        {
            var line = $"TRIGGER {tr.Schema}.{tr.TableName}.{tr.Name};";
            if (line.Length > remaining) break;
            sb.AppendLine(line);
            remaining -= line.Length;
        }

        return sb.ToString();
    }

    private static string BuildSystemPrompt(string schemaContext) =>
        """
        Sei un assistente esperto di autocompletamento per query T-SQL (SQL Server).
        Ricevi lo schema del database e una query parziale scritta dall'utente.
        Il tuo compito: continuare la query nel punto in cui è stata interrotta, producendo SOLO il testo
        di completamento che verrà inserito nel cursore (nessuna spiegazione, nessun prefisso, nessun fence di codice,
        nessun testo prima o dopo il completamento).
        Regole:
        - Usa nomi di tabelle, viste, procedure e colonne coerenti con lo schema fornito.
        - Completa in modo sintatticamente corretto per T-SQL.
        - Se la query è già completa, restituisci il testo minimo utile (es. un terminatore ";").
        - Non ripetere testo che l'utente ha già digitato.
        - Massimo 256 token.

        """ + schemaContext;

    private static string BuildUserPrompt(string sql) =>
        "Ecco la query parziale che l'utente sta scrivendo (il cursore è alla fine del testo). " +
        "Rispondi SOLO con il testo di completamento da inserire nel cursore.\n\n" +
        "```sql\n" + sql + "\n```";

    /// <summary>Rimuove fence, whitespace e prefissi duplicati dell'ultima parola digitata.</summary>
    private static string Sanitize(string content, string sql)
    {
        var text = content.Trim();
        text = Regex.Replace(text, @"^```(?:sql)?\s*", "", RegexOptions.IgnoreCase).Trim();
        text = Regex.Replace(text, @"```\s*$", "").Trim();
        if (string.IsNullOrWhiteSpace(text)) return "";

        // Rimuove un eventuale prefisso che ripete l'ultima parola del testo già digitato
        var lastWords = WordRegex().Matches(sql).Select(m => m.Value).ToList();
        if (lastWords.Count > 0)
        {
            var lastWord = lastWords[^1];
            var stripped = text;
            if (stripped.StartsWith(lastWord, StringComparison.OrdinalIgnoreCase))
            {
                stripped = stripped[lastWord.Length..].TrimStart();
                if (!string.IsNullOrWhiteSpace(stripped)) text = stripped;
            }
        }
        return text.Trim();
    }

    private static string ExtractApiError(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("error", out var err))
            {
                if (err.TryGetProperty("message", out var msg))
                    return msg.GetString() ?? body.Truncate(300);
            }
        }
        catch { /* body non JSON */ }
        return body.Truncate(300);
    }

    [GeneratedRegex(@"[A-Za-z_][A-Za-z0-9_]*")]
    private static partial Regex WordRegex();
}

internal static class StringExtensions
{
    public static string Truncate(this string s, int max)
    {
        if (string.IsNullOrEmpty(s) || s.Length <= max) return s ?? "";
        return s[..max] + "…";
    }
}
