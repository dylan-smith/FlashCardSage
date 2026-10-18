using System.Net;
using System.Net.Http.Json;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class FlashCardScoresControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private const PracticeOutcome GotIt = PracticeOutcome.GotIt;
    private const PracticeOutcome WasClose = PracticeOutcome.WasClose;
    private const PracticeOutcome Failed = PracticeOutcome.Failed;

    [Fact]
    public async Task Get_ScoresACardNeverPracticedAsZero()
    {
        await using var dbContext = TestDb.Create();
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));

        var response = await GetAsync(dbContext);

        Assert.Equivalent(new[] { new FlashCardScore(card.Id, ["el gato"], ["the cat"], 0, null, null) }, response.Cards);
    }

    [Theory]
    [InlineData(50, GotIt)]
    [InlineData(80, GotIt, GotIt)]
    [InlineData(90, GotIt, GotIt, GotIt)]
    [InlineData(95, GotIt, GotIt, GotIt, GotIt)]
    [InlineData(100, GotIt, GotIt, GotIt, GotIt, GotIt)]
    [InlineData(100, GotIt, GotIt, GotIt, GotIt, GotIt, GotIt, GotIt)]
    [InlineData(0, GotIt, GotIt, Failed)]
    [InlineData(0, GotIt, GotIt, WasClose)]
    [InlineData(50, GotIt, GotIt, GotIt, Failed, GotIt)]
    [InlineData(80, Failed, WasClose, GotIt, GotIt)]
    public async Task Get_ScoresACardFromItsLatestRunOfGotIt(int expected, params PracticeOutcome[] outcomes)
    {
        await using var dbContext = TestDb.Create();
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));
        await AddResultsAsync(dbContext, card, outcomes);

        var response = await GetAsync(dbContext);

        Assert.Equal(expected, Assert.Single(response.Cards).Score);
    }

    [Fact]
    public async Task Get_SortsLowestScoreFirstThenByCard_AndTotalsTheScores()
    {
        await using var dbContext = TestDb.Create();
        var cat = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));
        var dog = await TestDb.AddCardAsync(dbContext, TestDb.Card("el perro", "the dog"));
        var house = await TestDb.AddCardAsync(dbContext, TestDb.Card("la casa", "the house"));
        var book = await TestDb.AddCardAsync(dbContext, TestDb.Card("el libro", "the book"));
        await AddResultsAsync(dbContext, cat, GotIt, GotIt);
        await AddResultsAsync(dbContext, dog, GotIt);
        await AddResultsAsync(dbContext, house, GotIt, Failed);

        var response = await GetAsync(dbContext);

        Assert.Equal(
            [(house.Id, 0), (book.Id, 0), (dog.Id, 50), (cat.Id, 80)],
            response.Cards.Select(card => (card.Id, card.Score)));
        Assert.Equal((130, 400), (response.Total, response.Maximum));
    }

    [Fact]
    public async Task Get_GivesWhenEachCardWasLastPracticed()
    {
        await using var dbContext = TestDb.Create();
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));
        var first = new DateTimeOffset(2026, 10, 1, 9, 0, 0, TimeSpan.Zero);
        var last = first.AddDays(3);
        foreach (var practicedAt in new[] { first, last })
        {
            dbContext.PracticeResults.Add(
                new PracticeResult { FlashCardId = card.Id, Outcome = GotIt, PracticedAt = practicedAt });
            await dbContext.SaveChangesAsync();
        }

        var response = await GetAsync(dbContext);

        Assert.Equal(last, Assert.Single(response.Cards).LastPracticedAt);
    }

    [Fact]
    public async Task Get_ReturnsNothing_WhenThereAreNoCards()
    {
        await using var dbContext = TestDb.Create();

        var response = await GetAsync(dbContext);

        Assert.Equal((0, 0), (response.Total, response.Maximum));
        Assert.Empty(response.Cards);
    }

    [Fact]
    public async Task Get_LeavesOutOtherUsersCardsAndResults()
    {
        var databaseName = TestDb.NewDatabaseName();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            var other = await TestDb.AddCardAsync(otherContext, TestDb.Card("el perro", "the dog"));
            await AddResultsAsync(otherContext, other, GotIt, GotIt);
        }

        await using var dbContext = TestDb.Create(databaseName);
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));

        var response = await GetAsync(dbContext);

        Assert.Equivalent(new[] { new FlashCardScore(card.Id, ["el gato"], ["the cat"], 0, null, null) }, response.Cards);
        Assert.Equal((0, 100), (response.Total, response.Maximum));
    }

    [Fact]
    public async Task Get_ScoresAndTotalsOnlyTheDecksCards()
    {
        await using var dbContext = TestDb.Create();
        var deck = new Deck { Name = "Animals" };
        var cat = new FlashCard { Words = TestDb.Words("el gato", "the cat"), Decks = [deck] };
        var house = TestDb.Card("la casa", "the house");
        dbContext.FlashCards.AddRange(cat, house);
        await dbContext.SaveChangesAsync();
        await AddResultsAsync(dbContext, cat, GotIt);
        await AddResultsAsync(dbContext, house, GotIt, GotIt);

        var response = await GetAsync(dbContext, new PracticeSelection { DeckId = deck.Id });

        Assert.Equal(cat.Id, Assert.Single(response.Cards).Id);
        Assert.Equal((50, 100), (response.Total, response.Maximum));
    }

    [Fact]
    public async Task Get_ScoresAndTotalsOnlyTheTagsCards()
    {
        await using var dbContext = TestDb.Create();
        var tag = new Tag { Name = "Animals" };
        var cat = new FlashCard { Words = TestDb.Words("el gato", "the cat"), Tags = [tag] };
        var house = TestDb.Card("la casa", "the house");
        dbContext.FlashCards.AddRange(cat, house);
        await dbContext.SaveChangesAsync();
        await AddResultsAsync(dbContext, cat, GotIt, GotIt);
        await AddResultsAsync(dbContext, house, GotIt);

        var response = await GetAsync(dbContext, new PracticeSelection { TagId = tag.Id });

        Assert.Equal(cat.Id, Assert.Single(response.Cards).Id);
        Assert.Equal((80, 100), (response.Total, response.Maximum));
    }

    [Fact]
    public async Task Get_ReturnsNotFound_ForAnotherUsersDeckOrTag()
    {
        var databaseName = TestDb.NewDatabaseName();
        var otherDeck = new Deck { Name = "Theirs" };
        var otherTag = new Tag { Name = "Theirs" };
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext =>
        {
            otherContext.Decks.Add(otherDeck);
            otherContext.Tags.Add(otherTag);
        });

        await using var dbContext = TestDb.Create(databaseName);
        var controller = new FlashCardScoresController(dbContext, NullLogger<FlashCardScoresController>.Instance);

        Assert.IsType<NotFoundResult>((await controller.Get(new PracticeSelection { DeckId = otherDeck.Id })).Result);
        Assert.IsType<NotFoundResult>((await controller.Get(new PracticeSelection { TagId = otherTag.Id })).Result);
    }

    [Fact]
    public async Task GetScores_TakesTheDeckOrTagFromTheQuery()
    {
        using var client = TestApp.CreateSignedInClient(factory);

        var unknownDeck = await client.GetAsync("/api/flashcards/scores?deckId=999");
        var unknownTag = await client.GetAsync("/api/flashcards/scores?tagId=999");
        var both = await client.GetAsync("/api/flashcards/scores?deckId=1&tagId=1");

        Assert.Equal(HttpStatusCode.NotFound, unknownDeck.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, unknownTag.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, both.StatusCode);
    }

    [Fact]
    public async Task GetScores_IsServedAlongsideTheCardRoutes()
    {
        using var client = TestApp.CreateSignedInClient(factory);
        var created = await client.PostAsJsonAsync("/api/flashcards", TestDb.CardBody("el gato", "the cat"));
        created.EnsureSuccessStatusCode();

        var response = await client.GetFromJsonAsync<FlashCardScoresResponse>("/api/flashcards/scores");

        Assert.Equal((0, 100), (response!.Total, response.Maximum));
        Assert.Equal("el gato", Assert.Single(response.Cards).Spanish.Single());
    }

    // Saved in the order given, oldest first.
    private static async Task AddResultsAsync(
        FlashCardDbContext dbContext, FlashCard card, params PracticeOutcome[] outcomes)
    {
        foreach (var outcome in outcomes)
        {
            dbContext.PracticeResults.Add(new PracticeResult
            {
                FlashCardId = card.Id,
                Outcome = outcome,
                PracticedAt = DateTimeOffset.UtcNow
            });
            await dbContext.SaveChangesAsync();
        }
    }

    private static async Task<FlashCardScoresResponse> GetAsync(
        FlashCardDbContext dbContext, PracticeSelection? selection = null)
    {
        var controller = new FlashCardScoresController(dbContext, NullLogger<FlashCardScoresController>.Instance);
        var result = await controller.Get(selection ?? new PracticeSelection());
        return ActionResultAssert.Ok<FlashCardScoresResponse>(result.Result);
    }
}
