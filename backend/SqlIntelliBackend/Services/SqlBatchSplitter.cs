using System.Text.RegularExpressions;

namespace SqlIntelliBackend.Services;

/// <summary>
/// Batch SQL con la riga (1-based) a cui inizia nel testo originale.
/// <paramref name="Repeat"/> = quante volte eseguire il batch: in SSMS "GO 5" esegue il batch 5 volte
/// (senza numero = 1).
/// </summary>
public record SqlBatch(string Text, int StartLine, int Repeat = 1);

/// <summary>
/// Splitta un batch SQL sui separatori "GO" (case-insensitive, riga intera).
/// Come in SSMS la riga può portare un NUMERO di ripetizioni: "GO 5" esegue il batch cinque volte
/// (richiesta utente). Un numero non valido (0, negativo, non numerico) vale 1, per non bloccare
/// l'esecuzione; oltre <see cref="MaxRepeat"/> ci si ferma a quel limite (protezione: "GO 1000000"
/// su una procedura pesante bloccherebbe l'app).
/// Nota: non gestisce "GO" dentro stringhe letterali o commenti (limite accettato per uno strumento locale).
/// </summary>
public static partial class SqlBatchSplitter
{
    /// <summary>Numero massimo di ripetizioni accettate da "GO n".</summary>
    public const int MaxRepeat = 1000;

    /// <summary>"GO" da solo oppure seguito dal numero di ripetizioni: "GO", "GO 5", "go 12".</summary>
    [GeneratedRegex(@"^[ \t]*GO(?:[ \t]+(\d+))?[ \t]*$", RegexOptions.IgnoreCase | RegexOptions.Multiline)]
    private static partial Regex GoRegex();

    /// <summary>Solo i testi dei batch (compatibilità).</summary>
    public static List<string> Split(string sql)
    {
        return SplitWithLines(sql).Select(b => b.Text).ToList();
    }

    /// <summary>Numero di ripetizioni dichiarato dalla riga "GO n" (1 se assente o non valido).</summary>
    private static int RepeatOf(Match go)
    {
        if (!go.Groups[1].Success) return 1;
        if (!int.TryParse(go.Groups[1].Value, out var n)) return 1;
        if (n < 1) return 1;
        return Math.Min(n, MaxRepeat);
    }

    /// <summary>
    /// Splitta in batch restituendo, per ciascuno, la riga di partenza nel testo originale
    /// (serve a mostrare la riga corretta negli errori: SQL Server riporta la riga relativa al batch)
    /// e quante volte va eseguito ("GO n").
    /// </summary>
    public static List<SqlBatch> SplitWithLines(string sql)
    {
        var outList = new List<SqlBatch>();
        if (string.IsNullOrWhiteSpace(sql)) return outList;

        var matches = GoRegex().Matches(sql);
        int pos = 0;
        foreach (Match m in matches)
        {
            // inizio reale del batch (dopo lo spazio bianco iniziale)
            var trimmedStart = pos;
            while (trimmedStart < m.Index && char.IsWhiteSpace(sql[trimmedStart])) trimmedStart++;
            var batchText = sql[trimmedStart..m.Index].TrimEnd();
            // il "GO n" chiude il batch che lo precede: si ripete quel batch, n volte
            if (batchText.Length > 0) outList.Add(new SqlBatch(batchText, LineAt(sql, trimmedStart), RepeatOf(m)));
            pos = m.Index + m.Length;
        }
        var lastStart = pos;
        while (lastStart < sql.Length && char.IsWhiteSpace(sql[lastStart])) lastStart++;
        var lastText = sql[lastStart..].TrimEnd();
        if (lastText.Length > 0) outList.Add(new SqlBatch(lastText, LineAt(sql, lastStart)));
        return outList;
    }

    /// <summary>Riga (1-based) dell'indice di carattere nel testo.</summary>
    private static int LineAt(string sql, int index)
    {
        var line = 1;
        for (var i = 0; i < index && i < sql.Length; i++)
            if (sql[i] == '\n') line++;
        return line;
    }
}
