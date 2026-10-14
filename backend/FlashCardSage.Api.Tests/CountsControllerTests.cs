using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Tests;

public class CountsControllerTests
{
    [Fact]
    public async Task Get_CountsOnlyTheUsersCardsDecksAndTags()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            otherContext.Decks.Add(new Deck
            {
                Name = "Theirs",
                FlashCards = [new FlashCard { Words = TestDb.Words("la casa", "the house"), Tags = [new Tag { Name = "Home" }] }]
            });
            await otherContext.SaveChangesAsync();
        }

        await using var dbContext = TestDb.Create(databaseName);
        var food = new Tag { Name = "Food" };
        dbContext.FlashCards.AddRange(
            new FlashCard { Words = TestDb.Words("el pan", "the bread"), Tags = [food] },
            new FlashCard { Words = TestDb.Words("el queso", "the cheese"), Tags = [food] },
            new FlashCard { Words = TestDb.Words("el gato", "the cat") });
        dbContext.Tags.Add(new Tag { Name = "Travel" });
        dbContext.Decks.Add(new Deck { Name = "Week 1" });
        await dbContext.SaveChangesAsync();
        var controller = new CountsController(dbContext);

        var result = await controller.Get();

        var counts = Assert.IsType<CountsResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(new CountsResponse(3, 1, 2), counts);
    }

    [Fact]
    public async Task Get_ReturnsZeros_ForANewUser()
    {
        await using var dbContext = TestDb.Create();
        var controller = new CountsController(dbContext);

        var result = await controller.Get();

        Assert.Equal(new CountsResponse(0, 0, 0), Assert.IsType<OkObjectResult>(result.Result).Value);
    }
}
