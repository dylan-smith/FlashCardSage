using FlashCardSage.Api.Mcp;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using Microsoft.Extensions.Logging.Abstractions;
using ModelContextProtocol;

namespace FlashCardSage.Api.Tests.Mcp;

public class StatsToolsTests
{
    private static readonly DateTimeOffset Start = new(2026, 10, 1, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task GetCounts_CountsOnlyTheUsersData()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"));
        await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "Animals", ids[0]);
        await TestDb.SeedAsOtherUserAsync(databaseName, dbContext =>
        {
            dbContext.FlashCards.Add(TestDb.Card("la casa", "the house"));
            dbContext.Decks.Add(new Deck { Name = "Theirs" });
        });
        await using var dbContext = TestDb.Create(databaseName);

        Assert.Equal(new Counts(2, 0, 1), await CreateTools(dbContext).GetCountsAsync());
    }

    [Fact]
    public async Task GetPracticeStats_ScoresTheCards_LowestFirst()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(
            databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"), ("la casa", "the house"));
        await using var dbContext = TestDb.Create(databaseName);
        AddResults(dbContext, ids[0], PracticeOutcome.Failed, PracticeOutcome.GotIt, PracticeOutcome.GotIt);
        AddResults(dbContext, ids[2], PracticeOutcome.GotIt, PracticeOutcome.WasClose);
        await dbContext.SaveChangesAsync();
        var tools = CreateTools(dbContext);

        var stats = await tools.GetPracticeStatsAsync();
        var page = await tools.GetPracticeStatsAsync(limit: 1, offset: 1);

        Assert.Equal([(ids[1], 0), (ids[2], 0), (ids[0], 80)], stats.Cards.Select(card => (card.Id, card.Score)));
        Assert.Equal((80, 300, 3, false), (stats.TotalScore, stats.MaximumScore, stats.CardCount, stats.HasMore));
        var cat = stats.Cards[2];
        Assert.Equal((2, 0, 1, Start.AddMinutes(2)), (cat.GotIt, cat.WasClose, cat.Failed, cat.LastPracticedAt));
        Assert.Equal([ids[2]], page.Cards.Select(card => card.Id));
        Assert.True(page.HasMore);
    }

    [Fact]
    public async Task GetPracticeStats_LimitsToTheCardsGivenOrADecksCards()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(
            databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"), ("la casa", "the house"));
        await using var dbContext = TestDb.Create(databaseName);
        var deck = new Deck { Name = "Week 1", FlashCards = [.. dbContext.FlashCards.Where(card => card.Id != ids[2])] };
        dbContext.Decks.Add(deck);
        await dbContext.SaveChangesAsync();
        var tools = CreateTools(dbContext);

        Assert.Equal([ids[0], ids[1]], (await tools.GetPracticeStatsAsync(deckId: deck.Id)).Cards.Select(card => card.Id));
        Assert.Equal(
            [ids[1]], (await tools.GetPracticeStatsAsync(deckId: deck.Id, cardIds: [ids[1], ids[2]])).Cards.Select(card => card.Id));
    }

    [Fact]
    public async Task GetPracticeStats_RefusesADeckAndATag_OrAnotherUsersDeck()
    {
        var databaseName = TestDb.NewDatabaseName();
        var otherDeck = new Deck { Name = "Theirs" };
        await TestDb.SeedAsOtherUserAsync(databaseName, dbContext => dbContext.Decks.Add(otherDeck));
        await using var dbContext = TestDb.Create(databaseName);
        var tools = CreateTools(dbContext);

        var both = await Assert.ThrowsAsync<McpException>(() => tools.GetPracticeStatsAsync(deckId: 1, tagId: 1));
        var other = await Assert.ThrowsAsync<McpException>(() => tools.GetPracticeStatsAsync(deckId: otherDeck.Id));

        Assert.Equal("Practice a deck or a tag, not both.", both.Message);
        Assert.Equal(ToolErrors.DeckNotFound, other.Message);
    }

    [Fact]
    public async Task GetPracticeHistory_ReturnsTheNewestAnswersFirst()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"));
        await using var dbContext = TestDb.Create(databaseName);
        AddResults(dbContext, ids[0], PracticeOutcome.WasClose, PracticeOutcome.GotIt, PracticeOutcome.GotIt);
        await dbContext.SaveChangesAsync();

        var history = await CreateTools(dbContext).GetPracticeHistoryAsync(ids[0], limit: 2);

        Assert.Equal((ids[0], 80, 3), (history.CardId, history.Score, history.TotalAttempts));
        Assert.Equal(
            [new PracticeAttempt(PracticeOutcome.GotIt, Start.AddMinutes(2)), new PracticeAttempt(PracticeOutcome.GotIt, Start.AddMinutes(1))],
            history.Attempts);
    }

    [Fact]
    public async Task GetPracticeHistory_RefusesAnotherUsersCard()
    {
        var databaseName = TestDb.NewDatabaseName();
        var otherId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el perro", "the dog"), TestDb.OtherUserId);
        await using var dbContext = TestDb.Create(databaseName);

        var error = await Assert.ThrowsAsync<McpException>(() => CreateTools(dbContext).GetPracticeHistoryAsync(otherId));

        Assert.Equal(ToolErrors.CardNotFound, error.Message);
    }

    // Practice answers to the card, oldest first, a minute apart.
    private static void AddResults(Data.FlashCardDbContext dbContext, int cardId, params PracticeOutcome[] outcomes)
    {
        dbContext.PracticeResults.AddRange(outcomes.Select((outcome, index) =>
            new PracticeResult { FlashCardId = cardId, Outcome = outcome, PracticedAt = Start.AddMinutes(index) }));
    }

    private static StatsTools CreateTools(Data.FlashCardDbContext dbContext)
    {
        return new StatsTools(
            new PracticeService(dbContext, NullLogger<PracticeService>.Instance),
            new CountsService(dbContext));
    }
}
