using System.Net;
using System.Net.Http.Json;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class TagSuggestionsControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    // The app with no key for the service, so it's off.
    private static readonly Dictionary<string, string> Settings = new() { ["CardSuggestions:Key"] = "" };

    // A request through the API for a card with one Spanish word.
    private static readonly object DogBody = new { spanish = new[] { "el perro" } };

    [Fact]
    public async Task Suggest_SendsTheCardAndTheUsersTags_AndReturnsTheTagsPicked()
    {
        var databaseName = TestDb.NewDatabaseName();
        var cards = await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"), ("el tren", "the train"));
        var animals = await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "Animals", cards[0]);
        await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "Travel", cards[1]);
        var others = await TestDb.SeedCardsAsync(databaseName, TestDb.OtherUserId, ("la casa", "the house"));
        await TestDb.SeedTagAsync(databaseName, TestDb.OtherUserId, "Home", others[0]);
        var suggester = new FakeSuggester { Result = ["animals "] };
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, suggester).Suggest(
            new TagSuggestionRequest { Spanish = [" el perro ", ""], English = ["the dog"] }, CancellationToken.None);

        var tags = ActionResultAssert.Ok<List<Tag>>(result.Result);
        var tag = Assert.Single(tags);
        Assert.Equal((animals, "Animals"), (tag.Id, tag.Name));
        Assert.Equal(["el perro"], suggester.Spanish);
        Assert.Equal(["the dog"], suggester.English);
        Assert.Equal(["Animals", "Travel"], suggester.Tags!.Select(item => item.Name));
        Assert.Equal(["el gato"], suggester.Tags![0].FlashCards.Select(card => card.Spanish.Single()));
    }

    [Fact]
    public async Task Suggest_DescribesEachTagWithItsNewestCards()
    {
        var databaseName = TestDb.NewDatabaseName();
        var many = Enumerable.Range(1, TagSuggestionsController.CardsPerTag + 2)
            .Select(i => ($"es {i}", $"en {i}"))
            .ToArray();
        var cards = await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, many);
        await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "food", [.. cards]);
        var suggester = new FakeSuggester();
        await using var dbContext = TestDb.Create(databaseName);

        await CreateController(dbContext, suggester).Suggest(
            new TagSuggestionRequest { Spanish = ["el pan"] }, CancellationToken.None);

        var described = Assert.Single(suggester.Tags!).FlashCards.Select(card => card.Spanish.Single()).ToList();
        Assert.Equal(TagSuggestionsController.CardsPerTag, described.Count);
        Assert.Contains($"es {many.Length}", described);
        Assert.DoesNotContain("es 1", described);
    }

    [Fact]
    public async Task Suggest_LeavesOutTagsOnTheCard_MadeUpOnes_AndRepeats()
    {
        var databaseName = TestDb.NewDatabaseName();
        foreach (var name in new[] { "Animals", "Food", "Home", "Nature", "Pets" })
        {
            await TestDb.SeedTagAsync(databaseName, TestDb.UserId, name);
        }
        var suggester = new FakeSuggester { Result = ["Animals", "Zoo", "Pets", "pets", "Home", "Nature", "Food"] };
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, suggester).Suggest(
            new TagSuggestionRequest { Spanish = ["el perro"], Tags = ["animals"] }, CancellationToken.None);

        var tags = ActionResultAssert.Ok<List<Tag>>(result.Result);
        Assert.Equal(["Pets", "Home", "Nature"], tags.Select(tag => tag.Name));
        Assert.DoesNotContain("Animals", suggester.Tags!.Select(tag => tag.Name));
    }

    [Fact]
    public async Task Suggest_ReturnsNothing_WithoutAskingTheModel_WhenTheCardHasEveryTag()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "Animals");
        var suggester = new FakeSuggester { Result = ["Animals"] };
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, suggester).Suggest(
            new TagSuggestionRequest { Spanish = ["el perro"], Tags = ["Animals"] }, CancellationToken.None);

        Assert.Empty(ActionResultAssert.Ok<List<Tag>>(result.Result));
        Assert.Null(suggester.Tags);
    }

    [Fact]
    public async Task Suggest_RequiresSomeWords()
    {
        var suggester = new FakeSuggester();
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, suggester).Suggest(
            new TagSuggestionRequest { Spanish = [" "], English = [] }, CancellationToken.None);

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Contains(nameof(TagSuggestionRequest.Spanish), problem.Errors.Keys);
        Assert.Null(suggester.Tags);
    }

    [Fact]
    public async Task Suggest_ReturnsServiceUnavailable_WhenSuggestionsAreOff()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "Animals");
        var suggester = new FakeSuggester { IsAvailable = false };
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, suggester).Suggest(
            new TagSuggestionRequest { Spanish = ["el perro"] }, CancellationToken.None);

        ActionResultAssert.Problem(result.Result, StatusCodes.Status503ServiceUnavailable);
        Assert.Null(suggester.Tags);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Suggest_ReturnsBadGateway_WhenTheSuggesterFailsOrTimesOut(bool timesOut)
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "Animals");
        var suggester = new FakeSuggester
        {
            Failure = timesOut ? new TaskCanceledException("timed out") : new HttpRequestException("boom")
        };
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, suggester).Suggest(
            new TagSuggestionRequest { Spanish = ["el perro"] }, CancellationToken.None);

        ActionResultAssert.Problem(result.Result, StatusCodes.Status502BadGateway);
    }

    [Fact]
    public async Task Suggest_RequiresSignIn()
    {
        using var client = TestApp.CreateSignedOutClient(factory, Settings);

        var response = await client.PostAsJsonAsync("/api/tag-suggestions", DogBody);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Suggest_IsUnavailable_WithoutAnApiKey()
    {
        using var client = TestApp.CreateSignedInClient(factory, settings: Settings);

        var response = await client.PostAsJsonAsync("/api/tag-suggestions", DogBody);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task SuggestNewTags_SendsTheUsersTagsAndUntaggedCards_AndAsksForExtra()
    {
        var databaseName = TestDb.NewDatabaseName();
        var cards = await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"), ("rojo", "red"));
        await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "Animals", cards[0]);
        var others = await TestDb.SeedCardsAsync(databaseName, TestDb.OtherUserId, ("la casa", "the house"), ("azul", "blue"));
        await TestDb.SeedTagAsync(databaseName, TestDb.OtherUserId, "Home", others[0]);
        var suggester = new FakeSuggester { Result = ["Colors"] };
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, suggester).SuggestNewTags(null, CancellationToken.None);

        var names = ActionResultAssert.Ok<List<string>>(result.Result);
        Assert.Equal(["Colors"], names);
        Assert.Equal(["Animals"], suggester.Tags!.Select(tag => tag.Name));
        Assert.Equal(["el gato"], suggester.Tags![0].FlashCards.Select(card => card.Spanish.Single()));
        Assert.Equal(["rojo"], suggester.Untagged!.Select(card => card.Spanish.Single()));
        Assert.Equal(TagSuggestionsController.NewSuggestionCount + 3, suggester.Count);
    }

    [Fact]
    public async Task SuggestNewTags_DescribesOnlyTheNewestUntaggedCards()
    {
        var databaseName = TestDb.NewDatabaseName();
        var many = Enumerable.Range(1, TagSuggestionsController.MaxUntaggedCards + 2)
            .Select(i => ($"es {i}", $"en {i}"))
            .ToArray();
        await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, many);
        var suggester = new FakeSuggester();
        await using var dbContext = TestDb.Create(databaseName);

        await CreateController(dbContext, suggester).SuggestNewTags(null, CancellationToken.None);

        var described = suggester.Untagged!.Select(card => card.Spanish.Single()).ToList();
        Assert.Equal(TagSuggestionsController.MaxUntaggedCards, described.Count);
        Assert.Contains($"es {many.Length}", described);
        Assert.DoesNotContain("es 1", described);
    }

    [Fact]
    public async Task SuggestNewTags_LeavesOutTagsTheUserHas_Blanks_LongNames_AndRepeats()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "Animals");
        var suggester = new FakeSuggester
        {
            Result =
            [
                "animals", " Food ", "", "  ", new string('x', Tag.MaxNameLength + 1), "food", "Colors", "Home",
                "Travel", "Weather", "Work"
            ]
        };
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, suggester).SuggestNewTags(null, CancellationToken.None);

        var names = ActionResultAssert.Ok<List<string>>(result.Result);
        Assert.Equal(["Food", "Colors", "Home", "Travel", "Weather"], names);
        Assert.Empty(suggester.Exclude!);
    }

    [Fact]
    public async Task SuggestNewTags_LeavesOutNamesAlreadyShown_AndTellsTheSuggester()
    {
        var suggester = new FakeSuggester { Result = ["food", "Colors", "Home"] };
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, suggester)
            .SuggestNewTags([" Food ", "Travel", "food", "", new string('x', Tag.MaxNameLength + 1)], CancellationToken.None);

        var names = ActionResultAssert.Ok<List<string>>(result.Result);
        Assert.Equal(["Colors", "Home"], names);
        Assert.Equal(["Food", "Travel"], suggester.Exclude);
    }

    [Fact]
    public async Task SuggestNewTags_TellsTheSuggesterOnlyTheNewestNamesShown()
    {
        var shown = Enumerable.Range(1, ShownSuggestions.MaxCount + 2).Select(i => $"Tag {i}").ToArray();
        var suggester = new FakeSuggester();
        await using var dbContext = TestDb.Create();

        await CreateController(dbContext, suggester).SuggestNewTags(shown, CancellationToken.None);

        Assert.Equal(shown[2..], suggester.Exclude);
    }

    [Fact]
    public async Task SuggestNewTags_ReturnsServiceUnavailable_WhenSuggestionsAreOff()
    {
        var suggester = new FakeSuggester { IsAvailable = false };
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, suggester).SuggestNewTags(null, CancellationToken.None);

        ActionResultAssert.Problem(result.Result, StatusCodes.Status503ServiceUnavailable);
        Assert.Null(suggester.Count);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SuggestNewTags_ReturnsBadGateway_WhenTheSuggesterFailsOrTimesOut(bool timesOut)
    {
        var suggester = new FakeSuggester
        {
            Failure = timesOut ? new TaskCanceledException("timed out") : new HttpRequestException("boom")
        };
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, suggester).SuggestNewTags(null, CancellationToken.None);

        ActionResultAssert.Problem(result.Result, StatusCodes.Status502BadGateway);
    }

    [Theory]
    [InlineData(false, HttpStatusCode.Unauthorized)]
    [InlineData(true, HttpStatusCode.ServiceUnavailable)]
    public async Task SuggestNewTags_RequiresSignIn_AndAnApiKey(bool signedIn, HttpStatusCode expected)
    {
        using var client = signedIn
            ? TestApp.CreateSignedInClient(factory, settings: Settings)
            : TestApp.CreateSignedOutClient(factory, Settings);

        var response = await client.GetAsync(new Uri("/api/tag-suggestions/new", UriKind.Relative));

        Assert.Equal(expected, response.StatusCode);
    }

    private static TagSuggestionsController CreateController(FlashCardDbContext dbContext, ITagSuggester suggester)
    {
        return new TagSuggestionsController(
            dbContext, suggester, NullLogger<TagSuggestionsController>.Instance);
    }

    private sealed class FakeSuggester : ITagSuggester
    {
        public bool IsAvailable { get; init; } = true;

        public IReadOnlyList<string> Result { get; init; } = [];

        public Exception? Failure { get; init; }

        public IReadOnlyList<string>? Spanish { get; private set; }

        public IReadOnlyList<string>? English { get; private set; }

        public IReadOnlyList<Tag>? Tags { get; private set; }

        public Task<IReadOnlyList<string>> SuggestAsync(
            IReadOnlyList<string> spanish,
            IReadOnlyList<string> english,
            IReadOnlyList<Tag> tags,
            CancellationToken cancellationToken)
        {
            Spanish = spanish;
            English = english;
            Tags = tags;
            return Failure is null ? Task.FromResult(Result) : Task.FromException<IReadOnlyList<string>>(Failure);
        }

        public IReadOnlyList<FlashCard>? Untagged { get; private set; }

        public IReadOnlyList<string>? Exclude { get; private set; }

        public int? Count { get; private set; }

        public Task<IReadOnlyList<string>> SuggestNewAsync(
            IReadOnlyList<Tag> tags,
            IReadOnlyList<FlashCard> untagged,
            IReadOnlyList<string> exclude,
            int count,
            CancellationToken cancellationToken)
        {
            Tags = tags;
            Untagged = untagged;
            Exclude = exclude;
            Count = count;
            return Failure is null ? Task.FromResult(Result) : Task.FromException<IReadOnlyList<string>>(Failure);
        }
    }
}
