using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FlashCardSage.Api.Contracts;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace FlashCardSage.Api.Tests;

public class PreferencesControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Get_ReturnsEverythingOn_ForANewUser()
    {
        using var client = CreateClient(CreateFactory());

        var preferences = await client.GetFromJsonAsync<PreferencesResponse>("/api/preferences");

        Assert.Equal(new PreferencesResponse(true, true, true), preferences);
    }

    [Fact]
    public async Task Put_SavesTheUsersPreferences_AndLeavesOtherUsersAlone()
    {
        var webFactory = CreateFactory();
        using var alice = CreateClient(webFactory);
        using var bob = CreateClient(webFactory);
        await bob.GetAsync("/api/preferences");

        var response = await alice.PutAsJsonAsync(
            "/api/preferences",
            new { showPictures = false, showSuggestions = true, autoTranslate = false });

        response.EnsureSuccessStatusCode();
        var expected = new PreferencesResponse(false, true, false);
        Assert.Equal(expected, await response.Content.ReadFromJsonAsync<PreferencesResponse>());
        Assert.Equal(expected, await alice.GetFromJsonAsync<PreferencesResponse>("/api/preferences"));
        Assert.Equal(
            new PreferencesResponse(true, true, true),
            await bob.GetFromJsonAsync<PreferencesResponse>("/api/preferences"));
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("""{"showPictures":false,"showSuggestions":true}""")]
    [InlineData("""{"showPictures":"no","showSuggestions":true,"autoTranslate":true}""")]
    public async Task Put_ReturnsBadRequest_ForAMissingOrInvalidPreference(string body)
    {
        using var client = CreateClient(CreateFactory());
        using var content = new StringContent(body, MediaTypeHeaderValue.Parse("application/json"));

        var response = await client.PutAsync("/api/preferences", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(
            new PreferencesResponse(true, true, true),
            await client.GetFromJsonAsync<PreferencesResponse>("/api/preferences"));
    }

    private WebApplicationFactory<Program> CreateFactory()
    {
        // Development uses the in-memory database and allows test sign-in, so the app starts without SQL Server.
        return factory.WithWebHostBuilder(builder => builder
            .UseEnvironment("Development")
            .UseSetting("Authentication:AllowTestSignIn", "true"));
    }

    private static HttpClient CreateClient(WebApplicationFactory<Program> webFactory)
    {
        var client = webFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", $"test:Preferences {Guid.NewGuid()}");
        return client;
    }
}
