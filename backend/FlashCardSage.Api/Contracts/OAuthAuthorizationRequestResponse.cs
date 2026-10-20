namespace FlashCardSage.Api.Contracts;

// A sign-in waiting for the user's consent, for the frontend's consent page. ClientHost is the host of the app's
// metadata document's URL, which vouches for it (such as "claude.ai"), or null for an app that registered itself,
// whose name is only what it called itself, as ClientNameIsSelfAsserted says. RedirectHost is where the user is sent
// back to.
public record OAuthAuthorizationRequestResponse(
    Guid Id,
    string? ClientName,
    string? ClientHost,
    bool ClientNameIsSelfAsserted,
    string RedirectHost,
    IReadOnlyList<string> Scopes,
    DateTimeOffset ExpiresAt);
