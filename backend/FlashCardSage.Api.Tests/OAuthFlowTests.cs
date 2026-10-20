using System.Net;
using System.Net.Http.Json;
using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.OAuth;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
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
        // PR 4 (the MCP endpoint) adds the assertions that the access token works on /mcp, and stops working once the
        // app is disconnected. Until then the probe below stands in for it.

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
        var name = $"Alice {Guid.NewGuid()}";
        using var app = TestApp.CreateFactory(
            factory, services: services => services.AddTransient<IStartupFilter, McpProbe>());
        using var anonymous = OAuthFlow.CreateClient(app);
        using var user = OAuthFlow.CreateClient(app, $"test:{name}");
        var connected = await OAuthFlow.ConnectAsync(anonymous, user);
        using var mcpClient = OAuthFlow.CreateClient(app, connected.Tokens.AccessToken);

        var signedInAs = await mcpClient.GetStringAsync("/mcp");

        Assert.Equal($"{OAuthAccessTokenHandler.SchemeName} test:{name.ToLowerInvariant()} {name}", signedInAs);
        var connection = Assert.Single(
            (await user.GetFromJsonAsync<List<OAuthConnectionResponse>>("/api/oauth/connections"))!);
        await user.DeleteAsync($"/api/oauth/connections/{connection.Id}");
        Assert.Equal(HttpStatusCode.Unauthorized, (await mcpClient.GetAsync("/mcp")).StatusCode);
    }

    [Fact]
    public async Task AccessToken_IsRejected_WhenItIsntOneTheServerIssued()
    {
        using var app = TestApp.CreateFactory(
            factory, services: services => services.AddTransient<IStartupFilter, McpProbe>());
        using var mcpClient = OAuthFlow.CreateClient(app, $"{OAuthTokens.AccessTokenPrefix}not-a-real-token");

        Assert.Equal(HttpStatusCode.Unauthorized, (await mcpClient.GetAsync("/mcp")).StatusCode);
    }

    // Until PR 4 adds the MCP endpoint, answers /mcp with who signed in, or 401, after the app's own middleware.
    private sealed class McpProbe : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
        {
            return app =>
            {
                next(app);
                app.Run(async context =>
                {
                    if (context.User.Identity?.IsAuthenticated != true)
                    {
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        return;
                    }

                    await context.Response.WriteAsync(string.Join(
                        ' ',
                        context.User.Identity.AuthenticationType,
                        context.User.FindFirst(AuthenticationSetup.SubjectClaim)?.Value,
                        context.User.FindFirst(AuthenticationSetup.NameClaim)?.Value));
                });
            };
        }
    }
}
