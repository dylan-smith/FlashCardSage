using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using FlashCardSage.Api.SystemDecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

// The clash and taken-card paths, and the picture rollback, which SystemDecksControllerTests covers as responses.
public class SystemDeckImporterTests
{
    private static readonly SystemDeckDefinition Days = new(
        "Days",
        [
            SystemDeckSeederTests.Card("lunes", "Monday", "Days"),
            SystemDeckSeederTests.Card("martes", "Tuesday", "Days")
        ]);

    [Fact]
    public async Task ImportDeckAsync_ReturnsNothingToImport_WhenTheUserHasEveryCardsWords()
    {
        var databaseName = await SeedAsync();
        await using var dbContext = TestDb.Create(databaseName);
        dbContext.FlashCards.AddRange(
            new FlashCard { Words = TestDb.Words("LUNES", "the moon") },
            new FlashCard { Words = TestDb.Words("el martes", "tuesday") });
        await dbContext.SaveChangesAsync();
        var importer = CreateImporter(dbContext);

        var result = await importer.ImportDeckAsync(await DaysIdAsync(importer), CancellationToken.None);

        Assert.IsType<SystemDeckImportResult.NothingToImport>(result);
        Assert.False(await dbContext.Decks.AnyAsync());
    }

    [Fact]
    public async Task ImportDeckAsync_ReturnsClash_AndRemovesTheCopiedPictures_WhenAUniqueIndexFails()
    {
        var databaseName = await SeedAsync();
        var store = new FakeImageStore();
        var systemUrl = await GiveLunesAPictureAsync(databaseName, store);
        await using var dbContext = TestDb.Create(databaseName, interceptors: new FailingSaveInterceptor(
            () => new DbUpdateException("Cannot insert duplicate key row in object 'dbo.Decks'.")));
        var importer = CreateImporter(dbContext, store);

        var result = await importer.ImportDeckAsync(await DaysIdAsync(importer), CancellationToken.None);

        Assert.IsType<SystemDeckImportResult.Clash>(result);
        var copy = Assert.Single(store.Saved, item => item.Url != systemUrl);
        Assert.Equal([copy.Url], store.Deleted);
    }

    // Any other failure is rethrown, and the copies are removed all the same.
    [Fact]
    public async Task ImportDeckAsync_RemovesTheCopiedPictures_AndRethrows_WhenTheSaveFailsOtherwise()
    {
        var databaseName = await SeedAsync();
        var store = new FakeImageStore();
        var systemUrl = await GiveLunesAPictureAsync(databaseName, store);
        await using var dbContext = TestDb.Create(databaseName, interceptors: new FailingSaveInterceptor(
            () => new InvalidOperationException("The database is unreachable.")));
        var importer = CreateImporter(dbContext, store);
        var daysId = await DaysIdAsync(importer);

        await Assert.ThrowsAsync<InvalidOperationException>(() => importer.ImportDeckAsync(daysId, CancellationToken.None));

        var copy = Assert.Single(store.Saved, item => item.Url != systemUrl);
        Assert.Equal([copy.Url], store.Deleted);
    }

    [Fact]
    public async Task ImportCardAsync_ReturnsCardTaken_WhenTheUserHasOneOfItsWords()
    {
        var databaseName = await SeedAsync();
        await using var dbContext = TestDb.Create(databaseName);
        dbContext.FlashCards.Add(new FlashCard { Words = TestDb.Words("el lunes", "MONDAY") });
        await dbContext.SaveChangesAsync();
        var importer = CreateImporter(dbContext);
        var days = await importer.SystemDecks().SingleAsync(deck => deck.Name == "Days");
        var lunes = days.FlashCards.Single(card => card.Spanish.Single() == "lunes");

        var result = await importer.ImportCardAsync(days.Id, lunes.Id, CancellationToken.None);

        Assert.IsType<SystemDeckImportResult.CardTaken>(result);
        Assert.False(await dbContext.Decks.AnyAsync());
    }

