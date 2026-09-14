using System.Diagnostics;
using System.Globalization;
using Microsoft.Data.SqlClient;
using SqlIntelliBackend.Models;

namespace SqlIntelliBackend.Services;

/// <summary>Esegue batch SQL e restituisce i result set, i messaggi (PRINT/RAISERROR) e i tempi di esecuzione.</summary>
public class QueryService
{
    private const int MaxRowsPerSet = 5000;

    public async Task<QueryResult> ExecuteAsync(string connectionString, string sql, int? timeoutSeconds, CancellationToken ct = default, bool checkSyntax = false)
    {
        var sw = Stopwatch.StartNew();
        var messages = new List<string>();
        var sets = new List<QueryResultSet>();
        // messaggi/errori con numero, livello, stato, PROCEDURA e riga (come i "Messaggi" di SSMS)
        var details = new List<QueryMessage>();
        long totalAffected = 0;
        string? error = null;
        // riga di inizio del batch in esecuzione (per riportare la riga esatta negli errori)
        var currentStartLine = 1;

        try
        {
            await using var conn = new SqlConnection(connectionString);
            conn.FireInfoMessageEventOnUserErrors = true;
            conn.InfoMessage += (_, e) =>
            {
                // con FireInfoMessageEventOnUserErrors gli errori di sintassi arrivano qui:
                // riporta la riga assoluta (i PRINT hanno Number 0 → niente prefisso)
                foreach (SqlError err in e.Errors)
                {
                    if (err.Number == 0)
                    {
                        messages.Add(err.Message); // PRINT
                        continue;
                    }
                    var line = AbsoluteLine(err, currentStartLine);
                    if (checkSyntax)
                    {
                        // verifica di sintassi: il formato "Riga N: …" è quello che il client
                        // trasforma in sottolineature, va lasciato com'è (una sola riga)
                        messages.Add($"Riga {line}: {err.Message}");
                        continue;
                    }
                    // esecuzione vera: si riporta tutto come fa SSMS, così si vede QUALE
                    // procedura ha dato errore (err.Procedure) e a che riga della procedura
                    var detail = DescribeError(err, line, isError: err.Class >= 11);
                    messages.Add(detail.Display);
                    details.Add(detail);
                }
            };
            await conn.OpenAsync(ct);

            // Verifica di sintassi: ogni comando gira dentro una transazione ADO.NET che
            // viene SEMPRE annullata a fine richiesta (nessun effetto collaterale). NON si
            // usa "BEGIN TRANSACTION" in T-SQL: se il testo utente contiene già
            // BEGIN TRAN/ROLLBACK/COMMIT (nidificati sopra il nostro), un suo ROLLBACK
            // senza nome chiude l'INTERA transazione → il Rollback finale fallisce e va
            // ignorato (la connessione si chiude comunque senza COMMIT, quindi niente
            // effetti collaterali residui).
            SqlTransaction? checkTran = null;
            if (checkSyntax)
            {
                checkTran = (SqlTransaction)await conn.BeginTransactionAsync(ct);
            }

            var batches = SqlBatchSplitter.SplitWithLines(sql);
            if (batches.Count == 0)
                throw new InvalidOperationException("Nessuna istruzione SQL da eseguire.");

            foreach (var batch in batches)
            {
                currentStartLine = batch.StartLine;
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = batch.Text;
                cmd.Transaction = checkTran;
                cmd.CommandTimeout = checkSyntax ? Math.Min(timeoutSeconds ?? 30, 10) : (timeoutSeconds ?? 30);
                cmd.StatementCompleted += (_, e) => totalAffected += e.RecordCount;

                await using var reader = await cmd.ExecuteReaderAsync(ct);
                do
                {
                    var schema = reader.GetColumnSchema();
                    if (schema.Count == 0)
                    {
                        // Statement senza result set (UPDATE/INSERT/DELETE/PRINT…):
                        // niente set vuoto — come SSMS, le righe interessate finiscono nei messaggi,
                        // così il client mostra la schermata dei PRINT quando non c'è una SELECT.
                        var affected = reader.RecordsAffected;
                        if (affected >= 0)
                        {
                            totalAffected += affected;
                            messages.Add(affected == 1 ? "(1 riga interessata)" : $"({affected} righe interessate)");
                        }
                        continue;
                    }

                    var columns = schema
                        .Select(c => new ColumnResult(
                            string.IsNullOrEmpty(c.ColumnName) ? $"Column{schema.IndexOf(c) + 1}" : c.ColumnName,
                            c.DataTypeName ?? c.DataType?.Name ?? "unknown"))
                        .ToList();

                    var rows = new List<List<object?>>();
                    var truncated = false;
                    while (await reader.ReadAsync(ct))
                    {
                        if (rows.Count >= MaxRowsPerSet)
                        {
                            truncated = true;
                            break;
                        }
                        var row = new List<object?>(reader.FieldCount);
                        for (var i = 0; i < reader.FieldCount; i++)
                            row.Add(ConvertValue(reader.IsDBNull(i) ? DBNull.Value : reader.GetValue(i)));
                        rows.Add(row);
                    }
                    sets.Add(new QueryResultSet(columns, rows, rows.Count, 0, truncated));
                } while (await reader.NextResultAsync(ct));
            }

            // verifica di sintassi: annulla la transazione ADO.NET (nessun effetto collaterale).
            // Se il testo utente ha già eseguito ROLLBACK senza nome, la transazione non esiste
            // più: il rollback fallisce e va ignorato (la connessione si chiude senza COMMIT).
            if (checkTran is not null)
            {
                try
                {
                    await checkTran.RollbackAsync(ct);
                }
                catch
                {
                    /* transazione già chiusa dal testo utente */
                }
            }
        }
        catch (OperationCanceledException)
        {
            error = "Query annullata (timeout).";
        }
        catch (SqlException ex)
        {
            // riporta la riga assoluta dello script (SQL Server dà la riga relativa al batch)
            var parts = new List<string>();
            foreach (SqlError err in ex.Errors)
            {
                var line = AbsoluteLine(err, currentStartLine);
                if (checkSyntax)
                {
                    // verifica di sintassi: formato a una riga, letto dal client per i marker
                    parts.Add($"Riga {line}: {err.Message}");
                    continue;
                }
                // esecuzione vera: intestazione come SSMS, con la PROCEDURA che ha fallito
                var detail = DescribeError(err, line, isError: true);
                details.Add(detail);
                parts.Add(detail.Display);
            }
            error = string.Join(Environment.NewLine, parts);
        }
        catch (Exception ex)
        {
            error = ex.Message;
        }

        sw.Stop();
        return new QueryResult(sets, totalAffected, messages, sw.ElapsedMilliseconds, error, details);
    }

