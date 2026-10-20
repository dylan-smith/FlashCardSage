using System.Text.Json.Serialization;

namespace FlashCardSage.Api.Contracts;

// An app registering itself (RFC 7591). Only what the server looks at; everything is optional here, and
// OAuthClientRegistry answers with the RFC's errors rather than a validation problem.
public class OAuthClientRegistrationRequest
{
    [JsonPropertyName("redirect_uris")]
    public List<string>? RedirectUris { get; set; }

    [JsonPropertyName("client_name")]
    public string? ClientName { get; set; }

    [JsonPropertyName("token_endpoint_auth_method")]
    public string? TokenEndpointAuthMethod { get; set; }

    [JsonPropertyName("grant_types")]
    public List<string>? GrantTypes { get; set; }

    [JsonPropertyName("response_types")]
    public List<string>? ResponseTypes { get; set; }
}
