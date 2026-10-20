namespace FlashCardSage.Api.Models;

// An access or refresh token a connected app was given, kept only as its hash (OAuthTokens.Hash). It's looked up
// before the user is known, so it has no query filter, and its grant is reached past the grants' filter.
public class OAuthToken
{
    public int Id { get; set; }

    public int GrantId { get; set; }

    // The sign-in the token came from. Every refresh carries it on, so a stolen refresh token used twice revokes them all.
    public Guid FamilyId { get; set; }

    public OAuthTokenKind Kind { get; set; }

    public string TokenHash { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset ExpiresAt { get; set; }

    // When a refresh token was exchanged for new tokens.
    public DateTimeOffset? UsedAt { get; set; }
}
