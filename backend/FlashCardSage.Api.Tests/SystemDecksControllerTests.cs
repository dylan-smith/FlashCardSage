using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.SystemDecks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
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
        Assert.Equal(
            [
                new SystemDeckCard("lunes", "Monday", ["Days"]),
                new SystemDeckCard("martes", "Tuesday", ["Days", "Week"]),
                new SystemDeckCard("miércoles", "Wednesday", ["Days"])
            ],
            decks[0].Cards,
            SystemDeckCardComparer.Instance);
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

        var result = await CreateController(dbContext).Import(daysId);

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
            Assert.IsType<CreatedAtActionResult>((await CreateController(dbContext).Import(daysId)).Result).Value);

        var copy = await dbContext.FlashCards.SingleAsync(card => card.Spanish == "lunes");
        copy.English = "Mondays";
        dbContext.Decks.Remove(await dbContext.Decks.Include(deck => deck.FlashCards).SingleAsync(deck => deck.Id == imported.Deck.Id));
        await dbContext.SaveChangesAsync();

        var decks = Assert.IsAssignableFrom<IEnumerable<SystemDeckResponse>>(
            Assert.IsType<OkObjectResult>((await CreateController(dbContext).GetAll()).Result).Value).ToList();
        Assert.Equal("Monday", decks.Single(deck => deck.Name == "Days").Cards[0].English);
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

        var result = await CreateController(dbContext).Import(await SystemDeckIdAsync(dbContext, "Days"));

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
        Assert.IsType<CreatedAtActionResult>((await CreateController(dbContext).Import(monthsId)).Result);

        var result = await CreateController(dbContext).Import(monthsId);

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

        var result = await CreateController(dbContext).Import(await SystemDeckIdAsync(dbContext, "Days"));

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

        Assert.IsType<NotFoundResult>((await controller.Import(otherId)).Result);
        Assert.IsType<NotFoundResult>((await controller.Import(999)).Result);
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

    private static SystemDecksController CreateController(FlashCardDbContext dbContext)
    {
        return new SystemDecksController(dbContext, NullLogger<SystemDecksController>.Instance);
    }

    // Records compare their lists by reference, so the cards are compared by value here.
    private sealed class SystemDeckCardComparer : IEqualityComparer<SystemDeckCard>
    {
        public static readonly SystemDeckCardComparer Instance = new();

        public bool Equals(SystemDeckCard? x, SystemDeckCard? y)
        {
            return x is not null && y is not null
                && (x.Spanish, x.English) == (y.Spanish, y.English)
                && x.Tags.SequenceEqual(y.Tags);
        }

        public int GetHashCode(SystemDeckCard obj)
        {
            return HashCode.Combine(obj.Spanish, obj.English);
        }
    }
}
