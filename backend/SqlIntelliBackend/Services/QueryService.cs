using System.Diagnostics;
using System.Globalization;
using Microsoft.Data.SqlClient;
using SqlIntelliBackend.Models;

namespace SqlIntelliBackend.Services;

/// <summary>Esegue batch SQL e restituisce i result set, i messaggi (PRINT/RAISERROR) e i tempi di esecuzione.</summary>
public class QueryService
{
    private const int MaxRowsPerSet = 5000;

    /// <summary>
    /// Esecuzione SENZA sessione (verifica di sintassi e usi occasionali): connessione nuova e, in
    /// verifica di sintassi, una transazione ADO.NET sempre annullata. Nessun effetto collaterale.
    /// </summary>
    public async Task<QueryResult> ExecuteAsync(string connectionString, string sql, int? timeoutSeconds, CancellationToken ct = default, bool checkSyntax = false)
    {
        await using var conn = new SqlConnection(connectionString)
        {
            FireInfoMessageEventOnUserErrors = true,
        };
        await conn.OpenAsync(ct);

        // Verifica di sintassi: ogni comando gira dentro una transazione ADO.NET che viene
        // SEMPRE annullata a fine richiesta (nessun effetto collaterale). NON si usa
        // "BEGIN TRANSACTION" in T-SQL: se il testo utente contiene già BEGIN TRAN/ROLLBACK/COMMIT
        // (nidificati sopra il nostro), un suo ROLLBACK senza nome chiuderebbe l'INTERA
        // transazione → il Rollback finale fallisce e va ignorato (la connessione si chiude
        // comunque senza COMMIT, quindi niente effetti collaterali residui).
        SqlTransaction? checkTran = null;
        if (checkSyntax) checkTran = (SqlTransaction)await conn.BeginTransactionAsync(ct);

        var result = await EseguiBatchAsync(conn, checkTran, sql, timeoutSeconds, checkSyntax, ct);

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
        return result;
    }

    /// <summary>
    /// Esecuzione NELLA SESSIONE della connessione (quella che resta aperta fra una richiesta e
    /// l'altra): le transazioni aperte e le tabelle temporanee create qui restano valide per
    /// l'esecuzione successiva, come in SSMS. Se a fine esecuzione la sessione ha ancora una
    /// transazione aperta lo si dice nei messaggi (le modifiche non sono salvate).
    /// </summary>
    public async Task<QueryResult> EseguiInSessioneAsync(ConnectionHub.SessioneSql sessione, string sql, int? timeoutSeconds, CancellationToken ct = default)
    {
        var result = await EseguiBatchAsync(sessione.Connection, null, sql, timeoutSeconds, checkSyntax: false, ct);

        var messaggi = new List<string>(result.Messages);
        var dettagli = result.Errors is null ? new List<QueryMessage>() : new List<QueryMessage>(result.Errors);

        // sessione riaperta dopo una disconnessione: quello che c'era prima è perso
        if (sessione.PersaPerDisconnessione)
        {
            messaggi.Add(
                "⚠ Sessione SQL riaperta dopo una disconnessione: le transazioni aperte e le tabelle temporanee di prima sono andate perse.");
        }

        // transazione rimasta APERTA: non si annulla (la sessione resta, come in SSMS) ma va detto
        var trancount = await TrancountAsync(sessione.Connection, ct);
        if (trancount > 0)
        {
            var riga = trancount == 1 ? "1 transazione aperta" : $"{trancount} transazioni annidate aperte";
            messaggi.Add(
                $"⚠ Transazione ancora aperta ({riga}): le modifiche NON sono salvate. Chiudila con COMMIT TRANSACTION oppure ROLLBACK TRANSACTION.");
        }

        return result with { Messages = messaggi, Errors = dettagli, Trancount = trancount };
    }

