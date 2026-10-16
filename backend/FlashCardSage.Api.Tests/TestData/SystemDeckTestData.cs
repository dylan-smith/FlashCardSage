using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.SystemDecks;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Tests.TestData;

// Built-in decks for the tests, seeded as the API seeds them when it starts.
internal static class SystemDeckTestData
{
    // A built-in card with one word in each language.
    public static SystemCardDefinition Card(string spanish, string english, params string[] tags)
    {
        return new SystemCardDefinition([spanish], [english], tags);
    }

    // A database where the test users' rows are already there, as they would be, so the system user gets an id of
    // its own.
    public static async Task<string> CreateDatabaseWithUsersAsync()
    {
        var databaseName = TestDb.NewDatabaseName();
        await using var dbContext = TestDb.Create(databaseName);
        dbContext.Users.AddRange(
            new User { Id = TestDb.UserId, Subject = "test:tester" },
            new User { Id = TestDb.OtherUserId, Subject = "test:other" });
        await dbContext.SaveChangesAsync();
        return databaseName;
    }

    // Seeds the decks, as the API does when it starts, and returns the system user's id.
    public static async Task<int> SeedAsync(
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

    // A database with the test users and these built-in decks, as SeedAsync seeds them.
    public static async Task<string> CreateDatabaseWithDecksAsync(params SystemDeckDefinition[] definitions)
    {
        var databaseName = await CreateDatabaseWithUsersAsync();
        await SeedAsync(databaseName, definitions);
        return databaseName;
    }

    // The built-in card with this Spanish word.
    public static async Task<FlashCard> SystemCardAsync(FlashCardDbContext dbContext, string spanish)
    {
        var cards = await dbContext.FlashCards
            .IgnoreQueryFilters()
            .Include(card => card.Words)
            .Where(card => card.UserId != TestDb.UserId && card.UserId != TestDb.OtherUserId)
            .ToListAsync();
        return cards.Single(card => card.Spanish.Contains(spanish));
    }

    // Gives the built-in card a picture, saved in the store as an admin would have, and returns its URL.
    public static async Task<string> GiveSystemCardAPictureAsync(string databaseName, FakeImageStore store, string spanish)
    {
        var url = await store.SaveAsync(SampleImages.Png, "image/png", CancellationToken.None);
        await using var dbContext = TestDb.Create(databaseName);
        (await SystemCardAsync(dbContext, spanish)).ImageUrl = url;
        await dbContext.SaveChangesAsync();
        return url;
    }
}
