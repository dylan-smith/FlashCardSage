using FlashCardSage.Api.Data;
using FlashCardSage.Api.Mcp;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using ModelContextProtocol;

namespace FlashCardSage.Api.Tests.Mcp;

public class CardToolsTests
{
    [Fact]
    public async Task ListCards_ReturnsAPageInTheOrderTheyWereAdded()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(
            databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"), ("la casa", "the house"));
        await using var dbContext = TestDb.Create(databaseName);
        var tools = CreateTools(dbContext);

        var first = await tools.ListCardsAsync(limit: 2);
        var second = await tools.ListCardsAsync(limit: 2, offset: 2);

        Assert.Equal(ids[..2], first.Cards.Select(card => card.Id));
        Assert.Equal((3, 0, true), (first.Total, first.Offset, first.HasMore));
        Assert.Equal([ids[2]], second.Cards.Select(card => card.Id));
        Assert.Equal((3, 2, false), (second.Total, second.Offset, second.HasMore));
        Assert.Equal(["la casa"], second.Cards[0].Spanish);
        Assert.Equal(["the house"], second.Cards[0].English);
    }

    [Fact]
    public async Task ListCards_LimitsThePageSize()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"));
        await using var dbContext = TestDb.Create(databaseName);

        var page = await CreateTools(dbContext).ListCardsAsync(limit: 0);

