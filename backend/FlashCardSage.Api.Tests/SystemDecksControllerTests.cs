using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.SystemDecks;
using FlashCardSage.Api.Translation;
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
            SystemDeckSeederTests.Card("lunes", "Monday", "Days"),
            new(["martes"], ["Tuesday", "Tues"], ["Days", "Week"]),
            SystemDeckSeederTests.Card("miércoles", "Wednesday", "Days")
        ]);

    private static readonly SystemDeckDefinition Months = new(
        "Months", [SystemDeckSeederTests.Card("enero", "January", "Months")]);

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
        // Sent like the user's own cards, with their words in order and their tags in name order.
        Assert.Equal(
            [
                ("lunes", "Monday", "Days"),
                ("martes", "Tuesday, Tues", "Days, Week"),
                ("miércoles", "Wednesday", "Days")
            ],
            decks[0].Cards.Select(card => (
                string.Join(", ", card.Spanish),
                string.Join(", ", card.English),
                string.Join(", ", card.Tags.Select(tag => tag.Name)))));
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
            .ThenInclude(card => card.Words)
            .Include(item => item.FlashCards)
            .ThenInclude(card => card.Tags)
            .SingleAsync();
        Assert.NotEqual(daysId, deck.Id);
        Assert.Equal(TestDb.UserId, deck.UserId);
        Assert.Equal(imported.Deck.FlashCardIds, deck.FlashCards.Select(card => card.Id).Order());
        Assert.All(deck.FlashCards, card => Assert.Equal(TestDb.UserId, card.UserId));
        Assert.All(await checkContext.FlashCardWords.ToListAsync(), word => Assert.Equal(TestDb.UserId, word.UserId));
        var tuesday = deck.FlashCards.Single(card => card.Spanish.Single() == "martes");
        Assert.Equal(["Tuesday", "Tues"], tuesday.English);
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

        var copy = (await UserCardsAsync(dbContext)).Single(card => card.Spanish.Single() == "lunes");
        copy.Words.Single(word => word.Language == Language.English).Text = "Mondays";
        dbContext.Decks.Remove(await dbContext.Decks.Include(deck => deck.FlashCards).SingleAsync(deck => deck.Id == imported.Deck.Id));
        await dbContext.SaveChangesAsync();

        var decks = Assert.IsAssignableFrom<IEnumerable<SystemDeckResponse>>(
            Assert.IsType<OkObjectResult>((await CreateController(dbContext).GetAll()).Result).Value).ToList();
        Assert.Equal(["Monday"], decks.Single(deck => deck.Name == "Days").Cards[0].English);
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
        var cards = await UserCardsAsync(checkContext);
        Assert.Equal(copy.Url, cards.Single(card => card.Spanish.Single() == "lunes").ImageUrl);
        Assert.All(cards.Where(card => card.Spanish.Single() != "lunes"), card => Assert.Null(card.ImageUrl));
        // The built-in card keeps its own.
        Assert.Equal(systemUrl, (await SystemCardAsync(checkContext, "lunes")).ImageUrl);
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
        Assert.Null((await UserCardsAsync(dbContext)).Single(card => card.Spanish.Single() == "lunes").ImageUrl);
    }

    [Fact]
    public async Task Import_LeavesThePictureOff_WhenItCannotBeCopied()
    {
        var databaseName = await SeedAsync();
        await GiveSystemCardAPictureAsync(databaseName, new FakeImageStore(), "lunes");
        var store = new FakeImageStore { CopyFailure = new InvalidOperationException("Storage is down.") };
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, store)
            .Import(await SystemDeckIdAsync(dbContext, "Days"), CancellationToken.None);

        var imported = Assert.IsType<SystemDeckImportResponse>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.Equal(3, imported.ImportedCount);
        Assert.Null((await UserCardsAsync(dbContext)).Single(card => card.Spanish.Single() == "lunes").ImageUrl);
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

    // Any one word the user has, in either language and whatever its case, leaves the card out: martes is a single
    // Spanish word with two English ones.
    [Theory]
    [InlineData("MARTES", "the moon")]
    [InlineData("el martes", "tues")]
    public async Task Import_SkipsCardsWithAWordTheUserHas(string spanish, string english)
    {
        var databaseName = await SeedAsync();
        await using var dbContext = TestDb.Create(databaseName);
        var own = new FlashCard { Words = TestDb.Words(spanish, english) };
        dbContext.FlashCards.Add(own);
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).Import(await SystemDeckIdAsync(dbContext, "Days"), CancellationToken.None);

        var imported = Assert.IsType<SystemDeckImportResponse>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.Equal((2, 1), (imported.ImportedCount, imported.SkippedCount));
        await using var checkContext = TestDb.Create(databaseName);
        var deck = await checkContext.Decks
            .Include(item => item.FlashCards)
            .ThenInclude(card => card.Words)
            .SingleAsync();
        Assert.Equal(["lunes", "miércoles"], deck.FlashCards.Select(card => card.Spanish.Single()).Order());
        // The user's own card is left as it is.
        var saved = (await UserCardsAsync(checkContext)).Single(card => card.Id == own.Id);
        Assert.Equal([spanish], saved.Spanish);
        Assert.Equal([english], saved.English);
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
            var other = new Deck { Name = "Theirs", FlashCards = [new FlashCard { Words = TestDb.Words("el gato", "the cat") }] };
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

    [Fact]
    public async Task ImportCard_MakesTheDeck_AndCopiesTheCardIntoIt()
    {
        var databaseName = await SeedAsync();
        var store = new FakeImageStore();
        var systemUrl = await GiveSystemCardAPictureAsync(databaseName, store, "martes");
        await using var dbContext = TestDb.Create(databaseName);
        var daysId = await SystemDeckIdAsync(dbContext, "Days");
        var martes = await SystemCardAsync(dbContext, "martes");

        var result = await CreateController(dbContext, store).ImportCard(daysId, martes.Id, CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        Assert.Equal((nameof(FlashCardsController.GetById), "FlashCards"), (created.ActionName, created.ControllerName));
        var imported = Assert.IsType<SystemDeckCardImportResponse>(created.Value);
        Assert.True(imported.DeckCreated);
        Assert.Equal("Days", imported.Deck.Name);
        Assert.Equal([imported.Card.Id], imported.Deck.FlashCardIds);
        Assert.Equal(imported.Card.Id, created.RouteValues?["id"]);
        Assert.Equal(["martes"], imported.Card.Spanish);
        Assert.Equal(["Tuesday", "Tues"], imported.Card.English);
        Assert.Equal(["Days", "Week"], imported.Card.Tags.Select(tag => tag.Name));

        await using var checkContext = TestDb.Create(databaseName);
        var deck = await checkContext.Decks.Include(item => item.FlashCards).SingleAsync();
        Assert.Equal(TestDb.UserId, deck.UserId);
        var card = Assert.Single(deck.FlashCards);
        Assert.NotEqual(martes.Id, card.Id);
        Assert.Equal(TestDb.UserId, card.UserId);
        // The card gets its own copy of the picture.
        var copy = Assert.Single(store.Saved, item => item.Url != systemUrl);
        Assert.Equal(copy.Url, card.ImageUrl);
    }

    [Fact]
    public async Task ImportCard_AddsTheCardToTheUsersDeckWithTheName()
    {
        var databaseName = await SeedAsync();
        await using var dbContext = TestDb.Create(databaseName);
        var daysId = await SystemDeckIdAsync(dbContext, "Days");
        var controller = CreateController(dbContext);
        Assert.IsType<CreatedAtActionResult>(
            (await controller.ImportCard(daysId, (await SystemCardAsync(dbContext, "lunes")).Id, CancellationToken.None)).Result);
        // Found whatever its case, as the database's index would.
        var deck = await dbContext.Decks.SingleAsync();
        deck.Name = "DAYS";
        await dbContext.SaveChangesAsync();

        var result = await controller.ImportCard(daysId, (await SystemCardAsync(dbContext, "martes")).Id, CancellationToken.None);

        var imported = Assert.IsType<SystemDeckCardImportResponse>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.False(imported.DeckCreated);
        Assert.Equal((deck.Id, "DAYS"), (imported.Deck.Id, imported.Deck.Name));
        Assert.Equal(2, imported.Deck.FlashCardIds.Count);
        await using var checkContext = TestDb.Create(databaseName);
        Assert.Equal(
            ["lunes", "martes"],
            (await checkContext.Decks.Include(item => item.FlashCards).ThenInclude(card => card.Words).SingleAsync())
                .FlashCards.Select(card => card.Spanish.Single()).Order());
    }

    [Fact]
    public async Task ImportCard_ReturnsConflict_WhenTheUserHasAWordOnIt()
    {
        var databaseName = await SeedAsync();
        await using var dbContext = TestDb.Create(databaseName);
        dbContext.FlashCards.Add(new FlashCard { Words = TestDb.Words("el martes", "TUES") });
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).ImportCard(
            await SystemDeckIdAsync(dbContext, "Days"), (await SystemCardAsync(dbContext, "martes")).Id, CancellationToken.None);

        var problem = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status409Conflict, problem.StatusCode);
        Assert.Equal(SystemDecksController.CardTakenMessage, Assert.IsType<ProblemDetails>(problem.Value).Detail);
        Assert.False(await dbContext.Decks.AnyAsync());
        Assert.Single(await dbContext.FlashCards.ToListAsync());
    }

    [Fact]
    public async Task ImportCard_RemovesTheCopiedPicture_WhenTheSaveFails()
    {
        var databaseName = await SeedAsync();
        var store = new FakeImageStore();
        var systemUrl = await GiveSystemCardAPictureAsync(databaseName, store, "lunes");
        await using var dbContext = TestDb.Create(databaseName, interceptors: new UniqueIndexInterceptor());

        var result = await CreateController(dbContext, store).ImportCard(
            await SystemDeckIdAsync(dbContext, "Days"), (await SystemCardAsync(dbContext, "lunes")).Id, CancellationToken.None);

        var problem = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status409Conflict, problem.StatusCode);
        Assert.Equal(SystemDecksController.CardImportClashMessage, Assert.IsType<ProblemDetails>(problem.Value).Detail);
        var copy = Assert.Single(store.Saved, item => item.Url != systemUrl);
        Assert.Equal([copy.Url], store.Deleted);
    }

    // The card has to be on that built-in deck, so another deck's card, a user's card or an unknown one isn't found.
    [Fact]
    public async Task ImportCard_ReturnsNotFound_ForACardNotOnTheDeck()
    {
        var databaseName = await SeedAsync();
        int otherCardId;
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            var other = new FlashCard { Words = TestDb.Words("el gato", "the cat") };
            otherContext.FlashCards.Add(other);
            await otherContext.SaveChangesAsync();
            otherCardId = other.Id;
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);
        var daysId = await SystemDeckIdAsync(dbContext, "Days");
        var enero = await SystemCardAsync(dbContext, "enero");
        var lunes = await SystemCardAsync(dbContext, "lunes");

        Assert.IsType<NotFoundResult>((await controller.ImportCard(daysId, enero.Id, CancellationToken.None)).Result);
        Assert.IsType<NotFoundResult>((await controller.ImportCard(daysId, otherCardId, CancellationToken.None)).Result);
        Assert.IsType<NotFoundResult>((await controller.ImportCard(daysId, 999, CancellationToken.None)).Result);
        Assert.IsType<NotFoundResult>((await controller.ImportCard(999, lunes.Id, CancellationToken.None)).Result);
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

    // The test user's cards with their words, which are matched in memory since they're lists.
    private static Task<List<FlashCard>> UserCardsAsync(FlashCardDbContext dbContext)
    {
        return dbContext.FlashCards.Include(card => card.Words).ToListAsync();
    }

    // The built-in card with this Spanish word.
    private static async Task<FlashCard> SystemCardAsync(FlashCardDbContext dbContext, string spanish)
    {
        var cards = await dbContext.FlashCards
            .IgnoreQueryFilters()
            .Include(card => card.Words)
            .Where(card => card.UserId != TestDb.UserId && card.UserId != TestDb.OtherUserId)
            .ToListAsync();
        return cards.Single(card => card.Spanish.Contains(spanish));
    }

    // Gives the built-in card a picture, saved in the store as an admin would have.
    private static async Task<string> GiveSystemCardAPictureAsync(string databaseName, FakeImageStore store, string spanish)
    {
        var url = await store.SaveAsync(CardImageTests.Png, "image/png", CancellationToken.None);
        await using var dbContext = TestDb.Create(databaseName);
        (await SystemCardAsync(dbContext, spanish)).ImageUrl = url;
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
            throw new DbUpdateException("Cannot insert duplicate key row in object 'dbo.FlashCardWords'.");
        }
    }
}
