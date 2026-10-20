namespace FlashCardSage.Api.Models;

// A sign-in in progress (see OAuthAuthorizationService). It's made before anyone has signed in, so it has no owner and
// no query filter: its random Id is what the consent page is given. Approving it sets the user and the single-use code.
public class OAuthAuthorizationRequest
{
    public const int MaxStateLength = 1000;

    public Guid Id { get; set; }

    public int OAuthClientId { get; set; }

    public OAuthClient Client { get; set; } = null!;

    // The redirect URI the app asked for, which the code is sent to and which the token request must repeat.
    public string RedirectUri { get; set; } = string.Empty;

    public string Scope { get; set; } = string.Empty;

    public string? State { get; set; }

    // The PKCE S256 challenge.
    public string CodeChallenge { get; set; } = string.Empty;

    public string? Resource { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    // When the pending request expires, and once it's approved, when the code does.
    public DateTimeOffset ExpiresAt { get; set; }

    // The user who approved it.
    public int? UserId { get; set; }

    // The code's hash (OAuthTokens.Hash), set on approval.
    public string? CodeHash { get; set; }

    public DateTimeOffset? ApprovedAt { get; set; }

    public DateTimeOffset? RedeemedAt { get; set; }

    // The tokens the code was redeemed for, so a code used again can revoke them.
    public Guid? TokenFamilyId { get; set; }
}
