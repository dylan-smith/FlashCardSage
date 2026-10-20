using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
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
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.FlashCards.Add(TestDb.Card("el perro", "the dog")));

        await using var dbContext = TestDb.Create(databaseName);
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));

        var result = await CreateController(dbContext).GetNext(new PracticeSelection());

        var next = ActionResultAssert.Ok<PracticeCard>(result.Result);
        Assert.Equal((card.Id, "el gato", "the cat"), (next.Id, next.Spanish.Single(), next.English.Single()));
    }

    [Fact]
    public async Task GetNext_ReturnsEveryTranslationOnTheCard()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardAsync(databaseName, new FlashCard { Words = TestDb.Words(["solo", "únicamente"], ["only"]) });

        await using var dbContext = TestDb.Create(databaseName);
        var result = await CreateController(dbContext).GetNext(new PracticeSelection());

        var next = ActionResultAssert.Ok<PracticeCard>(result.Result);
        Assert.Equal(["solo", "únicamente"], next.Spanish);
        Assert.Equal(["only"], next.English);
    }

    [Fact]
    public async Task GetNext_IsServedAlongsideTheCardRoutes()
    {
        using var client = TestApp.CreateSignedInClient(factory);
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
        var cat = TestDb.Card("el gato", "the cat");
        dbContext.FlashCards.Add(TestDb.Card("el perro", "the dog"));
        var deck = new Deck { Name = "Cats", FlashCards = [cat] };
        dbContext.Decks.Add(deck);
        await dbContext.SaveChangesAsync();

        // Picked at random, so it's asked a few times.
        for (var attempt = 0; attempt < 10; attempt++)
        {
            var result = await CreateController(dbContext).GetNext(new PracticeSelection { DeckId = deck.Id });

            var next = ActionResultAssert.Ok<PracticeCard>(result.Result);
            Assert.Equal(cat.Id, next.Id);
        }
    }

    [Fact]
    public async Task GetNext_OnlyPicksTheTagsCards()
    {
        await using var dbContext = TestDb.Create();
        var tag = new Tag { Name = "Animals" };
        var cat = new FlashCard { Words = TestDb.Words("el gato", "the cat"), Tags = [tag] };
        dbContext.FlashCards.AddRange(cat, TestDb.Card("la casa", "the house"));
        await dbContext.SaveChangesAsync();

        for (var attempt = 0; attempt < 10; attempt++)
        {
            var result = await CreateController(dbContext).GetNext(new PracticeSelection { TagId = tag.Id });

            var next = ActionResultAssert.Ok<PracticeCard>(result.Result);
            Assert.Equal(cat.Id, next.Id);
        }
    }

    [Fact]
    public async Task GetNext_ReturnsNoContent_WhenTheDeckIsEmpty()
    {
        await using var dbContext = TestDb.Create();
        dbContext.FlashCards.Add(TestDb.Card("el gato", "the cat"));
        var deck = new Deck { Name = "Empty" };
        dbContext.Decks.Add(deck);
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).GetNext(new PracticeSelection { DeckId = deck.Id });

        Assert.IsType<NoContentResult>(result.Result);
    }

    [Fact]
    public async Task GetNext_ReturnsNotFound_ForAnotherUsersDeckOrTag()
    {
        var databaseName = TestDb.NewDatabaseName();
        var otherDeck = new Deck { Name = "Theirs" };
        var otherTag = new Tag { Name = "Theirs" };
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext =>
        {
            otherContext.Decks.Add(otherDeck);
            otherContext.Tags.Add(otherTag);
        });

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        Assert.IsType<NotFoundResult>((await controller.GetNext(new PracticeSelection { DeckId = otherDeck.Id })).Result);
        Assert.IsType<NotFoundResult>((await controller.GetNext(new PracticeSelection { TagId = otherTag.Id })).Result);
    }

    [Fact]
    public async Task GetNext_TakesTheDeckOrTagFromTheQuery()
    {
        using var client = TestApp.CreateSignedInClient(factory);

        var unknownDeck = await client.GetAsync("/api/flashcards/practice/next?deckId=999");
        var unknownTag = await client.GetAsync("/api/flashcards/practice/next?tagId=999");
        var both = await client.GetAsync("/api/flashcards/practice/next?deckId=1&tagId=1");

        Assert.Equal(HttpStatusCode.NotFound, unknownDeck.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, unknownTag.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, both.StatusCode);
    }

    [Fact]
    public async Task GetPack_HasEveryCardWithItsWordsScoreLastPracticePictureAndTags()
    {
        await using var dbContext = TestDb.Create();
        var cat = new FlashCard
        {
            Words = TestDb.Words(["el gato", "la gata"], ["the cat"]),
            Tags = [new Tag { Name = "Pets" }, new Tag { Name = "Animals" }],
            ImageUrl = "https://example.com/cat.png"
        };
        var house = TestDb.Card("la casa", "the house");
        dbContext.FlashCards.AddRange(cat, house);
        await dbContext.SaveChangesAsync();
        var earlier = new DateTimeOffset(2026, 10, 1, 9, 0, 0, TimeSpan.Zero);
        var later = earlier.AddDays(1);
        dbContext.PracticeResults.AddRange(
            new PracticeResult { FlashCardId = cat.Id, Outcome = PracticeOutcome.Failed, PracticedAt = earlier },
            new PracticeResult { FlashCardId = cat.Id, Outcome = PracticeOutcome.GotIt, PracticedAt = later });
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).GetPack();

        var pack = ActionResultAssert.Ok<PracticePack>(result.Result);
        Assert.Collection(
            pack.Cards,
            card =>
            {
                Assert.Equal(cat.Id, card.Id);
                Assert.Equal(["el gato", "la gata"], card.Spanish);
                Assert.Equal(["the cat"], card.English);
                Assert.Equal(50, card.Score);
                Assert.Equal(later, card.LastPracticedAt);
                Assert.Equal("https://example.com/cat.png", card.ImageUrl);
                Assert.Equal(cat.Tags.Select(tag => tag.Id).Order(), card.TagIds);
            },
            card =>
            {
                Assert.Equal((house.Id, 0, null, null), (card.Id, card.Score, card.LastPracticedAt, card.ImageUrl));
                Assert.Empty(card.TagIds);
            });
    }

    [Fact]
    public async Task GetPack_ListsTheDecksAndTagsByName()
    {
        await using var dbContext = TestDb.Create();
        var cat = TestDb.Card("el gato", "the cat", ["Travel", "Food"]);
        var dog = TestDb.Card("el perro", "the dog");
        dbContext.FlashCards.AddRange(cat, dog);
        dbContext.Decks.AddRange(
            new Deck { Name = "Zoo", FlashCards = [dog, cat] },
            new Deck { Name = "Animals", FlashCards = [dog] });
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).GetPack();

        var pack = ActionResultAssert.Ok<PracticePack>(result.Result);
        Assert.Equal(["Animals", "Zoo"], pack.Decks.Select(deck => deck.Name));
        Assert.Equal([dog.Id], pack.Decks[0].FlashCardIds);
        Assert.Equal([cat.Id, dog.Id], pack.Decks[1].FlashCardIds);
        Assert.Equal(["Food", "Travel"], pack.Tags.Select(tag => tag.Name));
    }

    [Fact]
    public async Task GetPack_LeavesOutAnotherUsersCardsDecksTagsAndResults()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext =>
        {
            var theirs = TestDb.Card("el perro", "the dog", ["Theirs"]);
            otherContext.FlashCards.Add(theirs);
            otherContext.Decks.Add(new Deck { Name = "Theirs", FlashCards = [theirs] });
            otherContext.PracticeResults.Add(
                new PracticeResult { FlashCard = theirs, Outcome = PracticeOutcome.GotIt, PracticedAt = DateTimeOffset.UtcNow });
        });

        await using var dbContext = TestDb.Create(databaseName);
        var mine = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));

        var result = await CreateController(dbContext).GetPack();

        var pack = ActionResultAssert.Ok<PracticePack>(result.Result);
        var card = Assert.Single(pack.Cards);
        Assert.Equal((mine.Id, 0, null), (card.Id, card.Score, card.LastPracticedAt));
        Assert.Empty(card.TagIds);
        Assert.Empty(pack.Decks);
        Assert.Empty(pack.Tags);
    }

    [Fact]
    public async Task GetPack_IsEmpty_ForANewUser()
    {
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext).GetPack();

        var pack = ActionResultAssert.Ok<PracticePack>(result.Result);
        Assert.Empty(pack.Cards);
        Assert.Empty(pack.Decks);
        Assert.Empty(pack.Tags);
    }

    [Fact]
    public async Task GetPack_UsesTheNamesTheDeviceKeepsItBy()
    {
        using var client = TestApp.CreateSignedInClient(factory);
        using var body = new StringContent(
            """{"spanish":["el gato"],"english":["the cat"],"tags":["Animals"]}""", MediaTypeHeaderValue.Parse("application/json"));
        var created = await client.PostAsync("/api/flashcards", body);
        var card = (await created.Content.ReadFromJsonAsync<IdResponse>())!;
        var deck = await client.PostAsJsonAsync("/api/decks", new { name = "Pets", flashCardIds = new[] { card.Id } });
        deck.EnsureSuccessStatusCode();

        var json = await client.GetStringAsync("/api/flashcards/practice/pack");

        Assert.Matches(
            $$"""
              ^\{"cards":\[\{"id":{{card.Id}},"spanish":\["el gato"\],"english":\["the cat"\],"score":0,"lastPracticedAt":null,"imageUrl":null,"tagIds":\[\d+\]\}\],"decks":\[\{"id":\d+,"name":"Pets","flashCardIds":\[{{card.Id}}\]\}\],"tags":\[\{"id":\d+,"name":"Animals"\}\]\}$
              """,
            json);
    }

    private static PracticeController CreateController(FlashCardDbContext dbContext)
    {
        return new PracticeController(dbContext, NullLogger<PracticeController>.Instance);
    }
}
