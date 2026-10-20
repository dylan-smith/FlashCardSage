using System.Text.Json.Serialization;

namespace FlashCardSage.Api.Contracts;

// An OAuth error (RFC 6749 section 5.2), which apps expect instead of a problem response.
public record OAuthErrorResponse(
    [property: JsonPropertyName("error")] string Error,
    [property: JsonPropertyName("error_description")] string ErrorDescription);
