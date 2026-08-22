using System.Text.RegularExpressions;

namespace SqlIntelliBackend.Services;

/// <summary>
/// Splitta un batch SQL sui separatori "GO" (case-insensitive, riga intera).
/// Nota: non gestisce "GO" dentro stringhe letterali o commenti (limite accettato per uno strumento locale).
/// </summary>
public static partial class SqlBatchSplitter
{
    [GeneratedRegex(@"^\s*GO\s*$", RegexOptions.IgnoreCase | RegexOptions.Multiline)]
    private static partial Regex GoRegex();

    public static List<string> Split(string sql)
    {
        if (string.IsNullOrWhiteSpace(sql)) return [];
        return GoRegex()
            .Split(sql)
            .Select(p => p.Trim())
            .Where(p => p.Length > 0)
            .ToList();
    }
}
