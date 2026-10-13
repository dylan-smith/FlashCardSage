using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public sealed class FlashCardImagesControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>, IDisposable
{
    private static readonly string Png = Convert.ToBase64String(CardImageTests.Png);

    // Where the app-level tests' pictures go, instead of the API project's App_Data.
    private readonly string pictures = Path.Join(Path.GetTempPath(), $"FlashCardSage-{Guid.NewGuid():N}");

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
        var generator = new FakeImageGenerator { Result = new GeneratedImage("image/jpeg", CardImageTests.Jpeg) };
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, generator).Generate(
            new ImageGenerationRequest { Spanish = " nadar ", English = " to swim " }, CancellationToken.None);

        var response = Assert.IsType<CardImageResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("image/jpeg", response.ContentType);
        Assert.Equal(CardImageTests.Jpeg, Convert.FromBase64String(response.Data));
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

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal("Spanish or English is required.", Assert.Single(problem.Errors["Spanish"]));
        Assert.Null(generator.Words);
    }

    [Fact]
    public async Task Generate_ReturnsServiceUnavailable_WhenPicturesAreOff()
    {
        var generator = new FakeImageGenerator { IsAvailable = false };
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, generator).Generate(
            new ImageGenerationRequest { Spanish = "nadar" }, CancellationToken.None);

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, Assert.IsType<ObjectResult>(result.Result).StatusCode);
        Assert.Null(generator.Words);
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

        Assert.Equal(StatusCodes.Status502BadGateway, Assert.IsType<ObjectResult>(result.Result).StatusCode);
    }

    [Fact]
    public async Task Put_KeepsThePicture_AndPutsItsUrlOnTheCard()
    {
        await using var dbContext = TestDb.Create();
        var card = await AddCardAsync(dbContext, tags: ["Verbs"]);
        var store = new FakeImageStore();

        var result = await CreateController(dbContext, store: store).Put(
            card.Id, new CardImageRequest { ContentType = "image/png", Data = Png }, CancellationToken.None);

        var returned = Assert.IsType<FlashCard>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var (url, contentType, data) = Assert.Single(store.Saved);
        Assert.Equal(url, returned.ImageUrl);
        Assert.Equal("image/png", contentType);
        Assert.Equal(CardImageTests.Png, data);
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

        var returned = Assert.IsType<FlashCard>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(Assert.Single(store.Saved).Url, returned.ImageUrl);
        Assert.Equal(["https://images.test/card-images/old.jpg"], store.Deleted);
    }

    [Fact]
    public async Task Put_ReturnsNotFound_ForAnotherUsersCard()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using var theirs = TestDb.Create(databaseName, TestDb.OtherUserId);
        var card = await AddCardAsync(theirs);
        await using var dbContext = TestDb.Create(databaseName);
        var store = new FakeImageStore();

        var result = await CreateController(dbContext, store: store).Put(
            card.Id, new CardImageRequest { ContentType = "image/png", Data = Png }, CancellationToken.None);

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

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal("The picture isn't the kind of image its content type says.", Assert.Single(problem.Errors["Data"]));
        Assert.Empty(store.Saved);
        Assert.Null((await dbContext.FlashCards.AsNoTracking().SingleAsync()).ImageUrl);
    }

    [Fact]
    public async Task Put_RemovesTheNewPicture_WhenTheCardCannotBeSaved()
    {
        var failure = new InvalidOperationException("the database is away");
        var databaseName = Guid.NewGuid().ToString();
        // The card is added without the interceptor, which only fails the controller's save.
        await using var setup = TestDb.Create(databaseName);
        var card = await AddCardAsync(setup);
        await using var dbContext = TestDb.Create(databaseName, interceptors: new FailingSaveInterceptor(failure));
        var store = new FakeImageStore();

        var thrown = await Assert.ThrowsAsync<InvalidOperationException>(() => CreateController(dbContext, store: store).Put(
            card.Id, new CardImageRequest { ContentType = "image/png", Data = Png }, CancellationToken.None));

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

        var returned = Assert.IsType<FlashCard>(Assert.IsType<OkObjectResult>(result.Result).Value);
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

        var returned = Assert.IsType<FlashCard>(Assert.IsType<OkObjectResult>(result.Result).Value);
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

        Assert.Null(Assert.IsType<FlashCard>(Assert.IsType<OkObjectResult>(result.Result).Value).ImageUrl);
        Assert.Empty(store.Deleted);
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_ForAnotherUsersCard()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using var theirs = TestDb.Create(databaseName, TestDb.OtherUserId);
        var card = await AddCardAsync(theirs, imageUrl: "https://images.test/card-images/theirs.jpg");
        await using var dbContext = TestDb.Create(databaseName);
        var store = new FakeImageStore();

        var result = await CreateController(dbContext, store: store).Delete(card.Id, CancellationToken.None);

        Assert.IsType<NotFoundResult>(result.Result);
        Assert.Empty(store.Deleted);
    }

    [Fact]
    public async Task Generate_RequiresSignIn()
    {
        using var client = CreateClient(signedIn: false);

        var response = await client.PostAsJsonAsync("/api/flashcards/images/generate", new { spanish = "nadar" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Generate_IsUnavailable_WithoutAnEndpointAndKey()
    {
        using var client = CreateClient(signedIn: true);

        var response = await client.PostAsJsonAsync("/api/flashcards/images/generate", new { spanish = "nadar" });

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task Put_KeepsThePictureAsALocalFile_WhichAnyoneCanLoad()
    {
        using var client = CreateClient(signedIn: true);
        var created = await client.PostAsJsonAsync("/api/flashcards", new { spanish = "nadar", english = "to swim" });
        var card = (await created.Content.ReadFromJsonAsync<FlashCard>())!;

        var put = await client.PutAsJsonAsync(
            $"/api/flashcards/{card.Id}/image", new { contentType = "image/png", data = Png });

        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var withPicture = (await put.Content.ReadFromJsonAsync<FlashCard>())!;
        Assert.Matches(@"^http://localhost/card-images/[0-9a-f]{32}\.png$", withPicture.ImageUrl);
        Assert.Single(Directory.GetFiles(pictures));

        // The picture is loaded by the browser like any image, so it doesn't need the user's token.
        using var anyone = CreateClient(signedIn: false);
        var picture = await anyone.GetAsync(new Uri(withPicture.ImageUrl!));
        Assert.Equal(HttpStatusCode.OK, picture.StatusCode);
        Assert.Equal("image/png", picture.Content.Headers.ContentType?.MediaType);
        Assert.Equal(CardImageTests.Png, await picture.Content.ReadAsByteArrayAsync());

        var deleted = await client.DeleteAsync($"/api/flashcards/{card.Id}");
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.Empty(Directory.GetFiles(pictures));
    }

    private static async Task<FlashCard> AddCardAsync(
        FlashCardDbContext dbContext, string? imageUrl = null, params string[] tags)
    {
        var card = new FlashCard
        {
            Spanish = "nadar",
            English = "to swim",
            ImageUrl = imageUrl,
            Tags = [.. tags.Select(name => new Tag { Name = name })]
        };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();
        dbContext.ChangeTracker.Clear();
        return card;
    }

    private static FlashCardImagesController CreateController(
        FlashCardDbContext dbContext, IImageGenerator? generator = null, IImageStore? store = null)
    {
        return new FlashCardImagesController(
            dbContext,
            generator ?? new FakeImageGenerator(),
            store ?? new FakeImageStore(),
            NullLogger<FlashCardImagesController>.Instance);
    }

    private HttpClient CreateClient(bool signedIn)
    {
        // Development uses the in-memory database and allows test sign-in, so the app starts without SQL Server.
        var client = factory
            .WithWebHostBuilder(builder => builder
                .UseEnvironment("Development")
                .UseSetting("Authentication:AllowTestSignIn", "true")
                .UseSetting("ImageGeneration:Endpoint", "")
                .UseSetting("ImageGeneration:Key", "")
                .UseSetting("ImageStore:StorageConnectionString", "")
                .UseSetting("ImageStore:LocalPath", pictures))
            .CreateClient();
        if (signedIn)
        {
            // The same user throughout, so the card one request made is there for the next.
            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", $"test:Pictures {pictures}");
        }

        return client;
    }

    private sealed class FakeImageGenerator : IImageGenerator
    {
        public bool IsAvailable { get; init; } = true;

        public GeneratedImage Result { get; init; } = new("image/jpeg", CardImageTests.Jpeg);

        public Exception? Failure { get; init; }

        public (string Spanish, string English)? Words { get; private set; }

        public Task<GeneratedImage> GenerateAsync(string spanish, string english, CancellationToken cancellationToken)
        {
            Words = (spanish, english);
            return Failure is null ? Task.FromResult(Result) : Task.FromException<GeneratedImage>(Failure);
        }
    }

    // Fails every save, as the database would if it were away.
    private sealed class FailingSaveInterceptor(Exception failure) : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            throw failure;
        }
    }
}
