using System.Collections.Concurrent;
using SqlIntelliBackend.Models;

namespace SqlIntelliBackend.Services;

/// <summary>Cache in-memory (TTL breve) dei metadati per connessione, evita di interrogare il DB a ogni tasto.</summary>
public class MetadataCache
{
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(2);
    private readonly ConcurrentDictionary<string, Entry> _cache = new();
    private readonly ConcurrentDictionary<string, GraphEntry> _graphs = new();

    public DatabaseSummary? Get(string connectionId) =>
        _cache.TryGetValue(connectionId, out var e) && e.Expires > DateTime.UtcNow ? e.Summary : null;

    public void Set(string connectionId, DatabaseSummary summary) =>
        _cache[connectionId] = new Entry(summary, DateTime.UtcNow.Add(Ttl));

    /// <summary>Grafo delle chiamate fra routine (costoso da leggere: si tiene in cache come il sommario).</summary>
    public RoutineCallGraph? GetCallGraph(string connectionId) =>
        _graphs.TryGetValue(connectionId, out var e) && e.Expires > DateTime.UtcNow ? e.Graph : null;

    public void SetCallGraph(string connectionId, RoutineCallGraph graph) =>
        _graphs[connectionId] = new GraphEntry(graph, DateTime.UtcNow.Add(Ttl));

    public void Invalidate(string connectionId)
    {
        _cache.TryRemove(connectionId, out _);
        _graphs.TryRemove(connectionId, out _);
    }

    private sealed record Entry(DatabaseSummary Summary, DateTime Expires);
    private sealed record GraphEntry(RoutineCallGraph Graph, DateTime Expires);
}
