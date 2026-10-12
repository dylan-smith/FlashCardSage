using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class FlashCardsControllerTests
{
    [Fact]
    public async Task Create_TrimsTitle_AndPersistsFlashCard()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Title = "  el gato  " });

        var createdResult = Assert.IsType<CreatedAtActionResult>(result.Result);
        var card = Assert.IsType<FlashCard>(createdResult.Value);
        Assert.Equal("el gato", card.Title);

        var savedCard = await dbContext.FlashCards.SingleAsync();
        Assert.Equal("el gato", savedCard.Title);
    }

    [Fact]
    public async Task Create_ReturnsValidationProblem_WhenTitleIsBlank()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Title = "   " });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(["Title is required."], problem.Errors["Title"]);
        Assert.False(await dbContext.FlashCards.AnyAsync());
    }

    [Fact]
    public async Task Create_AllowsTheSameTitleTwice()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        await controller.Create(new FlashCardRequest { Title = "el gato" });
        var result = await controller.Create(new FlashCardRequest { Title = "el gato" });

        Assert.IsType<CreatedAtActionResult>(result.Result);
        Assert.Equal(2, await dbContext.FlashCards.CountAsync());
    }

    [Fact]
    public async Task Create_GivesTheFlashCardToTheCurrentUser()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        await controller.Create(new FlashCardRequest { Title = "el gato" });

        Assert.Equal(TestDb.UserId, (await dbContext.FlashCards.SingleAsync()).UserId);
    }

    [Fact]
    public async Task GetAll_ReturnsFlashCardsInTheOrderTheyWereMade()
    {
        await using var dbContext = TestDb.Create();
        dbContext.FlashCards.AddRange(
            new FlashCard { Title = "uno" },
            new FlashCard { Title = "dos" },
            new FlashCard { Title = "tres" });
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.GetAll();

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var cards = Assert.IsAssignableFrom<IEnumerable<FlashCard>>(okResult.Value).ToList();
        Assert.Equal(["uno", "dos", "tres"], cards.Select(card => card.Title));
    }

    [Fact]
    public async Task GetById_ReturnsFlashCard_WhenItExists()
    {
        await using var dbContext = TestDb.Create();
        var card = new FlashCard { Title = "el gato" };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.GetById(card.Id);

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var returnedCard = Assert.IsType<FlashCard>(okResult.Value);
        Assert.Equal((card.Id, "el gato"), (returnedCard.Id, returnedCard.Title));
    }

    [Fact]
    public async Task GetById_ReturnsNotFound_WhenFlashCardDoesNotExist()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.GetById(999);

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Update_ReturnsOk_AndUpdatesFlashCard()
    {
        await using var dbContext = TestDb.Create();
        var card = new FlashCard { Title = "el gato" };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.Update(card.Id, new FlashCardRequest { Title = "  el perro  " });

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var updatedCard = Assert.IsType<FlashCard>(okResult.Value);
        Assert.Equal("el perro", updatedCard.Title);

        var savedCard = await dbContext.FlashCards.SingleAsync(item => item.Id == card.Id);
        Assert.Equal("el perro", savedCard.Title);
    }

    [Fact]
    public async Task Update_ReturnsValidationProblem_WhenTitleIsBlank()
    {
        await using var dbContext = TestDb.Create();
        var card = new FlashCard { Title = "el gato" };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.Update(card.Id, new FlashCardRequest { Title = "" });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(["Title is required."], problem.Errors["Title"]);
        Assert.Equal("el gato", (await dbContext.FlashCards.SingleAsync()).Title);
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenFlashCardDoesNotExist()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Update(999, new FlashCardRequest { Title = "el gato" });

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_AndRemovesFlashCard()
    {
        await using var dbContext = TestDb.Create();
        var card = new FlashCard { Title = "el gato" };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.Delete(card.Id);

        Assert.IsType<NoContentResult>(result);
        Assert.False(await dbContext.FlashCards.AnyAsync(item => item.Id == card.Id));
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenFlashCardDoesNotExist()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Delete(999);

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task OtherUsersFlashCards_AreNotListedOrFound()
    {
        var databaseName = Guid.NewGuid().ToString();
        int otherId;
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            var other = new FlashCard { Title = "Theirs" };
            otherContext.FlashCards.Add(other);
            await otherContext.SaveChangesAsync();
            otherId = other.Id;
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        var all = Assert.IsType<OkObjectResult>((await controller.GetAll()).Result);
        Assert.Empty(Assert.IsAssignableFrom<IEnumerable<FlashCard>>(all.Value));
        Assert.IsType<NotFoundResult>((await controller.GetById(otherId)).Result);
        Assert.IsType<NotFoundResult>((await controller.Update(otherId, new FlashCardRequest { Title = "Mine" })).Result);
        Assert.IsType<NotFoundResult>(await controller.Delete(otherId));
    }

    private static FlashCardsController CreateController(FlashCardDbContext dbContext)
    {
        return new FlashCardsController(dbContext, NullLogger<FlashCardsController>.Instance);
    }
}
