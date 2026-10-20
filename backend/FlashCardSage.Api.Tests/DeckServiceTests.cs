using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

// The reads, which DecksControllerTests covers as responses along with the changes.
public class DeckServiceTests
{
    [Fact]
    public async Task GetAllAsync_ReturnsTheUsersDecksByName_WithTheirCards_WithoutAnotherUsers()
    {
        var databaseName = TestDb.NewDatabaseName();
        var dog = TestDb.Card("el perro", "the dog");
        await using (var setupContext = TestDb.Create(databaseName))
        {
            setupContext.Decks.Add(new Deck { Name = "Verbs" });
            setupContext.Decks.Add(new Deck { Name = "Animals", FlashCards = [dog] });
            await setupContext.SaveChangesAsync();
        }

        await TestDb.SeedAsOtherUserAsync(databaseName, other => other.Decks.Add(new Deck { Name = "Food" }));
        await using var dbContext = TestDb.Create(databaseName);

        var decks = await CreateService(dbContext).GetAllAsync();

        Assert.Equal(["Animals", "Verbs"], decks.Select(deck => deck.Name));
        Assert.Equal(dog.Id, decks[0].FlashCards.Single().Id);
    }

    [Fact]
    public async Task GetAsync_ReturnsNull_ForAnotherUsersDeck()
    {
        var databaseName = TestDb.NewDatabaseName();
        var theirs = new Deck { Name = "Theirs" };
        await TestDb.SeedAsOtherUserAsync(databaseName, other => other.Decks.Add(theirs));
        await using var dbContext = TestDb.Create(databaseName);

        Assert.Null(await CreateService(dbContext).GetAsync(theirs.Id));
    }

    private static DeckService CreateService(FlashCardDbContext dbContext)
    {
        return new DeckService(dbContext, NullLogger<DeckService>.Instance);
    }
}
