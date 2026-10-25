using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using FlashCardSage.Api.Suggestions;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class SentencePracticeControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    // The app with no key for the service, so it's off.
    private static readonly Dictionary<string, string> Settings = new() { ["CardSuggestions:Key"] = "" };

    private const string SentencesUrl = "/api/flashcards/practice/sentences";

    private const string ResultsUrl = "/api/flashcards/practice/sentences/results";

    [Fact]
    public async Task Get_SendsTheUsersCards_AndReturnsTheSentences()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(
            databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"), ("la casa", "the house"));
        var others = await TestDb.SeedCardsAsync(databaseName, TestDb.OtherUserId, ("el coche", "the car"));
        var generator = new FakeSentenceGenerator
        {
            Result = [new("El gato y el perro.", "The cat and the dog.", [ids[0], ids[1], others[0]])]
        };
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, generator).Get(new PracticeSelection(), CancellationToken.None);

        var sentence = Assert.Single(ActionResultAssert.Ok<List<PracticeSentence>>(result.Result));
        Assert.Equal(("El gato y el perro.", "The cat and the dog."), (sentence.Spanish, sentence.English));
        Assert.Equal([ids[0], ids[1]], sentence.CardIds);
        Assert.Equal(ids, generator.Cards!.Select(card => card.Id));
        Assert.Equal(SentencePracticeController.SentenceCount + 2, generator.Count);
    }

    [Fact]
    public async Task Get_WritesSentencesFromOnlyTheDecksCards()
    {
        await using var dbContext = TestDb.Create();
        var deck = new Deck { Name = "Animals" };
        List<FlashCard> cards =
        [
            new() { Words = TestDb.Words("el gato", "the cat"), Decks = [deck] },
            new() { Words = TestDb.Words("el perro", "the dog"), Decks = [deck] },
            new() { Words = TestDb.Words("el pez", "the fish"), Decks = [deck] }
        ];
        dbContext.FlashCards.AddRange([.. cards, TestDb.Card("la casa", "the house")]);
        await dbContext.SaveChangesAsync();
        var generator = new FakeSentenceGenerator();

        await CreateController(dbContext, generator).Get(
            new PracticeSelection { DeckId = deck.Id }, CancellationToken.None);

        Assert.Equal(cards.Select(card => card.Id), generator.Cards!.Select(card => card.Id));
    }

    [Fact]
    public async Task Get_WritesSentencesFromOnlyTheTagsCards()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(
            databaseName, TestDb.UserId, ("el gato", "the cat"), ("la casa", "the house"), ("el perro", "the dog"),
            ("el pez", "the fish"));
        var tagId = await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "animals", ids[0], ids[2], ids[3]);
        var generator = new FakeSentenceGenerator();
        await using var dbContext = TestDb.Create(databaseName);

        await CreateController(dbContext, generator).Get(new PracticeSelection { TagId = tagId }, CancellationToken.None);

        Assert.Equal([ids[0], ids[2], ids[3]], generator.Cards!.Select(card => card.Id));
    }

    [Fact]
    public async Task Get_ReturnsNotFound_ForAnotherUsersDeckOrTag()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardsAsync(
            databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"), ("la casa", "the house"));
        var otherDeck = new Deck { Name = "Theirs" };
        var otherTag = new Tag { Name = "Theirs" };
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext =>
        {
            otherContext.Decks.Add(otherDeck);
            otherContext.Tags.Add(otherTag);
        });
        var generator = new FakeSentenceGenerator();
        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext, generator);

        var deck = await controller.Get(new PracticeSelection { DeckId = otherDeck.Id }, CancellationToken.None);
        var tag = await controller.Get(new PracticeSelection { TagId = otherTag.Id }, CancellationToken.None);

        Assert.IsType<NotFoundResult>(deck.Result);
        Assert.IsType<NotFoundResult>(tag.Result);
        Assert.Equal(0, generator.CallCount);
    }

    [Fact]
    public async Task Get_ReturnsValidationProblem_ForFewerThanThreeCards()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"));
        await TestDb.SeedCardsAsync(databaseName, TestDb.OtherUserId, ("la casa", "the house"));
        var generator = new FakeSentenceGenerator();
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, generator).Get(new PracticeSelection(), CancellationToken.None);

        ActionResultAssert.ValidationProblem(result.Result, "Cards", "Practicing sentences needs at least 3 cards.");
        Assert.Equal(0, generator.CallCount);
    }

    [Fact]
    public async Task Get_WritesFromARandomSampleOfTheCards_WhenThereAreMany()
    {
        var databaseName = TestDb.NewDatabaseName();
        var many = Enumerable.Range(1, SentencePracticeController.MaxCardsDescribed + 30)
            .Select(i => ($"es {i}", $"en {i}"))
            .ToArray();
        var ids = await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, many);
        var generator = new FakeSentenceGenerator();
        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext, generator);

        // Picked at random, so two samples of 40 of the 70 cards being the same is all but impossible.
        await controller.Get(new PracticeSelection(), CancellationToken.None);
        var first = generator.Cards!.Select(card => card.Id).ToList();
        await controller.Get(new PracticeSelection(), CancellationToken.None);
        var second = generator.Cards!.Select(card => card.Id).ToList();

        Assert.Equal(SentencePracticeController.MaxCardsDescribed, first.Count);
        Assert.Equal(first.Order(), first);
        Assert.Equal(first.Count, first.Distinct().Count());
        Assert.Subset(ids.ToHashSet(), first.ToHashSet());
        Assert.NotEqual(first, second);
    }

    [Fact]
    public async Task Get_CleansTheSentences_KeepingOnlyTheCardsWrittenFrom()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(
            databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"), ("la casa", "the house"));
        var generator = new FakeSentenceGenerator
        {
            Result =
            [
                new("  El gato duerme. ", " The cat sleeps.  ", [ids[0], ids[0]]),
                new("el gato duerme.", "The cat is sleeping.", [ids[0]]),
                new(" ", "Nothing.", [ids[1]]),
                new(new string('x', SentencePracticeResult.MaxSentenceLength + 1), "Too long.", [ids[1]]),
                new("Sin tarjetas.", "No cards.", [999]),
                new("La casa es grande.", "The house is big.", [ids[2]])
            ]
        };
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, generator).Get(new PracticeSelection(), CancellationToken.None);

        var sentences = ActionResultAssert.Ok<List<PracticeSentence>>(result.Result);
        Assert.Equal(
            [("El gato duerme.", "The cat sleeps.", ids[0]), ("La casa es grande.", "The house is big.", ids[2])],
            sentences.Select(sentence => (sentence.Spanish, sentence.English, Assert.Single(sentence.CardIds))));
    }

    [Fact]
    public async Task Get_ReturnsAHandfulAtMost()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(
            databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"), ("la casa", "the house"));
        var generator = new FakeSentenceGenerator
        {
            Result = Enumerable.Range(1, 7).Select(i => new PracticeSentence($"es {i}", $"en {i}", [ids[0]])).ToList()
        };
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, generator).Get(new PracticeSelection(), CancellationToken.None);

        var sentences = ActionResultAssert.Ok<List<PracticeSentence>>(result.Result);
        Assert.Equal(SentencePracticeController.SentenceCount, sentences.Count);
    }

    [Fact]
    public async Task Get_ReturnsServiceUnavailable_WhenSentencesAreOff()
    {
        var generator = new FakeSentenceGenerator { IsAvailable = false };
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, generator).Get(new PracticeSelection(), CancellationToken.None);

        ActionResultAssert.Problem(
            result.Result, StatusCodes.Status503ServiceUnavailable, "Sentences aren't available.");
        Assert.Equal(0, generator.CallCount);
    }

    public static TheoryData<Exception> Failures => [new HttpRequestException("boom"), new TaskCanceledException("timed out")];

    [Theory]
    [MemberData(nameof(Failures))]
    public async Task Get_ReturnsBadGateway_WhenTheGeneratorFailsOrTimesOut(Exception failure)
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardsAsync(
            databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"), ("la casa", "the house"));
        var generator = new FakeSentenceGenerator { Failure = failure };
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, generator).Get(new PracticeSelection(), CancellationToken.None);

        ActionResultAssert.Problem(result.Result, StatusCodes.Status502BadGateway, "Making sentences failed.");
    }

    [Fact]
    public async Task Record_SavesTheAnswerForTheUser_WithOnlyTheirCards()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"));
        var others = await TestDb.SeedCardsAsync(databaseName, TestDb.OtherUserId, ("la casa", "the house"));
        await using var dbContext = TestDb.Create(databaseName);
        var before = DateTimeOffset.UtcNow;

        var result = await CreateController(dbContext, new FakeSentenceGenerator()).Record(
            Answer(" El gato y el perro. ", "The cat and the dog. ", [ids[1], others[0], 999, ids[0], ids[1]]),
            CancellationToken.None);

        Assert.IsType<NoContentResult>(result);
        var saved = await dbContext.SentencePracticeResults.IgnoreQueryFilters().SingleAsync();
        Assert.Equal(TestDb.UserId, saved.UserId);
        Assert.Equal(("El gato y el perro.", "The cat and the dog."), (saved.Spanish, saved.English));
        Assert.Equal([ids[1], ids[0]], saved.CardIds);
        Assert.Equal((Language.English, PracticeOutcome.WasClose), (saved.ShownSide, saved.Outcome));
        Assert.InRange(saved.PracticedAt, before, DateTimeOffset.UtcNow);
    }

    [Theory]
    [InlineData(" ", "The cat.", "Spanish", "Enter the Spanish sentence.")]
    [InlineData("El gato.", "", "English", "Enter the English sentence.")]
    public async Task Record_ReturnsValidationProblem_ForABlankSide(
        string spanish, string english, string field, string message)
    {
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, new FakeSentenceGenerator()).Record(
            Answer(spanish, english, []), CancellationToken.None);

        ActionResultAssert.ValidationProblem(result, field, message);
        Assert.False(await dbContext.SentencePracticeResults.AnyAsync());
    }

    [Fact]
    public async Task OtherUsersSentencePracticeResults_AreNotVisible()
    {
        var databaseName = TestDb.NewDatabaseName();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            await CreateController(otherContext, new FakeSentenceGenerator()).Record(
                Answer("El gato.", "The cat.", []), CancellationToken.None);
        }

        await using var dbContext = TestDb.Create(databaseName);

        Assert.False(await dbContext.SentencePracticeResults.AnyAsync());
        Assert.True(await dbContext.SentencePracticeResults.IgnoreQueryFilters().AnyAsync());
    }

    [Fact]
    public async Task Routes_RequireSignIn()
    {
        using var client = TestApp.CreateSignedOutClient(factory, Settings);

        var get = await client.GetAsync(SentencesUrl);
        var post = await client.PostAsJsonAsync(
            ResultsUrl,
            new { spanish = "El gato.", english = "The cat.", cardIds = Array.Empty<int>(), shownSide = "Spanish", outcome = "GotIt" });

        Assert.Equal(HttpStatusCode.Unauthorized, get.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, post.StatusCode);
    }

    [Fact]
    public async Task GetSentences_IsUnavailable_WithoutAnApiKey()
    {
        using var client = TestApp.CreateSignedInClient(factory, settings: Settings);

        var response = await client.GetAsync(SentencesUrl);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task GetSentences_ReturnsBadRequest_ForADeckAndATagTogether()
    {
        using var client = TestApp.CreateSignedInClient(factory, settings: Settings);

        var response = await client.GetAsync($"{SentencesUrl}?deckId=1&tagId=1");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PostResult_AcceptsTheSideAndOutcomeByName()
    {
        using var client = TestApp.CreateSignedInClient(factory);
        var created = await client.PostAsJsonAsync("/api/flashcards", TestDb.CardBody("el gato", "the cat"));
        created.EnsureSuccessStatusCode();
        var card = (await created.Content.ReadFromJsonAsync<IdResponse>())!;
        var spanish = $"El gato {Guid.NewGuid()}.";

        var response = await client.PostAsJsonAsync(
            ResultsUrl,
            new { spanish, english = "The cat.", cardIds = new[] { card.Id }, shownSide = "English", outcome = "Failed" });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        using var scope = factory.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<FlashCardDbContext>();
        var saved = await dbContext.SentencePracticeResults.IgnoreQueryFilters().SingleAsync(item => item.Spanish == spanish);
        Assert.Equal([card.Id], saved.CardIds);
        Assert.Equal((Language.English, PracticeOutcome.Failed), (saved.ShownSide, saved.Outcome));
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("""{"english":"The cat.","cardIds":[],"shownSide":"Spanish","outcome":"GotIt"}""")]
    [InlineData("""{"spanish":"El gato.","cardIds":[],"shownSide":"Spanish","outcome":"GotIt"}""")]
    [InlineData("""{"spanish":"El gato.","english":"The cat.","shownSide":"Spanish","outcome":"GotIt"}""")]
    [InlineData("""{"spanish":"El gato.","english":"The cat.","cardIds":[],"outcome":"GotIt"}""")]
    [InlineData("""{"spanish":"El gato.","english":"The cat.","cardIds":[],"shownSide":"Spanish"}""")]
    [InlineData("""{"spanish":"El gato.","english":"The cat.","cardIds":[],"shownSide":"French","outcome":"GotIt"}""")]
    [InlineData("""{"spanish":"El gato.","english":"The cat.","cardIds":[],"shownSide":42,"outcome":"GotIt"}""")]
    [InlineData("""{"spanish":"El gato.","english":"The cat.","cardIds":[],"shownSide":"Spanish","outcome":"Maybe"}""")]
    [InlineData("""{"spanish":"El gato.","english":"The cat.","cardIds":[1,2,3,4,5,6,7,8,9,10,11],"shownSide":"Spanish","outcome":"GotIt"}""")]
    [InlineData("""{"spanish":"  ","english":"The cat.","cardIds":[],"shownSide":"Spanish","outcome":"GotIt"}""")]
    public async Task PostResult_ReturnsBadRequest_ForAMissingOrInvalidField(string body)
    {
        using var client = TestApp.CreateSignedInClient(factory);
        using var content = new StringContent(body, MediaTypeHeaderValue.Parse("application/json"));

        var response = await client.PostAsync(ResultsUrl, content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PostResult_ReturnsBadRequest_ForASentenceOverTheLimit()
    {
        using var client = TestApp.CreateSignedInClient(factory);

        var response = await client.PostAsJsonAsync(
            ResultsUrl,
            new
            {
                spanish = new string('x', SentencePracticeResult.MaxSentenceLength + 1),
                english = "Too long.",
                cardIds = Array.Empty<int>(),
                shownSide = "Spanish",
                outcome = "GotIt"
            });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private static SentencePracticeResultRequest Answer(string spanish, string english, List<int> cardIds)
    {
        return new SentencePracticeResultRequest
        {
            Spanish = spanish,
            English = english,
            CardIds = cardIds,
            ShownSide = Language.English,
            Outcome = PracticeOutcome.WasClose
        };
    }

    private static SentencePracticeController CreateController(FlashCardDbContext dbContext, ISentenceGenerator generator)
    {
        return new SentencePracticeController(
            new FlashCardService(dbContext, new FakeImageStore(), NullLogger<FlashCardService>.Instance),
            generator,
            new SentencePracticeService(dbContext, NullLogger<SentencePracticeService>.Instance),
            NullLogger<SentencePracticeController>.Instance);
    }
}
