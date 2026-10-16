using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using FlashCardSage.Api.SystemDecks;
using FlashCardSage.Api.Tests.Fakes;
using FlashCardSage.Api.Tests.TestData;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

// The clash and taken-card paths, and the picture rollback, which SystemDecksControllerTests covers as responses.
public class SystemDeckImporterTests
{
    private static readonly SystemDeckDefinition Days = new(
        "Days",
        [
            SystemDeckTestData.Card("lunes", "Monday", "Days"),
            SystemDeckTestData.Card("martes", "Tuesday", "Days")
        ]);

    [Fact]
    public async Task ImportDeckAsync_ReturnsNothingToImport_WhenTheUserHasEveryCardsWords()
    {
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days);
        await using var dbContext = TestDb.Create(databaseName);
        dbContext.FlashCards.AddRange(
            TestDb.Card("LUNES", "the moon"),
            TestDb.Card("el martes", "tuesday"));
        await dbContext.SaveChangesAsync();
        var importer = CreateImporter(dbContext);

        var result = await importer.ImportDeckAsync(await DaysIdAsync(importer), CancellationToken.None);

        Assert.IsType<SystemDeckImportResult.NothingToImport>(result);
        Assert.False(await dbContext.Decks.AnyAsync());
    }

    [Fact]
    public async Task ImportDeckAsync_ReturnsClash_AndRemovesTheCopiedPictures_WhenAUniqueIndexFails()
    {
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days);
        var store = new FakeImageStore();
        var systemUrl = await SystemDeckTestData.GiveSystemCardAPictureAsync(databaseName, store, "lunes");
        await using var dbContext = TestDb.Create(databaseName, interceptors: FailingSaveInterceptor.DuplicateKey("Decks"));
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
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days);
        var store = new FakeImageStore();
        var systemUrl = await SystemDeckTestData.GiveSystemCardAPictureAsync(databaseName, store, "lunes");
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
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days);
        await using var dbContext = TestDb.Create(databaseName);
        dbContext.FlashCards.Add(TestDb.Card("el lunes", "MONDAY"));
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
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days);
        var store = new FakeImageStore();
        var systemUrl = await SystemDeckTestData.GiveSystemCardAPictureAsync(databaseName, store, "lunes");
        await using var dbContext = TestDb.Create(databaseName, interceptors: FailingSaveInterceptor.DuplicateKey("FlashCardWords"));
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

    private static async Task<int> DaysIdAsync(SystemDeckImporter importer)
    {
        return (await importer.SystemDecks().SingleAsync(deck => deck.Name == "Days")).Id;
    }

    private static SystemDeckImporter CreateImporter(FlashCardDbContext dbContext, FakeImageStore? store = null)
    {
        return new SystemDeckImporter(dbContext, store ?? new FakeImageStore(), NullLogger<SystemDeckImporter>.Instance);
    }

}
