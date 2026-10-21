using FlashCardSage.Api.Data;
using FlashCardSage.Api.Mcp;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using ModelContextProtocol;

namespace FlashCardSage.Api.Tests.Mcp;

public class DeckToolsTests
{
    [Fact]
    public async Task CreateDeck_PutsTheCardsInIt_AndListDecksCountsThem()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"));
        await using var dbContext = TestDb.Create(databaseName);
        var tools = CreateTools(dbContext);

        var deck = await tools.CreateDeckAsync("Week 1", [ids[1], ids[0]]);
        await tools.CreateDeckAsync("Animals");

        Assert.Equal("Week 1", deck.Name);
        Assert.Equal(ids, deck.CardIds);
        Assert.Equal([("Animals", 0), ("Week 1", 2)], (await tools.ListDecksAsync()).Select(item => (item.Name, item.CardCount)));
        Assert.Equal(ids, (await tools.GetDeckAsync(deck.Id)).CardIds);
    }

    [Fact]
    public async Task CreateDeck_RefusesAnotherUsersOrAnUnknownCard()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"));
        var otherId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el perro", "the dog"), TestDb.OtherUserId);
        await using var dbContext = TestDb.Create(databaseName);
        var tools = CreateTools(dbContext);

        var other = await Assert.ThrowsAsync<McpException>(() => tools.CreateDeckAsync("Week 1", [ids[0], otherId]));
        var unknown = await Assert.ThrowsAsync<McpException>(() => tools.CreateDeckAsync("Week 1", [9999]));

        Assert.Equal("Some of those flash cards no longer exist.", other.Message);
        Assert.Equal("Some of those flash cards no longer exist.", unknown.Message);
        Assert.False(await dbContext.Decks.AnyAsync());
    }

    [Fact]
    public async Task CreateDeck_RefusesATakenName()
    {
        await using var dbContext = TestDb.Create();
        var tools = CreateTools(dbContext);
        await tools.CreateDeckAsync("Week 1");

        var error = await Assert.ThrowsAsync<McpException>(() => tools.CreateDeckAsync("WEEK 1"));

        Assert.Equal("There's already a deck with that name.", error.Message);
    }

    [Fact]
    public async Task AddAndRemoveCards_CanBeRepeated()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"));
        await using var dbContext = TestDb.Create(databaseName);
        var tools = CreateTools(dbContext);
        var deck = await tools.CreateDeckAsync("Week 1", [ids[0]]);

        await tools.AddCardsToDeckAsync(deck.Id, [ids[0], ids[1]]);
        var added = await tools.AddCardsToDeckAsync(deck.Id, [ids[1]]);
        await tools.RemoveCardsFromDeckAsync(deck.Id, [ids[0], 9999]);
        var removed = await tools.RemoveCardsFromDeckAsync(deck.Id, [ids[0]]);

        Assert.Equal(ids, added.CardIds);
        Assert.Equal([ids[1]], removed.CardIds);
    }

    [Fact]
    public async Task AddCards_RefusesAnotherUsersCard()
    {
        var databaseName = TestDb.NewDatabaseName();
        var otherId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el perro", "the dog"), TestDb.OtherUserId);
        await using var dbContext = TestDb.Create(databaseName);
        var tools = CreateTools(dbContext);
        var deck = await tools.CreateDeckAsync("Week 1");

        var error = await Assert.ThrowsAsync<McpException>(() => tools.AddCardsToDeckAsync(deck.Id, [otherId]));

        Assert.Equal("Some of those flash cards no longer exist.", error.Message);
        Assert.Empty((await tools.GetDeckAsync(deck.Id)).CardIds);
    }

    [Fact]
    public async Task RenameDeck_KeepsItsCards()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"));
        await using var dbContext = TestDb.Create(databaseName);
        var tools = CreateTools(dbContext);
        var deck = await tools.CreateDeckAsync("Week 1", [ids[0]]);

        var renamed = await tools.RenameDeckAsync(deck.Id, " Animals ");

        Assert.Equal("Animals", renamed.Name);
        Assert.Equal(ids, renamed.CardIds);
    }

    [Fact]
    public async Task DeleteDeck_KeepsItsCards()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"));
        await using var dbContext = TestDb.Create(databaseName);
        var tools = CreateTools(dbContext);
        var deck = await tools.CreateDeckAsync("Week 1", [ids[0]]);

        await tools.DeleteDeckAsync(deck.Id);

        Assert.Empty(await tools.ListDecksAsync());
        Assert.Equal(1, await dbContext.FlashCards.CountAsync());
        var error = await Assert.ThrowsAsync<McpException>(() => tools.DeleteDeckAsync(deck.Id));
        Assert.Equal(ToolErrors.DeckNotFound, error.Message);
    }

    [Fact]
    public async Task GetDeck_RefusesAnotherUsersDeck()
    {
        var databaseName = TestDb.NewDatabaseName();
        var otherDeck = new Deck { Name = "Theirs" };
        await TestDb.SeedAsOtherUserAsync(databaseName, dbContext => dbContext.Decks.Add(otherDeck));
        await using var dbContext = TestDb.Create(databaseName);
        var tools = CreateTools(dbContext);

        var error = await Assert.ThrowsAsync<McpException>(() => tools.GetDeckAsync(otherDeck.Id));

        Assert.Equal(ToolErrors.DeckNotFound, error.Message);
        Assert.Empty(await tools.ListDecksAsync());
    }

    private static DeckTools CreateTools(FlashCardDbContext dbContext)
    {
        return new DeckTools(new DeckService(dbContext, NullLogger<DeckService>.Instance));
    }
}