    /// <summary>
    /// Riga da mostrare per un errore.
    /// - errore DENTRO una procedura: la riga è quella interna alla procedura, come la mostra
    ///   SSMS ("Procedura X, Riga N"): sommarla all'inizio del batch darebbe un numero falso;
    /// - errore nel batch scritto dall'utente: si aggiunge l'inizio del batch, così la riga è
    ///   quella del SCRIPT (utile per le sottolineature della verifica di sintassi).
    /// </summary>
    private static int AbsoluteLine(SqlError err, int batchStartLine)
    {
        if (err.Procedure is { Length: > 0 }) return Math.Max(1, err.LineNumber);
        return err.LineNumber > 0 ? batchStartLine + err.LineNumber - 1 : batchStartLine;
    }

    /// <summary>
    /// Traduce un errore di SQL Server nei dati che mostra SSMS: numero, livello, stato,
    /// procedura e riga. La procedura è quella che ha eseguito il RAISERROR, quindi su una
    /// query che richiama più stored procedure dice subito quale ha fallito.
    /// </summary>
    private static QueryMessage DescribeError(SqlError err, int line, bool isError)
    {
        var message = new QueryMessage(
            Text: err.Message,
            Display: "",
            Number: err.Number,
            Severity: err.Class,
            State: err.State,
            Procedure: string.IsNullOrWhiteSpace(err.Procedure) ? null : err.Procedure,
            Line: line,
            IsError: isError);
        return message with { Display = FormatMessage(message) };
    }

    /// <summary>Formatta il messaggio come nella finestra "Messaggi" di SSMS.</summary>
    private static string FormatMessage(QueryMessage m)
    {
        if (m.Number == 0) return m.Text;
        var proc = m.Procedure is { Length: > 0 } p ? $", Procedura {p}" : "";
        return $"Msg {m.Number}, Livello {m.Severity}, Stato {m.State}{proc}, Riga {m.Line}"
            + Environment.NewLine + m.Text;
    }

    private static object? ConvertValue(object value)
    {
        if (value is DBNull) return null;
        return value switch
        {
            byte[] bytes => Convert.ToBase64String(bytes),
            DateTime dt => dt.ToString("yyyy-MM-ddTHH:mm:ss.fff", CultureInfo.InvariantCulture),
            DateTimeOffset dto => dto.ToString("yyyy-MM-ddTHH:mm:ss.fffzzz", CultureInfo.InvariantCulture),
            TimeSpan ts => ts.ToString("c", CultureInfo.InvariantCulture),
            Guid g => g.ToString(),
            System.Data.SqlTypes.SqlXml xml => xml.Value,
            // Oggetti non gestiti (geography, geometry, hierarchyid, sql_variant, CLR…):
            // li converte in stringa invece di restituirli (non serializzabili in JSON).
            _ => value is string or decimal or bool or byte or sbyte or short or ushort or int or uint or long or ulong or float or double or char
                ? value
                : Convert.ToString(value, CultureInfo.InvariantCulture) ?? value.ToString() ?? "",
        };
    }
}
