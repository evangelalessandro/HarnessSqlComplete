using System.Collections.Concurrent;
using SqlIntelliBackend.Models;

namespace SqlIntelliBackend.Services;

/// <summary>Cache in-memory (TTL breve) dei metadati per connessione, evita di interrogare il DB a ogni tasto.</summary>
public class MetadataCache
{
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(2);
    private readonly ConcurrentDictionary<string, Entry> _cache = new();

    public DatabaseSummary? Get(string connectionId) =>
        _cache.TryGetValue(connectionId, out var e) && e.Expires > DateTime.UtcNow ? e.Summary : null;

    public void Set(string connectionId, DatabaseSummary summary) =>
        _cache[connectionId] = new Entry(summary, DateTime.UtcNow.Add(Ttl));

    public void Invalidate(string connectionId) => _cache.TryRemove(connectionId, out _);

    private sealed record Entry(DatabaseSummary Summary, DateTime Expires);
}
