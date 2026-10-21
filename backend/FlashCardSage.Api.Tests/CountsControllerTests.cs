using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Tests;

public class CountsControllerTests
{
    [Fact]
    public async Task Get_CountsOnlyTheUsersCardsDecksAndTags()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.Decks.Add(
            new Deck { Name = "Theirs", FlashCards = [TestDb.Card("la casa", "the house", ["Home"])] }));

        await using var dbContext = TestDb.Create(databaseName);
        var food = new Tag { Name = "Food" };
        dbContext.FlashCards.AddRange(
            new FlashCard { Words = TestDb.Words("el pan", "the bread"), Tags = [food] },
            new FlashCard { Words = TestDb.Words("el queso", "the cheese"), Tags = [food] },
            TestDb.Card("el gato", "the cat"));
        dbContext.Tags.Add(new Tag { Name = "Travel" });
        dbContext.Decks.Add(new Deck { Name = "Week 1" });
        await dbContext.SaveChangesAsync();
        var controller = new CountsController(new CountsService(dbContext));

        var result = await controller.Get();

        var counts = ActionResultAssert.Ok<CountsResponse>(result.Result);
        Assert.Equal(new CountsResponse(3, 1, 2), counts);
    }

    [Fact]
    public async Task Get_ReturnsZeros_ForANewUser()
    {
        await using var dbContext = TestDb.Create();
        var controller = new CountsController(new CountsService(dbContext));

        var result = await controller.Get();

        Assert.Equal(new CountsResponse(0, 0, 0), Assert.IsType<OkObjectResult>(result.Result).Value);
    }
}
