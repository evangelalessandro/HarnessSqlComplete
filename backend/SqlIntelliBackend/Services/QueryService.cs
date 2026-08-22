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

        try
        {
            await using var conn = new SqlConnection(connectionString);
            conn.FireInfoMessageEventOnUserErrors = true;
            conn.InfoMessage += (_, e) =>
            {
                foreach (SqlError err in e.Errors)
                    messages.Add(err.Message);
            };
            await conn.OpenAsync(ct);

            var batches = SqlBatchSplitter.Split(sql);
            if (batches.Count == 0)
                throw new InvalidOperationException("Nessuna istruzione SQL da eseguire.");

            foreach (var batch in batches)
            {
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = batch;
                cmd.CommandTimeout = timeoutSeconds ?? 30;
                cmd.StatementCompleted += (_, e) => totalAffected += e.RecordCount;

                await using var reader = await cmd.ExecuteReaderAsync(ct);
                var first = true;
                do
                {
                    var schema = reader.GetColumnSchema();
                    if (schema.Count == 0)
                    {
                        var affected = reader.RecordsAffected;
                        if (affected >= 0)
                        {
                            totalAffected += affected;
                            if (first && sets.Count == 0)
                                sets.Add(new QueryResultSet([], [], 0, affected, false));
                        }
                        first = false;
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
                    first = false;
                } while (await reader.NextResultAsync(ct));
            }
        }
        catch (OperationCanceledException)
        {
            error = "Query annullata (timeout).";
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
            _ => value,
        };
    }
}
