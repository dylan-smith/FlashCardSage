using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

// The duplicate and clash paths, which FlashCardsControllerTests covers as responses.
public class FlashCardServiceTests
{
    [Fact]
    public async Task CreateAsync_ReturnsTheTakenSpanishWordFirst_IgnoringCase()
    {
        var databaseName = Guid.NewGuid().ToString();
        var catId = await SaveCardAsync(databaseName, "el gato", "the cat");
        await SaveCardAsync(databaseName, "el perro", "the dog");
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateService(dbContext).CreateAsync(
            new FlashCardRequest { Spanish = ["la casa", "EL GATO"], English = ["the dog"] });

        var duplicate = Assert.IsType<CardResult.Duplicate>(result);
        Assert.Equal((Language.Spanish, "el gato", catId), (duplicate.Word.Language, duplicate.Word.Text, duplicate.Word.FlashCardId));
        Assert.Equal(2, await dbContext.FlashCards.CountAsync());
    }

    [Fact]
    public async Task CreateAsync_ReturnsTheSavedCard_WhenARetriedInsertAlreadySavedIt()
    {
        var databaseName = Guid.NewGuid().ToString();
        var interceptor = new UniqueIndexInterceptor(() => SaveCardAsync(databaseName, "el gato", "the cat"));
        await using var dbContext = TestDb.Create(databaseName, TestDb.UserId, interceptor);

        var result = await CreateService(dbContext).CreateAsync(
            new FlashCardRequest { Spanish = ["El Gato"], English = ["the cat"] });

        var created = Assert.IsType<CardResult.Created>(result);
        Assert.Equal((await dbContext.FlashCards.SingleAsync()).Id, created.Card.Id);
        Assert.Equal(["el gato"], created.Card.Spanish);
    }

    [Fact]
    public async Task CreateAsync_ReturnsDuplicate_WhenAnotherCardTookAWordMeanwhile()
    {
        var databaseName = Guid.NewGuid().ToString();
        var interceptor = new UniqueIndexInterceptor(() => SaveCardAsync(databaseName, "el gato", "the kitty"));
        await using var dbContext = TestDb.Create(databaseName, TestDb.UserId, interceptor);

        var result = await CreateService(dbContext).CreateAsync(
            new FlashCardRequest { Spanish = ["el gato"], English = ["the cat"] });

        var duplicate = Assert.IsType<CardResult.Duplicate>(result);
        Assert.Equal((Language.Spanish, "el gato"), (duplicate.Word.Language, duplicate.Word.Text));
    }

    [Fact]
    public async Task CreateAsync_Rethrows_WhenTheSaveFailsWithNoClashingWord()
    {
        await using var dbContext = TestDb.Create(interceptors: new UniqueIndexInterceptor(() => Task.CompletedTask));

        await Assert.ThrowsAsync<DbUpdateException>(() => CreateService(dbContext).CreateAsync(
            new FlashCardRequest { Spanish = ["el gato"], English = ["the cat"] }));
    }

    // The card's own words aren't a clash, so it can be saved with them again.
    [Fact]
    public async Task UpdateAsync_KeepsTheCardsOwnWords_ButReturnsDuplicate_ForAnotherCardsWord()
    {
        var databaseName = Guid.NewGuid().ToString();
        var catId = await SaveCardAsync(databaseName, "el gato", "the cat");
        var dogId = await SaveCardAsync(databaseName, "el perro", "the dog");
        await using var dbContext = TestDb.Create(databaseName);
        var service = CreateService(dbContext);

        var updated = await service.UpdateAsync(catId, new FlashCardRequest { Spanish = ["El Gato"], English = ["the cat", "the kitty"] });
        var duplicate = await service.UpdateAsync(catId, new FlashCardRequest { Spanish = ["el gato"], English = ["THE DOG"] });

        Assert.Equal(["the cat", "the kitty"], Assert.IsType<CardResult.Updated>(updated).Card.English);
        Assert.Equal(dogId, Assert.IsType<CardResult.Duplicate>(duplicate).Word.FlashCardId);
    }

