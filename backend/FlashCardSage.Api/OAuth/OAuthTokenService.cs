using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.OAuth;

// The tokens an app was given, or why it wasn't.
public record OAuthTokenResult(OAuthTokenResponse? Tokens, OAuthError? Error)
{
    public static OAuthTokenResult Refused(string error, string description)
    {
        return new OAuthTokenResult(null, new OAuthError(error, description));
    }
}

/// <summary>
/// The token endpoint's work: a code is redeemed once for an access token and a refresh token, and each refresh token
/// once for a new pair. A code or refresh token used again looks stolen, so every token from that sign-in (its family)
/// is revoked. Tokens are opaque and kept only as hashes; requests reach grants past the query filter, since nobody is
/// signed in.
/// </summary>
public class OAuthTokenService(
    FlashCardDbContext dbContext,
    OAuthServerOptions options,
    TimeProvider timeProvider,
    ILogger<OAuthTokenService> logger)
{
    public static readonly TimeSpan CleanupInterval = TimeSpan.FromHours(1);

    // A client that's had no grant for this long is forgotten, as apps that register themselves make one for every
    // connection.
    public static readonly TimeSpan UnusedClientLifetime = TimeSpan.FromDays(30);

    // When this process may clean up next, by Environment.TickCount64. Not by the time provider, which tests move.
    private static long nextCleanupTicks;

    public async Task<OAuthTokenResult> ExchangeCodeAsync(
        string? code,
        string? clientId,
        string? redirectUri,
        string? codeVerifier,
        string? resource,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(clientId))
        {
            return OAuthTokenResult.Refused(OAuthErrors.InvalidRequest, "code and client_id are required.");
        }

        var codeHash = OAuthTokens.Hash(code);
        var request = await dbContext.OAuthAuthorizationRequests
            .Include(item => item.Client)
            .FirstOrDefaultAsync(item => item.CodeHash == codeHash, cancellationToken);
        if (request is null)
        {
            return InvalidGrant("The code isn't valid.");
        }

        if (request.RedeemedAt is not null)
        {
            if (request.TokenFamilyId is { } familyId)
            {
                await RevokeFamilyAsync(familyId, cancellationToken);
            }

            logger.LogWarning("An OAuth code was used again, so its tokens were revoked");
            return InvalidGrant("The code has been used already.");
        }

        var now = timeProvider.GetUtcNow();
        if (request.ExpiresAt <= now)
        {
            return InvalidGrant("The code has expired.");
        }

        if (!string.Equals(request.Client.ClientId, clientId, StringComparison.Ordinal))
        {
            return InvalidGrant("The code was issued to another client.");
        }

        if (redirectUri is not null && !string.Equals(request.RedirectUri, redirectUri, StringComparison.Ordinal))
        {
            return InvalidGrant("redirect_uri isn't the one the code was sent to.");
        }

        if (!Pkce.Verify(codeVerifier, request.CodeChallenge))
        {
            return InvalidGrant("code_verifier doesn't match the code_challenge.");
        }

        if (resource is not null && !options.IsMcpResource(resource))
        {
            return OAuthTokenResult.Refused(OAuthErrors.InvalidTarget, $"The only resource is {options.McpResource}.");
        }

        // The user may have disconnected the app since approving.
        var grant = await dbContext.OAuthGrants
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(
                item => item.UserId == request.UserId && item.OAuthClientId == request.OAuthClientId, cancellationToken);
        if (grant is null)
        {
            return InvalidGrant("The app has been disconnected.");
        }

        var (family, tokens) = IssueFamily(grant, now);
        request.RedeemedAt = now;
        request.TokenFamilyId = family;
        grant.LastUsedAt = now;
        await dbContext.SaveChangesAsync(cancellationToken);

        return new OAuthTokenResult(tokens, null);
    }

    public async Task<OAuthTokenResult> RefreshAsync(
        string? refreshToken,
        string? clientId,
        string? scope,
        string? resource,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(refreshToken))
        {
            return OAuthTokenResult.Refused(OAuthErrors.InvalidRequest, "refresh_token is required.");
        }

        var tokenHash = OAuthTokens.Hash(refreshToken);
        var token = await dbContext.OAuthTokens.FirstOrDefaultAsync(
            item => item.TokenHash == tokenHash && item.Kind == OAuthTokenKind.Refresh,
            cancellationToken);
        if (token is null)
        {
            return InvalidGrant("The refresh token isn't valid.");
        }

        var grant = await dbContext.OAuthGrants
            .IgnoreQueryFilters()
            .Include(item => item.Client)
            .FirstOrDefaultAsync(item => item.Id == token.GrantId, cancellationToken);
        if (grant is null)
        {
            return InvalidGrant("The refresh token isn't valid.");
        }

        if (clientId is not null && !string.Equals(grant.Client.ClientId, clientId, StringComparison.Ordinal))
        {
            return InvalidGrant("The refresh token was issued to another client.");
        }

        var now = timeProvider.GetUtcNow();
        if (token.UsedAt is { } usedAt)
        {
            // Probably the app retrying, so the tokens it got are left alone; later, probably stolen.
            if (now - usedAt > OAuthServerOptions.RefreshReuseGrace)
            {
                await RevokeFamilyAsync(token.FamilyId, cancellationToken);
                logger.LogWarning("An OAuth refresh token was used again, so its family was revoked");
            }

            return InvalidGrant("The refresh token has been used already.");
        }

        if (token.ExpiresAt <= now)
        {
            return InvalidGrant("The refresh token has expired.");
        }

        if (scope is not null && OAuthServerOptions.NormalizeScope(scope) is null)
        {
            return OAuthTokenResult.Refused(OAuthErrors.InvalidScope, $"The only scope is {OAuthServerOptions.Scope}.");
        }

        if (resource is not null && !options.IsMcpResource(resource))
        {
            return OAuthTokenResult.Refused(OAuthErrors.InvalidTarget, $"The only resource is {options.McpResource}.");
        }

        token.UsedAt = now;
        grant.LastUsedAt = now;
        var tokens = Issue(grant, token.FamilyId, now);
        await dbContext.SaveChangesAsync(cancellationToken);

        return new OAuthTokenResult(tokens, null);
    }

    // Deletes every token from one sign-in.
    public async Task RevokeFamilyAsync(Guid familyId, CancellationToken cancellationToken)
    {
        var tokens = await dbContext.OAuthTokens
            .Where(item => item.FamilyId == familyId)
            .ToListAsync(cancellationToken);
        dbContext.OAuthTokens.RemoveRange(tokens);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    // Cleans up, at most once an hour in each process. There's no timer, so a serverless database that nobody is using
    // can still pause.
    public async Task CleanupIfDueAsync(CancellationToken cancellationToken)
    {
        var ticks = Environment.TickCount64;
        var next = Interlocked.Read(ref nextCleanupTicks);
        if (ticks < next
            || Interlocked.CompareExchange(ref nextCleanupTicks, ticks + (long)CleanupInterval.TotalMilliseconds, next) != next)
        {
            return;
        }

        await CleanupAsync(cancellationToken);
    }

    // Deletes expired tokens and requests, and apps nobody has connected for a month. One by one rather than with
    // ExecuteDelete, which the in-memory database can't do.
    public async Task CleanupAsync(CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        var unusedSince = now - UnusedClientLifetime;

        dbContext.OAuthTokens.RemoveRange(
            await dbContext.OAuthTokens.Where(item => item.ExpiresAt <= now).ToListAsync(cancellationToken));
        dbContext.OAuthAuthorizationRequests.RemoveRange(
            await dbContext.OAuthAuthorizationRequests.Where(item => item.ExpiresAt <= now).ToListAsync(cancellationToken));
        await dbContext.SaveChangesAsync(cancellationToken);

        var unusedClients = await dbContext.OAuthClients
            .Where(client => client.UpdatedAt < unusedSince
                && !dbContext.OAuthGrants.IgnoreQueryFilters().Any(grant => grant.OAuthClientId == client.Id)
                && !dbContext.OAuthAuthorizationRequests.Any(request => request.OAuthClientId == client.Id))
            .ToListAsync(cancellationToken);
        dbContext.OAuthClients.RemoveRange(unusedClients);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    // A new access and refresh token for the grant, starting a family of their own.
    public (Guid FamilyId, OAuthTokenResponse Tokens) IssueFamily(OAuthGrant grant, DateTimeOffset now)
    {
        var familyId = Guid.NewGuid();
        return (familyId, Issue(grant, familyId, now));
    }

    // A new access and refresh token in the family, added to the context for the caller to save.
    private OAuthTokenResponse Issue(OAuthGrant grant, Guid familyId, DateTimeOffset now)
    {
        var accessToken = OAuthTokens.NewAccessToken();
        var refreshToken = OAuthTokens.NewRefreshToken();

        dbContext.OAuthTokens.AddRange(
            new OAuthToken
            {
                GrantId = grant.Id,
                FamilyId = familyId,
                Kind = OAuthTokenKind.Access,
                TokenHash = OAuthTokens.Hash(accessToken),
                CreatedAt = now,
                ExpiresAt = now + OAuthServerOptions.AccessTokenLifetime
            },
            new OAuthToken
            {
                GrantId = grant.Id,
                FamilyId = familyId,
                Kind = OAuthTokenKind.Refresh,
                TokenHash = OAuthTokens.Hash(refreshToken),
                CreatedAt = now,
                ExpiresAt = now + OAuthServerOptions.RefreshTokenLifetime
            });

        return new OAuthTokenResponse(
            accessToken,
            "Bearer",
            (int)OAuthServerOptions.AccessTokenLifetime.TotalSeconds,
            refreshToken,
            grant.Scope);
    }

    private static OAuthTokenResult InvalidGrant(string description)
    {
        return OAuthTokenResult.Refused(OAuthErrors.InvalidGrant, description);
    }
}
