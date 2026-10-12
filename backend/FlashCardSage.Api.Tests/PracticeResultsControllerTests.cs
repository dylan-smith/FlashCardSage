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
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class PracticeResultsControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Theory]
    [InlineData(PracticeOutcome.GotIt)]
    [InlineData(PracticeOutcome.WasClose)]
    [InlineData(PracticeOutcome.Failed)]
    public async Task Create_RecordsTheOutcomeAndWhenForTheCard(PracticeOutcome outcome)
    {
        await using var dbContext = TestDb.Create();
        var card = await AddCardAsync(dbContext);
        var controller = CreateController(dbContext);
        var before = DateTimeOffset.UtcNow;

        var result = await controller.Create(card.Id, new PracticeResultRequest { Outcome = outcome });

        Assert.IsType<NoContentResult>(result);
        var saved = await dbContext.PracticeResults.SingleAsync();
        Assert.Equal((card.Id, outcome), (saved.FlashCardId, saved.Outcome));
        Assert.InRange(saved.PracticedAt, before, DateTimeOffset.UtcNow);
    }

    [Fact]
    public async Task Create_KeepsEveryResult()
    {
        await using var dbContext = TestDb.Create();
        var card = await AddCardAsync(dbContext);
        var controller = CreateController(dbContext);

        await controller.Create(card.Id, new PracticeResultRequest { Outcome = PracticeOutcome.Failed });
        await controller.Create(card.Id, new PracticeResultRequest { Outcome = PracticeOutcome.GotIt });

        Assert.Equal(
            [PracticeOutcome.Failed, PracticeOutcome.GotIt],
            await dbContext.PracticeResults.OrderBy(item => item.Id).Select(item => item.Outcome).ToListAsync());
    }

    [Fact]
    public async Task Create_ReturnsNotFound_WhenFlashCardDoesNotExist()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Create(999, new PracticeResultRequest { Outcome = PracticeOutcome.GotIt });

        Assert.IsType<NotFoundResult>(result);
        Assert.False(await dbContext.PracticeResults.AnyAsync());
    }

    [Fact]
    public async Task Create_ReturnsNotFound_ForAnotherUsersFlashCard()
    {
        var databaseName = Guid.NewGuid().ToString();
        int otherId;
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            otherId = (await AddCardAsync(otherContext)).Id;
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        var result = await controller.Create(otherId, new PracticeResultRequest { Outcome = PracticeOutcome.GotIt });

        Assert.IsType<NotFoundResult>(result);
        Assert.False(await dbContext.PracticeResults.IgnoreQueryFilters().AnyAsync());
    }

    [Fact]
    public async Task OtherUsersPracticeResults_AreNotVisible()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            var other = await AddCardAsync(otherContext);
            await CreateController(otherContext)
                .Create(other.Id, new PracticeResultRequest { Outcome = PracticeOutcome.GotIt });
        }

        await using var dbContext = TestDb.Create(databaseName);

        Assert.False(await dbContext.PracticeResults.AnyAsync());
    }

    [Fact]
    public async Task Post_AcceptsTheOutcomeByName()
    {
        using var client = CreateClient();
        var card = await CreateCardAsync(client);

        var response = await client.PostAsJsonAsync(
            $"/api/flashcards/{card.Id}/practice-results", new { outcome = "WasClose" });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("""{"outcome":"Maybe"}""")]
    [InlineData("""{"outcome":42}""")]
    public async Task Post_ReturnsBadRequest_ForAMissingOrUnknownOutcome(string body)
    {
        using var client = CreateClient();
        var card = await CreateCardAsync(client);

        var response = await client.PostAsync(
            $"/api/flashcards/{card.Id}/practice-results",
            new StringContent(body, MediaTypeHeaderValue.Parse("application/json")));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private static async Task<FlashCard> AddCardAsync(FlashCardDbContext dbContext)
    {
        var card = new FlashCard { Spanish = "el gato", English = "the cat" };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();
        return card;
    }

    private static PracticeResultsController CreateController(FlashCardDbContext dbContext)
    {
        return new PracticeResultsController(dbContext, NullLogger<PracticeResultsController>.Instance);
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

    private static async Task<IdResponse> CreateCardAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync("/api/flashcards", new { spanish = "el gato", english = "the cat" });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<IdResponse>())!;
    }

    private sealed record IdResponse(int Id);
}
