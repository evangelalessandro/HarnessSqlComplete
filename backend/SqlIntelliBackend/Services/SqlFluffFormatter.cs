using System.Diagnostics;
using System.Text;

namespace SqlIntelliBackend.Services;

/// <summary>
/// FORMATTAZIONE CON SQLFLUFF (https://sqlfluff.com): è una CLI Python, quindi si esegue come
/// processo figlio passando il testo su stdin e leggendo il risultato da stdout.
///
/// Le opzioni si passano con un file di configurazione temporaneo (.sqlfluff), che è il modo
/// previsto dalla libreria: si evita così una riga di comando lunghissima.
/// Se Python o sqlfluff non sono installati si restituisce un messaggio chiaro (l'app non deve
/// rompersi e l'utente deve sapere cosa manca).
/// </summary>
public class SqlFluffFormatter(ILogger<SqlFluffFormatter> logger)
{
    /// <summary>Opzioni di formattazione scelte dall'utente (tutte con un default sensato).</summary>
    public record Opzioni(
        string Dialect = "tsql",
        int TabSpaceSize = 2,
        bool UseTabs = false,
        string KeywordCasing = "upper",
        string IdentifierCasing = "preserve",
        string DataTypeCasing = "upper",
        string FunctionCasing = "preserve",
        string CommaStyle = "trailing",   // "trailing" (a fine riga) oppure "leading" (in testa)
        bool WhereNewline = true,
        int MaxLineLength = 120);

    public record Esito(string? Formattato, string? Errore);

    /// <summary>
    /// Configurazione .sqlfluff (INI) corrispondente alle opzioni. È una funzione pura: si può
    /// controllare nei test senza eseguire nulla.
    /// </summary>
    public static string Configurazione(Opzioni o)
    {
        // le regole di impaginazione che interessano la formattazione (il resto resta ai default)
        var sb = new StringBuilder();
        sb.AppendLine("[sqlfluff]");
        sb.AppendLine($"dialect = {o.Dialect}");
        sb.AppendLine("templater = raw");
        sb.AppendLine($"max_line_length = {Math.Clamp(o.MaxLineLength, 20, 400)}");
        // "preserve" = la regola va ESCLUSA: con "consistent" sqlfluff renderebbe comunque tutto
        // uguale (era il motivo per cui "dbo.T" diventava "dbo.t").
        var escludi = new List<string>();
        if (!IsCasing(o.KeywordCasing)) escludi.Add("capitalisation.keywords");
        if (!IsCasing(o.IdentifierCasing)) escludi.Add("capitalisation.identifiers");
        if (!IsCasing(o.FunctionCasing)) escludi.Add("capitalisation.functions");
        if (!IsCasing(o.DataTypeCasing)) escludi.Add("capitalisation.types");
        if (escludi.Count > 0) sb.AppendLine($"exclude_rules = {string.Join(",", escludi)}");
        sb.AppendLine();
        sb.AppendLine("[sqlfluff:indentation]");
        sb.AppendLine($"indent_unit = {(o.UseTabs ? "tab" : "space")}");
        sb.AppendLine($"tab_space_size = {Math.Clamp(o.TabSpaceSize, 1, 8)}");
        sb.AppendLine();
        sb.AppendLine("[sqlfluff:layout:type:comma]");
        sb.AppendLine($"line_position = {(o.CommaStyle == "leading" ? "leading" : "trailing")}");
        sb.AppendLine();
        // "preserve" non è un valore che sqlfluff conosce: in quel caso la regola va esclusa,
        // così gli identificatori (e le funzioni) restano esattamente come sono scritti.
        bool preservaIdentificatori = !IsCasing(o.IdentifierCasing);
        bool preservaFunzioni = !IsCasing(o.FunctionCasing);
        sb.AppendLine("[sqlfluff:rules:capitalisation.keywords]");
        sb.AppendLine($"capitalisation_policy = {(IsCasing(o.KeywordCasing) ? o.KeywordCasing : "consistent")}");
        sb.AppendLine();
        sb.AppendLine("[sqlfluff:rules:capitalisation.identifiers]");
        sb.AppendLine($"capitalisation_policy = {(preservaIdentificatori ? "consistent" : o.IdentifierCasing)}");
        sb.AppendLine();
        sb.AppendLine("[sqlfluff:rules:capitalisation.functions]");
        sb.AppendLine($"capitalisation_policy = {(preservaFunzioni ? "consistent" : o.FunctionCasing)}");
        sb.AppendLine();
        sb.AppendLine("[sqlfluff:rules:capitalisation.literals]");
        sb.AppendLine("capitalisation_policy = consistent");
        sb.AppendLine();
        sb.AppendLine("[sqlfluff:rules:capitalisation.types]");
        sb.AppendLine($"capitalisation_policy = {(IsCasing(o.DataTypeCasing) ? o.DataTypeCasing : "upper")}");
        sb.AppendLine();
        if (!o.WhereNewline)
        {
            // "where" attaccato alla riga precedente: si escludono le regole che lo mandano a capo
            sb.AppendLine("[sqlfluff:rules:layout.keyword_newline]");
            sb.AppendLine("keyword_line_position =");
            sb.AppendLine();
        }
        // Le regole che non riguardano l'impaginazione non devono bloccare o cambiare il testo
        sb.AppendLine("[sqlfluff:rules:references.consistent]");
        sb.AppendLine("force_enable = False");
        return sb.ToString();
    }

