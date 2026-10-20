using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class PracticeResultsControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    // A time some while ago, when answers were given on the device.
    private static readonly DateTimeOffset Earlier = new(2026, 10, 1, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task OtherUsersPracticeResults_AreNotVisible()
    {
        var databaseName = TestDb.NewDatabaseName();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            var other = await TestDb.AddCardAsync(otherContext, TestDb.Card("el gato", "the cat"));
            await CreateController(otherContext).Sync(
                SyncRequest(Answer(other.Id, PracticeOutcome.GotIt, Earlier)), CancellationToken.None);
        }

        await using var dbContext = TestDb.Create(databaseName);

        Assert.False(await dbContext.PracticeResults.AnyAsync());
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

    private static PracticeResultRequest Answer(int flashCardId, PracticeOutcome outcome, DateTimeOffset practicedAt)
    {
        return new PracticeResultRequest
        {
            Id = Guid.NewGuid(),
            FlashCardId = flashCardId,
            Outcome = outcome,
            PracticedAt = practicedAt
        };
    }

    private static PracticeResultsSyncRequest SyncRequest(params PracticeResultRequest[] answers)
    {
        return new PracticeResultsSyncRequest { Results = [.. answers] };
    }

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
