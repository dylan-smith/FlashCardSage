namespace FlashCardSage.Api.Contracts;

// An app the user has connected, for Connected apps. The client fields mean what they do in
// OAuthAuthorizationRequestResponse.
public record OAuthConnectionResponse(
    int Id,
    string? ClientName,
    string? ClientHost,
    bool ClientNameIsSelfAsserted,
    IReadOnlyList<string> Scopes,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastUsedAt);
