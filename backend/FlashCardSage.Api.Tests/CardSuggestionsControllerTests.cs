using System.Net;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class CardSuggestionsControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    // The app with no key for the service, so it's off.
    private static readonly Dictionary<string, string> Settings = new() { ["CardSuggestions:Key"] = "" };

    [Fact]
    public async Task Suggest_SendsTheUsersCards_AndReturnsTheSuggestions()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"));
        await TestDb.SeedCardsAsync(databaseName, TestDb.OtherUserId, ("la casa", "the house"));
        var suggester = new FakeCardSuggester { Result = [new("  el pájaro ", " the bird"), new("el pez", "the fish")] };
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, suggester).Suggest(null, null, null, CancellationToken.None);

        var suggestions = ActionResultAssert.Ok<List<CardSuggestion>>(result.Result);
        Assert.Equal([new("el pájaro", "the bird"), new("el pez", "the fish")], suggestions);
        Assert.Equal(["el gato", "el perro"], suggester.Cards!.Select(card => card.Spanish.Single()));
        Assert.Null(suggester.RelatedTo);
        Assert.Null(suggester.Tag);
        Assert.Equal(CardSuggestionsController.SuggestionCount + 3, suggester.Count);
        Assert.Empty(suggester.Exclude!);
    }

    [Fact]
    public async Task Suggest_LeavesOutCardsAlreadyShown_AndTellsTheSuggester()
    {
        var suggester = new FakeCardSuggester
        {
            Result = [new("El Pájaro", "the bird"), new("el pez", "the fish"), new("la vaca", "the cow")]
        };
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, suggester).Suggest(
            null, null, [" el pájaro ", "la vaca", "el pájaro", "", new string('x', FlashCard.MaxWordLength + 1)],
            CancellationToken.None);

        var suggestions = ActionResultAssert.Ok<List<CardSuggestion>>(result.Result);
        Assert.Equal([new("el pez", "the fish")], suggestions);
        Assert.Equal(["el pájaro", "la vaca"], suggester.Exclude);
    }

    [Fact]
    public async Task Suggest_TellsTheSuggesterOnlyTheNewestCardsShown()
    {
        var shown = Enumerable.Range(1, ShownSuggestions.MaxCount + 2).Select(i => $"es {i}").ToArray();
        var suggester = new FakeCardSuggester();
        await using var dbContext = TestDb.Create();

        await CreateController(dbContext, suggester).Suggest(null, null, shown, CancellationToken.None);

        Assert.Equal(shown[2..], suggester.Exclude);
    }

    [Fact]
    public async Task Suggest_RelatesTheSuggestionsToTheGivenCard()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"));
        var suggester = new FakeCardSuggester { Result = [new("el collar", "the collar")] };
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, suggester).Suggest(ids[1], null, null, CancellationToken.None);

        var suggestions = ActionResultAssert.Ok<List<CardSuggestion>>(result.Result);
        Assert.Equal([new("el collar", "the collar")], suggestions);
        Assert.Equal(["el perro"], suggester.RelatedTo!.Spanish);
        Assert.Equal(2, suggester.Cards!.Count);
    }

    [Fact]
    public async Task Suggest_ReturnsNotFound_ForAnotherUsersCard()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"));
        var others = await TestDb.SeedCardsAsync(databaseName, TestDb.OtherUserId, ("la casa", "the house"));
        var suggester = new FakeCardSuggester();
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, suggester).Suggest(others[0], null, null, CancellationToken.None);

        Assert.IsType<NotFoundResult>(result.Result);
        Assert.Null(suggester.Cards);
    }

    [Fact]
    public async Task Suggest_SuggestsCardsForTheGivenTag_DescribingAllItsCards()
    {
        var databaseName = TestDb.NewDatabaseName();
        var many = Enumerable.Range(1, CardSuggestionsController.MaxCardsDescribed + 10)
            .Select(i => ($"es {i}", $"en {i}"))
            .ToArray();
        var ids = await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, many);
        var tagId = await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "food", ids[0], ids[^1]);
        var suggester = new FakeCardSuggester { Result = [new("el pan", "the bread")] };
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, suggester).Suggest(null, tagId, null, CancellationToken.None);

        var suggestions = ActionResultAssert.Ok<List<CardSuggestion>>(result.Result);
        Assert.Equal([new("el pan", "the bread")], suggestions);
        Assert.Equal("food", suggester.Tag?.Name);
        // The tag's oldest card is kept in place of the oldest of the rest, and the cards stay in order.
        Assert.Equal(CardSuggestionsController.MaxCardsDescribed, suggester.Cards!.Count);
        Assert.Equal(["es 1", "es 12"], suggester.Cards.Take(2).Select(card => card.Spanish.Single()));
        Assert.Equal($"es {many.Length}", suggester.Cards[^1].Spanish.Single());
    }

    [Fact]
    public async Task Suggest_ReturnsNotFound_ForAnotherUsersTag()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"));
        var others = await TestDb.SeedCardsAsync(databaseName, TestDb.OtherUserId, ("la casa", "the house"));
        var otherTagId = await TestDb.SeedTagAsync(databaseName, TestDb.OtherUserId, "home", others[0]);
        var suggester = new FakeCardSuggester();
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, suggester).Suggest(null, otherTagId, null, CancellationToken.None);

        Assert.IsType<NotFoundResult>(result.Result);
        Assert.Null(suggester.Cards);
    }

    [Fact]
    public async Task Suggest_LeavesOutCardsTheUserHas_RepeatsAndBlanks()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"));
        var suggester = new FakeCardSuggester
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
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, suggester).Suggest(null, null, null, CancellationToken.None);

        var suggestions = ActionResultAssert.Ok<List<CardSuggestion>>(result.Result);
        Assert.Equal([new("el pez", "the fish"), new("el ratón", "the mouse")], suggestions);
    }

    [Fact]
    public async Task Suggest_LeavesOutCardsWithAnyOfACardsTranslations()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardAsync(databaseName, new FlashCard { Words = TestDb.Words(["solo", "únicamente"], ["only", "just"]) });

        var suggester = new FakeCardSuggester
        {
            Result = [new("Únicamente", "solely"), new("justo", "Just"), new("el pez", "the fish")]
        };
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, suggester).Suggest(null, null, null, CancellationToken.None);

        var suggestions = ActionResultAssert.Ok<List<CardSuggestion>>(result.Result);
        Assert.Equal([new("el pez", "the fish")], suggestions);
    }

    [Fact]
    public async Task Suggest_ReturnsAHandfulAtMost()
    {
        var suggester = new FakeCardSuggester
        {
            Result = Enumerable.Range(1, 8).Select(i => new CardSuggestion($"es {i}", $"en {i}")).ToList()
        };
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, suggester).Suggest(null, null, null, CancellationToken.None);

        var suggestions = ActionResultAssert.Ok<List<CardSuggestion>>(result.Result);
        Assert.Equal(CardSuggestionsController.SuggestionCount, suggestions.Count);
    }

    [Fact]
    public async Task Suggest_DescribesOnlyTheNewestCards()
    {
        var databaseName = TestDb.NewDatabaseName();
        var many = Enumerable.Range(1, CardSuggestionsController.MaxCardsDescribed + 10)
            .Select(i => ($"es {i}", $"en {i}"))
            .ToArray();
        await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, many);
        var suggester = new FakeCardSuggester();
        await using var dbContext = TestDb.Create(databaseName);

        await CreateController(dbContext, suggester).Suggest(null, null, null, CancellationToken.None);

        Assert.Equal(CardSuggestionsController.MaxCardsDescribed, suggester.Cards!.Count);
        Assert.Equal("es 11", suggester.Cards[0].Spanish.Single());
    }

    [Fact]
    public async Task Suggest_ReturnsTheLastSuggestions_WhenNothingHasChanged()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"));
        var suggester = new FakeCardSuggester { Result = [new("el pez", "the fish")] };
        await using (var dbContext = TestDb.Create(databaseName))
        {
            await CreateController(dbContext, suggester).Suggest(null, null, null, CancellationToken.None);
        }
        suggester.Result = [new("el ratón", "the mouse")];
        await using var secondContext = TestDb.Create(databaseName);

        var result = await CreateController(secondContext, suggester).Suggest(null, null, null, CancellationToken.None);

        var suggestions = ActionResultAssert.Ok<List<CardSuggestion>>(result.Result);
        Assert.Equal([new("el pez", "the fish")], suggestions);
        Assert.Equal(1, suggester.CallCount);
    }

    [Fact]
    public async Task Suggest_LeavesOutLastSuggestionsTheUserHasSinceAdded()
    {
        var databaseName = TestDb.NewDatabaseName();
        var suggester = new FakeCardSuggester { Result = [new("el pez", "the fish"), new("el ratón", "the mouse")] };
        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext, suggester);
        await controller.Suggest(null, null, null, CancellationToken.None);
        await TestDb.AddCardAsync(dbContext, TestDb.Card("el pez", "the fish"));

        var result = await controller.Suggest(null, null, null, CancellationToken.None);

        // The cards changed, so the model is asked again, and what it says is still checked against them.
        var suggestions = ActionResultAssert.Ok<List<CardSuggestion>>(result.Result);
        Assert.Equal([new("el ratón", "the mouse")], suggestions);
        Assert.Equal(2, suggester.CallCount);
    }

    [Fact]
    public async Task Suggest_AsksForMore_AndShowsThemNextTime()
    {
        var suggester = new FakeCardSuggester { Result = [new("el pez", "the fish")] };
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext, suggester);
        await controller.Suggest(null, null, null, CancellationToken.None);
        suggester.Result = [new("el ratón", "the mouse")];

        var more = await controller.Suggest(null, null, ["el pez"], CancellationToken.None);
        var again = await controller.Suggest(null, null, null, CancellationToken.None);

        Assert.Equal([new("el ratón", "the mouse")], ActionResultAssert.Ok<List<CardSuggestion>>(more.Result));
        Assert.Equal([new("el ratón", "the mouse")], ActionResultAssert.Ok<List<CardSuggestion>>(again.Result));
        Assert.Equal(2, suggester.CallCount);
    }

    [Fact]
    public async Task Suggest_ReturnsServiceUnavailable_WhenSuggestionsAreOff()
    {
        var suggester = new FakeCardSuggester { IsAvailable = false };
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, suggester).Suggest(null, null, null, CancellationToken.None);

        ActionResultAssert.Problem(result.Result, StatusCodes.Status503ServiceUnavailable);
        Assert.Null(suggester.Cards);
    }

    [Fact]
    public async Task Suggest_ReturnsBadGateway_WhenTheSuggesterFails()
    {
        var suggester = new FakeCardSuggester { Failure = new HttpRequestException("boom") };
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, suggester).Suggest(null, null, null, CancellationToken.None);

        ActionResultAssert.Problem(result.Result, StatusCodes.Status502BadGateway);
    }

    [Fact]
    public async Task Suggest_ReturnsBadGateway_WhenTheSuggesterTimesOut()
    {
        var suggester = new FakeCardSuggester { Failure = new TaskCanceledException("timed out") };
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, suggester).Suggest(null, null, null, CancellationToken.None);

        ActionResultAssert.Problem(result.Result, StatusCodes.Status502BadGateway);
    }

    [Fact]
    public async Task Suggest_RequiresSignIn()
    {
        using var client = TestApp.CreateSignedOutClient(factory, Settings);

        var response = await client.GetAsync("/api/card-suggestions");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Suggest_IsUnavailable_WithoutAnApiKey()
    {
        using var client = TestApp.CreateSignedInClient(factory, settings: Settings);

        var response = await client.GetAsync("/api/card-suggestions");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    private static CardSuggestionsController CreateController(FlashCardDbContext dbContext, ICardSuggester suggester)
    {
        return new CardSuggestionsController(
            dbContext,
            new CachedCardSuggester(suggester, dbContext, NullLogger<CachedCardSuggester>.Instance),
            NullLogger<CardSuggestionsController>.Instance);
    }
}
