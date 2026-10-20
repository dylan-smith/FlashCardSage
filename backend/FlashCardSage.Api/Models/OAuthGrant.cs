namespace FlashCardSage.Api.Models;

// An app a user has connected: one for each user and app, shown in Connected apps. Deleting it disconnects the app and
// deletes its tokens.
public class OAuthGrant : IUserOwned
{
    public int Id { get; set; }

    public int UserId { get; set; }

    public int OAuthClientId { get; set; }

    public OAuthClient Client { get; set; } = null!;

    public string Scope { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; }

    // When the app last refreshed its tokens or used one, roughly (see OAuthAccessTokenHandler).
    public DateTimeOffset? LastUsedAt { get; set; }
}
