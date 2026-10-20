using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.OAuth;

/// <summary>
/// A sign-in from an app: the app sends the user to /oauth/authorize, which keeps the request and sends them on to the
/// frontend's consent page with only its ID. There the user signs in as usual and approves it, which ties it to them
/// and gives the app a code, or denies it.
/// </summary>
public class OAuthAuthorizationService(
    FlashCardDbContext dbContext,
    OAuthClientRegistry clients,
    OAuthServerOptions options,
    CurrentUser currentUser,
    TimeProvider timeProvider,
    ILogger<OAuthAuthorizationService> logger)
{
    // Where the browser goes next. An unknown app or redirect URI goes to the frontend, which shows the error, since the
    // redirect URI can't be trusted; anything else that's wrong goes back to the app, and a good request to the consent
    // page.
    public async Task<string> BeginAsync(OAuthAuthorizeRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var client = await clients.ResolveAsync(request.ClientId, cancellationToken);
        if (client is null)
        {
            return FrontendError(OAuthErrors.InvalidClient);
        }

        var redirectUri = request.RedirectUri ?? (client.RedirectUris.Count == 1 ? client.RedirectUris[0] : null);
        if (redirectUri is null
            || redirectUri.Length > OAuthClient.MaxRedirectUriLength
            || !client.RedirectUris.Any(registered => RedirectUris.Matches(registered, redirectUri)))
        {
            return FrontendError(OAuthErrors.InvalidRedirectUri);
        }

        if (request.ResponseType != "code")
        {
            return ClientError(redirectUri, request.State, OAuthErrors.UnsupportedResponseType, "response_type must be code.");
        }

        if (request.State?.Length > OAuthAuthorizationRequest.MaxStateLength)
        {
            return ClientError(redirectUri, null, OAuthErrors.InvalidRequest, "state is too long.");
        }

        if (request.CodeChallengeMethod != Pkce.S256 || !Pkce.IsValidChallenge(request.CodeChallenge))
        {
            return ClientError(
                redirectUri, request.State, OAuthErrors.InvalidRequest, "PKCE with code_challenge_method S256 is required.");
        }

        var scope = OAuthServerOptions.NormalizeScope(request.Scope);
        if (scope is null)
        {
            return ClientError(
                redirectUri, request.State, OAuthErrors.InvalidScope, $"The only scope is {OAuthServerOptions.Scope}.");
        }

        if (request.Resource is not null && !options.IsMcpResource(request.Resource))
        {
            return ClientError(
                redirectUri, request.State, OAuthErrors.InvalidTarget, $"The only resource is {options.McpResource}.");
        }

        var now = timeProvider.GetUtcNow();
        var pending = new OAuthAuthorizationRequest
        {
            Id = Guid.NewGuid(),
            OAuthClientId = client.Id,
            RedirectUri = redirectUri,
            Scope = scope,
            State = request.State,
            CodeChallenge = request.CodeChallenge!,
            Resource = request.Resource,
            CreatedAt = now,
            ExpiresAt = now + OAuthServerOptions.PendingRequestLifetime
        };
        dbContext.OAuthAuthorizationRequests.Add(pending);
        await dbContext.SaveChangesAsync(cancellationToken);

        return QueryHelpers.AddQueryString($"{options.Frontend}/authorize", "request", pending.Id.ToString());
    }

    // The request, with its app, while it's waiting for the user.
    public Task<OAuthAuthorizationRequest?> GetPendingAsync(Guid id, CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();

        return dbContext.OAuthAuthorizationRequests
            .Include(item => item.Client)
            .FirstOrDefaultAsync(
                item => item.Id == id && item.ApprovedAt == null && item.ExpiresAt > now, cancellationToken);
    }

    // Connects the app to the signed-in user and returns where to send them back to it with a code, or null when the
    // request isn't waiting.
    public async Task<string?> ApproveAsync(Guid id, CancellationToken cancellationToken)
    {
        var request = await GetPendingAsync(id, cancellationToken);
        if (request is null)
        {
            return null;
        }

        var userId = currentUser.UserId
            ?? throw new InvalidOperationException("Only a signed-in user can approve a sign-in.");
        var now = timeProvider.GetUtcNow();

        // Filtered to the user, who has one grant for each app.
        var grant = await dbContext.OAuthGrants
            .FirstOrDefaultAsync(item => item.OAuthClientId == request.OAuthClientId, cancellationToken);
        if (grant is null)
        {
            grant = new OAuthGrant { OAuthClientId = request.OAuthClientId, CreatedAt = now };
            dbContext.OAuthGrants.Add(grant);
        }

        grant.Scope = request.Scope;

        var code = OAuthTokens.NewCode();
        request.UserId = userId;
        request.CodeHash = OAuthTokens.Hash(code);
        request.ApprovedAt = now;
        request.ExpiresAt = now + OAuthServerOptions.CodeLifetime;
        await dbContext.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "User {UserId} approved OAuth client {OAuthClientId}", userId, request.OAuthClientId);

        return AddQuery(request.RedirectUri, ("code", code), ("state", request.State));
    }

    // Forgets the request and returns where to send the user back to the app with access_denied, or null when the
    // request isn't waiting.
    public async Task<string?> DenyAsync(Guid id, CancellationToken cancellationToken)
    {
        var request = await GetPendingAsync(id, cancellationToken);
        if (request is null)
        {
            return null;
        }

        dbContext.OAuthAuthorizationRequests.Remove(request);
        await dbContext.SaveChangesAsync(cancellationToken);

        return ClientError(request.RedirectUri, request.State, OAuthErrors.AccessDenied, "The user denied access.");
    }

    private string FrontendError(string error)
    {
        return QueryHelpers.AddQueryString($"{options.Frontend}/authorize", "error", error);
    }

    private static string ClientError(string redirectUri, string? state, string error, string description)
    {
        return AddQuery(redirectUri, ("error", error), ("error_description", description), ("state", state));
    }

    // The URI with these parameters added to its query, leaving out the ones with no value.
    private static string AddQuery(string uri, params (string Name, string? Value)[] parameters)
    {
        return QueryHelpers.AddQueryString(
            uri,
            parameters
                .Where(parameter => parameter.Value is not null)
                .Select(parameter => KeyValuePair.Create(parameter.Name, parameter.Value)));
    }
}
