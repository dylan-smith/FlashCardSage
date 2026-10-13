using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.SystemDecks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class SystemDecksControllerTests
{
    private static readonly SystemDeckDefinition Days = new(
        "Days",
        [
            new("lunes", "Monday", ["Days"]),
            new("martes", "Tuesday", ["Days", "Week"]),
            new("miércoles", "Wednesday", ["Days"])
        ]);

    private static readonly SystemDeckDefinition Months = new("Months", [new("enero", "January", ["Months"])]);

    [Fact]
    public async Task GetAll_ReturnsOnlyTheSystemDecks_WithTheirCardsAndTags()
    {
        var databaseName = await SeedAsync();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            otherContext.Decks.Add(new Deck { Name = "Theirs" });
            await otherContext.SaveChangesAsync();
        }

        await using var dbContext = TestDb.Create(databaseName);
        dbContext.Decks.Add(new Deck { Name = "Mine" });
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).GetAll();

        var decks = Assert.IsAssignableFrom<IEnumerable<SystemDeckResponse>>(
            Assert.IsType<OkObjectResult>(result.Result).Value).ToList();
        Assert.Equal(["Days", "Months"], decks.Select(deck => deck.Name));
        // Sent like the user's own cards, with their tags in name order.
        Assert.Equal(
            [
                ("lunes", "Monday", "Days"),
                ("martes", "Tuesday", "Days, Week"),
                ("miércoles", "Wednesday", "Days")
            ],
            decks[0].Cards.Select(card =>
                (card.Spanish, card.English, string.Join(", ", card.Tags.Select(tag => tag.Name)))));
    }

    [Fact]
    public async Task Import_CopiesTheDeckCardsAndTagsIntoTheUsersOwn()
    {
        var databaseName = await SeedAsync();
        await using var dbContext = TestDb.Create(databaseName);
        // The user's tag is used whatever its case.
        dbContext.Tags.Add(new Tag { Name = "days" });
        await dbContext.SaveChangesAsync();
        var daysId = await SystemDeckIdAsync(dbContext, "Days");

        var result = await CreateController(dbContext).Import(daysId, CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        Assert.Equal((nameof(DecksController.GetById), "Decks"), (created.ActionName, created.ControllerName));
        var imported = Assert.IsType<SystemDeckImportResponse>(created.Value);
        Assert.Equal((3, 0, "Days"), (imported.ImportedCount, imported.SkippedCount, imported.Deck.Name));
        Assert.Equal(imported.Deck.Id, created.RouteValues?["id"]);

        await using var checkContext = TestDb.Create(databaseName);
        var deck = await checkContext.Decks
            .Include(item => item.FlashCards)
            .ThenInclude(card => card.Tags)
            .SingleAsync();
        Assert.NotEqual(daysId, deck.Id);
        Assert.Equal(TestDb.UserId, deck.UserId);
        Assert.Equal(imported.Deck.FlashCardIds, deck.FlashCards.Select(card => card.Id).Order());
        Assert.All(deck.FlashCards, card => Assert.Equal(TestDb.UserId, card.UserId));
        var tuesday = deck.FlashCards.Single(card => card.Spanish == "martes");
        Assert.Equal(["days", "Week"], tuesday.Tags.Select(tag => tag.Name));
        Assert.Equal(["days", "Week"], (await checkContext.Tags.Select(tag => tag.Name).ToListAsync()).Order());
    }

    [Fact]
    public async Task Import_LeavesTheSystemDeckAsItIs_WhenTheCopyChanges()
    {
        var databaseName = await SeedAsync();
        await using var dbContext = TestDb.Create(databaseName);
        var daysId = await SystemDeckIdAsync(dbContext, "Days");
        var imported = Assert.IsType<SystemDeckImportResponse>(
            Assert.IsType<CreatedAtActionResult>((await CreateController(dbContext).Import(daysId, CancellationToken.None)).Result).Value);

        var copy = await dbContext.FlashCards.SingleAsync(card => card.Spanish == "lunes");
        copy.English = "Mondays";
        dbContext.Decks.Remove(await dbContext.Decks.Include(deck => deck.FlashCards).SingleAsync(deck => deck.Id == imported.Deck.Id));
        await dbContext.SaveChangesAsync();

        var decks = Assert.IsAssignableFrom<IEnumerable<SystemDeckResponse>>(
            Assert.IsType<OkObjectResult>((await CreateController(dbContext).GetAll()).Result).Value).ToList();
        Assert.Equal("Monday", decks.Single(deck => deck.Name == "Days").Cards[0].English);
    }

    [Fact]
    public async Task Import_GivesEachCardItsOwnCopyOfThePicture()
    {
        var databaseName = await SeedAsync();
        var store = new FakeImageStore();
        var systemUrl = await GiveSystemCardAPictureAsync(databaseName, store, "lunes");
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, store)
            .Import(await SystemDeckIdAsync(dbContext, "Days"), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
        var copy = Assert.Single(store.Saved, item => item.Url != systemUrl);
        Assert.Equal("image/png", copy.ContentType);
        Assert.Equal(CardImageTests.Png, copy.Data);
        await using var checkContext = TestDb.Create(databaseName);
        var cards = await checkContext.FlashCards.ToListAsync();
        Assert.Equal(copy.Url, cards.Single(card => card.Spanish == "lunes").ImageUrl);
        Assert.All(cards.Where(card => card.Spanish != "lunes"), card => Assert.Null(card.ImageUrl));
        // The built-in card keeps its own.
        var systemCard = await checkContext.FlashCards.IgnoreQueryFilters()
            .SingleAsync(card => card.Spanish == "lunes" && card.UserId != TestDb.UserId);
        Assert.Equal(systemUrl, systemCard.ImageUrl);
        Assert.Empty(store.Deleted);
    }

    [Fact]
    public async Task Import_LeavesThePictureOff_WhenItsGone()
    {
        var databaseName = await SeedAsync();
        var store = new FakeImageStore();
        var systemUrl = await GiveSystemCardAPictureAsync(databaseName, store, "lunes");
        await store.DeleteAsync(systemUrl, CancellationToken.None);
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, store)
            .Import(await SystemDeckIdAsync(dbContext, "Days"), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
        Assert.Null((await dbContext.FlashCards.SingleAsync(card => card.Spanish == "lunes")).ImageUrl);
    }

    [Fact]
    public async Task Import_LeavesThePictureOff_WhenItCannotBeCopied()
    {
        var databaseName = await SeedAsync();
        var seedStore = new FakeImageStore();
        await GiveSystemCardAPictureAsync(databaseName, seedStore, "lunes");
        var store = new FakeImageStore { CopyFailure = new InvalidOperationException("Storage is down.") };
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, store)
            .Import(await SystemDeckIdAsync(dbContext, "Days"), CancellationToken.None);

        var imported = Assert.IsType<SystemDeckImportResponse>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.Equal(3, imported.ImportedCount);
        Assert.Null((await dbContext.FlashCards.SingleAsync(card => card.Spanish == "lunes")).ImageUrl);
    }

    [Fact]
    public async Task Import_RemovesTheCopiedPictures_WhenTheSaveFails()
    {
        var databaseName = await SeedAsync();
        var store = new FakeImageStore();
        var systemUrl = await GiveSystemCardAPictureAsync(databaseName, store, "lunes");
        await using var dbContext = TestDb.Create(databaseName, interceptors: new UniqueIndexInterceptor());
        var daysId = await SystemDeckIdAsync(dbContext, "Days");

        var result = await CreateController(dbContext, store).Import(daysId, CancellationToken.None);

        var problem = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status409Conflict, problem.StatusCode);
        Assert.Equal(SystemDecksController.ImportClashMessage, Assert.IsType<ProblemDetails>(problem.Value).Detail);
        var copy = Assert.Single(store.Saved, item => item.Url != systemUrl);
        Assert.Equal([copy.Url], store.Deleted);
    }

    [Theory]
    [InlineData("LUNES", "the moon")]
    [InlineData("el lunes", "monday")]
    public async Task Import_SkipsCardsWhoseSpanishOrEnglishTheUserHas(string spanish, string english)
    {
        var databaseName = await SeedAsync();
        await using var dbContext = TestDb.Create(databaseName);
        var own = new FlashCard { Spanish = spanish, English = english };
        dbContext.FlashCards.Add(own);
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).Import(await SystemDeckIdAsync(dbContext, "Days"), CancellationToken.None);

        var imported = Assert.IsType<SystemDeckImportResponse>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.Equal((2, 1), (imported.ImportedCount, imported.SkippedCount));
        await using var checkContext = TestDb.Create(databaseName);
        var deck = await checkContext.Decks.Include(item => item.FlashCards).SingleAsync();
        Assert.Equal(["martes", "miércoles"], deck.FlashCards.Select(card => card.Spanish).Order());
        // The user's own card is left as it is.
        Assert.Equal(english, (await checkContext.FlashCards.SingleAsync(card => card.Id == own.Id)).English);
    }

    [Fact]
    public async Task Import_ReturnsConflict_WhenTheUserHasEveryCard()
    {
        var databaseName = await SeedAsync();
        await using var dbContext = TestDb.Create(databaseName);
        var monthsId = await SystemDeckIdAsync(dbContext, "Months");
        Assert.IsType<CreatedAtActionResult>((await CreateController(dbContext).Import(monthsId, CancellationToken.None)).Result);

        var result = await CreateController(dbContext).Import(monthsId, CancellationToken.None);

        var problem = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status409Conflict, problem.StatusCode);
        Assert.Equal(SystemDecksController.NothingToImportMessage, Assert.IsType<ProblemDetails>(problem.Value).Detail);
        Assert.Single(await dbContext.Decks.ToListAsync());
    }

    [Fact]
    public async Task Import_NumbersTheName_WhenTheUserHasADeckWithIt()
    {
        var databaseName = await SeedAsync();
        await using var dbContext = TestDb.Create(databaseName);
        dbContext.Decks.AddRange(new Deck { Name = "DAYS" }, new Deck { Name = "Days (2)" });
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).Import(await SystemDeckIdAsync(dbContext, "Days"), CancellationToken.None);

        var imported = Assert.IsType<SystemDeckImportResponse>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.Equal("Days (3)", imported.Deck.Name);
    }

    [Fact]
    public async Task Import_ReturnsNotFound_ForAnUnknownOrAnotherUsersDeck()
    {
        var databaseName = await SeedAsync();
        int otherId;
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            var other = new Deck { Name = "Theirs", FlashCards = [new FlashCard { Spanish = "el gato", English = "the cat" }] };
            otherContext.Decks.Add(other);
            await otherContext.SaveChangesAsync();
            otherId = other.Id;
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        Assert.IsType<NotFoundResult>((await controller.Import(otherId, CancellationToken.None)).Result);
        Assert.IsType<NotFoundResult>((await controller.Import(999, CancellationToken.None)).Result);
        Assert.False(await dbContext.Decks.AnyAsync());
        Assert.False(await dbContext.FlashCards.AnyAsync());
    }

    private static async Task<string> SeedAsync()
    {
        var databaseName = await SystemDeckSeederTests.CreateDatabaseWithUsersAsync();
        await SystemDeckSeederTests.SeedAsync(databaseName, [Days, Months]);
        return databaseName;
    }

    private static async Task<int> SystemDeckIdAsync(FlashCardDbContext dbContext, string name)
    {
        return await dbContext.Decks
            .IgnoreQueryFilters()
            .Where(deck => deck.Name == name && deck.UserId != TestDb.UserId && deck.UserId != TestDb.OtherUserId)
            .Select(deck => deck.Id)
            .SingleAsync();
    }

    // Gives the built-in card a picture, saved in the store as an admin would have.
    private static async Task<string> GiveSystemCardAPictureAsync(string databaseName, FakeImageStore store, string spanish)
    {
        var url = await store.SaveAsync(CardImageTests.Png, "image/png", CancellationToken.None);
        await using var dbContext = TestDb.Create(databaseName);
        var card = await dbContext.FlashCards.IgnoreQueryFilters()
            .SingleAsync(item => item.Spanish == spanish && item.UserId != TestDb.UserId);
        card.ImageUrl = url;
        await dbContext.SaveChangesAsync();
        return url;
    }

    private static SystemDecksController CreateController(FlashCardDbContext dbContext, FakeImageStore? store = null)
    {
        return new SystemDecksController(
            dbContext, store ?? new FakeImageStore(), NullLogger<SystemDecksController>.Instance);
    }

    // Fails the save as a unique index would. The in-memory database has no unique indexes of its own.
    private sealed class UniqueIndexInterceptor : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            throw new DbUpdateException("Cannot insert duplicate key row in object 'dbo.FlashCards'.");
        }
    }
}
