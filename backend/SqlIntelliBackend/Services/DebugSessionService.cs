using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using Microsoft.Data.SqlClient;
using SqlIntelliBackend.Models;

namespace SqlIntelliBackend.Services;

/// <summary>
/// "Debug" delle chiamate SQL: esegue lo script BATCH PER BATCH su una CONNESSIONE
/// PERSISTENTE (come farebbe Visual Studio): variabili, tabelle temporanee e
/// transazioni restano vive tra un passo e il successivo. Con SET STATISTICS TIME/IO
/// ON per avere CPU/tempo e letture logiche di ogni batch nei messaggi.
/// Nota: un vero step-into T-SQL (breakpoint dentro le stored procedure) non è
/// possibile — Microsoft lo ha rimosso e SQL Server non lo espone più.
/// </summary>
public sealed class DebugSessionService : IDisposable
{
    private readonly ConcurrentDictionary<string, DebugSession> _sessions = new();

    public async Task<DebugStartResponse> StartAsync(string connectionString, string sql, CancellationToken ct)
    {
        // una sessione per connectionId: se esiste già, la chiude
        if (_sessions.TryRemove(connectionIdKey(connectionString), out var old))
        {
            await old.CloseAsync();
        }
        var conn = new SqlConnection(connectionString);
        await conn.OpenAsync(ct);
        await using (var setup = conn.CreateCommand())
        {
            setup.CommandText = "SET STATISTICS TIME ON; SET STATISTICS IO ON;";
            setup.CommandTimeout = 10;
            await setup.ExecuteNonQueryAsync(ct);
        }
        var batches = SqlBatchSplitter.SplitWithLines(sql);
        var session = new DebugSession(conn, batches);
        _sessions[connectionIdKey(connectionString)] = session;
        return new DebugStartResponse(batches.Select((b, i) => new DebugBatchInfo(i, b.StartLine, b.Text)).ToList());
    }

    public async Task<DebugStepResponse> StepAsync(string connectionString, CancellationToken ct)
    {
        var session = GetSession(connectionString);
        return await session.ExecuteNextAsync(ct);
    }

    public async Task<DebugRunResponse> RunAsync(string connectionString, CancellationToken ct)
    {
        var session = GetSession(connectionString);
        var steps = new List<DebugStepResponse>();
        while (!session.IsDone)
        {
            steps.Add(await session.ExecuteNextAsync(ct));
        }
        return new DebugRunResponse(steps);
    }

    public async Task StopAsync(string connectionString, CancellationToken ct)
    {
        if (_sessions.TryRemove(connectionIdKey(connectionString), out var session))
        {
            await session.CloseAsync();
        }
    }

    private DebugSession GetSession(string connectionString)
    {
        if (_sessions.TryGetValue(connectionIdKey(connectionString), out var s)) return s;
        throw new InvalidOperationException("Sessione di debug non avviata: premi Avvia debug.");
    }

    // la "chiave" è la connection string stessa (il connectionId dell'app la risolve già)
    private static string connectionIdKey(string connectionString) => connectionString;

    public void Dispose()
    {
        foreach (var s in _sessions.Values) s.CloseAsync().GetAwaiter().GetResult();
        _sessions.Clear();
    }

    private sealed class DebugSession
    {
        private readonly SqlConnection _conn;
        private readonly List<SqlBatch> _batches;
        private readonly SemaphoreSlim _gate = new(1, 1);
        private readonly List<string> _infoMessages = new();
        private int _batchStartLine = 1;
        private int _current = -1;
        private bool _closed;

        public bool IsDone => _current >= _batches.Count - 1;

        public DebugSession(SqlConnection conn, List<SqlBatch> batches)
        {
            _conn = conn;
            _batches = batches;
            _conn.FireInfoMessageEventOnUserErrors = true;
            // un SOLO handler per tutta la sessione: usa la riga di inizio del batch corrente
            _conn.InfoMessage += (_, e) =>
            {
                foreach (SqlError err in e.Errors)
                {
                    var text = err.Number == 0
                        ? err.Message
                        : $"Riga {_batchStartLine + Math.Max(0, err.LineNumber - 1)}: {err.Message}";
                    _infoMessages.Add(text);
                }
            };
        }

        public async Task<DebugStepResponse> ExecuteNextAsync(CancellationToken ct)
        {
            await _gate.WaitAsync(ct);
            try
            {
                if (_closed) throw new InvalidOperationException("Sessione di debug chiusa.");
                var next = _current + 1;
                if (next >= _batches.Count)
                {
                    return new DebugStepResponse(_current, _batches.Count, true, [], 0, [], null);
                }
                var batch = _batches[next];
                var sw = Stopwatch.StartNew();
                var sets = new List<QueryResultSet>();
                long totalAffected = 0;
                string? error = null;
                _infoMessages.Clear();
                _batchStartLine = batch.StartLine;

                try
                {
                    await using var cmd = _conn.CreateCommand();
                    cmd.CommandText = batch.Text;
                    cmd.CommandTimeout = 30;
                    cmd.StatementCompleted += (_, e) => totalAffected += e.RecordCount;
                    await using var reader = await cmd.ExecuteReaderAsync(ct);
                    do
                    {
                        var schema = reader.GetColumnSchema();
                        if (schema.Count == 0)
                        {
                            var affected = reader.RecordsAffected;
                            if (affected >= 0)
                            {
                                totalAffected += affected;
                                _infoMessages.Add(affected == 1 ? "(1 riga interessata)" : $"({affected} righe interessate)");
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
                            if (rows.Count >= 5000) { truncated = true; break; }
                            var row = new List<object?>(reader.FieldCount);
                            for (var i = 0; i < reader.FieldCount; i++)
                                row.Add(ConvertValue(reader.IsDBNull(i) ? DBNull.Value : reader.GetValue(i)));
                            rows.Add(row);
                        }
                        sets.Add(new QueryResultSet(columns, rows, rows.Count, 0, truncated));
                    } while (await reader.NextResultAsync(ct));
                }
                catch (OperationCanceledException)
                {
                    error = "Batch annullato (timeout).";
                }
                catch (SqlException ex)
                {
                    var parts = new List<string>();
                    foreach (SqlError err in ex.Errors)
                    {
                        var line = err.LineNumber > 0 ? batch.StartLine + err.LineNumber - 1 : batch.StartLine;
                        parts.Add($"Riga {line}: {err.Message}");
                    }
                    error = string.Join(Environment.NewLine, parts);
                }
                catch (Exception ex)
                {
                    error = ex.Message;
                }
                sw.Stop();
                _current = next;
                if (error == null)
                {
                    _infoMessages.Add($"Batch {next + 1}/{_batches.Count} eseguito in {sw.ElapsedMilliseconds} ms.");
                }
                var messages = new List<string>(_infoMessages);
                return new DebugStepResponse(next, _batches.Count, next >= _batches.Count - 1, sets, totalAffected, messages, error);
            }
            finally
            {
                _gate.Release();
            }
        }

        public async Task CloseAsync()
        {
            await _gate.WaitAsync();
            try
            {
                _closed = true;
                try { await _conn.DisposeAsync(); } catch { /* ignora */ }
            }
            finally
            {
                _gate.Release();
            }
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
                _ => value is string or decimal or bool or byte or sbyte or short or ushort or int or uint or long or ulong or float or double or char
                    ? value
                    : Convert.ToString(value, CultureInfo.InvariantCulture) ?? value.ToString() ?? "",
            };
        }
    }
}
