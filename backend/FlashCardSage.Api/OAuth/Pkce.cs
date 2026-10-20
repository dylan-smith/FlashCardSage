using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;

namespace FlashCardSage.Api.OAuth;

/// <summary>
/// Proof Key for Code Exchange (RFC 7636), S256 only: the app sends the hash of a secret with the sign-in and the
/// secret itself with the code, so a code that's intercepted on the way back is no use to anyone else.
/// </summary>
public static class Pkce
{
    public const string S256 = "S256";

    // A base64url SHA-256 hash with no padding.
    private const int ChallengeLength = 43;

    // A verifier is 43 to 128 of the URL's unreserved characters.
    public static bool IsValidVerifier(string? verifier)
    {
        return verifier is { Length: >= 43 and <= 128 } && verifier.All(IsUnreserved);
    }

    public static bool IsValidChallenge(string? challenge)
    {
        return challenge is { Length: ChallengeLength }
            && challenge.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_');
    }

    public static string Challenge(string verifier)
    {
        ArgumentNullException.ThrowIfNull(verifier);

        return Base64Url.EncodeToString(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
    }

    // Whether the verifier hashes to the challenge, compared in constant time.
    public static bool Verify(string? verifier, string challenge)
    {
        ArgumentNullException.ThrowIfNull(challenge);

        return IsValidVerifier(verifier)
            && CryptographicOperations.FixedTimeEquals(
                Encoding.ASCII.GetBytes(Challenge(verifier!)),
                Encoding.ASCII.GetBytes(challenge));
    }

    private static bool IsUnreserved(char character)
    {
        return char.IsAsciiLetterOrDigit(character) || character is '-' or '.' or '_' or '~';
    }
}
