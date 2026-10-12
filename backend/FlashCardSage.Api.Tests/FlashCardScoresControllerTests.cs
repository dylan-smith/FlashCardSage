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

public class FlashCardScoresControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private const PracticeOutcome GotIt = PracticeOutcome.GotIt;
    private const PracticeOutcome WasClose = PracticeOutcome.WasClose;
    private const PracticeOutcome Failed = PracticeOutcome.Failed;

    [Theory]
    [InlineData(0, 0)]
    [InlineData(1, 50)]
    [InlineData(2, 80)]
    [InlineData(3, 90)]
    [InlineData(4, 95)]
    [InlineData(5, 100)]
    [InlineData(6, 100)]
    public void FromStreak_ScoresEachRunOfCorrectAnswers(int correctInARow, int expected)
    {
        Assert.Equal(expected, PracticeScore.FromStreak(correctInARow));
    }

    [Fact]
    public async Task Get_ScoresACardNeverPracticedAsZero()
    {
        await using var dbContext = TestDb.Create();
        var card = await AddCardAsync(dbContext, "el gato", "the cat");

        var response = await GetAsync(dbContext);

        Assert.Equal([new FlashCardScore(card.Id, "el gato", "the cat", 0)], response.Cards);
    }

    [Theory]
    [InlineData(50, GotIt)]
    [InlineData(80, GotIt, GotIt)]
    [InlineData(90, GotIt, GotIt, GotIt)]
    [InlineData(95, GotIt, GotIt, GotIt, GotIt)]
    [InlineData(100, GotIt, GotIt, GotIt, GotIt, GotIt)]
    [InlineData(100, GotIt, GotIt, GotIt, GotIt, GotIt, GotIt, GotIt)]
    [InlineData(0, GotIt, GotIt, Failed)]
    [InlineData(0, GotIt, GotIt, WasClose)]
    [InlineData(50, GotIt, GotIt, GotIt, Failed, GotIt)]
    [InlineData(80, Failed, WasClose, GotIt, GotIt)]
    public async Task Get_ScoresACardFromItsLatestRunOfGotIt(int expected, params PracticeOutcome[] outcomes)
    {
        await using var dbContext = TestDb.Create();
        var card = await AddCardAsync(dbContext, "el gato", "the cat");
        await AddResultsAsync(dbContext, card, outcomes);

        var response = await GetAsync(dbContext);

        Assert.Equal(expected, Assert.Single(response.Cards).Score);
    }

    [Fact]
    public async Task Get_SortsLowestScoreFirstThenByCard_AndTotalsTheScores()
    {
        await using var dbContext = TestDb.Create();
        var cat = await AddCardAsync(dbContext, "el gato", "the cat");
        var dog = await AddCardAsync(dbContext, "el perro", "the dog");
        var house = await AddCardAsync(dbContext, "la casa", "the house");
        var book = await AddCardAsync(dbContext, "el libro", "the book");
        await AddResultsAsync(dbContext, cat, GotIt, GotIt);
        await AddResultsAsync(dbContext, dog, GotIt);
        await AddResultsAsync(dbContext, house, GotIt, Failed);

        var response = await GetAsync(dbContext);

        Assert.Equal(
            [(house.Id, 0), (book.Id, 0), (dog.Id, 50), (cat.Id, 80)],
            response.Cards.Select(card => (card.Id, card.Score)));
        Assert.Equal((130, 400), (response.Total, response.Maximum));
    }

    [Fact]
    public async Task Get_ReturnsNothing_WhenThereAreNoCards()
    {
        await using var dbContext = TestDb.Create();

        var response = await GetAsync(dbContext);

        Assert.Equal((0, 0), (response.Total, response.Maximum));
        Assert.Empty(response.Cards);
    }

    [Fact]
    public async Task Get_LeavesOutOtherUsersCardsAndResults()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            var other = await AddCardAsync(otherContext, "el perro", "the dog");
            await AddResultsAsync(otherContext, other, GotIt, GotIt);
        }

        await using var dbContext = TestDb.Create(databaseName);
        var card = await AddCardAsync(dbContext, "el gato", "the cat");

        var response = await GetAsync(dbContext);

        Assert.Equal([new FlashCardScore(card.Id, "el gato", "the cat", 0)], response.Cards);
        Assert.Equal((0, 100), (response.Total, response.Maximum));
    }

    [Fact]
    public async Task GetScores_IsServedAlongsideTheCardRoutes()
    {
        using var client = CreateClient();
        var created = await client.PostAsJsonAsync("/api/flashcards", new { spanish = "el gato", english = "the cat" });
        created.EnsureSuccessStatusCode();

        var response = await client.GetFromJsonAsync<FlashCardScoresResponse>("/api/flashcards/scores");

        Assert.Equal((0, 100), (response!.Total, response.Maximum));
        Assert.Equal("el gato", Assert.Single(response.Cards).Spanish);
    }

    private static async Task<FlashCard> AddCardAsync(FlashCardDbContext dbContext, string spanish, string english)
    {
        var card = new FlashCard { Spanish = spanish, English = english };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();
        return card;
    }

    // Saved in the order given, oldest first.
    private static async Task AddResultsAsync(
        FlashCardDbContext dbContext, FlashCard card, params PracticeOutcome[] outcomes)
    {
        foreach (var outcome in outcomes)
        {
            dbContext.PracticeResults.Add(new PracticeResult
            {
                FlashCardId = card.Id,
                Outcome = outcome,
                PracticedAt = DateTimeOffset.UtcNow
            });
            await dbContext.SaveChangesAsync();
        }
    }

    private static async Task<FlashCardScoresResponse> GetAsync(FlashCardDbContext dbContext)
    {
        var controller = new FlashCardScoresController(dbContext, NullLogger<FlashCardScoresController>.Instance);
        var result = await controller.Get();
        return Assert.IsType<FlashCardScoresResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
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
            new AuthenticationHeaderValue("Bearer", $"test:Scores {Guid.NewGuid()}");
        return client;
    }
}
