using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.SystemDecks;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Tests;

public class SystemDeckSeederTests
{
    private static readonly SystemDeckDefinition Days = new(
        "Days",
        [Card("lunes", "Monday", "Days"), new(["martes"], ["Tuesday", "Tues"], ["Days", "Week"])]);

    private static readonly SystemDeckDefinition Weekend = new(
        "Weekend",
        [Card("sábado", "Saturday", "Days"), Card("domingo", "Sunday", "Days"), Card("lunes", "Monday", "Days")]);

    [Fact]
    public async Task SeedAsync_AddsTheDecksForTheSystemUser_SharingCardsAndTags()
    {
        var databaseName = await CreateDatabaseWithUsersAsync();

        var systemUserId = await SeedAsync(databaseName, [Days, Weekend], expectedAdded: 2);

        await using var checkContext = TestDb.Create(databaseName, systemUserId);
        var system = await checkContext.Users.SingleAsync(user => user.Id == systemUserId);
        Assert.Equal(User.SystemSubject, system.Subject);
        var decks = await checkContext.Decks
            .Include(deck => deck.FlashCards)
            .ThenInclude(card => card.Words)
            .Include(deck => deck.FlashCards)
            .ThenInclude(card => card.Tags)
            .OrderBy(deck => deck.Name)
            .ToListAsync();
        Assert.Equal(["Days", "Weekend"], decks.Select(deck => deck.Name));
        Assert.Equal(["lunes", "martes"], decks[0].FlashCards.Select(card => card.Spanish.Single()).Order());
        Assert.Equal(
            ["domingo", "lunes", "sábado"],
            decks[1].FlashCards.Select(card => card.Spanish.Single()).Order());
        // Monday is on both decks, as one card.
        Assert.Equal(4, await checkContext.FlashCards.CountAsync());
        Assert.Equal(["Days", "Week"], (await checkContext.Tags.Select(tag => tag.Name).ToListAsync()).Order());
        var tuesday = decks[0].FlashCards.Single(card => card.Spanish.Single() == "martes");
        Assert.Equal(["Tuesday", "Tues"], tuesday.English);
        Assert.Equal(["Days", "Week"], tuesday.Tags.Select(tag => tag.Name).Order());
        Assert.All(await checkContext.FlashCardWords.ToListAsync(), word => Assert.Equal(systemUserId, word.UserId));

        // None of it is the users' own.
        await using var userContext = TestDb.Create(databaseName);
        Assert.False(await userContext.Decks.AnyAsync());
        Assert.False(await userContext.FlashCards.AnyAsync());
        Assert.False(await userContext.FlashCardWords.AnyAsync());
        Assert.False(await userContext.Tags.AnyAsync());
    }

    [Fact]
    public async Task SeedAsync_OnlyAddsDecksTheSystemUserDoesNotHave()
    {
        var databaseName = await CreateDatabaseWithUsersAsync();
        var systemUserId = await SeedAsync(databaseName, [Days], expectedAdded: 1);

        // A changed deck that's already there is left as it is.
        SystemDeckDefinition changedDays = new("DAYS", [Card("miércoles", "Wednesday", "Days")]);
        await SeedAsync(databaseName, [changedDays, Weekend], expectedAdded: 1);
        await SeedAsync(databaseName, [changedDays, Weekend], expectedAdded: 0);

        await using var checkContext = TestDb.Create(databaseName, systemUserId);
        Assert.Equal(["Days", "Weekend"], (await checkContext.Decks.Select(deck => deck.Name).ToListAsync()).Order());
        var cards = await checkContext.FlashCards.Include(card => card.Words).ToListAsync();
        Assert.Equal(["domingo", "lunes", "martes", "sábado"], cards.Select(card => card.Spanish.Single()).Order());
        Assert.Single(await checkContext.Users.Where(user => user.Subject == User.SystemSubject).ToListAsync());
    }

    [Fact]
    public void Load_ReadsTheBuiltInDecks_WhichFitTheDatabase()
    {
        var decks = SystemDeckDefinitions.Load();

        Assert.NotEmpty(decks);
        Assert.Equal(decks.Count, decks.Select(deck => deck.Name).Distinct(StringComparer.OrdinalIgnoreCase).Count());
        Assert.All(decks, deck =>
        {
            Assert.InRange(deck.Name.Length, 1, Deck.MaxNameLength);
            Assert.NotEmpty(deck.Cards);
        });

        Assert.All(decks.SelectMany(deck => deck.Cards), card =>
        {
            Assert.All<IReadOnlyList<string>>([card.Spanish, card.English], words =>
            {
                Assert.InRange(words.Count, 1, FlashCard.MaxWordsPerSide);
                Assert.All(words, word => Assert.InRange(word.Trim().Length, 1, FlashCard.MaxWordLength));
            });
            Assert.All(card.Tags, tag => Assert.InRange(tag.Length, 1, Tag.MaxNameLength));
        });

        // A card on two decks is the same card, found by its first Spanish word, so it must be written the same way
        // each time, and no word can be on two different cards.
        var cards = decks.SelectMany(deck => deck.Cards)
            .DistinctBy(card => card.Spanish[0], StringComparer.OrdinalIgnoreCase)
            .ToList();
        Assert.All(decks.SelectMany(deck => deck.Cards), card =>
        {
            var first = cards.Single(item => string.Equals(item.Spanish[0], card.Spanish[0], StringComparison.OrdinalIgnoreCase));
            Assert.Equal(first.Spanish, card.Spanish);
            Assert.Equal(first.English, card.English);
        });
        var spanish = cards.SelectMany(card => card.Spanish).ToList();
        var english = cards.SelectMany(card => card.English).ToList();
        Assert.Equal(spanish.Count, spanish.Distinct(StringComparer.OrdinalIgnoreCase).Count());
        Assert.Equal(english.Count, english.Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }

    // A built-in card with one word in each language.
    internal static SystemCardDefinition Card(string spanish, string english, params string[] tags)
    {
        return new SystemCardDefinition([spanish], [english], tags);
    }

    // A database where the test users' rows are already there, as they would be, so the system user gets an id of
    // its own.
    internal static async Task<string> CreateDatabaseWithUsersAsync()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using var dbContext = TestDb.Create(databaseName);
        dbContext.Users.AddRange(
            new User { Id = TestDb.UserId, Subject = "test:tester" },
            new User { Id = TestDb.OtherUserId, Subject = "test:other" });
        await dbContext.SaveChangesAsync();
        return databaseName;
    }

    // Seeds the decks, as the API does when it starts, and returns the system user's id.
    internal static async Task<int> SeedAsync(
        string databaseName, IReadOnlyList<SystemDeckDefinition> definitions, int? expectedAdded = null)
    {
        var currentUser = new CurrentUser();
        await using var dbContext = TestDb.Create(databaseName, currentUser);

        var added = await SystemDeckSeeder.SeedAsync(dbContext, currentUser, definitions, CancellationToken.None);

        if (expectedAdded is { } expected)
        {
            Assert.Equal(expected, added);
        }

        var systemUserId = Assert.IsType<int>(currentUser.UserId);
        Assert.DoesNotContain(systemUserId, new[] { TestDb.UserId, TestDb.OtherUserId });
        return systemUserId;
    }
}
