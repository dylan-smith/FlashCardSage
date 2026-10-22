using FlashCardSage.Api.Models;
using FlashCardSage.Api.OAuth;

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
    DateTimeOffset? LastUsedAt)
{
    // The grant, which must be loaded with its app.
    public static OAuthConnectionResponse FromGrant(OAuthGrant grant)
    {
        ArgumentNullException.ThrowIfNull(grant);

        return new OAuthConnectionResponse(
            grant.Id,
            grant.Client.Name,
            OAuthClientRegistry.ClientHost(grant.Client),
            !grant.Client.IsMetadataDocument,
            grant.Scope.Split(' ', StringSplitOptions.RemoveEmptyEntries),
            grant.CreatedAt,
            grant.LastUsedAt);
    }
}
