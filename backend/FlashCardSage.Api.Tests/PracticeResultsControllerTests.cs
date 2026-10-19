using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class PracticeResultsControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    // A time some while ago, when answers were given on the device.
    private static readonly DateTimeOffset Earlier = new(2026, 10, 1, 9, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(PracticeOutcome.GotIt)]
    [InlineData(PracticeOutcome.WasClose)]
    [InlineData(PracticeOutcome.Failed)]
    public async Task Create_RecordsTheOutcomeAndWhenForTheCard(PracticeOutcome outcome)
    {
        await using var dbContext = TestDb.Create();
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));
        var controller = CreateController(dbContext);
        var before = DateTimeOffset.UtcNow;

        var result = await controller.Create(card.Id, new PracticeResultRequest { Outcome = outcome }, AllCards);

        Assert.IsType<OkObjectResult>(result.Result);
        var saved = await dbContext.PracticeResults.SingleAsync();
        Assert.Equal((card.Id, outcome), (saved.FlashCardId, saved.Outcome));
        Assert.InRange(saved.PracticedAt, before, DateTimeOffset.UtcNow);
    }

    [Fact]
    public async Task Create_ReturnsAnotherCardToPracticeNext()
    {
        await using var dbContext = TestDb.Create();
        var cat = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));
        var dog = await TestDb.AddCardAsync(dbContext, TestDb.Card("el perro", "the dog"));
        var controller = CreateController(dbContext);

        var result = await controller.Create(cat.Id, new PracticeResultRequest { Outcome = PracticeOutcome.Failed }, AllCards);

        var response = ActionResultAssert.Ok<PracticeResultResponse>(result.Result);
        var next = Assert.IsType<PracticeCard>(response.Next);
        Assert.Equal((dog.Id, "el perro", "the dog"), (next.Id, next.Spanish.Single(), next.English.Single()));
    }

    [Fact]
    public async Task Create_ReturnsTheSameCard_WhenItIsTheOnlyOne()
    {
        await using var dbContext = TestDb.Create();
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));
        var controller = CreateController(dbContext);

        var result = await controller.Create(card.Id, new PracticeResultRequest { Outcome = PracticeOutcome.GotIt }, AllCards);

        var response = ActionResultAssert.Ok<PracticeResultResponse>(result.Result);
        Assert.Equal(card.Id, response.Next?.Id);
    }

    [Fact]
    public async Task Create_PicksTheNextCardFromTheSelectedDeck()
    {
        await using var dbContext = TestDb.Create();
        var cat = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));
        var dog = await TestDb.AddCardAsync(dbContext, TestDb.Card("el perro", "the dog"));
        await TestDb.AddCardAsync(dbContext, TestDb.Card("la casa", "the house"));
        var deck = new Deck { Name = "Animals", FlashCards = [cat, dog] };
        dbContext.Decks.Add(deck);
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.Create(
            cat.Id, new PracticeResultRequest { Outcome = PracticeOutcome.GotIt }, new PracticeSelection { DeckId = deck.Id });

        var response = ActionResultAssert.Ok<PracticeResultResponse>(result.Result);
        Assert.Equal(dog.Id, response.Next?.Id);
    }

    [Fact]
    public async Task Create_PicksTheNextCardFromTheSelectedTag()
    {
        await using var dbContext = TestDb.Create();
        var tag = new Tag { Name = "Animals" };
        var cat = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));
        var dog = new FlashCard { Words = TestDb.Words("el perro", "the dog"), Tags = [tag] };
        dbContext.FlashCards.Add(dog);
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.Create(
            cat.Id, new PracticeResultRequest { Outcome = PracticeOutcome.GotIt }, new PracticeSelection { TagId = tag.Id });

        var response = ActionResultAssert.Ok<PracticeResultResponse>(result.Result);
        Assert.Equal(dog.Id, response.Next?.Id);
    }

    [Fact]
    public async Task Create_ReturnsNoNextCard_WhenTheDeckHasNoCardsLeft()
    {
        await using var dbContext = TestDb.Create();
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));
        var deck = new Deck { Name = "Empty" };
        dbContext.Decks.Add(deck);
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.Create(
            card.Id, new PracticeResultRequest { Outcome = PracticeOutcome.GotIt }, new PracticeSelection { DeckId = deck.Id });

        var response = ActionResultAssert.Ok<PracticeResultResponse>(result.Result);
        Assert.Null(response.Next);
        Assert.True(await dbContext.PracticeResults.AnyAsync());
    }

    [Fact]
    public async Task Create_ReturnsNotFound_WhenTheDeckDoesNotExist()
    {
        await using var dbContext = TestDb.Create();
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));
        var controller = CreateController(dbContext);

        var result = await controller.Create(
            card.Id, new PracticeResultRequest { Outcome = PracticeOutcome.GotIt }, new PracticeSelection { DeckId = 999 });

        Assert.IsType<NotFoundResult>(result.Result);
        Assert.False(await dbContext.PracticeResults.AnyAsync());
    }

    [Theory]
    // A never-practiced card.
    [InlineData(new PracticeOutcome[0], PracticeOutcome.GotIt, 50)]
    [InlineData(new PracticeOutcome[0], PracticeOutcome.Failed, 0)]
    // Raising a run of Got it!
    [InlineData(new[] { PracticeOutcome.GotIt }, PracticeOutcome.GotIt, 30)]
    [InlineData(new[] { PracticeOutcome.Failed, PracticeOutcome.GotIt, PracticeOutcome.GotIt }, PracticeOutcome.GotIt, 10)]
    // Ending a run, including with I was close.
    [InlineData(new[] { PracticeOutcome.GotIt, PracticeOutcome.GotIt }, PracticeOutcome.WasClose, -80)]
    [InlineData(new[] { PracticeOutcome.GotIt, PracticeOutcome.GotIt, PracticeOutcome.GotIt }, PracticeOutcome.Failed, -90)]
    // A card already at the top stays there.
    [InlineData(
        new[]
        {
            PracticeOutcome.GotIt, PracticeOutcome.GotIt, PracticeOutcome.GotIt, PracticeOutcome.GotIt,
            PracticeOutcome.GotIt, PracticeOutcome.GotIt
        },
        PracticeOutcome.GotIt,
        0)]
    public async Task Create_ReturnsHowMuchTheAnswerChangedTheCardsScore(
        PracticeOutcome[] earlier, PracticeOutcome outcome, int expected)
    {
        await using var dbContext = TestDb.Create();
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));
        var controller = CreateController(dbContext);
        foreach (var earlierOutcome in earlier)
        {
            await controller.Create(card.Id, new PracticeResultRequest { Outcome = earlierOutcome }, AllCards);
        }

        var result = await controller.Create(card.Id, new PracticeResultRequest { Outcome = outcome }, AllCards);

        var response = ActionResultAssert.Ok<PracticeResultResponse>(result.Result);
        Assert.Equal(expected, response.ScoreChange);
    }

    [Fact]
    public async Task Create_OnlyCountsTheCardsOwnResults_ForTheScoreChange()
    {
        await using var dbContext = TestDb.Create();
        var cat = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));
        var dog = await TestDb.AddCardAsync(dbContext, TestDb.Card("el perro", "the dog"));
        var controller = CreateController(dbContext);
        await controller.Create(dog.Id, new PracticeResultRequest { Outcome = PracticeOutcome.GotIt }, AllCards);

        var result = await controller.Create(cat.Id, new PracticeResultRequest { Outcome = PracticeOutcome.GotIt }, AllCards);

        var response = ActionResultAssert.Ok<PracticeResultResponse>(result.Result);
        Assert.Equal(50, response.ScoreChange);
    }

    [Fact]
    public async Task Create_KeepsEveryResult()
    {
        await using var dbContext = TestDb.Create();
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));
        var controller = CreateController(dbContext);

        await controller.Create(card.Id, new PracticeResultRequest { Outcome = PracticeOutcome.Failed }, AllCards);
        await controller.Create(card.Id, new PracticeResultRequest { Outcome = PracticeOutcome.GotIt }, AllCards);

        Assert.Equal(
            [PracticeOutcome.Failed, PracticeOutcome.GotIt],
            await dbContext.PracticeResults.OrderBy(item => item.Id).Select(item => item.Outcome).ToListAsync());
    }

    [Fact]
    public async Task Create_ReturnsNotFound_WhenFlashCardDoesNotExist()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Create(999, new PracticeResultRequest { Outcome = PracticeOutcome.GotIt }, AllCards);

        Assert.IsType<NotFoundResult>(result.Result);
        Assert.False(await dbContext.PracticeResults.AnyAsync());
    }

    [Fact]
    public async Task Create_ReturnsNotFound_ForAnotherUsersFlashCard()
    {
        var databaseName = TestDb.NewDatabaseName();
        var otherId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"), TestDb.OtherUserId);

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        var result = await controller.Create(otherId, new PracticeResultRequest { Outcome = PracticeOutcome.GotIt }, AllCards);

        Assert.IsType<NotFoundResult>(result.Result);
        Assert.False(await dbContext.PracticeResults.IgnoreQueryFilters().AnyAsync());
    }

    [Fact]
    public async Task OtherUsersPracticeResults_AreNotVisible()
    {
        var databaseName = TestDb.NewDatabaseName();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            var other = await TestDb.AddCardAsync(otherContext, TestDb.Card("el gato", "the cat"));
            await CreateController(otherContext)
                .Create(other.Id, new PracticeResultRequest { Outcome = PracticeOutcome.GotIt }, AllCards);
        }

        await using var dbContext = TestDb.Create(databaseName);

        Assert.False(await dbContext.PracticeResults.AnyAsync());
    }

    [Fact]
    public async Task Post_AcceptsTheOutcomeByName()
    {
        using var client = TestApp.CreateSignedInClient(factory);
        var card = await CreateCardAsync(client);

        var response = await client.PostAsJsonAsync(
            $"/api/flashcards/{card.Id}/practice-results", new { outcome = "WasClose" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        // The only card comes up again, with the side sent by name. I was close leaves a new card at 0.
        Assert.Matches(
            $$"""^\{"next":\{"id":{{card.Id}},.*"side":"(Spanish|English)","imageUrl":null\},"scoreChange":0\}$""",
            await response.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("""{"outcome":"Maybe"}""")]
    [InlineData("""{"outcome":42}""")]
    public async Task Post_ReturnsBadRequest_ForAMissingOrUnknownOutcome(string body)
    {
        using var client = TestApp.CreateSignedInClient(factory);
        var card = await CreateCardAsync(client);

        using var content = new StringContent(body, MediaTypeHeaderValue.Parse("application/json"));

        var response = await client.PostAsync($"/api/flashcards/{card.Id}/practice-results", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Sync_RecordsTheAnswersInTheOrderGiven()
    {
        await using var dbContext = TestDb.Create();
        var cat = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));
        var dog = await TestDb.AddCardAsync(dbContext, TestDb.Card("el perro", "the dog"));
        var answers = new[]
        {
            Answer(cat.Id, PracticeOutcome.GotIt, Earlier),
            Answer(dog.Id, PracticeOutcome.Failed, Earlier.AddMinutes(1)),
            Answer(cat.Id, PracticeOutcome.WasClose, Earlier.AddMinutes(2))
        };

        var result = await CreateController(dbContext).Sync(SyncRequest(answers), CancellationToken.None);

        Assert.Equal(3, ActionResultAssert.Ok<PracticeResultsSyncResponse>(result.Result).Accepted);
        Assert.Equal(
            answers.Select(answer => (answer.Id, answer.FlashCardId!.Value, answer.Outcome!.Value, answer.PracticedAt!.Value)),
            (await dbContext.PracticeResults.OrderBy(item => item.Id).ToListAsync())
                .Select(item => (item.ClientId, item.FlashCardId, item.Outcome, item.PracticedAt)));
    }

    [Fact]
    public async Task Sync_ScoresTheAnswersInTheOrderGiven()
    {
        await using var dbContext = TestDb.Create();
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));

        await CreateController(dbContext).Sync(
            SyncRequest(
                Answer(card.Id, PracticeOutcome.GotIt, Earlier),
                Answer(card.Id, PracticeOutcome.GotIt, Earlier.AddMinutes(1)),
                Answer(card.Id, PracticeOutcome.Failed, Earlier.AddMinutes(2)),
                Answer(card.Id, PracticeOutcome.GotIt, Earlier.AddMinutes(3))),
            CancellationToken.None);

        var score = Assert.Single(await dbContext.ScoreFlashCardsAsync(null));
        Assert.Equal(50, score.Score);
    }

    [Fact]
    public async Task Sync_SkipsAnAnswerAlreadyRecorded()
    {
        await using var dbContext = TestDb.Create();
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));
        var request = SyncRequest(Answer(card.Id, PracticeOutcome.GotIt, Earlier));
        var controller = CreateController(dbContext);

        var first = await controller.Sync(request, CancellationToken.None);
        var again = await controller.Sync(request, CancellationToken.None);

        Assert.Equal(1, ActionResultAssert.Ok<PracticeResultsSyncResponse>(first.Result).Accepted);
        Assert.Equal(0, ActionResultAssert.Ok<PracticeResultsSyncResponse>(again.Result).Accepted);
        Assert.Equal(1, await dbContext.PracticeResults.CountAsync());
    }

    [Fact]
    public async Task Sync_SkipsAnAnswerRepeatedInTheRequest()
    {
        await using var dbContext = TestDb.Create();
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));
        var answer = Answer(card.Id, PracticeOutcome.GotIt, Earlier);

        var result = await CreateController(dbContext).Sync(SyncRequest(answer, answer), CancellationToken.None);

        Assert.Equal(1, ActionResultAssert.Ok<PracticeResultsSyncResponse>(result.Result).Accepted);
        Assert.Equal(1, await dbContext.PracticeResults.CountAsync());
    }

    [Fact]
    public async Task Sync_SkipsACardThatIsGone()
    {
        await using var dbContext = TestDb.Create();
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));

        var result = await CreateController(dbContext).Sync(
            SyncRequest(Answer(999, PracticeOutcome.GotIt, Earlier), Answer(card.Id, PracticeOutcome.Failed, Earlier)),
            CancellationToken.None);

        Assert.Equal(1, ActionResultAssert.Ok<PracticeResultsSyncResponse>(result.Result).Accepted);
        Assert.Equal(card.Id, (await dbContext.PracticeResults.SingleAsync()).FlashCardId);
    }

    [Fact]
    public async Task Sync_SkipsAnotherUsersCard()
    {
        var databaseName = TestDb.NewDatabaseName();
        var otherId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"), TestDb.OtherUserId);

        await using var dbContext = TestDb.Create(databaseName);
        var result = await CreateController(dbContext).Sync(
            SyncRequest(Answer(otherId, PracticeOutcome.GotIt, Earlier)), CancellationToken.None);

        Assert.Equal(0, ActionResultAssert.Ok<PracticeResultsSyncResponse>(result.Result).Accepted);
        Assert.False(await dbContext.PracticeResults.IgnoreQueryFilters().AnyAsync());
    }

    [Fact]
    public async Task Sync_RecordsAnAnswerFromTheFutureAsGivenNow_AndKeepsAPastOne()
    {
        await using var dbContext = TestDb.Create();
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));
        var before = DateTimeOffset.UtcNow;

        await CreateController(dbContext).Sync(
            SyncRequest(
                Answer(card.Id, PracticeOutcome.GotIt, Earlier),
                Answer(card.Id, PracticeOutcome.GotIt, DateTimeOffset.UtcNow.AddDays(1))),
            CancellationToken.None);

        var saved = await dbContext.PracticeResults.OrderBy(item => item.Id).Select(item => item.PracticedAt).ToListAsync();
        Assert.Equal(Earlier, saved[0]);
        Assert.InRange(saved[1], before, DateTimeOffset.UtcNow);
    }

    [Fact]
    public async Task Sync_SkipsAnAnswerRecordedMeanwhile()
    {
        var databaseName = TestDb.NewDatabaseName();
        var cardId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"));
        var answer = Answer(cardId, PracticeOutcome.GotIt, Earlier);
        // Another request, sent before this one heard back, records the same answer first.
        var interceptor = new UniqueIndexInterceptor(async () =>
        {
            await using var otherRequest = TestDb.Create(databaseName);
            otherRequest.PracticeResults.Add(new PracticeResult
            {
                ClientId = answer.Id,
                FlashCardId = cardId,
                Outcome = PracticeOutcome.GotIt,
                PracticedAt = Earlier
            });
            await otherRequest.SaveChangesAsync();
        });

        await using var dbContext = TestDb.Create(databaseName, interceptors: interceptor);
        var result = await CreateController(dbContext).Sync(
            SyncRequest(answer, Answer(cardId, PracticeOutcome.Failed, Earlier.AddMinutes(1))), CancellationToken.None);

        Assert.Equal(1, ActionResultAssert.Ok<PracticeResultsSyncResponse>(result.Result).Accepted);
        Assert.Equal(
            [PracticeOutcome.GotIt, PracticeOutcome.Failed],
            await dbContext.PracticeResults.OrderBy(item => item.Id).Select(item => item.Outcome).ToListAsync());
    }

    [Fact]
    public async Task Sync_Throws_WhenTheSaveFailsForAnotherReason()
    {
        var databaseName = TestDb.NewDatabaseName();
        var cardId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"));

        await using var dbContext = TestDb.Create(
            databaseName, interceptors: FailingSaveInterceptor.DuplicateKey("PracticeResults"));

        await Assert.ThrowsAsync<DbUpdateException>(() => CreateController(dbContext).Sync(
            SyncRequest(Answer(cardId, PracticeOutcome.GotIt, Earlier)), CancellationToken.None));
    }

    [Fact]
    public async Task PostSync_AcceptsTheOutcomeByName()
    {
        using var client = TestApp.CreateSignedInClient(factory);
        var card = await CreateCardAsync(client);

        var response = await client.PostAsJsonAsync(
            "/api/flashcards/practice-results",
            new
            {
                results = new[]
                {
                    new { id = Guid.NewGuid(), flashCardId = card.Id, outcome = "WasClose", practicedAt = Earlier }
                }
            });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("""{"accepted":1}""", await response.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("""{"results":[]}""")]
    [InlineData("""{"results":[{"flashCardId":1,"outcome":"GotIt","practicedAt":"2026-10-01T09:00:00Z"}]}""")]
    [InlineData("""{"results":[{"id":"8a1f0c6e-3b7d-4c55-9a43-5f0e2d6b7c11","outcome":"GotIt","practicedAt":"2026-10-01T09:00:00Z"}]}""")]
    [InlineData("""{"results":[{"id":"8a1f0c6e-3b7d-4c55-9a43-5f0e2d6b7c11","flashCardId":1,"outcome":"GotIt"}]}""")]
    [InlineData("""{"results":[{"id":"8a1f0c6e-3b7d-4c55-9a43-5f0e2d6b7c11","flashCardId":1,"practicedAt":"2026-10-01T09:00:00Z"}]}""")]
    [InlineData("""{"results":[{"id":"8a1f0c6e-3b7d-4c55-9a43-5f0e2d6b7c11","flashCardId":1,"outcome":"Maybe","practicedAt":"2026-10-01T09:00:00Z"}]}""")]
    [InlineData("""{"results":[{"id":"8a1f0c6e-3b7d-4c55-9a43-5f0e2d6b7c11","flashCardId":1,"outcome":42,"practicedAt":"2026-10-01T09:00:00Z"}]}""")]
    [InlineData("""{"results":[{"id":"not-a-guid","flashCardId":1,"outcome":"GotIt","practicedAt":"2026-10-01T09:00:00Z"}]}""")]
    public async Task PostSync_ReturnsBadRequest_ForAMissingOrInvalidAnswer(string body)
    {
        using var client = TestApp.CreateSignedInClient(factory);
        using var content = new StringContent(body, MediaTypeHeaderValue.Parse("application/json"));

        var response = await client.PostAsync("/api/flashcards/practice-results", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PostSync_ReturnsBadRequest_ForMoreAnswersThanTheLimit()
    {
        using var client = TestApp.CreateSignedInClient(factory);
        var card = await CreateCardAsync(client);
        var results = Enumerable.Range(0, PracticeResultsSyncRequest.MaxResults + 1)
            .Select(_ => new { id = Guid.NewGuid(), flashCardId = card.Id, outcome = "GotIt", practicedAt = Earlier });

        var response = await client.PostAsJsonAsync("/api/flashcards/practice-results", new { results });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(
            0,
            (await client.GetFromJsonAsync<FlashCardScoresResponse>("/api/flashcards/scores"))!.Cards.Single().GotIt);
    }

    private static PracticeResultSyncItem Answer(int flashCardId, PracticeOutcome outcome, DateTimeOffset practicedAt)
    {
        return new PracticeResultSyncItem
        {
            Id = Guid.NewGuid(),
            FlashCardId = flashCardId,
            Outcome = outcome,
            PracticedAt = practicedAt
        };
    }

    private static PracticeResultsSyncRequest SyncRequest(params PracticeResultSyncItem[] answers)
    {
        return new PracticeResultsSyncRequest { Results = [.. answers] };
    }

    private static PracticeSelection AllCards => new();

    private static PracticeResultsController CreateController(FlashCardDbContext dbContext)
    {
        return new PracticeResultsController(dbContext, NullLogger<PracticeResultsController>.Instance);
    }

    private static async Task<IdResponse> CreateCardAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync("/api/flashcards", TestDb.CardBody("el gato", "the cat"));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<IdResponse>())!;
    }
}
