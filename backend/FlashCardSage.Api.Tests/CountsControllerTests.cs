using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Tests;

public class CountsControllerTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 23, 10, 0, 0, TimeSpan.Zero);

    // A Got it! answer to the card.
    private static PracticeResult Answer(FlashCard card)
    {
        return new PracticeResult { FlashCard = card, Outcome = PracticeOutcome.GotIt, PracticedAt = Now };
    }

    [Fact]
    public async Task Get_CountsOnlyTheUsersCardsDecksTagsAndAnswers()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext =>
        {
            var theirs = TestDb.Card("la casa", "the house", ["Home"]);
            otherContext.Decks.Add(new Deck { Name = "Theirs", FlashCards = [theirs] });
            otherContext.PracticeResults.Add(Answer(theirs));
        });

        await using var dbContext = TestDb.Create(databaseName);
        var food = new Tag { Name = "Food" };
        var bread = new FlashCard { Words = TestDb.Words("el pan", "the bread"), Tags = [food] };
        dbContext.FlashCards.AddRange(
            bread,
            new FlashCard { Words = TestDb.Words("el queso", "the cheese"), Tags = [food] },
            TestDb.Card("el gato", "the cat"));
        dbContext.Tags.Add(new Tag { Name = "Travel" });
        dbContext.Decks.Add(new Deck { Name = "Week 1" });
        dbContext.PracticeResults.AddRange(Answer(bread), Answer(bread));
        await dbContext.SaveChangesAsync();
        var controller = new CountsController(new CountsService(dbContext));

        var result = await controller.Get();

        var counts = ActionResultAssert.Ok<CountsResponse>(result.Result);
        Assert.Equal(new CountsResponse(3, 1, 2, 2), counts);
    }

    [Fact]
    public async Task Get_ReturnsZeros_ForANewUser()
    {
        await using var dbContext = TestDb.Create();
        var controller = new CountsController(new CountsService(dbContext));

        var result = await controller.Get();

        Assert.Equal(new CountsResponse(0, 0, 0, 0), Assert.IsType<OkObjectResult>(result.Result).Value);
    }
}