    [Fact]
    public async Task ImportCardAsync_ReturnsClash_AndRemovesTheCopiedPicture_WhenAUniqueIndexFails()
    {
        var databaseName = await SeedAsync();
        var store = new FakeImageStore();
        var systemUrl = await GiveLunesAPictureAsync(databaseName, store);
        await using var dbContext = TestDb.Create(databaseName, interceptors: new FailingSaveInterceptor(
            () => new DbUpdateException("Cannot insert duplicate key row in object 'dbo.FlashCardWords'.")));
        var importer = CreateImporter(dbContext, store);
        var days = await importer.SystemDecks().SingleAsync(deck => deck.Name == "Days");
        var lunes = days.FlashCards.Single(card => card.Spanish.Single() == "lunes");

        var result = await importer.ImportCardAsync(days.Id, lunes.Id, CancellationToken.None);

        Assert.IsType<SystemDeckImportResult.Clash>(result);
        var copy = Assert.Single(store.Saved, item => item.Url != systemUrl);
        Assert.Equal([copy.Url], store.Deleted);
    }

    // The user's decks named like the built-in one, whatever their case, are skipped over.
    [Fact]
    public async Task UnusedDeckNameAsync_NumbersTheName_PastTheUsersDecks()
    {
        await using var dbContext = TestDb.Create();
        dbContext.Decks.AddRange(new Deck { Name = "days" }, new Deck { Name = "Days (2)" });
        await dbContext.SaveChangesAsync();

        var name = await CreateImporter(dbContext).UnusedDeckNameAsync("Days", CancellationToken.None);

        Assert.Equal("Days (3)", name);
    }

    [Fact]
    public async Task DeckNamedAsync_FindsTheUsersDeck_IgnoringCase()
    {
        await using var dbContext = TestDb.Create();
        var deck = new Deck { Name = "Days" };
        dbContext.Decks.Add(deck);
        await dbContext.SaveChangesAsync();
        var importer = CreateImporter(dbContext);

        Assert.Equal(deck.Id, (await importer.DeckNamedAsync("DAYS", CancellationToken.None))?.Id);
        Assert.Null(await importer.DeckNamedAsync("Months", CancellationToken.None));
    }

    private static async Task<string> SeedAsync()
    {
        var databaseName = await SystemDeckSeederTests.CreateDatabaseWithUsersAsync();
        await SystemDeckSeederTests.SeedAsync(databaseName, [Days]);
        return databaseName;
    }

    private static async Task<int> DaysIdAsync(SystemDeckImporter importer)
    {
        return (await importer.SystemDecks().SingleAsync(deck => deck.Name == "Days")).Id;
    }

    // Gives the built-in card for lunes a picture, saved in the store as an admin would have.
    private static async Task<string> GiveLunesAPictureAsync(string databaseName, FakeImageStore store)
    {
        var url = await store.SaveAsync(CardImageTests.Png, "image/png", CancellationToken.None);
        await using var dbContext = TestDb.Create(databaseName);
        var systemCards = await dbContext.FlashCards
            .IgnoreQueryFilters()
            .Include(card => card.Words)
            .Where(card => card.UserId != TestDb.UserId && card.UserId != TestDb.OtherUserId)
            .ToListAsync();
        systemCards.Single(card => card.Spanish.Contains("lunes")).ImageUrl = url;
        await dbContext.SaveChangesAsync();
        return url;
    }

    private static SystemDeckImporter CreateImporter(FlashCardDbContext dbContext, FakeImageStore? store = null)
    {
        return new SystemDeckImporter(dbContext, store ?? new FakeImageStore(), NullLogger<SystemDeckImporter>.Instance);
    }

    // Fails every save with the exception, such as the one a unique index would throw. The in-memory database has no
    // unique indexes of its own.
    private sealed class FailingSaveInterceptor(Func<Exception> failure) : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            throw failure();
        }
    }
}
