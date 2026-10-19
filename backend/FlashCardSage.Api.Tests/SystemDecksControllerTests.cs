using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using FlashCardSage.Api.SystemDecks;
using FlashCardSage.Api.Tests.Fakes;
using FlashCardSage.Api.Tests.TestData;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class SystemDecksControllerTests
{
    private static readonly SystemDeckDefinition Days = new(
        "Days",
        [
            SystemDeckTestData.Card("lunes", "Monday", "Days"),
            new(["martes"], ["Tuesday", "Tues"], ["Days", "Week"]),
            SystemDeckTestData.Card("miércoles", "Wednesday", "Days")
        ]);

    private static readonly SystemDeckDefinition Months = new(
        "Months", [SystemDeckTestData.Card("enero", "January", "Months")]);

    [Fact]
    public async Task GetAll_ReturnsOnlyTheSystemDecks_WithTheirCardsAndTags()
    {
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days, Months);
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.Decks.Add(new Deck { Name = "Theirs" }));

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

    // A card is the user's when any of its words is on one of their cards, whatever its case, as importing judges it.
    // Another user's cards don't count.
    [Fact]
    public async Task GetAll_ListsTheCardsTheUserAlreadyHas()
    {
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days, Months);
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.FlashCards.Add(TestDb.Card("lunes", "Monday")));

        await using var dbContext = TestDb.Create(databaseName);
        dbContext.FlashCards.Add(TestDb.Card("el martes", "TUES"));
        await dbContext.SaveChangesAsync();
        var martes = await SystemDeckTestData.SystemCardAsync(dbContext, "martes");

        var result = await CreateController(dbContext).GetAll();

        var decks = Assert.IsAssignableFrom<IEnumerable<SystemDeckResponse>>(
            Assert.IsType<OkObjectResult>(result.Result).Value).ToList();
        Assert.Equal([martes.Id], decks.Single(deck => deck.Name == "Days").OwnedCardIds);
        Assert.Empty(decks.Single(deck => deck.Name == "Months").OwnedCardIds);
    }

    [Fact]
    public async Task Import_CopiesTheDeckCardsAndTagsIntoTheUsersOwn()
    {
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days, Months);
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
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days, Months);
        await using var dbContext = TestDb.Create(databaseName);
        var daysId = await SystemDeckIdAsync(dbContext, "Days");
        var imported = ActionResultAssert.Created<SystemDeckImportResponse>(
            (await CreateController(dbContext).Import(daysId, CancellationToken.None)).Result);

        var copy = (await UserCardsAsync(dbContext)).Single(card => card.Spanish.Single() == "lunes");
        copy.Words.Single(word => word.Language == Language.English).Text = "Mondays";
        dbContext.Decks.Remove(await dbContext.Decks.Include(deck => deck.FlashCards).SingleAsync(deck => deck.Id == imported.Deck.Id));
        await dbContext.SaveChangesAsync();

        var decks = Assert.IsAssignableFrom<IEnumerable<SystemDeckResponse>>(
            Assert.IsType<OkObjectResult>((await CreateController(dbContext).GetAll()).Result).Value).ToList();
        Assert.Equal(["Monday"], decks.Single(deck => deck.Name == "Days").Cards[0].English);
    }

    [Fact]
    public async Task Import_SharesTheBuiltInPicture_WhichDeletingTheCardLeaves()
    {
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days, Months);
        var store = new FakeImageStore();
        var systemUrl = await SystemDeckTestData.GiveSystemCardAPictureAsync(databaseName, store, "lunes");
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext)
            .Import(await SystemDeckIdAsync(dbContext, "Days"), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
        Assert.Single(store.Saved);
        await using var checkContext = TestDb.Create(databaseName);
        var cards = await UserCardsAsync(checkContext);
        var lunes = cards.Single(card => card.Spanish.Single() == "lunes");
        Assert.Equal(systemUrl, lunes.ImageUrl);
        Assert.All(cards.Where(card => card.Spanish.Single() != "lunes"), card => Assert.Null(card.ImageUrl));
        Assert.Equal(systemUrl, Assert.Single(checkContext.GeneratedImages).ImageUrl);

        var flashCards = new FlashCardsController(
            checkContext,
            new FlashCardService(checkContext, store, NullLogger<FlashCardService>.Instance),
            NullLogger<FlashCardsController>.Instance);
        Assert.IsType<NoContentResult>(await flashCards.Delete(lunes.Id));
        Assert.Empty(store.Deleted);
    }

    [Fact]
    public async Task Import_SavesNoCachedPictures_WhenTheSaveFails()
    {
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days, Months);
        await SystemDeckTestData.GiveSystemCardAPictureAsync(databaseName, new FakeImageStore(), "lunes");
        await using var dbContext = TestDb.Create(databaseName, interceptors: FailingSaveInterceptor.DuplicateKey("FlashCardWords"));
        var daysId = await SystemDeckIdAsync(dbContext, "Days");

        var result = await CreateController(dbContext).Import(daysId, CancellationToken.None);

        ActionResultAssert.Conflict(result.Result, SystemDecksController.ImportClashMessage);
        await using var checkContext = TestDb.Create(databaseName);
        Assert.False(await checkContext.GeneratedImages.AnyAsync());
    }

    // Any one word the user has, in either language and whatever its case, leaves the card out: martes is a single
    // Spanish word with two English ones.
    [Theory]
    [InlineData("MARTES", "the moon")]
    [InlineData("el martes", "tues")]
    public async Task Import_SkipsCardsWithAWordTheUserHas(string spanish, string english)
    {
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days, Months);
        await using var dbContext = TestDb.Create(databaseName);
        var own = await TestDb.AddCardAsync(dbContext, TestDb.Card(spanish, english));

        var result = await CreateController(dbContext).Import(await SystemDeckIdAsync(dbContext, "Days"), CancellationToken.None);

        var imported = ActionResultAssert.Created<SystemDeckImportResponse>(result.Result);
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
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days, Months);
        await using var dbContext = TestDb.Create(databaseName);
        var monthsId = await SystemDeckIdAsync(dbContext, "Months");
        Assert.IsType<CreatedAtActionResult>((await CreateController(dbContext).Import(monthsId, CancellationToken.None)).Result);

        var result = await CreateController(dbContext).Import(monthsId, CancellationToken.None);

        ActionResultAssert.Conflict(result.Result, SystemDecksController.NothingToImportMessage);
        Assert.Single(await dbContext.Decks.ToListAsync());
    }

    [Fact]
    public async Task Import_NumbersTheName_WhenTheUserHasADeckWithIt()
    {
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days, Months);
        await using var dbContext = TestDb.Create(databaseName);
        dbContext.Decks.AddRange(new Deck { Name = "DAYS" }, new Deck { Name = "Days (2)" });
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).Import(await SystemDeckIdAsync(dbContext, "Days"), CancellationToken.None);

        var imported = ActionResultAssert.Created<SystemDeckImportResponse>(result.Result);
        Assert.Equal("Days (3)", imported.Deck.Name);
    }

    [Fact]
    public async Task Import_ReturnsNotFound_ForAnUnknownOrAnotherUsersDeck()
    {
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days, Months);
        var other = new Deck { Name = "Theirs", FlashCards = [TestDb.Card("el gato", "the cat")] };
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.Decks.Add(other));

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        Assert.IsType<NotFoundResult>((await controller.Import(other.Id, CancellationToken.None)).Result);
        Assert.IsType<NotFoundResult>((await controller.Import(999, CancellationToken.None)).Result);
        Assert.False(await dbContext.Decks.AnyAsync());
        Assert.False(await dbContext.FlashCards.AnyAsync());
    }

    [Fact]
    public async Task ImportCard_MakesTheDeck_AndCopiesTheCardIntoIt()
    {
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days, Months);
        var systemUrl = await SystemDeckTestData.GiveSystemCardAPictureAsync(databaseName, new FakeImageStore(), "martes");
        await using var dbContext = TestDb.Create(databaseName);
        var daysId = await SystemDeckIdAsync(dbContext, "Days");
        var martes = await SystemDeckTestData.SystemCardAsync(dbContext, "martes");

        var result = await CreateController(dbContext).ImportCard(daysId, martes.Id, CancellationToken.None);

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
        // The card shares the built-in card's picture, which is cached under the card's words.
        Assert.Equal(systemUrl, card.ImageUrl);
        var cached = Assert.Single(checkContext.GeneratedImages);
        Assert.Equal(
            (systemUrl, CachedImageGenerator.PromptHash("martes", "Tuesday / Tues")),
            (cached.ImageUrl, cached.PromptHash));
    }

    [Fact]
    public async Task ImportCard_AddsTheCardToTheUsersDeckWithTheName()
    {
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days, Months);
        await using var dbContext = TestDb.Create(databaseName);
        var daysId = await SystemDeckIdAsync(dbContext, "Days");
        var controller = CreateController(dbContext);
        Assert.IsType<CreatedAtActionResult>(
            (await controller.ImportCard(
                daysId, (await SystemDeckTestData.SystemCardAsync(dbContext, "lunes")).Id, CancellationToken.None)).Result);
        // Found whatever its case, as the database's index would.
        var deck = await dbContext.Decks.SingleAsync();
        deck.Name = "DAYS";
        await dbContext.SaveChangesAsync();

        var result = await controller.ImportCard(
            daysId, (await SystemDeckTestData.SystemCardAsync(dbContext, "martes")).Id, CancellationToken.None);

        var imported = ActionResultAssert.Created<SystemDeckCardImportResponse>(result.Result);
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
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days, Months);
        await using var dbContext = TestDb.Create(databaseName);
        dbContext.FlashCards.Add(TestDb.Card("el martes", "TUES"));
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).ImportCard(
            await SystemDeckIdAsync(dbContext, "Days"),
            (await SystemDeckTestData.SystemCardAsync(dbContext, "martes")).Id,
            CancellationToken.None);

        ActionResultAssert.Conflict(result.Result, SystemDecksController.CardTakenMessage);
        Assert.False(await dbContext.Decks.AnyAsync());
        Assert.Single(await dbContext.FlashCards.ToListAsync());
    }

    [Fact]
    public async Task ImportCard_SavesNoCachedPicture_WhenTheSaveFails()
    {
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days, Months);
        await SystemDeckTestData.GiveSystemCardAPictureAsync(databaseName, new FakeImageStore(), "lunes");
        await using var dbContext = TestDb.Create(databaseName, interceptors: FailingSaveInterceptor.DuplicateKey("FlashCardWords"));

        var result = await CreateController(dbContext).ImportCard(
            await SystemDeckIdAsync(dbContext, "Days"),
            (await SystemDeckTestData.SystemCardAsync(dbContext, "lunes")).Id,
            CancellationToken.None);

        ActionResultAssert.Conflict(result.Result, SystemDecksController.CardImportClashMessage);
        await using var checkContext = TestDb.Create(databaseName);
        Assert.False(await checkContext.GeneratedImages.AnyAsync());
    }

    // The card has to be on that built-in deck, so another deck's card, a user's card or an unknown one isn't found.
    [Fact]
    public async Task ImportCard_ReturnsNotFound_ForACardNotOnTheDeck()
    {
        var databaseName = await SystemDeckTestData.CreateDatabaseWithDecksAsync(Days, Months);
        var other = TestDb.Card("el gato", "the cat");
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.FlashCards.Add(other));

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);
        var daysId = await SystemDeckIdAsync(dbContext, "Days");
        var enero = await SystemDeckTestData.SystemCardAsync(dbContext, "enero");
        var lunes = await SystemDeckTestData.SystemCardAsync(dbContext, "lunes");

        Assert.IsType<NotFoundResult>((await controller.ImportCard(daysId, enero.Id, CancellationToken.None)).Result);
        Assert.IsType<NotFoundResult>((await controller.ImportCard(daysId, other.Id, CancellationToken.None)).Result);
        Assert.IsType<NotFoundResult>((await controller.ImportCard(daysId, 999, CancellationToken.None)).Result);
        Assert.IsType<NotFoundResult>((await controller.ImportCard(999, lunes.Id, CancellationToken.None)).Result);
        Assert.False(await dbContext.Decks.AnyAsync());
        Assert.False(await dbContext.FlashCards.AnyAsync());
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

    private static SystemDecksController CreateController(FlashCardDbContext dbContext)
    {
        return new SystemDecksController(
            dbContext,
            new SystemDeckImporter(dbContext, NullLogger<SystemDeckImporter>.Instance),
            NullLogger<SystemDecksController>.Instance);
    }

}