        Assert.Single(page.Cards);
        Assert.True(page.HasMore);
    }

    [Theory]
    [InlineData("NINO", "el niño")]
    [InlineData("the BOY", "el niño")]
    [InlineData("famil", "la madre")]
    public async Task ListCards_SearchesWordsAndTags_IgnoringCaseAndAccents(string search, string expected)
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardAsync(databaseName, TestDb.Card("el niño", "the boy"));
        await TestDb.SeedCardAsync(databaseName, TestDb.Card("la madre", "the mother", ["Familia"]));
        await TestDb.SeedCardAsync(databaseName, TestDb.Card("la casa", "the house"));
        await using var dbContext = TestDb.Create(databaseName);

        var page = await CreateTools(dbContext).ListCardsAsync(search: search);

        var card = Assert.Single(page.Cards);
        Assert.Equal([expected], card.Spanish);
        Assert.Equal(1, page.Total);
    }

    [Fact]
    public async Task ListCards_FiltersByTagAndDeck()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(
            databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"), ("la casa", "the house"));
        var tagId = await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "Animals", ids[0], ids[1]);
        await using var dbContext = TestDb.Create(databaseName);
        var deck = new Deck { Name = "Week 1", FlashCards = [.. dbContext.FlashCards.Where(card => card.Id != ids[0])] };
        dbContext.Decks.Add(deck);
        await dbContext.SaveChangesAsync();
        var tools = CreateTools(dbContext);

        Assert.Equal(ids[..2], (await tools.ListCardsAsync(tagId: tagId)).Cards.Select(card => card.Id));
        Assert.Equal(ids[1..], (await tools.ListCardsAsync(deckId: deck.Id)).Cards.Select(card => card.Id));
        Assert.Equal([ids[1]], (await tools.ListCardsAsync(tagId: tagId, deckId: deck.Id)).Cards.Select(card => card.Id));
        Assert.Equal(["Animals"], (await tools.ListCardsAsync(tagId: tagId)).Cards[0].Tags);
    }

    [Fact]
    public async Task ListCards_HidesOtherUsersCards_AndRefusesTheirDecksAndTags()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"));
        var otherDeck = new Deck { Name = "Theirs" };
        var otherTag = new Tag { Name = "Theirs" };
        await TestDb.SeedAsOtherUserAsync(databaseName, dbContext =>
        {
            dbContext.FlashCards.Add(TestDb.Card("el perro", "the dog"));
            dbContext.Decks.Add(otherDeck);
            dbContext.Tags.Add(otherTag);
        });
        await using var dbContext = TestDb.Create(databaseName);
        var tools = CreateTools(dbContext);

        var page = await tools.ListCardsAsync();

        Assert.Equal(["el gato"], Assert.Single(page.Cards).Spanish);
        var deckError = await Assert.ThrowsAsync<McpException>(() => tools.ListCardsAsync(deckId: otherDeck.Id));
        Assert.Equal(ToolErrors.DeckNotFound, deckError.Message);
        var tagError = await Assert.ThrowsAsync<McpException>(() => tools.ListCardsAsync(tagId: otherTag.Id));
        Assert.Equal(ToolErrors.TagNotFound, tagError.Message);
    }

    [Fact]
    public async Task GetCard_IncludesItsTagsAndDecks()
    {
        var databaseName = TestDb.NewDatabaseName();
        await using var dbContext = TestDb.Create(databaseName);
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat", ["Pets", "Animals"]));
        dbContext.Decks.AddRange(new Deck { Name = "Week 2", FlashCards = [card] }, new Deck { Name = "Week 1", FlashCards = [card] });
        await dbContext.SaveChangesAsync();

        var detail = await CreateTools(dbContext).GetCardAsync(card.Id);

        Assert.Equal(["Animals", "Pets"], detail.Tags);
        Assert.Equal(["Week 1", "Week 2"], detail.Decks.Select(deck => deck.Name));
    }

    [Fact]
    public async Task GetCard_RefusesAnotherUsersCard()
    {
        var databaseName = TestDb.NewDatabaseName();
        var otherId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el perro", "the dog"), TestDb.OtherUserId);
        await using var dbContext = TestDb.Create(databaseName);

        var error = await Assert.ThrowsAsync<McpException>(() => CreateTools(dbContext).GetCardAsync(otherId));

        Assert.Equal(ToolErrors.CardNotFound, error.Message);
    }

    [Fact]
    public async Task CreateCard_AddsTheCardWithItsTags()
    {
        await using var dbContext = TestDb.Create();

        var card = await CreateTools(dbContext).CreateCardAsync(["solo", "únicamente"], ["only"], ["Adverbs"]);

        Assert.Equal(["solo", "únicamente"], card.Spanish);
        Assert.Equal(["Adverbs"], card.Tags);
        Assert.Equal(1, await dbContext.FlashCards.CountAsync());
    }

    [Fact]
    public async Task CreateCard_NamesTheCardThatHasADuplicateWord()
    {
        var databaseName = TestDb.NewDatabaseName();
        var catId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"));
        await using var dbContext = TestDb.Create(databaseName);

        var error = await Assert.ThrowsAsync<McpException>(
            () => CreateTools(dbContext).CreateCardAsync(["El Gato"], ["the kitty"]));

        Assert.Equal(
            $"You already have a flash card with the Spanish \"el gato\". Add this translation to that card instead (card {catId}).",
            error.Message);
    }

    [Fact]
    public async Task CreateCard_TakesAMissingListAsEmpty()
    {
        await using var dbContext = TestDb.Create();

        var error = await Assert.ThrowsAsync<McpException>(() => CreateTools(dbContext).CreateCardAsync(null, ["the cat"]));

        Assert.Equal("Spanish is required.", error.Message);
    }

    [Fact]
    public async Task CreateCards_ReturnsTheSkippedCards()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"));
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateTools(dbContext).CreateCardsAsync(
        [
            new CardInput(["el perro"], ["the dog"], ["Animals"]),
            new CardInput(["el gato"], ["the kitty"]),
            new CardInput(["el can"], ["the dog"])
        ]);

        Assert.Equal(["el perro"], Assert.Single(result.Created).Spanish);
        Assert.Equal(["Animals"], result.Created[0].Tags);
        Assert.Equal([["el gato"], ["el can"]], result.Skipped.Select(card => card.Spanish));
        Assert.Equal(2, await dbContext.FlashCards.CountAsync());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(101)]
    public async Task CreateCards_RefusesTooFewOrTooMany(int count)
    {
        await using var dbContext = TestDb.Create();
        var cards = Enumerable.Range(0, count).Select(index => new CardInput([$"palabra {index}"], [$"word {index}"])).ToArray();

        var error = await Assert.ThrowsAsync<McpException>(() => CreateTools(dbContext).CreateCardsAsync(cards));

        Assert.Equal("Give between 1 and 100 cards to add at once.", error.Message);
        Assert.False(await dbContext.FlashCards.AnyAsync());
    }

    [Fact]
    public async Task CreateCards_SaysWhichCardIsInvalid()
    {
        await using var dbContext = TestDb.Create();

        var error = await Assert.ThrowsAsync<McpException>(() => CreateTools(dbContext).CreateCardsAsync(
            [new CardInput(["el gato"], ["the cat"]), new CardInput(["el perro"], null)]));

        Assert.Equal("cards[1]: English is required.", error.Message);
    }

    [Fact]
    public async Task UpdateCard_KeepsWhatsLeftOut()
    {
        await using var dbContext = TestDb.Create();
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat", ["Animals"]));

        var updated = await CreateTools(dbContext).UpdateCardAsync(card.Id, english: ["the cat", "the kitty"]);

        Assert.Equal(["el gato"], updated.Spanish);
        Assert.Equal(["the cat", "the kitty"], updated.English);
        Assert.Equal(["Animals"], updated.Tags);
    }

    [Fact]
    public async Task UpdateCard_ClearsTheTags_WhenGivenNone()
    {
        await using var dbContext = TestDb.Create();
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat", ["Animals"]));

        var updated = await CreateTools(dbContext).UpdateCardAsync(card.Id, tags: []);

        Assert.Empty(updated.Tags);
        Assert.Equal(["the cat"], updated.English);
    }

    [Fact]
    public async Task UpdateCard_RefusesAnotherUsersCard()
    {
        var databaseName = TestDb.NewDatabaseName();
        var otherId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el perro", "the dog"), TestDb.OtherUserId);
        await using var dbContext = TestDb.Create(databaseName);

        var error = await Assert.ThrowsAsync<McpException>(
            () => CreateTools(dbContext).UpdateCardAsync(otherId, english: ["the hound"]));

        Assert.Equal(ToolErrors.CardNotFound, error.Message);
    }

    [Fact]
    public async Task DeleteCards_CountsTheCardsDeleted_SkippingGoneAndOtherUsersCards()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"));
        var otherId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("la casa", "the house"), TestDb.OtherUserId);
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateTools(dbContext).DeleteCardsAsync([ids[0], ids[0], 9999, otherId]);

        Assert.Equal(new CardsDeleted(1, 3), result);
        Assert.Equal([ids[1]], await dbContext.FlashCards.Select(card => card.Id).ToListAsync());
        await using var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId);
        Assert.True(await otherContext.FlashCards.AnyAsync(card => card.Id == otherId));
    }

    [Fact]
    public async Task DeleteCards_RefusesNoIds()
    {
        await using var dbContext = TestDb.Create();

        var error = await Assert.ThrowsAsync<McpException>(() => CreateTools(dbContext).DeleteCardsAsync(null));

        Assert.Equal("Give the ids of the cards to delete.", error.Message);
    }

    private static CardTools CreateTools(FlashCardDbContext dbContext)
    {
        return new CardTools(
            dbContext, new FlashCardService(dbContext, new FakeImageStore(), NullLogger<FlashCardService>.Instance));
    }
}
