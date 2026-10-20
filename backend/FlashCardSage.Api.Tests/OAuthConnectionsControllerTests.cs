using System.Net;
using System.Net.Http.Json;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.OAuth;
using Microsoft.AspNetCore.Mvc.Testing;

namespace FlashCardSage.Api.Tests;

public class OAuthConnectionsControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task GetAll_ListsTheUsersConnectedApps_NewestFirst()
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        using var alice = OAuthFlow.CreateClient(app, $"test:Alice {Guid.NewGuid()}");
        using var bob = OAuthFlow.CreateClient(app, $"test:Bob {Guid.NewGuid()}");
        var first = await OAuthFlow.ConnectAsync(anonymous, alice);
        var second = await OAuthFlow.ConnectAsync(anonymous, alice);
        await OAuthFlow.ConnectAsync(anonymous, bob);

        var connections = await alice.GetFromJsonAsync<List<OAuthConnectionResponse>>("/api/oauth/connections");

        Assert.Equal(2, connections!.Count);
        Assert.True(connections[0].Id > connections[1].Id);
        Assert.NotEqual(first.ClientId, second.ClientId);
    }

    [Fact]
    public async Task Approving_TheSameAppAgain_KeepsOneConnection()
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        using var user = OAuthFlow.CreateClient(app, $"test:Alice {Guid.NewGuid()}");
        var connected = await OAuthFlow.ConnectAsync(anonymous, user);

        var requestId = await OAuthFlow.BeginAsync(
            anonymous, connected.ClientId, connected.RedirectUri, OAuthFlow.PkcePair().Challenge);
        await OAuthFlow.ApproveAsync(user, requestId);

        Assert.Single((await user.GetFromJsonAsync<List<OAuthConnectionResponse>>("/api/oauth/connections"))!);
        await OAuthFlow.ReadTokensAsync(
            await OAuthFlow.RefreshAsync(anonymous, connected.Tokens.RefreshToken, connected.ClientId));
    }

    [Fact]
    public async Task Delete_IsNotFound_ForAnotherUsersConnection()
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        using var alice = OAuthFlow.CreateClient(app, $"test:Alice {Guid.NewGuid()}");
        using var bob = OAuthFlow.CreateClient(app, $"test:Bob {Guid.NewGuid()}");
        var connected = await OAuthFlow.ConnectAsync(anonymous, alice);
        var connection = Assert.Single(
            (await alice.GetFromJsonAsync<List<OAuthConnectionResponse>>("/api/oauth/connections"))!);

        var response = await bob.DeleteAsync($"/api/oauth/connections/{connection.Id}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        await OAuthFlow.ReadTokensAsync(
            await OAuthFlow.RefreshAsync(anonymous, connected.Tokens.RefreshToken, connected.ClientId));
    }

    [Fact]
    public async Task Delete_ThrowsAwayACodeTheAppHasntRedeemedYet()
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        using var user = OAuthFlow.CreateClient(app, $"test:Alice {Guid.NewGuid()}");
        var clientId = await OAuthFlow.RegisterAsync(anonymous);
        var (verifier, challenge) = OAuthFlow.PkcePair();
        var redirect = await OAuthFlow.ApproveAsync(
            user, await OAuthFlow.BeginAsync(anonymous, clientId, OAuthFlow.LoopbackRedirectUri, challenge));
        var connection = Assert.Single(
            (await user.GetFromJsonAsync<List<OAuthConnectionResponse>>("/api/oauth/connections"))!);

        await user.DeleteAsync($"/api/oauth/connections/{connection.Id}");

        var response = await OAuthFlow.ExchangeAsync(
            anonymous, OAuthFlow.Query(redirect)["code"], clientId, OAuthFlow.LoopbackRedirectUri, verifier);
        Assert.Equal(OAuthErrors.InvalidGrant, await OAuthFlow.ReadErrorAsync(response));
    }

    [Fact]
    public async Task Connections_NeedASignedInUser()
    {
        using var client = TestApp.CreateSignedOutClient(factory);

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/oauth/connections")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.DeleteAsync("/api/oauth/connections/1")).StatusCode);
    }
}
