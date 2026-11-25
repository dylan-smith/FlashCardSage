using System.Net;
using System.Net.Http.Json;
using FlashCardSage.Api.Contracts;
using Microsoft.AspNetCore.Mvc.Testing;

namespace FlashCardSage.Api.Tests;

public class MeControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Delete_DeletesTheUsersAccount_AndLeavesOtherUsersAlone()
    {
        using var app = TestApp.CreateFactory(factory);
        using var alice = TestApp.CreateClient(app, $"test:Alice {Guid.NewGuid()}");
        using var bob = TestApp.CreateClient(app, $"test:Bob {Guid.NewGuid()}");
        (await alice.PostAsJsonAsync("/api/flashcards", TestDb.CardBody("el gato", "the cat"))).EnsureSuccessStatusCode();
        (await alice.PutAsJsonAsync(
            "/api/preferences",
            new { showPictures = false, showSuggestions = false, autoTranslate = false })).EnsureSuccessStatusCode();
        (await bob.PostAsJsonAsync("/api/flashcards", TestDb.CardBody("el perro", "the dog"))).EnsureSuccessStatusCode();

        var response = await alice.DeleteAsync("/api/me");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Single((await bob.GetFromJsonAsync<List<IdResponse>>("/api/flashcards"))!);
        // The same sign-in starts again with a new, empty account.
        Assert.Empty((await alice.GetFromJsonAsync<List<IdResponse>>("/api/flashcards"))!);
        Assert.Equal(
            new PreferencesResponse(true, true, true),
            await alice.GetFromJsonAsync<PreferencesResponse>("/api/preferences"));
    }

    [Fact]
    public async Task Delete_IsUnauthorized_WhenNobodyIsSignedIn()
    {
        using var client = TestApp.CreateSignedOutClient(factory);

        var response = await client.DeleteAsync("/api/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
