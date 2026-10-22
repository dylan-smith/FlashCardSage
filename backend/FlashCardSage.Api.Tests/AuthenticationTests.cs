using System.Net;
using System.Net.Http.Json;
using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace FlashCardSage.Api.Tests;

public class AuthenticationTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private const string ServiceToken = "service-token-for-tests";

    [Fact]
    public async Task Health_AllowsAnonymousRequests()
    {
        using var client = TestApp.CreateSignedOutClient(factory, Settings());

        var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Api_ReturnsUnauthorized_WithoutToken()
    {
        using var client = TestApp.CreateSignedOutClient(factory, Settings());

        var response = await client.GetAsync("/api/flashcards");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Api_ReturnsUnauthorized_ForUnknownToken()
    {
        using var app = TestApp.CreateFactory(factory, Settings());
        using var client = TestApp.CreateClient(app, "not-a-real-token");

        var response = await client.GetAsync("/api/flashcards");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Api_ReturnsUnauthorized_ForAnMcpAccessToken()
    {
        using var app = TestApp.CreateFactory(factory, Settings());
        using var client = TestApp.CreateClient(app, "fcs_at_garbage");

        var response = await client.GetAsync("/api/flashcards");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task TestSignIn_CreatesTheUserOnce_AndReturnsThem()
    {
        var name = $"Alice {Guid.NewGuid()}";
        using var app = TestApp.CreateFactory(factory, Settings());
        using var client = TestApp.CreateClient(app, $"test:{name}");

        var first = await client.GetFromJsonAsync<MeResponse>("/api/me");
        var second = await client.GetFromJsonAsync<MeResponse>("/api/me");

        Assert.Equal(name, first!.DisplayName);
        Assert.Equal(name, second!.DisplayName);
        using var scope = app.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<FlashCardDbContext>();
        var subject = $"test:{name.ToLowerInvariant()}";
        Assert.Equal(1, await dbContext.Users.CountAsync(user => user.Subject == subject));
    }

    [Fact]
    public async Task Requests_RecordWhenTheUserWasLastSeen_ToWithinTheLastSeenPrecision()
    {
        var name = $"Alice {Guid.NewGuid()}";
        var clock = new FixedTimeProvider();
        var signedUpAt = clock.Now;
        using var app = TestApp.CreateFactory(
            factory, Settings(), services => services.AddSingleton<TimeProvider>(clock));
        using var client = TestApp.CreateClient(app, $"test:{name}");

        await client.GetAsync("/api/me");
        Assert.Equal(signedUpAt, await LastSeenAtAsync(app, name));

        clock.Advance(UserAccounts.LastSeenPrecision - TimeSpan.FromMinutes(1));
        await client.GetAsync("/api/me");
        Assert.Equal(signedUpAt, await LastSeenAtAsync(app, name));

        clock.Advance(TimeSpan.FromMinutes(1));
        await client.GetAsync("/api/me");
        Assert.Equal(clock.Now, await LastSeenAtAsync(app, name));
    }

    [Fact]
    public async Task TestSignIn_IsRejected_WhenNotEnabled()
    {
        using var client = TestApp.CreateSignedInClient(factory, "Alice", Settings(allowTestSignIn: false));

        var response = await client.GetAsync("/api/flashcards");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ServiceToken_SignsInAsTheServiceUser()
    {
        using var app = TestApp.CreateFactory(factory, Settings(serviceToken: ServiceToken));
        using var client = TestApp.CreateClient(app, ServiceToken);

        var response = await client.GetFromJsonAsync<MeResponse>("/api/me");

        Assert.Equal("FlashCardSage Service", response!.DisplayName);
    }

    [Fact]
    public async Task ServiceToken_IsRejected_WhenNotConfigured()
    {
        using var app = TestApp.CreateFactory(factory, Settings());
        using var client = TestApp.CreateClient(app, ServiceToken);

        var response = await client.GetAsync("/api/flashcards");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Users_OnlySeeTheirOwnFlashCards()
    {
        using var app = TestApp.CreateFactory(factory, Settings());
        using var alice = TestApp.CreateClient(app, $"test:Alice {Guid.NewGuid()}");
        using var bob = TestApp.CreateClient(app, $"test:Bob {Guid.NewGuid()}");
        var created = await alice.PostAsJsonAsync("/api/flashcards", TestDb.CardBody("buenos días", "good morning"));
        var card = await created.Content.ReadFromJsonAsync<IdResponse>();

        Assert.Equal(HttpStatusCode.Created, (await bob.PostAsJsonAsync("/api/flashcards", TestDb.CardBody("buenos días", "good morning"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/api/flashcards/{card!.Id}")).StatusCode);
        var bobsCards = await bob.GetFromJsonAsync<List<IdResponse>>("/api/flashcards");
        Assert.DoesNotContain(bobsCards!, item => item.Id == card.Id);
        Assert.Equal(HttpStatusCode.OK, (await alice.GetAsync($"/api/flashcards/{card.Id}")).StatusCode);
    }

    // When the test sign-in user with this name was last seen, read through a context of its own.
    private static async Task<DateTimeOffset?> LastSeenAtAsync(WebApplicationFactory<Program> app, string name)
    {
        using var scope = app.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<FlashCardDbContext>();
        var subject = $"test:{name.ToLowerInvariant()}";
        return await dbContext.Users
            .Where(user => user.Subject == subject)
            .Select(user => user.LastSeenAt)
            .SingleAsync();
    }

    // The sign-in settings, with test sign-in on and no service token unless the test says otherwise.
    private static Dictionary<string, string> Settings(bool allowTestSignIn = true, string serviceToken = "")
    {
        return new()
        {
            ["Authentication:AllowTestSignIn"] = allowTestSignIn.ToString(),
            ["Authentication:ServiceToken"] = serviceToken
        };
    }

    private sealed record MeResponse(string? DisplayName, string? Email);
}
