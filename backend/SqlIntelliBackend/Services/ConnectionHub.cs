using System.Collections.Concurrent;
using System.Data;
using Microsoft.Data.SqlClient;

namespace SqlIntelliBackend.Services;

/// <summary>
/// Tiene in memoria (solo RAM, mai restituite al client) le connessioni attive.
///
/// Oltre alla connection string, ogni connessione ha una SESSIONE SQL vera: la connessione fisica
/// resta APERTA fra una richiesta e l'altra, così quello che si fa in una esecuzione si ritrova
/// nella successiva — come in SSMS:
/// <list type="bullet">
/// <item>una transazione aperta con BEGIN TRAN in un F5 si chiude con COMMIT/ROLLBACK nel F5 dopo;</item>
/// <item>le tabelle temporanee (#tmp) create in un'esecuzione esistono anche dopo;</item>
/// <item><c>SET</c> di sessione, tabelle di lavoro e variabili di sessione restano validi.</item>
/// </list>
/// Le letture di metadati (schema, definizioni, ricerche) NON usano la sessione: continuano ad
/// aprire connessioni brevi, così non si mettono in coda dietro a una query lunga né dietro a una
/// transazione aperta dall'utente.
///
/// Le esecuzioni sulla STESSA sessione sono serializzate da un semaforo (SqlClient non permette due
/// comandi contemporanei sulla stessa connessione): la seconda attende, non fallisce.
/// </summary>
public sealed class ConnectionHub : IAsyncDisposable
{
    /// <summary>Stato di una connessione: stringa + connessione fisica persistente + lucchetto.</summary>
    internal sealed class Stato
    {
        public required string ConnectionString { get; init; }
        public readonly SemaphoreSlim Lucchetto = new(1, 1);
        /// <summary>Connessione fisica della sessione (null finché non serve).</summary>
        public SqlConnection? Connessione;
        /// <summary>True quando la connessione è stata riaperta: lo stato precedente è perso.</summary>
        public bool PersaPerDisconnessione;
    }

    private readonly ConcurrentDictionary<string, Stato> _connections = new();

    public string Register(string connectionString)
    {
        var id = Guid.NewGuid().ToString("N");
        _connections[id] = new Stato { ConnectionString = connectionString };
        return id;
    }

    /// <summary>Connection string della connessione (per le letture di metadati).</summary>
    public string? Get(string connectionId) =>
        _connections.TryGetValue(connectionId, out var s) ? s.ConnectionString : null;

    public bool Exists(string connectionId) => _connections.ContainsKey(connectionId);

    /// <summary>
    /// Prende la SESSIONE per un'esecuzione: una sola alla volta per connessione (semaphore).
    /// Restituisce null se la connessione non esiste più. Il chiamante DEVE fare `using` sul
    /// risultato per rilasciarla (la connessione NON viene chiusa: resta per le esecuzioni dopo).
    /// </summary>
    public async Task<SessioneSql?> ApriSessioneAsync(string connectionId, CancellationToken ct)
    {
        if (!_connections.TryGetValue(connectionId, out var stato)) return null;
        await stato.Lucchetto.WaitAsync(ct);
        try
        {
            if (stato.Connessione is { State: ConnectionState.Open }) return new SessioneSql(stato.Connessione, stato, false);

            // La sessione non c'è (primo uso) o è morta (rete, riavvio di SQL Server): si riapre.
            // Se PRIMA esisteva, quello che c'era dentro (transazione, #tmp) è andato perso.
            var persa = stato.Connessione is not null;
            if (stato.Connessione is not null)
            {
                try
                {
                    await stato.Connessione.DisposeAsync();
                }
                catch
                {
                    /* connessione già rotta: niente da fare */
                }
                stato.Connessione = null;
            }
            var conn = new SqlConnection(stato.ConnectionString)
            {
                // gli errori "di utente" (sintassi) arrivano come InfoMessage: servono per la
                // verifica di sintassi e per i messaggi come in SSMS
                FireInfoMessageEventOnUserErrors = true,
            };
            await conn.OpenAsync(ct);
            stato.Connessione = conn;
            stato.PersaPerDisconnessione = persa;
            return new SessioneSql(conn, stato, persa);
        }
        catch
        {
            stato.Lucchetto.Release();
            throw;
        }
    }

    /// <summary>Chiude la connessione fisica della sessione (fine della connessione logica).</summary>
    public async Task RemoveAsync(string connectionId)
    {
        if (!_connections.TryRemove(connectionId, out var stato)) return;
        // si attende l'eventuale esecuzione in corso e poi si chiude la sessione: chiudere una
        // connessione con una transazione aperta la annulla (come chiudere la finestra in SSMS)
        await stato.Lucchetto.WaitAsync();
        try
        {
            if (stato.Connessione is not null)
            {
                try
                {
                    await stato.Connessione.DisposeAsync();
                }
                catch
                {
                    /* già chiusa */
                }
                stato.Connessione = null;
            }
        }
        finally
        {
            stato.Lucchetto.Release();
        }
    }

    /// <summary>Rilascio del semaforo a fine esecuzione (chiamato da <see cref="SessioneSql"/>).</summary>
    internal static void Rilascia(Stato stato) => stato.Lucchetto.Release();

    public async ValueTask DisposeAsync()
    {
        foreach (var id in _connections.Keys) await RemoveAsync(id);
    }

    /// <summary>
    /// SESSIONE SQL prestata a un'esecuzione: `using` per rilasciarla (la connessione resta aperta).
    /// </summary>
    public sealed class SessioneSql : IAsyncDisposable
    {
        private bool _rilasciata;

        internal SessioneSql(SqlConnection connection, Stato stato, bool persa)
        {
            Connection = connection;
            _stato = stato;
            PersaPerDisconnessione = persa;
        }

        private readonly Stato _stato;

        /// <summary>Connessione fisica della sessione (aperta, riusata a ogni esecuzione).</summary>
        public SqlConnection Connection { get; }

        /// <summary>
        /// True se questa sessione è stata RIAPERTA perché la precedente non era più valida:
        /// transazioni e tabelle temporanee di prima sono andate perse (va detto all'utente).
        /// </summary>
        public bool PersaPerDisconnessione { get; }

        public ValueTask DisposeAsync()
        {
            if (!_rilasciata)
            {
                _rilasciata = true;
                Rilascia(_stato);
            }
            return ValueTask.CompletedTask;
        }
    }
}
