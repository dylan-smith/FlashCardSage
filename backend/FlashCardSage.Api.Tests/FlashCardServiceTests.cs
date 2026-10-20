using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

// The duplicate and clash paths, which FlashCardsControllerTests covers as responses.
public class FlashCardServiceTests
{
    [Fact]
    public async Task CreateAsync_ReturnsTheTakenSpanishWordFirst_IgnoringCase()
    {
        var databaseName = TestDb.NewDatabaseName();
        var catId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"));
        await TestDb.SeedCardAsync(databaseName, TestDb.Card("el perro", "the dog"));
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
        var databaseName = TestDb.NewDatabaseName();
        var interceptor = new UniqueIndexInterceptor(() => TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat")));
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
        var databaseName = TestDb.NewDatabaseName();
        var interceptor = new UniqueIndexInterceptor(() => TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the kitty")));
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
        var databaseName = TestDb.NewDatabaseName();
        var catId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"));
        var dogId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el perro", "the dog"));
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
        var databaseName = TestDb.NewDatabaseName();
        var catId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"));
        var interceptor = new UniqueIndexInterceptor(() => TestDb.SeedCardAsync(databaseName, TestDb.Card("el perro", "the dog")));
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
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"));
        await using var dbContext = TestDb.Create(databaseName);

        FlashCardRequest[] requests =
        [
            new FlashCardRequest { Spanish = ["el perro"], English = ["the dog"] },
            new FlashCardRequest { Spanish = ["el gatito"], English = ["THE CAT"] },
            new FlashCardRequest { Spanish = ["EL PERRO"], English = ["the hound"] }
        ];

        var result = await CreateService(dbContext).CreateManyAsync(requests);

        var created = Assert.IsType<CardResult.CreatedMany>(result);
        Assert.Equal(["el perro"], created.Cards.Select(card => card.Spanish.Single()));
        Assert.Equal(2, created.SkippedCount);
        Assert.Equal([requests[1], requests[2]], created.Skipped);
    }

    [Fact]
    public async Task CreateManyAsync_ReturnsClash_WhenACardIsSavedMeanwhile()
    {
        var databaseName = TestDb.NewDatabaseName();
        var interceptor = new UniqueIndexInterceptor(() => TestDb.SeedCardAsync(databaseName, TestDb.Card("el perro", "the dog")));
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

    private static FlashCardService CreateService(FlashCardDbContext dbContext)
    {
        return new FlashCardService(dbContext, new FakeImageStore(), NullLogger<FlashCardService>.Instance);
    }
}
