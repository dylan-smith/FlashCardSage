using FlashCardSage.Api.Models;
using FlashCardSage.Api.OAuth;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Tests;

public class OAuthCleanupTests
{
    [Fact]
    public async Task Cleanup_DeletesExpiredTokensAndRequests_AndKeepsLiveOnes()
    {
        await using var server = new OAuthTestServer();
        var (clientId, _) = await server.ConnectAsync();
        var pendingId = await server.BeginAsync(clientId, OAuthFlow.PkcePair().Challenge);

        // The access token and the pending request have expired, the refresh token hasn't.
        server.Time.Advance(OAuthServerOptions.PendingRequestLifetime + OAuthServerOptions.AccessTokenLifetime);
        await server.Tokens.CleanupAsync(CancellationToken.None);

        var token = Assert.Single(await server.Db.OAuthTokens.ToListAsync());
        Assert.Equal(OAuthTokenKind.Refresh, token.Kind);
        // The pending request, and the one whose code was redeemed.
        Assert.Empty(await server.Db.OAuthAuthorizationRequests.ToListAsync());
        Assert.Null(await server.Authorizations.GetPendingAsync(pendingId, CancellationToken.None));
        Assert.Single(await server.Db.OAuthClients.ToListAsync());
    }

    [Fact]
    public async Task Cleanup_ForgetsAppsNobodyConnected_AfterAMonth()
    {
        await using var server = new OAuthTestServer();
        await server.ConnectAsync();
        var unusedClientId = await server.RegisterAsync();

        server.Time.Advance(OAuthTokenService.UnusedClientLifetime - TimeSpan.FromMinutes(1));
        await server.Tokens.CleanupAsync(CancellationToken.None);
        Assert.Equal(2, await server.Db.OAuthClients.CountAsync());

        server.Time.Advance(TimeSpan.FromMinutes(2));
        await server.Tokens.CleanupAsync(CancellationToken.None);

        var kept = Assert.Single(await server.Db.OAuthClients.ToListAsync());
        Assert.NotEqual(unusedClientId, kept.ClientId);
        Assert.Single(await server.Db.OAuthGrants.ToListAsync());
    }
}
