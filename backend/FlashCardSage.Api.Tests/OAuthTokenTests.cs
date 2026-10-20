using System.Net;
using System.Text.Json;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.OAuth;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Tests;

public class OAuthTokenTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Exchange_ReturnsTheTokens_AsJsonThatIsNeverCached()
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        using var user = OAuthFlow.CreateClient(app, $"test:Alice {Guid.NewGuid()}");
        var (clientId, code, verifier) = await ApproveAsync(anonymous, user);

        var response = await OAuthFlow.ExchangeAsync(anonymous, code, clientId, OAuthFlow.LoopbackRedirectUri, verifier);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
        Assert.Equal("application/json", response.Content.Headers.ContentType!.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(
            ["access_token", "token_type", "expires_in", "refresh_token", "scope"],
            body.RootElement.EnumerateObject().Select(property => property.Name));
        Assert.Equal("Bearer", body.RootElement.GetProperty("token_type").GetString());
        Assert.Equal(3600, body.RootElement.GetProperty("expires_in").GetInt32());
        Assert.Equal("flashcards", body.RootElement.GetProperty("scope").GetString());
    }

    [Theory]
    [InlineData("code_verifier")]
    [InlineData("redirect_uri")]
    [InlineData("client_id")]
    [InlineData("code")]
    public async Task Exchange_IsRefused_WhenSomethingDoesntMatchTheCode(string parameter)
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        using var user = OAuthFlow.CreateClient(app, $"test:Alice {Guid.NewGuid()}");
        var (clientId, code, verifier) = await ApproveAsync(anonymous, user);
        var otherClientId = await OAuthFlow.RegisterAsync(anonymous);
        var form = new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["client_id"] = clientId,
            ["redirect_uri"] = OAuthFlow.LoopbackRedirectUri,
            ["code_verifier"] = verifier
        };
        form[parameter] = parameter switch
        {
            "code_verifier" => OAuthFlow.PkcePair().Verifier,
            "redirect_uri" => "http://127.0.0.1:5000/callback",
            "client_id" => otherClientId,
            _ => OAuthTokens.NewCode()
        };

        var response = await OAuthFlow.TokenAsync(anonymous, form);

        Assert.Equal(OAuthErrors.InvalidGrant, await OAuthFlow.ReadErrorAsync(response));
        Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
        // A failed attempt doesn't use the code up.
        await OAuthFlow.ReadTokensAsync(
            await OAuthFlow.ExchangeAsync(anonymous, code, clientId, OAuthFlow.LoopbackRedirectUri, verifier));
    }

    [Fact]
    public async Task Exchange_IsRefused_ForAnotherResource()
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        using var user = OAuthFlow.CreateClient(app, $"test:Alice {Guid.NewGuid()}");
        var (clientId, code, verifier) = await ApproveAsync(anonymous, user);

        var response = await OAuthFlow.TokenAsync(anonymous, new()
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["client_id"] = clientId,
            ["code_verifier"] = verifier,
            ["resource"] = "https://elsewhere.example/mcp"
        });

        Assert.Equal(OAuthErrors.InvalidTarget, await OAuthFlow.ReadErrorAsync(response));
    }

    [Fact]
    public async Task Exchange_OfACodeUsedAlready_RevokesTheTokensItGave()
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        using var user = OAuthFlow.CreateClient(app, $"test:Alice {Guid.NewGuid()}");
        var (clientId, code, verifier) = await ApproveAsync(anonymous, user);
        var tokens = await OAuthFlow.ReadTokensAsync(
            await OAuthFlow.ExchangeAsync(anonymous, code, clientId, OAuthFlow.LoopbackRedirectUri, verifier));

        var replay = await OAuthFlow.ExchangeAsync(anonymous, code, clientId, OAuthFlow.LoopbackRedirectUri, verifier);

        Assert.Equal(OAuthErrors.InvalidGrant, await OAuthFlow.ReadErrorAsync(replay));
        Assert.Equal(
            OAuthErrors.InvalidGrant,
            await OAuthFlow.ReadErrorAsync(await OAuthFlow.RefreshAsync(anonymous, tokens.RefreshToken, clientId)));
    }

    [Theory]
    [InlineData("password")]
    [InlineData("client_credentials")]
    [InlineData("")]
    public async Task Token_IsRefused_ForOtherGrantTypes(string grantType)
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);

        var response = await OAuthFlow.TokenAsync(anonymous, new() { ["grant_type"] = grantType });

        Assert.Equal(OAuthErrors.UnsupportedGrantType, await OAuthFlow.ReadErrorAsync(response));
        Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
    }

    [Fact]
    public async Task Refresh_IsRefused_ForAnotherClient()
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        using var user = OAuthFlow.CreateClient(app, $"test:Alice {Guid.NewGuid()}");
        var connected = await OAuthFlow.ConnectAsync(anonymous, user);
        var otherClientId = await OAuthFlow.RegisterAsync(anonymous);

        var response = await OAuthFlow.RefreshAsync(anonymous, connected.Tokens.RefreshToken, otherClientId);

        Assert.Equal(OAuthErrors.InvalidGrant, await OAuthFlow.ReadErrorAsync(response));
        await OAuthFlow.ReadTokensAsync(
            await OAuthFlow.RefreshAsync(anonymous, connected.Tokens.RefreshToken, connected.ClientId));
    }

    [Fact]
    public async Task Refresh_IsRefused_ForAnAccessToken()
    {
        await using var server = new OAuthTestServer();
        var (clientId, tokens) = await server.ConnectAsync();

        var result = await server.RefreshAsync(tokens.AccessToken, clientId);

        Assert.Equal(OAuthErrors.InvalidGrant, result.Error!.Code);
    }

    [Fact]
    public async Task Exchange_IsRefused_OnceTheCodeHasExpired()
    {
        await using var server = new OAuthTestServer();
        var (clientId, code, verifier) = await server.ApproveAsync();

        server.Time.Advance(OAuthServerOptions.CodeLifetime);
        var result = await server.ExchangeAsync(code, clientId, verifier);

        Assert.Equal(OAuthErrors.InvalidGrant, result.Error!.Code);
    }

    [Fact]
    public async Task Refresh_UsedAgainWithinTheGrace_GivesANewPair_AndKeepsTheFirst()
    {
        await using var server = new OAuthTestServer();
        var (clientId, tokens) = await server.ConnectAsync();
        var refreshed = (await server.RefreshAsync(tokens.RefreshToken, clientId)).Tokens!;

        server.Time.Advance(OAuthServerOptions.RefreshReuseGrace);
        var retried = (await server.RefreshAsync(tokens.RefreshToken, clientId)).Tokens!;

        Assert.NotEqual(refreshed.AccessToken, retried.AccessToken);
        Assert.NotEqual(refreshed.RefreshToken, retried.RefreshToken);
        var families = await server.Db.OAuthTokens.Select(token => token.FamilyId).Distinct().ToListAsync();
        Assert.Single(families);
        Assert.Equal(server.Time.Now, (await server.Db.OAuthGrants.SingleAsync()).LastUsedAt);
        Assert.NotNull((await server.RefreshAsync(retried.RefreshToken, clientId)).Tokens);
        Assert.NotNull((await server.RefreshAsync(refreshed.RefreshToken, clientId)).Tokens);
    }

    [Fact]
    public async Task Refresh_RetriedWithinTheGrace_StillRevokesOnceTheGraceFromTheFirstUseHasPassed()
    {
        await using var server = new OAuthTestServer();
        var (clientId, tokens) = await server.ConnectAsync();
        await server.RefreshAsync(tokens.RefreshToken, clientId);
        server.Time.Advance(TimeSpan.FromSeconds(30));
        Assert.NotNull((await server.RefreshAsync(tokens.RefreshToken, clientId)).Tokens);

        server.Time.Advance(TimeSpan.FromSeconds(31));
        var reused = await server.RefreshAsync(tokens.RefreshToken, clientId);

        Assert.Equal(OAuthErrors.InvalidGrant, reused.Error!.Code);
        Assert.Empty(await server.Db.OAuthTokens.ToListAsync());
    }

    [Fact]
    public async Task Refresh_UsedAgainAfterTheGrace_RevokesEveryTokenFromTheSignIn()
    {
        await using var server = new OAuthTestServer();
        var (clientId, tokens) = await server.ConnectAsync();
        var refreshed = (await server.RefreshAsync(tokens.RefreshToken, clientId)).Tokens!;

        server.Time.Advance(OAuthServerOptions.RefreshReuseGrace + TimeSpan.FromSeconds(1));
        var reused = await server.RefreshAsync(tokens.RefreshToken, clientId);

        Assert.Equal(OAuthErrors.InvalidGrant, reused.Error!.Code);
        Assert.Equal(OAuthErrors.InvalidGrant, (await server.RefreshAsync(refreshed.RefreshToken, clientId)).Error!.Code);
        Assert.Empty(await server.Db.OAuthTokens.ToListAsync());
    }

    [Fact]
    public async Task Refresh_GivesARefreshTokenThatLastsAsLongAgain()
    {
        await using var server = new OAuthTestServer();
        var (clientId, tokens) = await server.ConnectAsync();

        server.Time.Advance(OAuthServerOptions.RefreshTokenLifetime - TimeSpan.FromDays(1));
        var refreshed = (await server.RefreshAsync(tokens.RefreshToken, clientId)).Tokens!;
        server.Time.Advance(OAuthServerOptions.RefreshTokenLifetime - TimeSpan.FromDays(1));

        Assert.NotNull((await server.RefreshAsync(refreshed.RefreshToken, clientId)).Tokens);
        var grant = await server.Db.OAuthGrants.SingleAsync();
        Assert.Equal(server.Time.Now, grant.LastUsedAt);
    }

    [Fact]
    public async Task Refresh_IsRefused_OnceTheRefreshTokenHasExpired()
    {
        await using var server = new OAuthTestServer();
        var (clientId, tokens) = await server.ConnectAsync();

        server.Time.Advance(OAuthServerOptions.RefreshTokenLifetime);
        var result = await server.RefreshAsync(tokens.RefreshToken, clientId);

        Assert.Equal(OAuthErrors.InvalidGrant, result.Error!.Code);
    }

    [Fact]
    public async Task Tokens_AreKeptOnlyAsHashes()
    {
        await using var server = new OAuthTestServer();
        var (_, tokens) = await server.ConnectAsync();

        var stored = await server.Db.OAuthTokens.ToListAsync();

        Assert.Equal(
            [OAuthTokens.Hash(tokens.AccessToken), OAuthTokens.Hash(tokens.RefreshToken)],
            stored.OrderBy(token => token.Kind).Select(token => token.TokenHash));
        Assert.Equal([OAuthTokenKind.Access, OAuthTokenKind.Refresh], stored.Select(token => token.Kind).Order());
        Assert.Single(stored.Select(token => token.FamilyId).Distinct());
    }

    // Registers an app and approves a sign-in for it as the user, returning the code and what redeems it.
    private static async Task<(string ClientId, string Code, string Verifier)> ApproveAsync(
        HttpClient anonymous, HttpClient user)
    {
        var clientId = await OAuthFlow.RegisterAsync(anonymous);
        var (verifier, challenge) = OAuthFlow.PkcePair();
        var requestId = await OAuthFlow.BeginAsync(anonymous, clientId, OAuthFlow.LoopbackRedirectUri, challenge);
        var redirect = await OAuthFlow.ApproveAsync(user, requestId);
        return (clientId, OAuthFlow.Query(redirect)["code"], verifier);
    }
}
