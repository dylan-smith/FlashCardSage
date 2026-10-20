namespace FlashCardSage.Api.OAuth;

/// <summary>
/// Where the OAuth server and the frontend are, from Api:BaseUrl and Frontend:BaseUrl. They're set rather than taken
/// from the request, since a forwarded host header could otherwise name another issuer. With either missing the OAuth
/// endpoints answer 503.
/// </summary>
public sealed class OAuthServerOptions
{
    // The one scope there is: everything the MCP tools do with the user's flash cards.
    public const string Scope = "flashcards";

    // Asked for by some clients to get a refresh token, which they always get here, so it's left out.
    public const string OfflineAccessScope = "offline_access";

    public static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(10);

    public static readonly TimeSpan PendingRequestLifetime = TimeSpan.FromMinutes(15);

    public static readonly TimeSpan AccessTokenLifetime = TimeSpan.FromHours(1);

    // Each refresh gives a refresh token that lasts this long again, so an app used once a month stays connected.
    public static readonly TimeSpan RefreshTokenLifetime = TimeSpan.FromDays(30);

    // A refresh token used again this soon after it was exchanged is probably the app retrying, so it's refused without
    // revoking the tokens; later, it's probably stolen, and every token from that sign-in is revoked.
    public static readonly TimeSpan RefreshReuseGrace = TimeSpan.FromSeconds(60);

    public string ApiBaseUrl { get; init; } = string.Empty;

    public string FrontendBaseUrl { get; init; } = string.Empty;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiBaseUrl) && !string.IsNullOrWhiteSpace(FrontendBaseUrl);

    // The API's URL, which identifies the OAuth server.
    public string Issuer => ApiBaseUrl.Trim().TrimEnd('/');

    // The MCP endpoint, which the tokens are for.
    public string McpResource => $"{Issuer}/mcp";

    public string Frontend => FrontendBaseUrl.Trim().TrimEnd('/');

    // Whether a resource an app named (RFC 8707) is the MCP endpoint.
    public bool IsMcpResource(string resource)
    {
        ArgumentNullException.ThrowIfNull(resource);

        return string.Equals(resource, McpResource, StringComparison.Ordinal)
            || string.Equals(resource, McpResource + "/", StringComparison.Ordinal);
    }

    // The scope a sign-in asked for, or null when it asks for one there isn't. offline_access is left out, and asking
    // for nothing gets the one scope there is.
    public static string? NormalizeScope(string? scope)
    {
        var scopes = (scope ?? string.Empty)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(item => item != OfflineAccessScope)
            .ToList();

        return scopes.All(item => item == Scope) ? Scope : null;
    }

    public static OAuthServerOptions FromConfiguration(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        return new OAuthServerOptions
        {
            ApiBaseUrl = configuration["Api:BaseUrl"] ?? string.Empty,
            FrontendBaseUrl = configuration["Frontend:BaseUrl"] ?? string.Empty
        };
    }
}
