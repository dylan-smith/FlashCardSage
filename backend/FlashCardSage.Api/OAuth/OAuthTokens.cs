using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;

namespace FlashCardSage.Api.OAuth;

/// <summary>
/// The random values the OAuth server hands out. Each has a prefix that says what it is, so the API can tell an MCP
/// access token from the other bearer tokens it accepts without looking it up, and only its hash is kept.
/// </summary>
public static class OAuthTokens
{
    public const string AccessTokenPrefix = "fcs_at_";

    public const string RefreshTokenPrefix = "fcs_rt_";

    public const string CodePrefix = "fcs_ac_";

    public const string ClientIdPrefix = "fcs_c_";

    // A SHA-256 hash as hex.
    public const int HashLength = 64;

    public static string NewAccessToken()
    {
        return New(AccessTokenPrefix, 32);
    }

    public static string NewRefreshToken()
    {
        return New(RefreshTokenPrefix, 32);
    }

    public static string NewCode()
    {
        return New(CodePrefix, 32);
    }

    // Client IDs aren't secret, so they're shorter.
    public static string NewClientId()
    {
        return New(ClientIdPrefix, 16);
    }

    // The SHA-256 of the value, as lowercase hex, which is what the database keeps.
    public static string Hash(string value)
    {
        ArgumentNullException.ThrowIfNull(value);

        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    }

    public static bool IsAccessToken(string? token)
    {
        return token is not null && token.StartsWith(AccessTokenPrefix, StringComparison.Ordinal);
    }

    private static string New(string prefix, int byteCount)
    {
        return prefix + Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(byteCount));
    }
}
