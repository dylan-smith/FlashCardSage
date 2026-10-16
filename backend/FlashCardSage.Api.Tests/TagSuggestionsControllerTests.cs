using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class TagSuggestionsControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    // A request through the API for a card with one Spanish word.
    private static readonly object DogBody = new { spanish = new[] { "el perro" } };

    [Fact]
    public async Task Suggest_SendsTheCardAndTheUsersTags_AndReturnsTheTagsPicked()
    {
        var databaseName = Guid.NewGuid().ToString();
        var cards = await SeedAsync(databaseName, TestDb.UserId, ("el gato", "the cat"), ("el tren", "the train"));
        var animals = await SeedTagAsync(databaseName, TestDb.UserId, "Animals", cards[0]);
        await SeedTagAsync(databaseName, TestDb.UserId, "Travel", cards[1]);
        var others = await SeedAsync(databaseName, TestDb.OtherUserId, ("la casa", "the house"));
        await SeedTagAsync(databaseName, TestDb.OtherUserId, "Home", others[0]);
        var suggester = new FakeSuggester { Result = ["animals "] };

        var result = await CreateController(databaseName, suggester).Suggest(
            new TagSuggestionRequest { Spanish = [" el perro ", ""], English = ["the dog"] }, CancellationToken.None);

        var tags = Assert.IsType<List<Tag>>(Assert.IsType<OkObjectResult>(result.Result).Value);
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
        var databaseName = Guid.NewGuid().ToString();
        var many = Enumerable.Range(1, TagSuggestionsController.CardsPerTag + 2)
            .Select(i => ($"es {i}", $"en {i}"))
            .ToArray();
        var cards = await SeedAsync(databaseName, TestDb.UserId, many);
        await SeedTagAsync(databaseName, TestDb.UserId, "food", [.. cards]);
        var suggester = new FakeSuggester();

        await CreateController(databaseName, suggester).Suggest(
            new TagSuggestionRequest { Spanish = ["el pan"] }, CancellationToken.None);

        var described = Assert.Single(suggester.Tags!).FlashCards.Select(card => card.Spanish.Single()).ToList();
        Assert.Equal(TagSuggestionsController.CardsPerTag, described.Count);
        Assert.Contains($"es {many.Length}", described);
        Assert.DoesNotContain("es 1", described);
    }

    [Fact]
    public async Task Suggest_LeavesOutTagsOnTheCard_MadeUpOnes_AndRepeats()
    {
        var databaseName = Guid.NewGuid().ToString();
        foreach (var name in new[] { "Animals", "Food", "Home", "Nature", "Pets" })
        {
            await SeedTagAsync(databaseName, TestDb.UserId, name);
        }
        var suggester = new FakeSuggester { Result = ["Animals", "Zoo", "Pets", "pets", "Home", "Nature", "Food"] };

        var result = await CreateController(databaseName, suggester).Suggest(
            new TagSuggestionRequest { Spanish = ["el perro"], Tags = ["animals"] }, CancellationToken.None);

        var tags = Assert.IsType<List<Tag>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(["Pets", "Home", "Nature"], tags.Select(tag => tag.Name));
        Assert.DoesNotContain("Animals", suggester.Tags!.Select(tag => tag.Name));
    }

    [Fact]
    public async Task Suggest_ReturnsNothing_WithoutAskingTheModel_WhenTheCardHasEveryTag()
    {
        var databaseName = Guid.NewGuid().ToString();
        await SeedTagAsync(databaseName, TestDb.UserId, "Animals");
        var suggester = new FakeSuggester { Result = ["Animals"] };

        var result = await CreateController(databaseName, suggester).Suggest(
            new TagSuggestionRequest { Spanish = ["el perro"], Tags = ["Animals"] }, CancellationToken.None);

        Assert.Empty(Assert.IsType<List<Tag>>(Assert.IsType<OkObjectResult>(result.Result).Value));
        Assert.Null(suggester.Tags);
    }

    [Fact]
    public async Task Suggest_RequiresSomeWords()
    {
        var suggester = new FakeSuggester();

        var result = await CreateController(Guid.NewGuid().ToString(), suggester).Suggest(
            new TagSuggestionRequest { Spanish = [" "], English = [] }, CancellationToken.None);

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Contains(nameof(TagSuggestionRequest.Spanish), problem.Errors.Keys);
        Assert.Null(suggester.Tags);
    }

    [Fact]
    public async Task Suggest_ReturnsServiceUnavailable_WhenSuggestionsAreOff()
    {
        var databaseName = Guid.NewGuid().ToString();
        await SeedTagAsync(databaseName, TestDb.UserId, "Animals");
        var suggester = new FakeSuggester { IsAvailable = false };

        var result = await CreateController(databaseName, suggester).Suggest(
            new TagSuggestionRequest { Spanish = ["el perro"] }, CancellationToken.None);

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, Assert.IsType<ObjectResult>(result.Result).StatusCode);
        Assert.Null(suggester.Tags);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Suggest_ReturnsBadGateway_WhenTheSuggesterFailsOrTimesOut(bool timesOut)
    {
        var databaseName = Guid.NewGuid().ToString();
        await SeedTagAsync(databaseName, TestDb.UserId, "Animals");
        var suggester = new FakeSuggester
        {
            Failure = timesOut ? new TaskCanceledException("timed out") : new HttpRequestException("boom")
        };

        var result = await CreateController(databaseName, suggester).Suggest(
            new TagSuggestionRequest { Spanish = ["el perro"] }, CancellationToken.None);

        Assert.Equal(StatusCodes.Status502BadGateway, Assert.IsType<ObjectResult>(result.Result).StatusCode);
    }

    [Fact]
    public async Task Suggest_RequiresSignIn()
    {
        using var client = CreateClient(signedIn: false);

        var response = await client.PostAsJsonAsync("/api/tag-suggestions", DogBody);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Suggest_IsUnavailable_WithoutAnApiKey()
    {
        using var client = CreateClient(signedIn: true);

        var response = await client.PostAsJsonAsync("/api/tag-suggestions", DogBody);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task SuggestNewTags_SendsTheUsersTagsAndUntaggedCards_AndAsksForExtra()
    {
        var databaseName = Guid.NewGuid().ToString();
        var cards = await SeedAsync(databaseName, TestDb.UserId, ("el gato", "the cat"), ("rojo", "red"));
        await SeedTagAsync(databaseName, TestDb.UserId, "Animals", cards[0]);
        var others = await SeedAsync(databaseName, TestDb.OtherUserId, ("la casa", "the house"), ("azul", "blue"));
        await SeedTagAsync(databaseName, TestDb.OtherUserId, "Home", others[0]);
        var suggester = new FakeSuggester { Result = ["Colors"] };

        var result = await CreateController(databaseName, suggester).SuggestNewTags(CancellationToken.None);

        var names = Assert.IsType<List<string>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(["Colors"], names);
        Assert.Equal(["Animals"], suggester.Tags!.Select(tag => tag.Name));
        Assert.Equal(["el gato"], suggester.Tags![0].FlashCards.Select(card => card.Spanish.Single()));
        Assert.Equal(["rojo"], suggester.Untagged!.Select(card => card.Spanish.Single()));
        Assert.Equal(TagSuggestionsController.NewSuggestionCount + 3, suggester.Count);
    }

    [Fact]
    public async Task SuggestNewTags_DescribesOnlyTheNewestUntaggedCards()
    {
        var databaseName = Guid.NewGuid().ToString();
        var many = Enumerable.Range(1, TagSuggestionsController.MaxUntaggedCards + 2)
            .Select(i => ($"es {i}", $"en {i}"))
            .ToArray();
        await SeedAsync(databaseName, TestDb.UserId, many);
        var suggester = new FakeSuggester();

        await CreateController(databaseName, suggester).SuggestNewTags(CancellationToken.None);

        var described = suggester.Untagged!.Select(card => card.Spanish.Single()).ToList();
        Assert.Equal(TagSuggestionsController.MaxUntaggedCards, described.Count);
        Assert.Contains($"es {many.Length}", described);
        Assert.DoesNotContain("es 1", described);
    }

    [Fact]
    public async Task SuggestNewTags_LeavesOutTagsTheUserHas_Blanks_LongNames_AndRepeats()
    {
        var databaseName = Guid.NewGuid().ToString();
        await SeedTagAsync(databaseName, TestDb.UserId, "Animals");
        var suggester = new FakeSuggester
        {
            Result =
            [
                "animals", " Food ", "", "  ", new string('x', Tag.MaxNameLength + 1), "food", "Colors", "Home",
                "Travel", "Weather", "Work"
            ]
        };

        var result = await CreateController(databaseName, suggester).SuggestNewTags(CancellationToken.None);

        var names = Assert.IsType<List<string>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(["Food", "Colors", "Home", "Travel", "Weather"], names);
    }

    [Fact]
    public async Task SuggestNewTags_ReturnsServiceUnavailable_WhenSuggestionsAreOff()
    {
        var suggester = new FakeSuggester { IsAvailable = false };

        var result = await CreateController(Guid.NewGuid().ToString(), suggester).SuggestNewTags(CancellationToken.None);

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, Assert.IsType<ObjectResult>(result.Result).StatusCode);
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

        var result = await CreateController(Guid.NewGuid().ToString(), suggester).SuggestNewTags(CancellationToken.None);

        Assert.Equal(StatusCodes.Status502BadGateway, Assert.IsType<ObjectResult>(result.Result).StatusCode);
    }

    [Theory]
    [InlineData(false, HttpStatusCode.Unauthorized)]
    [InlineData(true, HttpStatusCode.ServiceUnavailable)]
    public async Task SuggestNewTags_RequiresSignIn_AndAnApiKey(bool signedIn, HttpStatusCode expected)
    {
        using var client = CreateClient(signedIn);

        var response = await client.GetAsync(new Uri("/api/tag-suggestions/new", UriKind.Relative));

        Assert.Equal(expected, response.StatusCode);
    }

    // Adds the cards for the user, returning their IDs.
    private static async Task<List<int>> SeedAsync(
        string databaseName, int userId, params (string Spanish, string English)[] cards)
    {
        await using var dbContext = TestDb.Create(databaseName, userId);
        var added = cards.Select(card => new FlashCard { Words = TestDb.Words(card.Spanish, card.English) }).ToList();
        dbContext.FlashCards.AddRange(added);
        await dbContext.SaveChangesAsync();
        return added.Select(card => card.Id).ToList();
    }

    // Adds a tag of the user's, on these of their cards, returning its ID.
    private static async Task<int> SeedTagAsync(string databaseName, int userId, string name, params int[] cardIds)
    {
        await using var dbContext = TestDb.Create(databaseName, userId);
        var tag = new Tag { Name = name };
        dbContext.Tags.Add(tag);
        foreach (var card in dbContext.FlashCards.Where(card => cardIds.Contains(card.Id)))
        {
            card.Tags.Add(tag);
        }
        await dbContext.SaveChangesAsync();
        return tag.Id;
    }

    private static TagSuggestionsController CreateController(string databaseName, ITagSuggester suggester)
    {
        return new TagSuggestionsController(
            TestDb.Create(databaseName), suggester, NullLogger<TagSuggestionsController>.Instance);
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
                new AuthenticationHeaderValue("Bearer", $"test:Tag suggestions {Guid.NewGuid()}");
        }

        return client;
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

        public int? Count { get; private set; }

        public Task<IReadOnlyList<string>> SuggestNewAsync(
            IReadOnlyList<Tag> tags,
            IReadOnlyList<FlashCard> untagged,
            int count,
            CancellationToken cancellationToken)
        {
            Tags = tags;
            Untagged = untagged;
            Count = count;
            return Failure is null ? Task.FromResult(Result) : Task.FromException<IReadOnlyList<string>>(Failure);
        }
    }
}
