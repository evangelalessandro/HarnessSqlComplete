using Microsoft.Data.SqlClient;
using SqlIntelliBackend.Models;

namespace SqlIntelliBackend.Services;

/// <summary>Costruisce connection string SQL Server a partire da una richiesta o da una login salvata.</summary>
public static class SqlConnectionStringFactory
{
    public static string Build(ConnectionRequest r)
    {
        var server = r.Port is > 0 and not 1433 ? $"{r.Server},{r.Port}" : r.Server;
        var b = new SqlConnectionStringBuilder
        {
            DataSource = server,
            InitialCatalog = string.IsNullOrWhiteSpace(r.Database) ? "master" : r.Database.Trim(),
            ConnectTimeout = 10,
            Encrypt = r.Encrypt ?? false,
            TrustServerCertificate = r.TrustServerCertificate ?? true,
        };
        if (r.UseWindowsAuth)
        {
            b.IntegratedSecurity = true;
        }
        else
        {
            b.UserID = r.Username;
            b.Password = r.Password;
        }
        return b.ConnectionString;
    }

    public static string Build(SavedConnection c)
    {
        var password = string.IsNullOrWhiteSpace(c.EncryptedPassword)
            ? null
            : ConnectionCrypto.Decrypt(c.EncryptedPassword);
        return Build(new ConnectionRequest(
            c.Name, c.Server, c.Port, c.Database, c.UseWindowsAuth, c.Username, password,
            Save: false, Encrypt: null, TrustServerCertificate: null));
    }

    public static string ServerName(ConnectionRequest r) =>
        r.Port is > 0 and not 1433 ? $"{r.Server},{r.Port}" : r.Server;
}
