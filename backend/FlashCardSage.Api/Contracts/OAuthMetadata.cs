using System.Text.Json.Serialization;

namespace FlashCardSage.Api.Contracts;

// The OAuth server's metadata (RFC 8414), which apps read to find its endpoints and what it supports. Built by
// OAuthServerMetadata.
public record OAuthAuthorizationServerMetadata(
    [property: JsonPropertyName("issuer")] string Issuer,
    [property: JsonPropertyName("authorization_endpoint")] string AuthorizationEndpoint,
    [property: JsonPropertyName("token_endpoint")] string TokenEndpoint,
    [property: JsonPropertyName("registration_endpoint")] string RegistrationEndpoint,
    [property: JsonPropertyName("scopes_supported")] IReadOnlyList<string> ScopesSupported,
    [property: JsonPropertyName("response_types_supported")] IReadOnlyList<string> ResponseTypesSupported,
    [property: JsonPropertyName("response_modes_supported")] IReadOnlyList<string> ResponseModesSupported,
    [property: JsonPropertyName("grant_types_supported")] IReadOnlyList<string> GrantTypesSupported,
    [property: JsonPropertyName("token_endpoint_auth_methods_supported")] IReadOnlyList<string> TokenEndpointAuthMethodsSupported,
    [property: JsonPropertyName("code_challenge_methods_supported")] IReadOnlyList<string> CodeChallengeMethodsSupported,
    [property: JsonPropertyName("client_id_metadata_document_supported")] bool ClientIdMetadataDocumentSupported);

// The MCP endpoint's protected resource metadata (RFC 9728), which tells an MCP client which OAuth server signs in
// for it.
public record OAuthProtectedResourceMetadata(
    [property: JsonPropertyName("resource")] string Resource,
    [property: JsonPropertyName("authorization_servers")] IReadOnlyList<string> AuthorizationServers,
    [property: JsonPropertyName("scopes_supported")] IReadOnlyList<string> ScopesSupported,
    [property: JsonPropertyName("bearer_methods_supported")] IReadOnlyList<string> BearerMethodsSupported);
