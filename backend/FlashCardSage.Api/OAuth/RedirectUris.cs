namespace FlashCardSage.Api.OAuth;

/// <summary>
/// Which redirect URIs an app may register, and whether the one a sign-in asks for is one of them.
/// </summary>
public static class RedirectUris
{
    // Schemes that would run or show something in the browser rather than hand the code to an app.
    private static readonly HashSet<string> ForbiddenSchemes =
        new(["javascript", "data", "file", "blob", "vbscript", "about"], StringComparer.OrdinalIgnoreCase);

    private static readonly HashSet<string> LoopbackHosts =
        new(["127.0.0.1", "[::1]", "localhost"], StringComparer.OrdinalIgnoreCase);

    // An absolute URI with no fragment that's https, http on this computer (as native apps such as Claude Code use),
    // or an app's own scheme.
    public static bool IsAcceptable(string? uri)
    {
        return !string.IsNullOrWhiteSpace(uri)
            && uri.Length <= Models.OAuthClient.MaxRedirectUriLength
            && !uri.Contains('#', StringComparison.Ordinal)
            && Uri.TryCreate(uri, UriKind.Absolute, out var parsed)
            && parsed.Scheme switch
            {
                "https" => !string.IsNullOrEmpty(parsed.Host),
                "http" => IsLoopback(parsed),
                _ => !ForbiddenSchemes.Contains(parsed.Scheme)
            };
    }

    // Whether the requested URI is the registered one, exactly. A loopback one may be on any port, since a native app
    // listens on whichever port is free when it signs in (RFC 8252 section 7.3).
    public static bool Matches(string registered, string? requested)
    {
        ArgumentNullException.ThrowIfNull(registered);

        return requested is not null
            && (string.Equals(registered, requested, StringComparison.Ordinal)
                || (Uri.TryCreate(registered, UriKind.Absolute, out var left)
                    && Uri.TryCreate(requested, UriKind.Absolute, out var right)
                    && left.Scheme is "http" or "https"
                    && IsLoopback(left)
                    && IsLoopback(right)
                    && string.Equals(left.Scheme, right.Scheme, StringComparison.Ordinal)
                    && string.Equals(left.Host, right.Host, StringComparison.OrdinalIgnoreCase)
                    && string.Equals(left.UserInfo, right.UserInfo, StringComparison.Ordinal)
                    && string.Equals(left.PathAndQuery, right.PathAndQuery, StringComparison.Ordinal)));
    }

    public static bool IsLoopback(Uri uri)
    {
        ArgumentNullException.ThrowIfNull(uri);

        return LoopbackHosts.Contains(uri.Host);
    }
}
