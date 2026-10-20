using System.Net;
using System.Net.Http.Json;
using System.Text;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.OAuth;
using FlashCardSage.Api.Tests.Mcp;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace FlashCardSage.Api.Tests;

public class OAuthFlowTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task FullFlow_IssuesTokens_RotatesThem_AndStopsOnceDisconnected()
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        using var user = OAuthFlow.CreateClient(app, $"test:Alice {Guid.NewGuid()}");

        var connected = await OAuthFlow.ConnectAsync(anonymous, user);

        Assert.StartsWith(OAuthTokens.AccessTokenPrefix, connected.Tokens.AccessToken, StringComparison.Ordinal);
        Assert.StartsWith(OAuthTokens.RefreshTokenPrefix, connected.Tokens.RefreshToken, StringComparison.Ordinal);
        Assert.Equal("Bearer", connected.Tokens.TokenType);
        Assert.Equal(3600, connected.Tokens.ExpiresIn);
        Assert.Equal("flashcards", connected.Tokens.Scope);

        var refreshed = await OAuthFlow.ReadTokensAsync(
            await OAuthFlow.RefreshAsync(anonymous, connected.Tokens.RefreshToken, connected.ClientId));
        Assert.NotEqual(connected.Tokens.AccessToken, refreshed.AccessToken);
        Assert.NotEqual(connected.Tokens.RefreshToken, refreshed.RefreshToken);
        Assert.Equal(
            OAuthErrors.InvalidGrant,
            await OAuthFlow.ReadErrorAsync(
                await OAuthFlow.RefreshAsync(anonymous, connected.Tokens.RefreshToken, connected.ClientId)));

        var connection = Assert.Single(
            (await user.GetFromJsonAsync<List<OAuthConnectionResponse>>("/api/oauth/connections"))!);
        Assert.Equal("Test app", connection.ClientName);
        Assert.Null(connection.ClientHost);
        Assert.True(connection.ClientNameIsSelfAsserted);
        Assert.Equal(["flashcards"], connection.Scopes);
        Assert.NotNull(connection.LastUsedAt);

        Assert.Equal(
            HttpStatusCode.NoContent, (await user.DeleteAsync($"/api/oauth/connections/{connection.Id}")).StatusCode);

        Assert.Equal(
            OAuthErrors.InvalidGrant,
            await OAuthFlow.ReadErrorAsync(
                await OAuthFlow.RefreshAsync(anonymous, refreshed.RefreshToken, connected.ClientId)));
        Assert.Empty((await user.GetFromJsonAsync<List<OAuthConnectionResponse>>("/api/oauth/connections"))!);
        using var scope = app.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<FlashCardDbContext>();
        Assert.False(await dbContext.OAuthTokens.AnyAsync(token => token.GrantId == connection.Id));
    }

    [Fact]
    public async Task AccessToken_IsRejected_EverywhereButMcp()
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        using var user = OAuthFlow.CreateClient(app, $"test:Alice {Guid.NewGuid()}");
        var connected = await OAuthFlow.ConnectAsync(anonymous, user);
        using var mcpClient = OAuthFlow.CreateClient(app, connected.Tokens.AccessToken);

        Assert.Equal(HttpStatusCode.Unauthorized, (await mcpClient.GetAsync("/api/flashcards")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await mcpClient.GetAsync("/api/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await mcpClient.GetAsync("/api/oauth/connections")).StatusCode);
    }

    [Fact]
    public async Task AccessToken_SignsInAsTheUserWhoConnected_OnMcp_UntilDisconnected()
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        using var user = OAuthFlow.CreateClient(app, $"test:Alice {Guid.NewGuid()}");
        var created = await user.PostAsJsonAsync("/api/flashcards", TestDb.CardBody("el gato", "the cat"));
        var cardId = (await created.Content.ReadFromJsonAsync<IdResponse>())!.Id;
        var connected = await OAuthFlow.ConnectAsync(anonymous, user);
        using var mcpHttp = OAuthFlow.CreateClient(app, connected.Tokens.AccessToken);

        await using (var mcpClient = await McpTestClient.ConnectAsync(mcpHttp))
        {
            var page = await McpTestClient.CallJsonAsync(mcpClient, "list_cards");

            Assert.Equal(1, page.GetProperty("total").GetInt32());
            Assert.Equal(cardId, page.GetProperty("cards")[0].GetProperty("id").GetInt32());
        }

        var connection = Assert.Single(
            (await user.GetFromJsonAsync<List<OAuthConnectionResponse>>("/api/oauth/connections"))!);
        await user.DeleteAsync($"/api/oauth/connections/{connection.Id}");
        using var afterDisconnect = await mcpHttp.PostAsync("/mcp", InitializeRequest());
        Assert.Equal(HttpStatusCode.Unauthorized, afterDisconnect.StatusCode);
    }

    [Fact]
    public async Task AccessToken_IsRejected_WhenItIsntOneTheServerIssued()
    {
        using var app = TestApp.CreateFactory(factory);
        using var mcpHttp = OAuthFlow.CreateClient(app, $"{OAuthTokens.AccessTokenPrefix}not-a-real-token");

        using var response = await mcpHttp.PostAsync("/mcp", InitializeRequest());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Contains("resource_metadata=", response.Headers.WwwAuthenticate.ToString(), StringComparison.Ordinal);
    }

    private static StringContent InitializeRequest()
    {
        return new StringContent(
            """{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}""",
            Encoding.UTF8,
            "application/json");
    }
}
