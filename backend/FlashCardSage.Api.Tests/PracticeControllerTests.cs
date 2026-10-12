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

        var result = await CreateController(dbContext).GetNext();

        Assert.IsType<NoContentResult>(result.Result);
    }

    [Fact]
    public async Task GetNext_ReturnsOneOfTheUsersCards()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            otherContext.FlashCards.Add(new FlashCard { Spanish = "el perro", English = "the dog" });
            await otherContext.SaveChangesAsync();
        }

        await using var dbContext = TestDb.Create(databaseName);
        var card = new FlashCard { Spanish = "el gato", English = "the cat" };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).GetNext();

        var next = Assert.IsType<PracticeCard>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal((card.Id, "el gato", "the cat"), (next.Id, next.Spanish, next.English));
    }

    [Fact]
    public async Task GetNext_IsServedAlongsideTheCardRoutes()
    {
        using var client = CreateClient();
        var empty = await client.GetAsync("/api/flashcards/practice/next");
        var created = await client.PostAsJsonAsync("/api/flashcards", new { spanish = "el gato", english = "the cat" });
        created.EnsureSuccessStatusCode();

        var next = await client.GetFromJsonAsync<PracticeCard>("/api/flashcards/practice/next");

        Assert.Equal(HttpStatusCode.NoContent, empty.StatusCode);
        Assert.Equal("el gato", next!.Spanish);
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
