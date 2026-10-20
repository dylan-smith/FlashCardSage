using System.Text.Json.Serialization;

namespace FlashCardSage.Api.Contracts;

// The tokens an app gets for a code or a refresh token (RFC 6749 section 5.1). ExpiresIn is the access token's
// lifetime in seconds.
public record OAuthTokenResponse(
    [property: JsonPropertyName("access_token")] string AccessToken,
    [property: JsonPropertyName("token_type")] string TokenType,
    [property: JsonPropertyName("expires_in")] int ExpiresIn,
    [property: JsonPropertyName("refresh_token")] string RefreshToken,
    [property: JsonPropertyName("scope")] string Scope);
