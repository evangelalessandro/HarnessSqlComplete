using System.Text.Json.Serialization;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.EntityFrameworkCore;
using SqlIntelliBackend.Data;
using SqlIntelliBackend.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers().AddJsonOptions(o =>
{
    o.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    o.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});
builder.Services.AddOpenApi();

// COMPRESSIONE DELLE RISPOSTE: il sommario dei metadati è grande (3,5 MB di JSON per 340 tabelle)
// e viaggia a ogni ricarica dello schema. Con Brotli/Gzip scende a poche centinaia di KB: meno
// tempo di trasferimento e, soprattutto, meno tempo del browser a scaricarlo e interpretarlo.
// (Fastest: si comprime in fretta, il rapporto resta ottimo su JSON ripetitivo.)
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;
    o.Providers.Add<BrotliCompressionProvider>();
    o.Providers.Add<GzipCompressionProvider>();
});
builder.Services.Configure<BrotliCompressionProviderOptions>(o => o.Level = System.IO.Compression.CompressionLevel.Optimal);
builder.Services.Configure<GzipCompressionProviderOptions>(o => o.Level = System.IO.Compression.CompressionLevel.Optimal);

// SQLite locale per le login salvate
builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=sqlintelli.db"));

// Servizi applicativi
builder.Services.AddSingleton<ConnectionHub>();
builder.Services.AddSingleton<MetadataCache>();
builder.Services.AddScoped<MetadataService>();
builder.Services.AddScoped<QueryService>();
// Stateless come MetadataService/QueryService (solo ILogger): stessa durata, una per richiesta.
builder.Services.AddScoped<SearchService>();
builder.Services.AddSingleton<SqlFluffFormatter>();
builder.Services.AddHttpClient<DeepSeekService>(c =>
{
    c.BaseAddress = new Uri(builder.Configuration["DeepSeek:BaseUrl"] ?? "https://api.deepseek.com");
    c.Timeout = TimeSpan.FromSeconds(90);
});

// CORS per il frontend Vite in sviluppo
var corsOrigins = (builder.Configuration["Cors:Origins"] ?? "http://localhost:5173;http://localhost:4173")
    .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins(corsOrigins).AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

// Crea il DB SQLite al primo avvio
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
}

if (app.Environment.IsDevelopment())
    app.MapOpenApi();

// deve stare PRIMA di CORS e dei controller: comprime le risposte (v. AddResponseCompression sopra)
app.UseResponseCompression();
app.UseCors();
app.MapControllers();

app.Run();
