using System.Text.RegularExpressions;

namespace SqlIntelliBackend.Services;

/// <summary>Batch SQL con la riga (1-based) a cui inizia nel testo originale.</summary>
public record SqlBatch(string Text, int StartLine);

/// <summary>
/// Splitta un batch SQL sui separatori "GO" (case-insensitive, riga intera).
/// Nota: non gestisce "GO" dentro stringhe letterali o commenti (limite accettato per uno strumento locale).
/// </summary>
public static partial class SqlBatchSplitter
{
    [GeneratedRegex(@"^\s*GO\s*$", RegexOptions.IgnoreCase | RegexOptions.Multiline)]
    private static partial Regex GoRegex();

    /// <summary>Solo i testi dei batch (compatibilità).</summary>
    public static List<string> Split(string sql)
    {
        return SplitWithLines(sql).Select(b => b.Text).ToList();
    }

    /// <summary>
    /// Splitta in batch restituendo, per ciascuno, la riga di partenza nel testo originale
    /// (serve a mostrare la riga corretta negli errori: SQL Server riporta la riga relativa al batch).
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
            if (batchText.Length > 0) outList.Add(new SqlBatch(batchText, LineAt(sql, trimmedStart)));
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
