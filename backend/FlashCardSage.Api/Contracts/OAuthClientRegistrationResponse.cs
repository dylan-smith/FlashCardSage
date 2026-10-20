using System.Text.Json.Serialization;

namespace FlashCardSage.Api.Contracts;

// A registered app (RFC 7591): always a public client, which proves itself with PKCE rather than a secret.
public record OAuthClientRegistrationResponse(
    [property: JsonPropertyName("client_id")] string ClientId,
    [property: JsonPropertyName("client_id_issued_at")] long ClientIdIssuedAt,
    [property: JsonPropertyName("client_name"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? ClientName,
    [property: JsonPropertyName("redirect_uris")] IReadOnlyList<string> RedirectUris,
    [property: JsonPropertyName("token_endpoint_auth_method")] string TokenEndpointAuthMethod,
    [property: JsonPropertyName("grant_types")] IReadOnlyList<string> GrantTypes,
    [property: JsonPropertyName("response_types")] IReadOnlyList<string> ResponseTypes);
