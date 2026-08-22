namespace SqlIntelliBackend.Models;

/// <summary>Rappresenta una login salvata localmente (SQLite) per un database SQL Server.</summary>
public class SavedConnection
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Server { get; set; } = "";
    public int Port { get; set; } = 1433;
    public string? Database { get; set; }
    public bool UseWindowsAuth { get; set; } = true;
    public string? Username { get; set; }
    /// <summary>Password cifrata con DPAPI (CurrentUser scope).</summary>
    public string? EncryptedPassword { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
