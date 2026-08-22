using Microsoft.EntityFrameworkCore;
using SqlIntelliBackend.Models;

namespace SqlIntelliBackend.Data;

/// <summary>DbContext SQLite usato per salvare localmente le login dei database.</summary>
public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<SavedConnection> SavedConnections => Set<SavedConnection>();
}
