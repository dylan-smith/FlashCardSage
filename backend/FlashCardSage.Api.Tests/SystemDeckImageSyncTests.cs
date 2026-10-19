using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.SystemDecks;
using FlashCardSage.Api.Tests.Fakes;
using FlashCardSage.Api.Tests.TestData;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public sealed class SystemDeckImageSyncTests : IDisposable
{
    private static readonly SystemDeckDefinition Days = new(
        "Days",
        [
            SystemDeckTestData.Card("lunes", "Monday", "Days"),
            new(["martes", "el martes"], ["Tuesday"], ["Days"]),
            SystemDeckTestData.Card("miércoles", "Wednesday", "Days")
        ]);

    private readonly string directory = Path.Join(Path.GetTempPath(), $"FlashCardSage-{Guid.NewGuid():N}");

    public SystemDeckImageSyncTests()
    {
        Directory.CreateDirectory(directory);
    }

    public void Dispose()
    {
        Directory.Delete(directory, recursive: true);
    }

    [Fact]
    public async Task SyncAsync_GivesTheBuiltInCardsTheirPictures_AndLeavesUsersCardsAlone()
    {
        var databaseName = await SystemDeckTestData.CreateDatabaseWithUsersAsync();
        var systemUserId = await SystemDeckTestData.SeedAsync(databaseName, [Days]);
        await using (var userContext = TestDb.Create(databaseName))
        {
            userContext.FlashCards.Add(TestDb.Card("lunes", "Monday"));
            await userContext.SaveChangesAsync();
        }

        var store = new FakeImageStore();
        // Tuesday's picture is found by its second Spanish word, and Wednesday has none.
        var updated = await SyncAsync(databaseName, store, Image("lunes", SampleImages.Jpeg), Image("el martes", Jpeg2));

        Assert.Equal(2, updated);
        await using var checkContext = TestDb.Create(databaseName, systemUserId);
        var cards = await checkContext.FlashCards.Include(card => card.Words).ToListAsync();
        Assert.Equal(ExpectedUrl(SampleImages.Jpeg), cards.Single(card => card.Spanish[0] == "lunes").ImageUrl);
        Assert.Equal(ExpectedUrl(Jpeg2), cards.Single(card => card.Spanish[0] == "martes").ImageUrl);
        Assert.Null(cards.Single(card => card.Spanish[0] == "miércoles").ImageUrl);
        Assert.Equal(SampleImages.Jpeg, store.Saved.Single(item => item.Url == ExpectedUrl(SampleImages.Jpeg)).Data);
        Assert.Empty(store.Deleted);

        await using var userCheckContext = TestDb.Create(databaseName);
        Assert.Null((await userCheckContext.FlashCards.SingleAsync()).ImageUrl);
    }

    [Fact]
    public async Task SyncAsync_LeavesACardWithItsPictureAlone_AndReplacesAChangedOne()
    {
        var databaseName = await SystemDeckTestData.CreateDatabaseWithUsersAsync();
        var systemUserId = await SystemDeckTestData.SeedAsync(databaseName, [Days]);
        var store = new FakeImageStore();
        await SyncAsync(databaseName, store, Image("lunes", SampleImages.Jpeg), Image("martes", Jpeg2));

        Assert.Equal(0, await SyncAsync(databaseName, store, Image("lunes", SampleImages.Jpeg), Image("martes", Jpeg2)));
        Assert.Equal(2, store.Saved.Count);

        // Monday's picture was made again.
        Assert.Equal(1, await SyncAsync(databaseName, store, Image("lunes", Jpeg3), Image("martes", Jpeg2)));

        await using var checkContext = TestDb.Create(databaseName, systemUserId);
        var monday = (await checkContext.FlashCards.Include(card => card.Words).ToListAsync())
            .Single(card => card.Spanish[0] == "lunes");
        Assert.Equal(ExpectedUrl(Jpeg3), monday.ImageUrl);
        // The old picture is cached, like every built-in one, so users' cards that share it keep it.
        Assert.Empty(store.Deleted);
    }

    [Fact]
    public async Task SyncAsync_CachesEveryBuiltInPicture_OnceEach()
    {
        var databaseName = await SystemDeckTestData.CreateDatabaseWithUsersAsync();
        await SystemDeckTestData.SeedAsync(databaseName, [Days]);
        var store = new FakeImageStore();
        await SyncAsync(databaseName, store, Image("lunes", SampleImages.Jpeg));
        await using (var dbContext = TestDb.Create(databaseName))
        {
            // As if Monday's picture was synced before there was a cache.
            dbContext.GeneratedImages.RemoveRange(dbContext.GeneratedImages);
            await dbContext.SaveChangesAsync();
        }

        // Monday's is unchanged, and Tuesday's is new.
        Assert.Equal(1, await SyncAsync(databaseName, store, Image("lunes", SampleImages.Jpeg), Image("martes", Jpeg2)));
        await SyncAsync(databaseName, store, Image("lunes", SampleImages.Jpeg), Image("martes", Jpeg2));

        await using var checkContext = TestDb.Create(databaseName);
        var cached = await checkContext.GeneratedImages.OrderBy(item => item.Id).ToListAsync();
        Assert.Equal(
            [
                (ExpectedUrl(SampleImages.Jpeg), CachedImageGenerator.PromptHash("lunes", "Monday")),
                (ExpectedUrl(Jpeg2), CachedImageGenerator.PromptHash("martes / el martes", "Tuesday"))
            ],
            cached.Select(item => (item.ImageUrl, item.PromptHash)));
    }

    [Fact]
    public async Task SyncAsync_DoesNothing_WithoutPictures()
    {
        var databaseName = await SystemDeckTestData.CreateDatabaseWithUsersAsync();
        await SystemDeckTestData.SeedAsync(databaseName, [Days]);
        var store = new FakeImageStore();

        Assert.Equal(0, await SyncAsync(databaseName, store));
        Assert.Empty(store.Saved);
    }

    [Fact]
    public async Task Load_ReadsThePicturesWithAFile_FromImagesJson()
    {
        Assert.Empty(SystemDeckImages.Load(directory));

        await File.WriteAllTextAsync(Path.Join(directory, "images.json"), """
            {
              "lunes": { "scene": "Someone waking up.", "file": "lunes.jpg" },
              "el martes": { "scene": "Someone jogging.", "file": "el-martes.jpg", "hasText": true },
              "miércoles": { "scene": "Something refused.", "skipped": "contentFilter" }
            }
            """);

        var images = SystemDeckImages.Load(directory);

        Assert.Equal(
            [new SystemCardImage("lunes", Path.Join(directory, "lunes.jpg")), new("el martes", Path.Join(directory, "el-martes.jpg"))],
            images.OrderByDescending(image => image.Spanish, StringComparer.Ordinal));
    }

    [Fact]
    public void BuiltInPictures_AreForBuiltInCards_AndFitOnACard()
    {
        var firstWords = SystemDeckDefinitions.Load()
            .SelectMany(deck => deck.Cards)
            .Select(card => card.Spanish[0])
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        Assert.All(SystemDeckImages.Load(SystemDeckImages.Directory), image =>
        {
            Assert.Contains(image.Spanish, firstWords);
            var data = File.ReadAllBytes(image.Path);
            Assert.True(
                CardImage.TryDecode(CardImage.ContentTypeOf(image.Path), Convert.ToBase64String(data), out _, out _, out var error),
                $"{image.Path}: {error}");
        });
    }

    private static readonly byte[] Jpeg2 = [.. SampleImages.Jpeg, 0x02];

    private static readonly byte[] Jpeg3 = [.. SampleImages.Jpeg, 0x03];

    private static string ExpectedUrl(byte[] data)
    {
        return FakeImageStore.BaseUrl + CardImage.ContentName(data, "image/jpeg");
    }

    // A picture for the card, as a file like the ones the script makes.
    private SystemCardImage Image(string spanish, byte[] data)
    {
        var path = Path.Join(directory, $"{Guid.NewGuid():N}.jpg");
        File.WriteAllBytes(path, data);
        return new SystemCardImage(spanish, path);
    }

    private static async Task<int> SyncAsync(string databaseName, FakeImageStore store, params SystemCardImage[] images)
    {
        var currentUser = new CurrentUser();
        await using var dbContext = TestDb.Create(databaseName, currentUser);
        return await SystemDeckImageSync.SyncAsync(
            dbContext, currentUser, store, images, NullLogger.Instance, CancellationToken.None);
    }
}