    /// <summary>Legge @@TRANCOUNT dalla connessione (0 se non si riesce).</summary>
    private static async Task<int> TrancountAsync(SqlConnection conn, CancellationToken ct)
    {
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT @@TRANCOUNT";
            cmd.CommandTimeout = 5;
            var v = await cmd.ExecuteScalarAsync(ct);
            return v is null or DBNull ? 0 : Convert.ToInt32(v, CultureInfo.InvariantCulture);
        }
        catch
        {
            return 0;
        }
    }

    /// <summary>
    /// PIANO DI ESECUZIONE STIMATO: usa SET SHOWPLAN_XML ON, quindi la query NON viene eseguita (nessun
    /// dato letto o modificato). Restituisce l'XML di SQL Server così com'è: l'analisi la fa il client.
    /// Va su una connessione A PARTE (non sulla sessione dell'utente) e spegne sempre SHOWPLAN alla
    /// fine, anche in caso di errore.
    /// </summary>
    public async Task<PlanResult> GetEstimatedPlanAsync(string connectionString, string sql, CancellationToken ct = default)
    {
        var plans = new List<string>();
        string? error = null;
        try
        {
            await using var conn = new SqlConnection(connectionString);
            await conn.OpenAsync(ct);
            await using (var on = conn.CreateCommand())
            {
                on.CommandText = "SET SHOWPLAN_XML ON";
                await on.ExecuteNonQueryAsync(ct);
            }
            try
            {
                foreach (var batch in SqlBatchSplitter.SplitWithLines(sql))
                {
                    await using var cmd = conn.CreateCommand();
                    cmd.CommandText = batch.Text;
                    cmd.CommandTimeout = 60;
                    await using var r = await cmd.ExecuteReaderAsync(ct);
                    do
                    {
                        if (r.FieldCount < 1) continue;
                        while (await r.ReadAsync(ct))
                        {
                            if (r.IsDBNull(0)) continue;
                            var valore = r.GetValue(0);
                            var xml = valore is System.Data.SqlTypes.SqlXml sx ? sx.Value : valore?.ToString() ?? "";
                            // il piano è un XML di showplan: si tiene solo quello (per statement)
                            if (xml.Contains("<ShowPlanXML", StringComparison.OrdinalIgnoreCase)) plans.Add(xml);
                        }
                    } while (await r.NextResultAsync(ct));
                }
            }
            finally
            {
                try
                {
                    await using var off = conn.CreateCommand();
                    off.CommandText = "SET SHOWPLAN_XML OFF";
                    await off.ExecuteNonQueryAsync(ct);
                }
                catch
                {
                    /* la connessione si chiude comunque: SHOWPLAN non resta acceso da nessuna parte */
                }
            }
        }
        catch (OperationCanceledException)
        {
            error = "Piano annullato (timeout).";
        }
        catch (SqlException ex)
        {
            var parti = new List<string>();
            foreach (SqlError err in ex.Errors)
            {
                var proc = err.Procedure is { Length: > 0 } p ? $" Procedura {p}," : "";
                parti.Add($"Msg {err.Number}, Livello {err.Class}, Stato {err.State}{proc} Riga {err.LineNumber}" + Environment.NewLine + err.Message);
            }
            error = string.Join(Environment.NewLine, parti);
        }
        catch (Exception ex)
        {
            error = ex.Message;
        }
        return new PlanResult(plans, error);
    }

    /// <summary>Il giro vero e proprio: divide in batch, esegue e raccoglie set/messaggi/errori.</summary>
    private static async Task<QueryResult> EseguiBatchAsync(
        SqlConnection conn,
        SqlTransaction? tran,
        string sql,
        int? timeoutSeconds,
        bool checkSyntax,
        CancellationToken ct)
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
            // i messaggi (PRINT/errori di sintassi) vanno raccolti SOLO per questa esecuzione: la
            // connessione può essere quella persistente della sessione, condivisa con le altre
            SqlInfoMessageEventHandler onInfo = (_, e) =>
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
            conn.InfoMessage += onInfo;
            try
            {
                var batches = SqlBatchSplitter.SplitWithLines(sql);
                if (batches.Count == 0)
                    throw new InvalidOperationException("Nessuna istruzione SQL da eseguire.");

                foreach (var batch in batches)
                {
                    currentStartLine = batch.StartLine;
                    // "GO n" (come in SSMS): lo stesso batch eseguito n volte. I result set tornano
                    // uno per esecuzione; un errore interrompe il giro come farebbe SSMS.
                    if (batch.Repeat > 1)
                        messages.Add($"(GO {batch.Repeat}: batch eseguito {batch.Repeat} volte)");
                    for (var giro = 0; giro < batch.Repeat; giro++)
                    {
                        await using var cmd = conn.CreateCommand();
                        cmd.CommandText = batch.Text;
                        cmd.Transaction = tran;
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
                }
            }
            finally
            {
                conn.InfoMessage -= onInfo;
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
                // anche nell'elenco dei messaggi: la schermata Messaggi è quella che si apre
                // per prima quando c'è un errore, quindi deve contenerlo
                messages.Add(detail.Display);
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
