using Microsoft.AspNetCore.Mvc;
using SqlIntelliBackend.Services;

namespace SqlIntelliBackend.Controllers;

/// <summary>
/// FORMATTAZIONE: motore esterno SQLFluff (CLI Python). Il testo arriva dal client, viene
/// formattato e torna indietro; se Python/sqlfluff non ci sono la risposta lo dice con un
/// messaggio chiaro (nessun errore 500).
/// </summary>
[ApiController]
[Route("api/format")]
public class FormatController(SqlFluffFormatter sqlfluff) : ControllerBase
{
    /// <summary>Opzioni di SQLFluff inviate dal client (tutte opzionali: i default stanno nel servizio).</summary>
    public record SqlFluffOptionsDto(
        string? Dialect,
        int? TabSpaceSize,
        bool? UseTabs,
        string? KeywordCasing,
        string? IdentifierCasing,
        string? DataTypeCasing,
        string? FunctionCasing,
        string? CommaStyle,
        bool? WhereNewline,
        int? MaxLineLength);

    public record SqlFluffRequest(string Sql, SqlFluffOptionsDto? Options);

    public record SqlFluffResponse(string? Formatted, string? Error);

    /// <summary>Formatta il testo SQL con SQLFluff (dialetto T-SQL) e restituisce il risultato.</summary>
    [HttpPost("sqlfluff")]
    public async Task<ActionResult<SqlFluffResponse>> SqlFluff([FromBody] SqlFluffRequest richiesta, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(richiesta?.Sql))
            return Ok(new SqlFluffResponse(null, "Nessun testo da formattare."));

        var d = new SqlFluffFormatter.Opzioni();
        var o = richiesta.Options;
        var opzioni = new SqlFluffFormatter.Opzioni(
            Dialect: string.IsNullOrWhiteSpace(o?.Dialect) ? d.Dialect : o!.Dialect!,
            TabSpaceSize: o?.TabSpaceSize ?? d.TabSpaceSize,
            UseTabs: o?.UseTabs ?? d.UseTabs,
            KeywordCasing: string.IsNullOrWhiteSpace(o?.KeywordCasing) ? d.KeywordCasing : o!.KeywordCasing!,
            IdentifierCasing: string.IsNullOrWhiteSpace(o?.IdentifierCasing) ? d.IdentifierCasing : o!.IdentifierCasing!,
            DataTypeCasing: string.IsNullOrWhiteSpace(o?.DataTypeCasing) ? d.DataTypeCasing : o!.DataTypeCasing!,
            FunctionCasing: string.IsNullOrWhiteSpace(o?.FunctionCasing) ? d.FunctionCasing : o!.FunctionCasing!,
            CommaStyle: string.IsNullOrWhiteSpace(o?.CommaStyle) ? d.CommaStyle : o!.CommaStyle!,
            WhereNewline: o?.WhereNewline ?? d.WhereNewline,
            MaxLineLength: o?.MaxLineLength ?? d.MaxLineLength);

        var esito = await sqlfluff.FormattaAsync(richiesta.Sql, opzioni, ct);
        return Ok(new SqlFluffResponse(esito.Formattato, esito.Errore));
    }
}
