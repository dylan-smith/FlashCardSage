using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Mcp;
using FlashCardSage.Api.Services;
using FlashCardSage.Api.Tests.Fakes;
using FlashCardSage.Api.Tests.TestData;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using ModelContextProtocol;

namespace FlashCardSage.Api.Tests.Mcp;

public sealed class PictureToolsTests : IDisposable
{
    private const string PictureUrl = "https://pictures.example/cat.png";

    private readonly FakeImageStore store = new();

    // Answers every download with a PNG, and keeps the requests.
    private readonly StubPictureHandler handler = new(_ => StubPictureHandler.Picture(SampleImages.Png, "image/png"));

    private readonly HttpClient httpClient;

    public PictureToolsTests()
    {
        httpClient = new HttpClient(handler) { Timeout = RemotePictureFetcher.Timeout };
    }

    [Theory]
    [InlineData(PictureUrl, "iVBORw0KGgo=", PictureTools.OneSourceMessage)]
    [InlineData(null, null, PictureTools.NoSourceMessage)]
    [InlineData(" ", "", PictureTools.NoSourceMessage)]
    public async Task SetCardPicture_TakesExactlyOneOfAUrlAndData(string? url, string? data, string expected)
    {
        var databaseName = TestDb.NewDatabaseName();
        var cardId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"));
        await using var dbContext = TestDb.Create(databaseName);

        var error = await Assert.ThrowsAsync<McpException>(
            () => CreateTools(dbContext).SetCardPictureAsync(cardId, url, data, "image/png"));

        Assert.Equal(expected, error.Message);
        Assert.Empty(handler.Requests);
        Assert.Empty(store.Saved);
    }

    [Fact]
    public async Task SetCardPicture_FromData_PutsItOnTheCard()
    {
        var databaseName = TestDb.NewDatabaseName();
        var cardId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"));
        await using var dbContext = TestDb.Create(databaseName);

        var card = await CreateTools(dbContext).SetCardPictureAsync(
            cardId, data: Convert.ToBase64String(SampleImages.Png), contentType: " IMAGE/PNG ");

        var saved = Assert.Single(store.Saved);
        Assert.Equal((cardId, saved.Url), (card.Id, card.ImageUrl));
        Assert.Equal("image/png", saved.ContentType);
        Assert.Equal(SampleImages.Png, saved.Data);
        Assert.Equal(saved.Url, (await dbContext.FlashCards.AsNoTracking().SingleAsync()).ImageUrl);
    }

    [Theory]
    [InlineData("image/gif", "R0lGODlh", "The picture must be a JPEG, PNG or WebP.")]
    [InlineData(null, "iVBORw0KGgo=", "The picture must be a JPEG, PNG or WebP.")]
    [InlineData("image/png", "not base64!", "The picture isn't valid base64.")]
    public async Task SetCardPicture_FromBadData_SaysWhatsWrong(string? contentType, string data, string expected)
    {
        var databaseName = TestDb.NewDatabaseName();
        var cardId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"));
        await using var dbContext = TestDb.Create(databaseName);

        var error = await Assert.ThrowsAsync<McpException>(
            () => CreateTools(dbContext).SetCardPictureAsync(cardId, data: data, contentType: contentType));

        Assert.Equal(expected, error.Message);
        Assert.Empty(store.Saved);
    }

    [Fact]
    public async Task SetCardPicture_FromAUrl_DownloadsItOntoTheCard_ReplacingTheOldOne()
    {
        var databaseName = TestDb.NewDatabaseName();
        var oldUrl = FakeImageStore.BaseUrl + "old.png";
        var cardId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat", imageUrl: oldUrl));
        await using var dbContext = TestDb.Create(databaseName);

        var card = await CreateTools(dbContext).SetCardPictureAsync(cardId, url: $" {PictureUrl} ");

        Assert.Equal([new Uri(PictureUrl)], handler.Urls);
        var saved = Assert.Single(store.Saved);
        Assert.Equal(saved.Url, card.ImageUrl);
        Assert.Equal("image/png", saved.ContentType);
        Assert.Equal(SampleImages.Png, saved.Data);
        Assert.Equal([oldUrl], store.Deleted);
    }

