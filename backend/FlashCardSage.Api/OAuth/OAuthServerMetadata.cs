using FlashCardSage.Api.Contracts;

namespace FlashCardSage.Api.OAuth;

/// <summary>
/// The two metadata documents MCP clients read to sign in: the MCP endpoint's, which names this server, and this
/// server's, which lists its endpoints. Built only here, so they always agree with each other and the options.
/// </summary>
public static class OAuthServerMetadata
{
    public const string AuthorizePath = "/oauth/authorize";

    public const string TokenPath = "/oauth/token";

    public const string RegisterPath = "/oauth/register";

    // Where the MCP endpoint's metadata is (RFC 9728 puts the resource's path after the well-known name), which a
    // 401 from /mcp points MCP clients at.
    public const string McpProtectedResourcePath = "/.well-known/oauth-protected-resource/mcp";

    public static OAuthAuthorizationServerMetadata AuthorizationServer(OAuthServerOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        return new OAuthAuthorizationServerMetadata(
            Issuer: options.Issuer,
            AuthorizationEndpoint: options.Issuer + AuthorizePath,
            TokenEndpoint: options.Issuer + TokenPath,
            RegistrationEndpoint: options.Issuer + RegisterPath,
            ScopesSupported: [OAuthServerOptions.Scope],
            ResponseTypesSupported: ["code"],
            ResponseModesSupported: ["query"],
            GrantTypesSupported: ["authorization_code", "refresh_token"],
            TokenEndpointAuthMethodsSupported: ["none"],
            CodeChallengeMethodsSupported: [Pkce.S256],
            ClientIdMetadataDocumentSupported: true);
    }

    public static OAuthProtectedResourceMetadata ProtectedResource(OAuthServerOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        return new OAuthProtectedResourceMetadata(
            Resource: options.McpResource,
            AuthorizationServers: [options.Issuer],
            ScopesSupported: [OAuthServerOptions.Scope],
            BearerMethodsSupported: ["header"]);
    }
}
