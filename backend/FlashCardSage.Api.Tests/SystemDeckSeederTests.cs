using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.SystemDecks;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Tests;

public class SystemDeckSeederTests
{
    private static readonly SystemDeckDefinition Days = new(
        "Days",
        [new("lunes", "Monday", ["Days"]), new("martes", "Tuesday", ["Days", "Week"])]);

    private static readonly SystemDeckDefinition Weekend = new(
        "Weekend",
        [new("sábado", "Saturday", ["Days"]), new("domingo", "Sunday", ["Days"]), new("lunes", "Monday", ["Days"])]);

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
            .ThenInclude(card => card.Tags)
            .OrderBy(deck => deck.Name)
            .ToListAsync();
        Assert.Equal(["Days", "Weekend"], decks.Select(deck => deck.Name));
        Assert.Equal(["lunes", "martes"], decks[0].FlashCards.Select(card => card.Spanish).Order());
        Assert.Equal(
            ["domingo", "lunes", "sábado"],
            decks[1].FlashCards.Select(card => card.Spanish).Order());
        // Monday is on both decks, as one card.
        Assert.Equal(4, await checkContext.FlashCards.CountAsync());
        Assert.Equal(["Days", "Week"], (await checkContext.Tags.Select(tag => tag.Name).ToListAsync()).Order());
        var tuesday = decks[0].FlashCards.Single(card => card.Spanish == "martes");
        Assert.Equal(["Days", "Week"], tuesday.Tags.Select(tag => tag.Name).Order());

        // None of it is the users' own.
        await using var userContext = TestDb.Create(databaseName);
        Assert.False(await userContext.Decks.AnyAsync());
        Assert.False(await userContext.FlashCards.AnyAsync());
        Assert.False(await userContext.Tags.AnyAsync());
    }

    [Fact]
    public async Task SeedAsync_OnlyAddsDecksTheSystemUserDoesNotHave()
    {
        var databaseName = await CreateDatabaseWithUsersAsync();
        var systemUserId = await SeedAsync(databaseName, [Days], expectedAdded: 1);

        // A changed deck that's already there is left as it is.
        SystemDeckDefinition changedDays = new("DAYS", [new("miércoles", "Wednesday", ["Days"])]);
        await SeedAsync(databaseName, [changedDays, Weekend], expectedAdded: 1);
        await SeedAsync(databaseName, [changedDays, Weekend], expectedAdded: 0);

        await using var checkContext = TestDb.Create(databaseName, systemUserId);
        Assert.Equal(["Days", "Weekend"], (await checkContext.Decks.Select(deck => deck.Name).ToListAsync()).Order());
        Assert.Equal(
            ["domingo", "lunes", "martes", "sábado"],
            (await checkContext.FlashCards.Select(card => card.Spanish).ToListAsync()).Order());
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

        // A card on two decks is the same card, so its words must match, and no two cards can share a side.
        var cards = decks.SelectMany(deck => deck.Cards)
            .DistinctBy(card => card.Spanish, StringComparer.OrdinalIgnoreCase)
            .ToList();
        Assert.Equal(cards.Count, cards.Select(card => card.English).Distinct(StringComparer.OrdinalIgnoreCase).Count());
        Assert.All(decks.SelectMany(deck => deck.Cards), card =>
        {
            Assert.InRange(card.Spanish.Length, 1, 200);
            Assert.InRange(card.English.Length, 1, 200);
            Assert.Equal(
                card.English,
                cards.Single(item => string.Equals(item.Spanish, card.Spanish, StringComparison.OrdinalIgnoreCase)).English);
            Assert.All(card.Tags, tag => Assert.InRange(tag.Length, 1, Tag.MaxNameLength));
        });
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
