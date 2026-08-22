using System.Security.Cryptography;
using System.Text;

namespace SqlIntelliBackend.Services;

/// <summary>
/// Cifra le password delle connessioni salvate usando DPAPI (scope CurrentUser).
/// Su piattaforme non Windows ripiega su Base64 (chiaramente non sicuro, documentato).
/// </summary>
public static class ConnectionCrypto
{
    private const string B64Prefix = "b64:";

    public static string Encrypt(string plain)
    {
        var bytes = Encoding.UTF8.GetBytes(plain);
        if (OperatingSystem.IsWindows())
        {
            try
            {
                return Convert.ToBase64String(ProtectedData.Protect(bytes, null, DataProtectionScope.CurrentUser));
            }
            catch (CryptographicException)
            {
                // DPAPI non disponibile in questo contesto: ripiega su Base64
            }
        }
        return B64Prefix + Convert.ToBase64String(bytes);
    }

    public static string Decrypt(string stored)
    {
        try
        {
            if (stored.StartsWith(B64Prefix, StringComparison.Ordinal))
                return Encoding.UTF8.GetString(Convert.FromBase64String(stored[B64Prefix.Length..]));
            if (OperatingSystem.IsWindows())
                return Encoding.UTF8.GetString(
                    ProtectedData.Unprotect(Convert.FromBase64String(stored), null, DataProtectionScope.CurrentUser));
            return "";
        }
        catch
        {
            return "";
        }
    }
}
