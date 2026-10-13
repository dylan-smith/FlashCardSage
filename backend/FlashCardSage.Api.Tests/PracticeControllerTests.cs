using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class PracticeControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task GetNext_ReturnsNoContent_WhenThereAreNoCards()
    {
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext).GetNext(new PracticeSelection());

        Assert.IsType<NoContentResult>(result.Result);
    }

    [Fact]
    public async Task GetNext_ReturnsOneOfTheUsersCards()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            otherContext.FlashCards.Add(new FlashCard { Words = TestDb.Words("el perro", "the dog") });
            await otherContext.SaveChangesAsync();
        }

        await using var dbContext = TestDb.Create(databaseName);
        var card = new FlashCard { Words = TestDb.Words("el gato", "the cat") };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).GetNext(new PracticeSelection());

        var next = Assert.IsType<PracticeCard>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal((card.Id, "el gato", "the cat"), (next.Id, next.Spanish.Single(), next.English.Single()));
    }

    [Fact]
    public async Task GetNext_ReturnsEveryTranslationOnTheCard()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using (var setupContext = TestDb.Create(databaseName))
        {
            setupContext.FlashCards.Add(new FlashCard { Words = TestDb.Words(["solo", "únicamente"], ["only"]) });
            await setupContext.SaveChangesAsync();
        }

        await using var dbContext = TestDb.Create(databaseName);
        var result = await CreateController(dbContext).GetNext(new PracticeSelection());

        var next = Assert.IsType<PracticeCard>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(["solo", "únicamente"], next.Spanish);
        Assert.Equal(["only"], next.English);
    }

    [Fact]
    public async Task GetNext_IsServedAlongsideTheCardRoutes()
    {
        using var client = CreateClient();
        var empty = await client.GetAsync("/api/flashcards/practice/next");
        var created = await client.PostAsJsonAsync("/api/flashcards", TestDb.CardBody("el gato", "the cat"));
        created.EnsureSuccessStatusCode();

        var next = await client.GetFromJsonAsync<PracticeCard>("/api/flashcards/practice/next");

        Assert.Equal(HttpStatusCode.NoContent, empty.StatusCode);
        Assert.Equal(["el gato"], next!.Spanish);
    }

    [Fact]
    public async Task GetNext_OnlyPicksTheDecksCards()
    {
        await using var dbContext = TestDb.Create();
        var cat = new FlashCard { Words = TestDb.Words("el gato", "the cat") };
        dbContext.FlashCards.Add(new FlashCard { Words = TestDb.Words("el perro", "the dog") });
        var deck = new Deck { Name = "Cats", FlashCards = [cat] };
        dbContext.Decks.Add(deck);
        await dbContext.SaveChangesAsync();

        // Picked at random, so it's asked a few times.
        for (var attempt = 0; attempt < 10; attempt++)
        {
            var result = await CreateController(dbContext).GetNext(new PracticeSelection { DeckId = deck.Id });

            var next = Assert.IsType<PracticeCard>(Assert.IsType<OkObjectResult>(result.Result).Value);
            Assert.Equal(cat.Id, next.Id);
        }
    }

    [Fact]
    public async Task GetNext_OnlyPicksTheTagsCards()
    {
        await using var dbContext = TestDb.Create();
        var tag = new Tag { Name = "Animals" };
        var cat = new FlashCard { Words = TestDb.Words("el gato", "the cat"), Tags = [tag] };
        dbContext.FlashCards.AddRange(cat, new FlashCard { Words = TestDb.Words("la casa", "the house") });
        await dbContext.SaveChangesAsync();

        for (var attempt = 0; attempt < 10; attempt++)
        {
            var result = await CreateController(dbContext).GetNext(new PracticeSelection { TagId = tag.Id });

            var next = Assert.IsType<PracticeCard>(Assert.IsType<OkObjectResult>(result.Result).Value);
            Assert.Equal(cat.Id, next.Id);
        }
    }

    [Fact]
    public async Task GetNext_ReturnsNoContent_WhenTheDeckIsEmpty()
    {
        await using var dbContext = TestDb.Create();
        dbContext.FlashCards.Add(new FlashCard { Words = TestDb.Words("el gato", "the cat") });
        var deck = new Deck { Name = "Empty" };
        dbContext.Decks.Add(deck);
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).GetNext(new PracticeSelection { DeckId = deck.Id });

        Assert.IsType<NoContentResult>(result.Result);
    }

    [Fact]
    public async Task GetNext_ReturnsNotFound_ForAnotherUsersDeckOrTag()
    {
        var databaseName = Guid.NewGuid().ToString();
        var otherDeck = new Deck { Name = "Theirs" };
        var otherTag = new Tag { Name = "Theirs" };
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            otherContext.Decks.Add(otherDeck);
            otherContext.Tags.Add(otherTag);
            await otherContext.SaveChangesAsync();
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        Assert.IsType<NotFoundResult>((await controller.GetNext(new PracticeSelection { DeckId = otherDeck.Id })).Result);
        Assert.IsType<NotFoundResult>((await controller.GetNext(new PracticeSelection { TagId = otherTag.Id })).Result);
    }

    [Fact]
    public async Task GetNext_TakesTheDeckOrTagFromTheQuery()
    {
        using var client = CreateClient();

        var unknownDeck = await client.GetAsync("/api/flashcards/practice/next?deckId=999");
        var unknownTag = await client.GetAsync("/api/flashcards/practice/next?tagId=999");
        var both = await client.GetAsync("/api/flashcards/practice/next?deckId=1&tagId=1");

        Assert.Equal(HttpStatusCode.NotFound, unknownDeck.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, unknownTag.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, both.StatusCode);
    }

    private static PracticeController CreateController(FlashCardDbContext dbContext)
    {
        return new PracticeController(dbContext, NullLogger<PracticeController>.Instance);
    }

    private HttpClient CreateClient()
    {
        // Development uses the in-memory database and allows test sign-in, so the app starts without SQL Server.
        var client = factory
            .WithWebHostBuilder(builder => builder
                .UseEnvironment("Development")
                .UseSetting("Authentication:AllowTestSignIn", "true"))
            .CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", $"test:Practice {Guid.NewGuid()}");
        return client;
    }
}
