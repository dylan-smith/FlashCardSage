using System.Net;
using System.Net.Http.Headers;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class CardSuggestionsControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Suggest_SendsTheUsersCards_AndReturnsTheSuggestions()
    {
        var databaseName = Guid.NewGuid().ToString();
        await SeedAsync(databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"));
        await SeedAsync(databaseName, TestDb.OtherUserId, ("la casa", "the house"));
        var suggester = new FakeSuggester { Result = [new("  el pájaro ", " the bird"), new("el pez", "the fish")] };

        var result = await CreateController(databaseName, suggester).Suggest(CancellationToken.None);

        var suggestions = Assert.IsType<List<CardSuggestion>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal([new("el pájaro", "the bird"), new("el pez", "the fish")], suggestions);
        Assert.Equal(["el gato", "el perro"], suggester.Cards!.Select(card => card.Spanish.Single()));
        Assert.Equal(CardSuggestionsController.SuggestionCount + 3, suggester.Count);
    }

    [Fact]
    public async Task Suggest_LeavesOutCardsTheUserHas_RepeatsAndBlanks()
    {
        var databaseName = Guid.NewGuid().ToString();
        await SeedAsync(databaseName, TestDb.UserId, ("el gato", "the cat"));
        var suggester = new FakeSuggester
        {
            Result =
            [
                new("El Gato", "the kitty"),
                new("el felino", "The Cat"),
                new("el pez", "the fish"),
                new("el pez", "the fishes"),
                new("los peces", "the fish"),
                new(" ", "nothing"),
                new("demasiado", new string('x', 201)),
                new("el ratón", "the mouse")
            ]
        };

        var result = await CreateController(databaseName, suggester).Suggest(CancellationToken.None);

        var suggestions = Assert.IsType<List<CardSuggestion>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal([new("el pez", "the fish"), new("el ratón", "the mouse")], suggestions);
    }

    [Fact]
    public async Task Suggest_LeavesOutCardsWithAnyOfACardsTranslations()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using (var dbContext = TestDb.Create(databaseName))
        {
            dbContext.FlashCards.Add(new FlashCard { Words = TestDb.Words(["solo", "únicamente"], ["only", "just"]) });
            await dbContext.SaveChangesAsync();
        }

        var suggester = new FakeSuggester
        {
            Result = [new("Únicamente", "solely"), new("justo", "Just"), new("el pez", "the fish")]
        };

        var result = await CreateController(databaseName, suggester).Suggest(CancellationToken.None);

        var suggestions = Assert.IsType<List<CardSuggestion>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal([new("el pez", "the fish")], suggestions);
    }

    [Fact]
    public async Task Suggest_ReturnsAHandfulAtMost()
    {
        var suggester = new FakeSuggester
        {
            Result = Enumerable.Range(1, 8).Select(i => new CardSuggestion($"es {i}", $"en {i}")).ToList()
        };

        var result = await CreateController(Guid.NewGuid().ToString(), suggester).Suggest(CancellationToken.None);

        var suggestions = Assert.IsType<List<CardSuggestion>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(CardSuggestionsController.SuggestionCount, suggestions.Count);
    }

    [Fact]
    public async Task Suggest_DescribesOnlyTheNewestCards()
    {
        var databaseName = Guid.NewGuid().ToString();
        var many = Enumerable.Range(1, CardSuggestionsController.MaxCardsDescribed + 10)
            .Select(i => ($"es {i}", $"en {i}"))
            .ToArray();
        await SeedAsync(databaseName, TestDb.UserId, many);
        var suggester = new FakeSuggester();

        await CreateController(databaseName, suggester).Suggest(CancellationToken.None);

        Assert.Equal(CardSuggestionsController.MaxCardsDescribed, suggester.Cards!.Count);
        Assert.Equal("es 11", suggester.Cards[0].Spanish.Single());
    }

    [Fact]
    public async Task Suggest_ReturnsServiceUnavailable_WhenSuggestionsAreOff()
    {
        var suggester = new FakeSuggester { IsAvailable = false };

        var result = await CreateController(Guid.NewGuid().ToString(), suggester).Suggest(CancellationToken.None);

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, Assert.IsType<ObjectResult>(result.Result).StatusCode);
        Assert.Null(suggester.Cards);
    }

    [Fact]
    public async Task Suggest_ReturnsBadGateway_WhenTheSuggesterFails()
    {
        var suggester = new FakeSuggester { Failure = new HttpRequestException("boom") };

        var result = await CreateController(Guid.NewGuid().ToString(), suggester).Suggest(CancellationToken.None);

        Assert.Equal(StatusCodes.Status502BadGateway, Assert.IsType<ObjectResult>(result.Result).StatusCode);
    }

    [Fact]
    public async Task Suggest_ReturnsBadGateway_WhenTheSuggesterTimesOut()
    {
        var suggester = new FakeSuggester { Failure = new TaskCanceledException("timed out") };

        var result = await CreateController(Guid.NewGuid().ToString(), suggester).Suggest(CancellationToken.None);

        Assert.Equal(StatusCodes.Status502BadGateway, Assert.IsType<ObjectResult>(result.Result).StatusCode);
    }

    [Fact]
    public async Task Suggest_RequiresSignIn()
    {
        using var client = CreateClient(signedIn: false);

        var response = await client.GetAsync("/api/card-suggestions");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Suggest_IsUnavailable_WithoutAnApiKey()
    {
        using var client = CreateClient(signedIn: true);

        var response = await client.GetAsync("/api/card-suggestions");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    private static async Task SeedAsync(string databaseName, int userId, params (string Spanish, string English)[] cards)
    {
        await using var dbContext = TestDb.Create(databaseName, userId);
        dbContext.FlashCards.AddRange(cards.Select(card => new FlashCard { Words = TestDb.Words(card.Spanish, card.English) }));
        await dbContext.SaveChangesAsync();
    }

    private static CardSuggestionsController CreateController(string databaseName, ICardSuggester suggester)
    {
        return new CardSuggestionsController(
            TestDb.Create(databaseName), suggester, NullLogger<CardSuggestionsController>.Instance);
    }

    private HttpClient CreateClient(bool signedIn)
    {
        // Development uses the in-memory database and allows test sign-in, so the app starts without SQL Server.
        var client = factory
            .WithWebHostBuilder(builder => builder
                .UseEnvironment("Development")
                .UseSetting("Authentication:AllowTestSignIn", "true")
                .UseSetting("CardSuggestions:Key", ""))
            .CreateClient();
        if (signedIn)
        {
            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", $"test:Suggestions {Guid.NewGuid()}");
        }

        return client;
    }

    private sealed class FakeSuggester : ICardSuggester
    {
        public bool IsAvailable { get; init; } = true;

        public IReadOnlyList<CardSuggestion> Result { get; init; } = [];

        public Exception? Failure { get; init; }

        public IReadOnlyList<FlashCard>? Cards { get; private set; }

        public int? Count { get; private set; }

        public Task<IReadOnlyList<CardSuggestion>> SuggestAsync(
            IReadOnlyList<FlashCard> cards, int count, CancellationToken cancellationToken)
        {
            Cards = cards;
            Count = count;
            return Failure is null ? Task.FromResult(Result) : Task.FromException<IReadOnlyList<CardSuggestion>>(Failure);
        }
    }
}
