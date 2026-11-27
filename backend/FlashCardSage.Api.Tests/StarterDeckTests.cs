using System.Net.Http.Json;
using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Services;
using Microsoft.AspNetCore.Mvc.Testing;

namespace FlashCardSage.Api.Tests;

// A new user's first request gives them the built-in Animals deck when NewUsers:AddStarterDeck is on.
public class StarterDeckTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private const string ServiceToken = "service-token-for-tests";

    private static readonly Dictionary<string, string> StarterDeckOn = new()
    {
        ["NewUsers:AddStarterDeck"] = "true",
        ["Authentication:ServiceToken"] = ServiceToken
    };

    [Fact]
    public async Task ANewUser_StartsWithTheAnimalsDeck()
    {
        using var client = TestApp.CreateSignedInClient(factory, settings: StarterDeckOn);

        var decks = (await client.GetFromJsonAsync<List<DeckResponse>>("/api/decks"))!;

        var deck = Assert.Single(decks);
        Assert.Equal(StarterDeck.DeckName, deck.Name);
        var cards = (await client.GetFromJsonAsync<List<IdResponse>>("/api/flashcards"))!;
        Assert.Equal(27, cards.Count);
        Assert.Equal(cards.Select(card => card.Id).Order(), deck.FlashCardIds.Order());
    }

    [Fact]
    public async Task TheDeckIsOnlyAdded_WhenTheAccountIsMade()
    {
        using var client = TestApp.CreateSignedInClient(factory, settings: StarterDeckOn);
        var deck = Assert.Single((await client.GetFromJsonAsync<List<DeckResponse>>("/api/decks"))!);

        // Once they've deleted it, it stays deleted.
        (await client.DeleteAsync($"/api/decks/{deck.Id}")).EnsureSuccessStatusCode();
        foreach (var id in deck.FlashCardIds)
        {
            (await client.DeleteAsync($"/api/flashcards/{id}")).EnsureSuccessStatusCode();
        }

        Assert.Empty((await client.GetFromJsonAsync<List<DeckResponse>>("/api/decks"))!);
        Assert.Empty((await client.GetFromJsonAsync<List<IdResponse>>("/api/flashcards"))!);
    }

    [Fact]
    public async Task TheServiceSignIn_DoesntGetTheDeck()
    {
        using var app = TestApp.CreateFactory(factory, StarterDeckOn);
        using var client = TestApp.CreateClient(app, ServiceToken);

        Assert.Empty((await client.GetFromJsonAsync<List<DeckResponse>>("/api/decks"))!);
    }

    [Fact]
    public async Task ANewUser_StartsWithNothing_InDevelopment()
    {
        using var client = TestApp.CreateSignedInClient(factory);

        Assert.Empty((await client.GetFromJsonAsync<List<DeckResponse>>("/api/decks"))!);
        Assert.Empty((await client.GetFromJsonAsync<List<IdResponse>>("/api/flashcards"))!);
    }

    [Fact]
    public async Task GetOrCreateUserIdAsync_SetsUpOnlyANewUser()
    {
        var databaseName = TestDb.NewDatabaseName();
        await using var dbContext = TestDb.Create(databaseName);
        var setUp = new List<int>();
        Task SetUp(int userId, CancellationToken cancellationToken)
        {
            setUp.Add(userId);
            return Task.CompletedTask;
        }

        var id = await UserAccounts.GetOrCreateUserIdAsync(
            dbContext, "test:new", "New", null, DateTimeOffset.UtcNow, CancellationToken.None, SetUp);
        var again = await UserAccounts.GetOrCreateUserIdAsync(
            dbContext, "test:new", "New", null, DateTimeOffset.UtcNow, CancellationToken.None, SetUp);

        Assert.Equal(id, again);
        Assert.Equal([id], setUp);
    }
}
