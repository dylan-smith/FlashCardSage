using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Tests.Fakes;
using FlashCardSage.Api.Tests.TestData;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class CachedImageGeneratorTests
{
    private static readonly GeneratedImage Other = new("image/png", SampleImages.Png);

    [Fact]
    public async Task GenerateAsync_MakesAndKeepsAPicture()
    {
        await using var dbContext = TestDb.Create();
        var store = new FakeImageStore();
        var generator = new FakeImageGenerator();

        var result = await Create(dbContext, generator, store).GenerateAsync("el gato", "the cat", CancellationToken.None);

        Assert.Equal(SampleImages.Jpeg, result.Image.Data.ToArray());
        Assert.Equal([("el gato", "the cat")], generator.Calls);
        var cached = Assert.Single(dbContext.GeneratedImages);
        Assert.Equal(result.Id, cached.Id);
        Assert.Equal(CachedImageGenerator.PromptHash("el gato", "the cat"), cached.PromptHash);
        Assert.Equal(Assert.Single(store.Saved).Url, cached.ImageUrl);
        Assert.Matches(@"/[0-9a-f]{32}\.jpg$", cached.ImageUrl);
        Assert.NotEqual(default, cached.CreatedAt);
    }

    [Fact]
    public async Task FindAsync_ReturnsNothing_WhenNoPictureIsKept()
    {
        await using var dbContext = TestDb.Create();

        Assert.Null(await Create(dbContext).FindAsync("el gato", "the cat", null, CancellationToken.None));
    }

    [Fact]
    public async Task FindAsync_ReturnsEachKeptPictureInTurn_ForEveryUser()
    {
        var databaseName = TestDb.NewDatabaseName();
        var store = new FakeImageStore();
        CachedGeneratedImage first, second;
        await using (var dbContext = TestDb.Create(databaseName, TestDb.UserId))
        {
            var generator = new FakeImageGenerator();
            var cachedGenerator = Create(dbContext, generator, store);
            first = await cachedGenerator.GenerateAsync("el gato", "the cat", CancellationToken.None);
            generator.Result = Other;
            second = await cachedGenerator.GenerateAsync("el gato", "the cat", CancellationToken.None);
        }
        await using var otherUsersContext = TestDb.Create(databaseName, TestDb.OtherUserId);
        var otherUsers = Create(otherUsersContext, store: store);

        var found = await otherUsers.FindAsync("el gato", "the cat", null, CancellationToken.None);
        var next = await otherUsers.FindAsync("el gato", "the cat", found!.Id, CancellationToken.None);
        var none = await otherUsers.FindAsync("el gato", "the cat", next!.Id, CancellationToken.None);

        Assert.Equal((first.Id, "image/jpeg"), (found.Id, found.Image.ContentType));
        Assert.Equal(SampleImages.Jpeg, found.Image.Data.ToArray());
        Assert.Equal((second.Id, "image/png"), (next.Id, next.Image.ContentType));
        Assert.Equal(SampleImages.Png, next.Image.Data.ToArray());
        Assert.Null(none);
    }

    [Fact]
    public async Task FindAsync_KeepsEachPromptsPicturesApart()
    {
        await using var dbContext = TestDb.Create();
        var cachedGenerator = Create(dbContext);
        await cachedGenerator.GenerateAsync("el gato", "the cat", CancellationToken.None);

        Assert.Null(await cachedGenerator.FindAsync("el perro", "the dog", null, CancellationToken.None));
        Assert.Null(await cachedGenerator.FindAsync("el gato", "", null, CancellationToken.None));
    }

    [Theory]
    [InlineData("el gato", "The Cat")]
    [InlineData("gato", "the cat")]
    [InlineData("", "the cat")]
    public async Task FindAsync_SharesPictures_BetweenWordsThatMakeTheSamePrompt(string spanish, string english)
    {
        await using var dbContext = TestDb.Create();
        var cachedGenerator = Create(dbContext);
        var kept = await cachedGenerator.GenerateAsync("el gato", "the cat", CancellationToken.None);

        var found = await cachedGenerator.FindAsync(spanish, english, null, CancellationToken.None);

        Assert.Equal(kept.Id, found?.Id);
    }

    [Fact]
    public async Task FindAsync_PassesOverAPictureWhoseFileIsGone()
    {
        await using var dbContext = TestDb.Create();
        var store = new FakeImageStore();
        var generator = new FakeImageGenerator();
        var cachedGenerator = Create(dbContext, generator, store);
        var gone = await cachedGenerator.GenerateAsync("el gato", "the cat", CancellationToken.None);
        generator.Result = Other;
        var kept = await cachedGenerator.GenerateAsync("el gato", "the cat", CancellationToken.None);
        await store.DeleteAsync(store.Saved[0].Url, CancellationToken.None);

        var found = await cachedGenerator.FindAsync("el gato", "the cat", null, CancellationToken.None);

        Assert.NotEqual(gone.Id, kept.Id);
        Assert.Equal(kept.Id, found?.Id);
    }

    [Fact]
    public async Task GenerateAsync_KeepsNothing_WhenGeneratingFails()
    {
        await using var dbContext = TestDb.Create();
        var store = new FakeImageStore();
        var generator = new FakeImageGenerator { Failure = new HttpRequestException("boom") };

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            Create(dbContext, generator, store).GenerateAsync("el gato", "the cat", CancellationToken.None));

        Assert.Empty(store.Saved);
        Assert.Equal(0, await dbContext.GeneratedImages.CountAsync());
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task IsAvailable_IsTheGenerators(bool available)
    {
        await using var dbContext = TestDb.Create();

        Assert.Equal(available, Create(dbContext, new FakeImageGenerator { IsAvailable = available }).IsAvailable);
    }

    private static CachedImageGenerator Create(
        FlashCardDbContext dbContext, FakeImageGenerator? generator = null, FakeImageStore? store = null)
    {
        return new CachedImageGenerator(
            generator ?? new FakeImageGenerator(),
            store ?? new FakeImageStore(),
            dbContext,
            NullLogger<CachedImageGenerator>.Instance);
    }
}