    [Theory]
    [InlineData("http://127.0.0.1/x.png", "The picture URL must start with https://.")]
    [InlineData("https://169.254.169.254/latest/meta-data", "The picture URL must be on the public internet.")]
    [InlineData("cat.png", "The picture URL isn't a valid absolute URL.")]
    public async Task SetCardPicture_FromARefusedUrl_SaysWhy_AndLeavesTheCard(string url, string expected)
    {
        var databaseName = TestDb.NewDatabaseName();
        var cardId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"));
        await using var dbContext = TestDb.Create(databaseName);

        var error = await Assert.ThrowsAsync<McpException>(
            () => CreateTools(dbContext).SetCardPictureAsync(cardId, url: url));

        Assert.Equal(expected, error.Message);
        Assert.Empty(handler.Requests);
        Assert.Empty(store.Saved);
        Assert.Null((await dbContext.FlashCards.AsNoTracking().SingleAsync()).ImageUrl);
    }

    [Fact]
    public async Task SetCardPicture_RefusesAnotherUsersCard_WithoutDownloading()
    {
        var databaseName = TestDb.NewDatabaseName();
        var otherId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el perro", "the dog"), TestDb.OtherUserId);
        await using var dbContext = TestDb.Create(databaseName);
        var tools = CreateTools(dbContext);

        var fromUrl = await Assert.ThrowsAsync<McpException>(() => tools.SetCardPictureAsync(otherId, url: PictureUrl));
        var fromData = await Assert.ThrowsAsync<McpException>(() => tools.SetCardPictureAsync(
            otherId, data: Convert.ToBase64String(SampleImages.Png), contentType: "image/png"));

        Assert.Equal(ToolErrors.CardNotFound, fromUrl.Message);
        Assert.Equal(ToolErrors.CardNotFound, fromData.Message);
        Assert.Empty(handler.Requests);
        Assert.Empty(store.Saved);
    }

    [Fact]
    public async Task RemoveCardPicture_TakesItOff_AndAgainChangesNothing()
    {
        var databaseName = TestDb.NewDatabaseName();
        var url = FakeImageStore.BaseUrl + "cat.png";
        var cardId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat", imageUrl: url));
        await using var dbContext = TestDb.Create(databaseName);
        var tools = CreateTools(dbContext);

        var card = await tools.RemoveCardPictureAsync(cardId);
        var again = await tools.RemoveCardPictureAsync(cardId);

        Assert.Null(card.ImageUrl);
        Assert.Null(again.ImageUrl);
        Assert.Equal(["el gato"], again.Spanish);
        Assert.Equal([url], store.Deleted);
    }

    [Fact]
    public async Task RemoveCardPicture_RefusesAnotherUsersCard()
    {
        var databaseName = TestDb.NewDatabaseName();
        var url = FakeImageStore.BaseUrl + "dog.png";
        var otherId = await TestDb.SeedCardAsync(
            databaseName, TestDb.Card("el perro", "the dog", imageUrl: url), TestDb.OtherUserId);
        await using var dbContext = TestDb.Create(databaseName);

        var error = await Assert.ThrowsAsync<McpException>(() => CreateTools(dbContext).RemoveCardPictureAsync(otherId));

        Assert.Equal(ToolErrors.CardNotFound, error.Message);
        Assert.Empty(store.Deleted);
        await using var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId);
        Assert.Equal(url, (await otherContext.FlashCards.SingleAsync()).ImageUrl);
    }

    public void Dispose()
    {
        httpClient.Dispose();
        handler.Dispose();
    }

    private PictureTools CreateTools(FlashCardDbContext dbContext)
    {
        var fetcher = new RemotePictureFetcher(
            httpClient, new FakeHostAddressResolver(), NullLogger<RemotePictureFetcher>.Instance);
        return new PictureTools(
            dbContext, new CardPictureService(dbContext, store, NullLogger<CardPictureService>.Instance), fetcher);
    }
}
