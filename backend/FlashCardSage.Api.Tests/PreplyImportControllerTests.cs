using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class PreplyImportControllerTests
{
    [Fact]
    public async Task Import_MakesAPreplyDeckWithACardForEachWord()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext)
            .Import(Request(("  tostado ", "toasted"), ("avena", "oatmeal")), CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        Assert.Equal((nameof(DecksController.GetById), "Decks"), (created.ActionName, created.ControllerName));
        var imported = Assert.IsType<DeckImportResponse>(created.Value);
        Assert.Equal((2, 0, "Preply"), (imported.ImportedCount, imported.SkippedCount, imported.Deck.Name));
        Assert.Equal(imported.Deck.Id, created.RouteValues?["id"]);

        await using var checkContext = TestDb.Create(databaseName);
        var deck = await checkContext.Decks
            .Include(item => item.FlashCards)
            .ThenInclude(card => card.Words)
            .SingleAsync();
        Assert.Equal(TestDb.UserId, deck.UserId);
        Assert.Equal(
            [("avena", "oatmeal"), ("tostado", "toasted")],
            deck.FlashCards.Select(card => (card.Spanish.Single(), card.English.Single())).Order());
        Assert.All(await checkContext.FlashCardWords.ToListAsync(), word => Assert.Equal(TestDb.UserId, word.UserId));
    }

    // A word the user has, in either language and whatever its case, leaves the word out, and so does one that's
    // earlier in the same import. A word left out doesn't take its other half: "picante" is still added.
    [Fact]
    public async Task Import_SkipsWordsTheUserHasOrThatAreRepeated()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using var dbContext = TestDb.Create(databaseName);
        dbContext.FlashCards.Add(new FlashCard { Words = TestDb.Words("el pan", "bread") });
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).Import(
            Request(
                ("EL PAN", "the bread"),
                ("picante", "BREAD"),
                ("avena", "oatmeal"),
                ("Avena", "oats"),
                ("picante", "spicy")),
            CancellationToken.None);

        var imported = Assert.IsType<DeckImportResponse>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.Equal((2, 3), (imported.ImportedCount, imported.SkippedCount));
        await using var checkContext = TestDb.Create(databaseName);
        var deck = await checkContext.Decks.Include(item => item.FlashCards).ThenInclude(card => card.Words).SingleAsync();
        Assert.Equal(
            [("avena", "oatmeal"), ("picante", "spicy")],
            deck.FlashCards.Select(card => (card.Spanish.Single(), card.English.Single())).Order());
    }

    [Fact]
    public async Task Import_IgnoresAnotherUsersCards()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            otherContext.FlashCards.Add(new FlashCard { Words = TestDb.Words("avena", "oatmeal") });
            otherContext.Decks.Add(new Deck { Name = "Preply" });
            await otherContext.SaveChangesAsync();
        }

        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext).Import(Request(("avena", "oatmeal")), CancellationToken.None);

        var imported = Assert.IsType<DeckImportResponse>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.Equal((1, "Preply"), (imported.ImportedCount, imported.Deck.Name));
    }

    [Fact]
    public async Task Import_NumbersTheName_WhenTheUserHasAPreplyDeck()
    {
        await using var dbContext = TestDb.Create();
        dbContext.Decks.Add(new Deck { Name = "preply" });
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).Import(Request(("avena", "oatmeal")), CancellationToken.None);

        var imported = Assert.IsType<DeckImportResponse>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.Equal("Preply (2)", imported.Deck.Name);
    }

    [Fact]
    public async Task Import_ReturnsConflict_WhenTheUserHasEveryWord()
    {
        await using var dbContext = TestDb.Create();
        dbContext.FlashCards.Add(new FlashCard { Words = TestDb.Words("avena", "oatmeal") });
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).Import(Request(("Avena", "oats")), CancellationToken.None);

        var problem = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status409Conflict, problem.StatusCode);
        Assert.Equal(PreplyImportController.NothingToImportMessage, Assert.IsType<ProblemDetails>(problem.Value).Detail);
        Assert.Empty(await dbContext.Decks.ToListAsync());
    }

    [Fact]
    public async Task Import_ReturnsConflict_WhenTheSaveClashes()
    {
        await using var dbContext = TestDb.Create(interceptors: new UniqueIndexInterceptor());

        var result = await CreateController(dbContext).Import(Request(("avena", "oatmeal")), CancellationToken.None);

        var problem = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status409Conflict, problem.StatusCode);
        Assert.Equal(PreplyImportController.ImportClashMessage, Assert.IsType<ProblemDetails>(problem.Value).Detail);
    }

    public static TheoryData<string, string, int> InvalidWords => new()
    {
        { "avena", " ", 1 },
        { "", "oatmeal", 1 },
        { new string('a', FlashCard.MaxWordLength + 1), "oatmeal", 1 },
        { "avena", new string('a', FlashCard.MaxWordLength + 1), 1 },
        { "avena", "oatmeal", 0 },
        { "avena", "oatmeal", PreplyImportController.MaxWords + 1 }
    };

    [Theory]
    [MemberData(nameof(InvalidWords))]
    public async Task Import_ReturnsValidationProblem_ForBadWords(string spanish, string english, int count)
    {
        await using var dbContext = TestDb.Create();
        var request = new PreplyImportRequest
        {
            Words = [.. Enumerable.Range(0, count).Select(_ => new PreplyWord { Spanish = spanish, English = english })]
        };

        var result = await CreateController(dbContext).Import(request, CancellationToken.None);

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Contains(nameof(PreplyImportRequest.Words), problem.Errors.Keys);
        Assert.Empty(await dbContext.Decks.ToListAsync());
    }

    private static PreplyImportRequest Request(params (string Spanish, string English)[] words)
    {
        return new PreplyImportRequest
        {
            Words = [.. words.Select(word => new PreplyWord { Spanish = word.Spanish, English = word.English })]
        };
    }

    private static PreplyImportController CreateController(FlashCardDbContext dbContext)
    {
        return new PreplyImportController(dbContext, NullLogger<PreplyImportController>.Instance);
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