    [Fact]
    public async Task UpdateAsync_ReturnsDuplicate_WhenAnotherCardTookAWordMeanwhile()
    {
        var databaseName = Guid.NewGuid().ToString();
        var catId = await SaveCardAsync(databaseName, "el gato", "the cat");
        var interceptor = new UniqueIndexInterceptor(() => SaveCardAsync(databaseName, "el perro", "the dog"));
        await using var dbContext = TestDb.Create(databaseName, TestDb.UserId, interceptor);

        var result = await CreateService(dbContext).UpdateAsync(
            catId, new FlashCardRequest { Spanish = ["el gato"], English = ["the dog"] });

        var duplicate = Assert.IsType<CardResult.Duplicate>(result);
        Assert.Equal((Language.English, "the dog"), (duplicate.Word.Language, duplicate.Word.Text));
    }

    [Fact]
    public async Task UpdateAsync_ReturnsNotFound_BeforeCheckingTheRequest()
    {
        await using var dbContext = TestDb.Create();

        var result = await CreateService(dbContext).UpdateAsync(999, new FlashCardRequest());

        Assert.IsType<CardResult.NotFound>(result);
    }

    [Fact]
    public async Task CreateManyAsync_SkipsCardsWithTakenWords_IncludingEarlierOnesInTheList()
    {
        var databaseName = Guid.NewGuid().ToString();
        await SaveCardAsync(databaseName, "el gato", "the cat");
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateService(dbContext).CreateManyAsync(
        [
            new FlashCardRequest { Spanish = ["el perro"], English = ["the dog"] },
            new FlashCardRequest { Spanish = ["el gatito"], English = ["THE CAT"] },
            new FlashCardRequest { Spanish = ["EL PERRO"], English = ["the hound"] }
        ]);

        var created = Assert.IsType<CardResult.CreatedMany>(result);
        Assert.Equal(["el perro"], created.Cards.Select(card => card.Spanish.Single()));
        Assert.Equal(2, created.SkippedCount);
    }

    [Fact]
    public async Task CreateManyAsync_ReturnsClash_WhenACardIsSavedMeanwhile()
    {
        var databaseName = Guid.NewGuid().ToString();
        var interceptor = new UniqueIndexInterceptor(() => SaveCardAsync(databaseName, "el perro", "the dog"));
        await using var dbContext = TestDb.Create(databaseName, TestDb.UserId, interceptor);

        var result = await CreateService(dbContext).CreateManyAsync(
            [new FlashCardRequest { Spanish = ["el perro"], English = ["the dog"] }]);

        Assert.IsType<CardResult.Clash>(result);
    }

    [Fact]
    public async Task CreateManyAsync_ReturnsEveryCardsErrors_WithItsIndex()
    {
        await using var dbContext = TestDb.Create();

        var result = await CreateService(dbContext).CreateManyAsync(
        [
            new FlashCardRequest { Spanish = [" "], English = ["the dog"] },
            new FlashCardRequest { Spanish = ["la vaca"], English = [] }
        ]);

        Assert.Equal(
            [new("Cards[0].Spanish", "Spanish is required."), new("Cards[1].English", "English is required.")],
            Assert.IsType<CardResult.Invalid>(result).Errors);
        Assert.False(await dbContext.FlashCards.AnyAsync());
    }

    // Saves a card for the test user through a context of its own, as another request would.
    private static async Task<int> SaveCardAsync(string databaseName, string spanish, string english)
    {
        await using var dbContext = TestDb.Create(databaseName);
        var card = new FlashCard { Words = TestDb.Words(spanish, english) };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();
        return card.Id;
    }

    private static FlashCardService CreateService(FlashCardDbContext dbContext)
    {
        return new FlashCardService(dbContext, new FakeImageStore(), NullLogger<FlashCardService>.Instance);
    }

    // Fails the first save as a unique index would, after running saveFirst (e.g. another request saving a card in
    // the meantime). The in-memory database has no unique indexes of its own.
    private sealed class UniqueIndexInterceptor(Func<Task> saveFirst) : SaveChangesInterceptor
    {
        private bool failed;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (failed)
            {
                return result;
            }

            failed = true;
            await saveFirst();
            throw new DbUpdateException("Cannot insert duplicate key row in object 'dbo.FlashCardWords'.");
        }
    }
}
