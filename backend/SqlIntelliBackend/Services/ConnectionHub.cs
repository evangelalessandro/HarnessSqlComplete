using System.Collections.Concurrent;

namespace SqlIntelliBackend.Services;

/// <summary>
/// Tiene in memoria (solo RAM, mai restituite al client) le connection string delle sessioni attive.
/// Ogni richiesta apre una connessione fresca a partire dalla stringa registrata.
/// </summary>
public class ConnectionHub
{
    private readonly ConcurrentDictionary<string, string> _connections = new();

    public string Register(string connectionString)
    {
        var id = Guid.NewGuid().ToString("N");
        _connections[id] = connectionString;
        return id;
    }

    public string? Get(string connectionId) =>
        _connections.TryGetValue(connectionId, out var cs) ? cs : null;

    public bool Exists(string connectionId) => _connections.ContainsKey(connectionId);

    public void Remove(string connectionId) => _connections.TryRemove(connectionId, out _);
}
