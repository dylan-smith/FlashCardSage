using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Tests.Fakes;
using FlashCardSage.Api.Translation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class CachedTranslatorTests
{
    private static readonly TranslationResult Chair = new("silla", ["cátedra", "presidente"]);

    [Fact]
    public async Task TranslateAsync_TranslatesAndKeepsATextItHasntSeen()
    {
        await using var dbContext = TestDb.Create();
        var translator = new FakeTranslator { Result = Chair };

        var result = await CreateCachedTranslator(translator, dbContext).TranslateAsync("chair", Language.English, CancellationToken.None);

        AssertChair(result);
        Assert.Equal([("chair", Language.English)], translator.Calls);
        var cached = Assert.Single(dbContext.Translations);
        Assert.Equal(("chair", Language.English, "silla"), (cached.Text, cached.FromLanguage, cached.Translation));
        Assert.Equal(["cátedra", "presidente"], cached.Alternatives);
        Assert.NotEqual(default, cached.CreatedAt);
    }

    [Fact]
    public async Task TranslateAsync_AnswersATextItHasSeen_WithoutTranslating()
    {
        var databaseName = TestDb.NewDatabaseName();
        await using (var dbContext = TestDb.Create(databaseName))
        {
            await CreateCachedTranslator(new FakeTranslator { Result = Chair }, dbContext)
                .TranslateAsync("chair", Language.English, CancellationToken.None);
        }
        await using var secondContext = TestDb.Create(databaseName);
        var translator = new FakeTranslator { Failure = new HttpRequestException("shouldn't be called") };

        var result = await CreateCachedTranslator(translator, secondContext).TranslateAsync("chair", Language.English, CancellationToken.None);

        AssertChair(result);
        Assert.Empty(translator.Calls);
    }

    [Fact]
    public async Task TranslateAsync_SharesTranslationsBetweenUsers()
    {
        var databaseName = TestDb.NewDatabaseName();
        await using (var dbContext = TestDb.Create(databaseName, TestDb.UserId))
        {
            await CreateCachedTranslator(new FakeTranslator { Result = Chair }, dbContext)
                .TranslateAsync("chair", Language.English, CancellationToken.None);
        }
        await using var otherUsersContext = TestDb.Create(databaseName, TestDb.OtherUserId);
        var translator = new FakeTranslator();

        var result = await CreateCachedTranslator(translator, otherUsersContext).TranslateAsync("chair", Language.English, CancellationToken.None);

        AssertChair(result);
        Assert.Empty(translator.Calls);
    }

    [Fact]
    public async Task TranslateAsync_KeepsEachLanguageApart()
    {
        await using var dbContext = TestDb.Create();
        var translator = new FakeTranslator { Result = new TranslationResult("solo", []) };
        var cachedTranslator = CreateCachedTranslator(translator, dbContext);
        await cachedTranslator.TranslateAsync("solo", Language.English, CancellationToken.None);

        await cachedTranslator.TranslateAsync("solo", Language.Spanish, CancellationToken.None);

        Assert.Equal([("solo", Language.English), ("solo", Language.Spanish)], translator.Calls);
        Assert.Equal(2, await dbContext.Translations.CountAsync());
    }

    [Fact]
    public async Task TranslateAsync_KeepsEachCaseApart()
    {
        await using var dbContext = TestDb.Create();
        var translator = new FakeTranslator { Result = new TranslationResult("gato", []) };
        var cachedTranslator = CreateCachedTranslator(translator, dbContext);
        await cachedTranslator.TranslateAsync("cat", Language.English, CancellationToken.None);

        await cachedTranslator.TranslateAsync("Cat", Language.English, CancellationToken.None);

        Assert.Equal([("cat", Language.English), ("Cat", Language.English)], translator.Calls);
        Assert.Equal(2, await dbContext.Translations.CountAsync());
    }

    [Fact]
    public async Task TranslateAsync_StillAnswers_WhenAnotherRequestCachedTheTextFirst()
    {
        await using var dbContext = TestDb.Create(interceptors: FailingSaveInterceptor.DuplicateKey("Translations"));
        var translator = new FakeTranslator { Result = Chair };

        var result = await CreateCachedTranslator(translator, dbContext).TranslateAsync("chair", Language.English, CancellationToken.None);

        AssertChair(result);
    }

    [Fact]
    public async Task TranslateAsync_KeepsNothing_WhenTranslationFails()
    {
        await using var dbContext = TestDb.Create();
        var translator = new FakeTranslator { Failure = new HttpRequestException("boom") };

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            CreateCachedTranslator(translator, dbContext).TranslateAsync("chair", Language.English, CancellationToken.None));

        Assert.Empty(dbContext.Translations);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task IsAvailable_IsTheTranslators(bool available)
    {
        await using var dbContext = TestDb.Create();

        Assert.Equal(available, CreateCachedTranslator(new FakeTranslator { IsAvailable = available }, dbContext).IsAvailable);
    }

    // A record compares its alternatives by reference, so the result is checked piecewise.
    private static void AssertChair(TranslationResult result)
    {
        Assert.Equal(Chair.Text, result.Text);
        Assert.Equal(Chair.Alternatives, result.Alternatives);
    }

    private static CachedTranslator CreateCachedTranslator(ITranslator translator, FlashCardDbContext dbContext)
    {
        return new CachedTranslator(translator, dbContext, NullLogger<CachedTranslator>.Instance);
    }
}
