using System.Diagnostics;
using System.Globalization;
using Microsoft.Data.SqlClient;
using SqlIntelliBackend.Models;

namespace SqlIntelliBackend.Services;

/// <summary>Esegue batch SQL e restituisce i result set, i messaggi (PRINT/RAISERROR) e i tempi di esecuzione.</summary>
public class QueryService
{
    private const int MaxRowsPerSet = 5000;

    public async Task<QueryResult> ExecuteAsync(string connectionString, string sql, int? timeoutSeconds, CancellationToken ct = default)
    {
        var sw = Stopwatch.StartNew();
        var messages = new List<string>();
        var sets = new List<QueryResultSet>();
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
                    var text = err.Number == 0
                        ? err.Message
                        : $"Riga {currentStartLine + Math.Max(0, err.LineNumber - 1)}: {err.Message}";
                    messages.Add(text);
                }
            };
            await conn.OpenAsync(ct);

            var batches = SqlBatchSplitter.SplitWithLines(sql);
            if (batches.Count == 0)
                throw new InvalidOperationException("Nessuna istruzione SQL da eseguire.");

            foreach (var batch in batches)
            {
                currentStartLine = batch.StartLine;
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = batch.Text;
                cmd.CommandTimeout = timeoutSeconds ?? 30;
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
                var line = err.LineNumber > 0 ? currentStartLine + err.LineNumber - 1 : currentStartLine;
                parts.Add($"Riga {line}: {err.Message}");
            }
            error = string.Join(Environment.NewLine, parts);
        }
        catch (Exception ex)
        {
            error = ex.Message;
        }

        sw.Stop();
        return new QueryResult(sets, totalAffected, messages, sw.ElapsedMilliseconds, error);
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