    private static bool IsCasing(string v) => v is "upper" or "lower" or "capitalise";

    /// <summary>Comando da eseguire: si usa `python -m sqlfluff` per non dipendere dal PATH.</summary>
    public static ProcessStartInfo AvvioProcesso(string configPath, string sqlPath) => new()
    {
        FileName = "python",
        RedirectStandardInput = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        UseShellExecute = false,
        CreateNoWindow = true,
        StandardOutputEncoding = Encoding.UTF8,
        StandardErrorEncoding = Encoding.UTF8,
        ArgumentList =
        {
            "-m", "sqlfluff", "format", "--dialect", "tsql", "--config", configPath, "--disable-progress-bar", sqlPath,
        },
    };

    /// <summary>Formatta il testo con sqlfluff. Non lancia mai: gli errori tornano come messaggio.</summary>
    public async Task<Esito> FormattaAsync(string sql, Opzioni opzioni, CancellationToken ct = default)
    {
        var cartella = Path.Combine(Path.GetTempPath(), "sqlintelli-sqlfluff", Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(cartella);
            var configPath = Path.Combine(cartella, ".sqlfluff");
            var sqlPath = Path.Combine(cartella, "query.sql");
            await File.WriteAllTextAsync(configPath, Configurazione(opzioni), new UTF8Encoding(false), ct);
            await File.WriteAllTextAsync(sqlPath, sql, new UTF8Encoding(false), ct);

            var psi = AvvioProcesso(configPath, sqlPath);
            using var processo = new Process { StartInfo = psi };
            if (!processo.Start())
                return new Esito(null, "sqlfluff non avviato.");

            var stdout = processo.StandardOutput.ReadToEndAsync(ct);
            var stderr = processo.StandardError.ReadToEndAsync(ct);
            await processo.WaitForExitAsync(ct);
            var testo = await stdout;
            var errori = await stderr;

            // sqlfluff riscrive il file e stampa il suo report: il risultato si legge dal FILE
            var formattato = await File.ReadAllTextAsync(sqlPath, ct);
            if (processo.ExitCode != 0 && string.IsNullOrWhiteSpace(formattato))
                return new Esito(null, errori.Trim() is { Length: > 0 } e ? e : "sqlfluff non ha formattato il testo.");
            logger.LogInformation("sqlfluff: formattate {Righe} righe", formattato.Count(c => c == '\n') + 1);
            return new Esito(formattato.Replace("\r\n", "\n"), null);
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return new Esito(
                null,
                "Python non trovato: per usare SQLFluff serve Python con il pacchetto sqlfluff installato (pip install sqlfluff).");
        }
        catch (OperationCanceledException)
        {
            return new Esito(null, "Formattazione SQLFluff interrotta (troppo tempo).");
        }
        catch (Exception ex)
        {
            return new Esito(null, $"SQLFluff non disponibile: {ex.Message}");
        }
        finally
        {
            try
            {
                if (Directory.Exists(cartella)) Directory.Delete(cartella, true);
            }
            catch
            {
                /* cartella temporanea: se resta non è un problema */
            }
        }
    }
}
