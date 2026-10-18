using System.Net;
using System.Net.Http.Json;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Tests.Fakes;
using FlashCardSage.Api.Tests.TestData;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public sealed class FlashCardImagesControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>, IDisposable
{
    private static readonly string Png = Convert.ToBase64String(SampleImages.Png);

    // Where the app-level tests' pictures go, instead of the API project's App_Data.
    private readonly string pictures = Path.Join(Path.GetTempPath(), $"FlashCardSage-{Guid.NewGuid():N}");

    // The picture settings: none to make them, and on disk, in the test's own folder.
    private Dictionary<string, string> Settings => new()
    {
        ["ImageGeneration:Endpoint"] = "",
        ["ImageGeneration:Key"] = "",
        ["ImageStore:StorageConnectionString"] = "",
        ["ImageStore:LocalPath"] = pictures
    };

    public void Dispose()
    {
        if (Directory.Exists(pictures))
        {
            Directory.Delete(pictures, recursive: true);
        }
    }

    [Fact]
    public async Task Generate_ReturnsThePictureAsBase64_FromTheTrimmedWords()
    {
        var generator = new FakeImageGenerator { Result = new GeneratedImage("image/jpeg", SampleImages.Jpeg) };
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, generator).Generate(
            new ImageGenerationRequest { Spanish = " nadar ", English = " to swim " }, CancellationToken.None);

        var response = ActionResultAssert.Ok<CardImageResponse>(result.Result);
        Assert.Equal("image/jpeg", response.ContentType);
        Assert.Equal(SampleImages.Jpeg, Convert.FromBase64String(response.Data));
        Assert.Equal(("nadar", "to swim"), generator.Words);
    }

    [Theory]
    [InlineData("nadar", null, "nadar", "")]
    [InlineData(null, "to swim", "", "to swim")]
    public async Task Generate_WorksFromOneSide(string? spanish, string? english, string expectedSpanish, string expectedEnglish)
    {
        var generator = new FakeImageGenerator();
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, generator).Generate(
            new ImageGenerationRequest { Spanish = spanish, English = english }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal((expectedSpanish, expectedEnglish), generator.Words);
    }

    [Fact]
    public async Task Generate_ReturnsValidationProblem_WhenBothSidesAreBlank()
    {
        var generator = new FakeImageGenerator();
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, generator).Generate(
            new ImageGenerationRequest { Spanish = "  ", English = null }, CancellationToken.None);

        ActionResultAssert.ValidationProblem(result.Result, "Spanish", "Spanish or English is required.");
        Assert.Null(generator.Words);
    }

    [Fact]
    public async Task Generate_ReturnsServiceUnavailable_WhenPicturesAreOff()
    {
        var generator = new FakeImageGenerator { IsAvailable = false };
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, generator).Generate(
            new ImageGenerationRequest { Spanish = "nadar" }, CancellationToken.None);

        ActionResultAssert.Problem(result.Result, StatusCodes.Status503ServiceUnavailable);
        Assert.Null(generator.Words);
    }

    [Fact]
    public async Task Generate_ReturnsTheCachedPicturesInTurn_ThenMakesANewOne()
    {
        await using var dbContext = TestDb.Create();
        var store = new FakeImageStore();
        var generator = new FakeImageGenerator();
        var controller = CreateController(dbContext, generator, store);
        var first = ActionResultAssert.Ok<CardImageResponse>((await controller.Generate(
            new ImageGenerationRequest { Spanish = "nadar" }, CancellationToken.None)).Result);

        var again = ActionResultAssert.Ok<CardImageResponse>((await controller.Generate(
            new ImageGenerationRequest { Spanish = "nadar" }, CancellationToken.None)).Result);
        var next = ActionResultAssert.Ok<CardImageResponse>((await controller.Generate(
            new ImageGenerationRequest { Spanish = "nadar", AfterId = first.Id }, CancellationToken.None)).Result);

        Assert.Equal(first.Id, again.Id);
        Assert.Equal(first.Data, again.Data);
        Assert.NotEqual(first.Id, next.Id);
        Assert.Equal(2, generator.Calls.Count);
    }

    [Fact]
    public async Task Generate_ReturnsACachedPicture_WhenPicturesAreOff()
    {
        var databaseName = TestDb.NewDatabaseName();
        var store = new FakeImageStore();
        await using (var dbContext = TestDb.Create(databaseName))
        {
            await CreateController(dbContext, store: store).Generate(
                new ImageGenerationRequest { Spanish = "nadar" }, CancellationToken.None);
        }
        await using var secondContext = TestDb.Create(databaseName);
        var generator = new FakeImageGenerator { IsAvailable = false };
        var controller = CreateController(secondContext, generator, store);

        var cached = ActionResultAssert.Ok<CardImageResponse>((await controller.Generate(
            new ImageGenerationRequest { Spanish = "nadar" }, CancellationToken.None)).Result);
        var none = await controller.Generate(
            new ImageGenerationRequest { Spanish = "nadar", AfterId = cached.Id }, CancellationToken.None);

        Assert.Equal(SampleImages.Jpeg, Convert.FromBase64String(cached.Data));
        ActionResultAssert.Problem(none.Result, StatusCodes.Status503ServiceUnavailable);
        Assert.Empty(generator.Calls);
    }

    [Fact]
    public async Task Generate_ReturnsUnprocessableEntity_WhenTheContentFilterRefuses()
    {
        var generator = new FakeImageGenerator { Failure = new ImageContentFilteredException("refused") };
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, generator).Generate(
            new ImageGenerationRequest { Spanish = "nadar" }, CancellationToken.None);

        var problem = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status422UnprocessableEntity, problem.StatusCode);
        Assert.Equal("That card can't be illustrated.", Assert.IsType<ProblemDetails>(problem.Value).Detail);
    }

    [Theory]
    [InlineData(typeof(HttpRequestException))]
    [InlineData(typeof(TaskCanceledException))]
    public async Task Generate_ReturnsBadGateway_WhenTheGeneratorFailsOrTimesOut(Type failure)
    {
        var generator = new FakeImageGenerator { Failure = (Exception)Activator.CreateInstance(failure, "boom")! };
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, generator).Generate(
            new ImageGenerationRequest { Spanish = "nadar" }, CancellationToken.None);

        ActionResultAssert.Problem(result.Result, StatusCodes.Status502BadGateway);
    }

    [Fact]
    public async Task Put_KeepsThePicture_AndPutsItsUrlOnTheCard()
    {
        await using var dbContext = TestDb.Create();
        var card = await AddCardAsync(dbContext, tags: ["Verbs"]);
        var store = new FakeImageStore();

        var result = await CreateController(dbContext, store: store).Put(
            card.Id, new CardImageRequest { ContentType = "image/png", Data = Png }, CancellationToken.None);

        var returned = ActionResultAssert.Ok<FlashCard>(result.Result);
        var (url, contentType, data) = Assert.Single(store.Saved);
        Assert.Equal(url, returned.ImageUrl);
        Assert.Equal("image/png", contentType);
        Assert.Equal(SampleImages.Png, data);
        Assert.Equal("Verbs", Assert.Single(returned.Tags).Name);
        Assert.Equal(url, (await dbContext.FlashCards.AsNoTracking().SingleAsync()).ImageUrl);
        Assert.Empty(store.Deleted);
    }

    [Fact]
    public async Task Put_ReplacesThePicture_AndRemovesTheOldOne()
    {
        await using var dbContext = TestDb.Create();
        var card = await AddCardAsync(dbContext, imageUrl: "https://images.test/card-images/old.jpg");
        var store = new FakeImageStore();

        var result = await CreateController(dbContext, store: store).Put(
            card.Id, new CardImageRequest { ContentType = "image/png", Data = Png }, CancellationToken.None);

        var returned = ActionResultAssert.Ok<FlashCard>(result.Result);
        Assert.Equal(Assert.Single(store.Saved).Url, returned.ImageUrl);
        Assert.Equal(["https://images.test/card-images/old.jpg"], store.Deleted);
    }

    [Fact]
    public async Task Put_ReturnsNotFound_ForAnotherUsersCard()
    {
        var databaseName = TestDb.NewDatabaseName();
        var cardId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("nadar", "to swim"), TestDb.OtherUserId);
        await using var dbContext = TestDb.Create(databaseName);
        var store = new FakeImageStore();

        var result = await CreateController(dbContext, store: store).Put(
            cardId, new CardImageRequest { ContentType = "image/png", Data = Png }, CancellationToken.None);

        Assert.IsType<NotFoundResult>(result.Result);
        Assert.Empty(store.Saved);
    }

    [Fact]
    public async Task Put_ReturnsValidationProblem_ForAPictureThatIsNotOne()
    {
        await using var dbContext = TestDb.Create();
        var card = await AddCardAsync(dbContext);
        var store = new FakeImageStore();

        var result = await CreateController(dbContext, store: store).Put(
            card.Id, new CardImageRequest { ContentType = "image/jpeg", Data = Png }, CancellationToken.None);

        ActionResultAssert.ValidationProblem(result.Result, "Data", "The picture isn't the kind of image its content type says.");
        Assert.Empty(store.Saved);
        Assert.Null((await dbContext.FlashCards.AsNoTracking().SingleAsync()).ImageUrl);
    }

    [Fact]
    public async Task Put_RemovesTheNewPicture_WhenTheCardCannotBeSaved()
    {
        var failure = new InvalidOperationException("the database is away");
        var databaseName = TestDb.NewDatabaseName();
        // The card is added without the interceptor, which only fails the controller's save.
        var cardId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("nadar", "to swim"));
        await using var dbContext = TestDb.Create(databaseName, interceptors: new FailingSaveInterceptor(failure));
        var store = new FakeImageStore();

        var thrown = await Assert.ThrowsAsync<InvalidOperationException>(() => CreateController(dbContext, store: store).Put(
            cardId, new CardImageRequest { ContentType = "image/png", Data = Png }, CancellationToken.None));

        Assert.Same(failure, thrown);
        Assert.Equal([Assert.Single(store.Saved).Url], store.Deleted);
    }

    [Fact]
    public async Task Delete_TakesThePictureOffTheCard_AndRemovesIt()
    {
        await using var dbContext = TestDb.Create();
        var card = await AddCardAsync(dbContext, imageUrl: "https://images.test/card-images/old.jpg");
        var store = new FakeImageStore();

        var result = await CreateController(dbContext, store: store).Delete(card.Id, CancellationToken.None);

        var returned = ActionResultAssert.Ok<FlashCard>(result.Result);
        Assert.Null(returned.ImageUrl);
        Assert.Null((await dbContext.FlashCards.AsNoTracking().SingleAsync()).ImageUrl);
        Assert.Equal(["https://images.test/card-images/old.jpg"], store.Deleted);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task TakingAPictureOff_StillSucceeds_WhenTheOldOneCannotBeRemoved(bool replace)
    {
        await using var dbContext = TestDb.Create();
        var card = await AddCardAsync(dbContext, imageUrl: "https://images.test/card-images/old.jpg");
        var store = new FakeImageStore { DeleteFailure = new IOException("still being sent") };
        var controller = CreateController(dbContext, store: store);

        var result = replace
            ? await controller.Put(card.Id, new CardImageRequest { ContentType = "image/png", Data = Png }, CancellationToken.None)
            : await controller.Delete(card.Id, CancellationToken.None);

        var returned = ActionResultAssert.Ok<FlashCard>(result.Result);
        Assert.Equal(replace ? store.Saved.Single().Url : null, returned.ImageUrl);
        Assert.Equal(["https://images.test/card-images/old.jpg"], store.Deleted);
    }

    [Fact]
    public async Task Delete_DoesNothing_ForACardWithoutAPicture()
    {
        await using var dbContext = TestDb.Create();
        var card = await AddCardAsync(dbContext);
        var store = new FakeImageStore();

        var result = await CreateController(dbContext, store: store).Delete(card.Id, CancellationToken.None);

        Assert.Null(ActionResultAssert.Ok<FlashCard>(result.Result).ImageUrl);
        Assert.Empty(store.Deleted);
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_ForAnotherUsersCard()
    {
        var databaseName = TestDb.NewDatabaseName();
        var cardId = await TestDb.SeedCardAsync(
            databaseName, TestDb.Card("nadar", "to swim", imageUrl: "https://images.test/card-images/theirs.jpg"), TestDb.OtherUserId);
        await using var dbContext = TestDb.Create(databaseName);
        var store = new FakeImageStore();

        var result = await CreateController(dbContext, store: store).Delete(cardId, CancellationToken.None);

        Assert.IsType<NotFoundResult>(result.Result);
        Assert.Empty(store.Deleted);
    }

    [Fact]
    public async Task Generate_RequiresSignIn()
    {
        using var client = TestApp.CreateSignedOutClient(factory, Settings);

        var response = await client.PostAsJsonAsync("/api/flashcards/images/generate", new { spanish = "nadar" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Generate_IsUnavailable_WithoutAnEndpointAndKey()
    {
        using var client = TestApp.CreateSignedInClient(factory, settings: Settings);

        var response = await client.PostAsJsonAsync("/api/flashcards/images/generate", new { spanish = "nadar" });

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task Put_KeepsThePictureAsALocalFile_WhichAnyoneCanLoad()
    {
        using var client = TestApp.CreateSignedInClient(factory, settings: Settings);
        var created = await client.PostAsJsonAsync("/api/flashcards", TestDb.CardBody("nadar", "to swim"));
        var card = (await created.Content.ReadFromJsonAsync<FlashCard>())!;

        var put = await client.PutAsJsonAsync(
            $"/api/flashcards/{card.Id}/image", new { contentType = "image/png", data = Png });

        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var withPicture = (await put.Content.ReadFromJsonAsync<FlashCard>())!;
        Assert.Matches(@"^http://localhost/card-images/[0-9a-f]{32}\.png$", withPicture.ImageUrl);
        Assert.Single(Directory.GetFiles(pictures));

        // The picture is loaded by the browser like any image, so it doesn't need the user's token.
        using var anyone = TestApp.CreateSignedOutClient(factory, Settings);
        var picture = await anyone.GetAsync(new Uri(withPicture.ImageUrl!));
        Assert.Equal(HttpStatusCode.OK, picture.StatusCode);
        Assert.Equal("image/png", picture.Content.Headers.ContentType?.MediaType);
        Assert.Equal(SampleImages.Png, await picture.Content.ReadAsByteArrayAsync());

        var deleted = await client.DeleteAsync($"/api/flashcards/{card.Id}");
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.Empty(Directory.GetFiles(pictures));
    }

    [Fact]
    public async Task Put_TakesAnUploadedPictureAsBigAsTheLimit()
    {
        using var client = TestApp.CreateSignedInClient(factory, settings: Settings);
        var created = await client.PostAsJsonAsync("/api/flashcards", TestDb.CardBody("nadar", "to swim"));
        var card = (await created.Content.ReadFromJsonAsync<FlashCard>())!;
        var bytes = new byte[CardImage.MaxBytes];
        SampleImages.Jpeg.CopyTo(bytes, 0);

        var put = await client.PutAsJsonAsync(
            $"/api/flashcards/{card.Id}/image",
            new { contentType = "image/jpeg", data = Convert.ToBase64String(bytes) });

        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        Assert.Equal(5 * 1024 * 1024, new FileInfo(Assert.Single(Directory.GetFiles(pictures))).Length);
    }

    private static async Task<FlashCard> AddCardAsync(
        FlashCardDbContext dbContext, string? imageUrl = null, params string[] tags)
    {
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("nadar", "to swim", tags, imageUrl));
        dbContext.ChangeTracker.Clear();
        return card;
    }

    private static FlashCardImagesController CreateController(
        FlashCardDbContext dbContext, IImageGenerator? generator = null, IImageStore? store = null)
    {
        store ??= new FakeImageStore();
        return new FlashCardImagesController(
            dbContext,
            new CachedImageGenerator(
                generator ?? new FakeImageGenerator(), store, dbContext, NullLogger<CachedImageGenerator>.Instance),
            store,
            NullLogger<FlashCardImagesController>.Instance);
    }
}
