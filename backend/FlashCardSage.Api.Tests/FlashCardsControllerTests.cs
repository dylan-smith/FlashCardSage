using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class FlashCardsControllerTests
{
    [Fact]
    public async Task Create_TrimsBothSides_AndPersistsFlashCard()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = "  el gato  ", English = " the cat " });

        var createdResult = Assert.IsType<CreatedAtActionResult>(result.Result);
        var card = Assert.IsType<FlashCard>(createdResult.Value);
        Assert.Equal(("el gato", "the cat"), (card.Spanish, card.English));

        var savedCard = await dbContext.FlashCards.SingleAsync();
        Assert.Equal(("el gato", "the cat"), (savedCard.Spanish, savedCard.English));
    }

    [Fact]
    public async Task Create_ReturnsValidationProblem_WhenSpanishIsBlank()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = "   ", English = "the cat" });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(["Spanish is required."], problem.Errors["Spanish"]);
        Assert.False(problem.Errors.ContainsKey("English"));
        Assert.False(await dbContext.FlashCards.AnyAsync());
    }

    [Fact]
    public async Task Create_ReturnsValidationProblem_WhenEnglishIsBlank()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = "el gato", English = "   " });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(["English is required."], problem.Errors["English"]);
        Assert.False(problem.Errors.ContainsKey("Spanish"));
        Assert.False(await dbContext.FlashCards.AnyAsync());
    }

    [Fact]
    public async Task Create_ReportsBothSides_WhenBothAreBlank()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = "", English = "" });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(["Spanish is required."], problem.Errors["Spanish"]);
        Assert.Equal(["English is required."], problem.Errors["English"]);
    }

    [Theory]
    [InlineData("el gato", "the cat", FlashCardsController.DuplicateSpanishMessage)]
    [InlineData("  El Gato ", "THE CAT", FlashCardsController.DuplicateSpanishMessage)]
    [InlineData("el gato", "the tomcat", FlashCardsController.DuplicateSpanishMessage)]
    [InlineData("el gatito", "The Cat", FlashCardsController.DuplicateEnglishMessage)]
    public async Task Create_ReturnsConflict_WhenEitherSideIsAlreadyOnACard(string spanish, string english, string message)
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        await controller.Create(new FlashCardRequest { Spanish = "el gato", English = "the cat" });
        var result = await controller.Create(new FlashCardRequest { Spanish = spanish, English = english });

        AssertDuplicateProblem(result.Result, message);
        Assert.Equal(1, await dbContext.FlashCards.CountAsync());
    }

    [Fact]
    public async Task Create_AllowsACardAnotherUserAlreadyHas()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            otherContext.FlashCards.Add(new FlashCard { Spanish = "el gato", English = "the cat" });
            await otherContext.SaveChangesAsync();
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = "el gato", English = "the cat" });

        Assert.IsType<CreatedAtActionResult>(result.Result);
    }

    [Fact]
    public async Task Create_GivesTheFlashCardToTheCurrentUser()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        await controller.Create(new FlashCardRequest { Spanish = "el gato", English = "the cat" });

        Assert.Equal(TestDb.UserId, (await dbContext.FlashCards.SingleAsync()).UserId);
    }

    [Fact]
    public async Task GetAll_ReturnsFlashCardsInTheOrderTheyWereMade()
    {
        await using var dbContext = TestDb.Create();
        dbContext.FlashCards.AddRange(
            new FlashCard { Spanish = "uno", English = "one" },
            new FlashCard { Spanish = "dos", English = "two" },
            new FlashCard { Spanish = "tres", English = "three" });
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.GetAll();

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var cards = Assert.IsAssignableFrom<IEnumerable<FlashCard>>(okResult.Value).ToList();
        Assert.Equal(["uno", "dos", "tres"], cards.Select(card => card.Spanish));
    }

    [Fact]
    public async Task GetById_ReturnsFlashCard_WhenItExists()
    {
        await using var dbContext = TestDb.Create();
        var card = new FlashCard { Spanish = "el gato", English = "the cat" };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.GetById(card.Id);

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var returnedCard = Assert.IsType<FlashCard>(okResult.Value);
        Assert.Equal((card.Id, "el gato"), (returnedCard.Id, returnedCard.Spanish));
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
        var card = new FlashCard { Spanish = "el gato", English = "the cat" };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.Update(card.Id, new FlashCardRequest { Spanish = "  el perro  ", English = "  the dog  " });

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var updatedCard = Assert.IsType<FlashCard>(okResult.Value);
        Assert.Equal(("el perro", "the dog"), (updatedCard.Spanish, updatedCard.English));

        var savedCard = await dbContext.FlashCards.SingleAsync(item => item.Id == card.Id);
        Assert.Equal(("el perro", "the dog"), (savedCard.Spanish, savedCard.English));
    }

    [Fact]
    public async Task Update_ReturnsValidationProblem_WhenEnglishIsBlank()
    {
        await using var dbContext = TestDb.Create();
        var card = new FlashCard { Spanish = "el gato", English = "the cat" };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.Update(card.Id, new FlashCardRequest { Spanish = "el perro", English = "" });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(["English is required."], problem.Errors["English"]);
        var savedCard = await dbContext.FlashCards.SingleAsync();
        Assert.Equal(("el gato", "the cat"), (savedCard.Spanish, savedCard.English));
    }

    [Theory]
    [InlineData("El perro", "the cat", FlashCardsController.DuplicateSpanishMessage)]
    [InlineData("el gato", "THE DOG", FlashCardsController.DuplicateEnglishMessage)]
    public async Task Update_ReturnsConflict_WhenEitherSideIsOnAnotherCard(string spanish, string english, string message)
    {
        await using var dbContext = TestDb.Create();
        var card = new FlashCard { Spanish = "el gato", English = "the cat" };
        dbContext.FlashCards.AddRange(card, new FlashCard { Spanish = "el perro", English = "the dog" });
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.Update(card.Id, new FlashCardRequest { Spanish = spanish, English = english });

        AssertDuplicateProblem(result.Result, message);
        var savedCard = await dbContext.FlashCards.AsNoTracking().SingleAsync(item => item.Id == card.Id);
        Assert.Equal(("el gato", "the cat"), (savedCard.Spanish, savedCard.English));
    }

    [Fact]
    public async Task Update_AllowsSavingTheCardUnchanged()
    {
        await using var dbContext = TestDb.Create();
        var card = new FlashCard { Spanish = "el gato", English = "the cat" };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.Update(card.Id, new FlashCardRequest { Spanish = "El gato", English = "the cat" });

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal("El gato", (await dbContext.FlashCards.SingleAsync()).Spanish);
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenFlashCardDoesNotExist()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Update(999, new FlashCardRequest { Spanish = "el gato", English = "the cat" });

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_AndRemovesFlashCard()
    {
        await using var dbContext = TestDb.Create();
        var card = new FlashCard { Spanish = "el gato", English = "the cat" };
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
            var other = new FlashCard { Spanish = "suyo", English = "theirs" };
            otherContext.FlashCards.Add(other);
            await otherContext.SaveChangesAsync();
            otherId = other.Id;
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        var all = Assert.IsType<OkObjectResult>((await controller.GetAll()).Result);
        Assert.Empty(Assert.IsAssignableFrom<IEnumerable<FlashCard>>(all.Value));
        Assert.IsType<NotFoundResult>((await controller.GetById(otherId)).Result);
        Assert.IsType<NotFoundResult>((await controller.Update(otherId, new FlashCardRequest { Spanish = "mío", English = "mine" })).Result);
        Assert.IsType<NotFoundResult>(await controller.Delete(otherId));
    }

    [Fact]
    public async Task Create_MakesNewTags_AndReusesExistingOnesWhateverTheirCase()
    {
        await using var dbContext = TestDb.Create();
        dbContext.Tags.Add(new Tag { Name = "Food" });
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest
        {
            Spanish = "la manzana",
            English = "the apple",
            Tags = [" Fruit ", "food", "", "  ", "FRUIT"]
        });

        var card = Assert.IsType<FlashCard>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.Equal(["Food", "Fruit"], card.Tags.Select(tag => tag.Name));
        Assert.Equal(["Food", "Fruit"], await dbContext.Tags.OrderBy(tag => tag.Name).Select(tag => tag.Name).ToListAsync());
        Assert.All(await dbContext.Tags.ToListAsync(), tag => Assert.Equal(TestDb.UserId, tag.UserId));
    }

    [Fact]
    public async Task Create_ReturnsValidationProblem_WhenATagIsTooLong()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest
        {
            Spanish = "el gato",
            English = "the cat",
            Tags = [new string('a', Tag.MaxNameLength + 1)]
        });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(["Tags can be at most 50 characters."], problem.Errors["Tags"]);
        Assert.False(await dbContext.FlashCards.AnyAsync());
        Assert.False(await dbContext.Tags.AnyAsync());
    }

    [Fact]
    public async Task Create_DoesNotReuseAnotherUsersTag()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            otherContext.Tags.Add(new Tag { Name = "Food" });
            await otherContext.SaveChangesAsync();
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = "el pan", English = "the bread", Tags = ["Food"] });

        var card = Assert.IsType<FlashCard>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.Equal(TestDb.UserId, Assert.Single(card.Tags).UserId);
        Assert.Equal(2, await dbContext.Tags.IgnoreQueryFilters().CountAsync());
    }

    [Fact]
    public async Task Update_ReplacesTheCardsTags()
    {
        var databaseName = Guid.NewGuid().ToString();
        int cardId;
        await using (var setupContext = TestDb.Create(databaseName))
        {
            var card = new FlashCard { Spanish = "lunes", English = "Monday", Tags = [new Tag { Name = "Days" }, new Tag { Name = "Food" }] };
            setupContext.FlashCards.Add(card);
            await setupContext.SaveChangesAsync();
            cardId = card.Id;
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        var result = await controller.Update(cardId, new FlashCardRequest { Spanish = "lunes", English = "Monday", Tags = ["days", "Weekdays"] });

        var updatedCard = Assert.IsType<FlashCard>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(["Days", "Weekdays"], updatedCard.Tags.Select(tag => tag.Name));

        await using var checkContext = TestDb.Create(databaseName);
        var savedCard = await checkContext.FlashCards.Include(card => card.Tags).SingleAsync();
        Assert.Equal(["Days", "Weekdays"], savedCard.Tags.Select(tag => tag.Name).Order());
        // The tag that came off the card is still there to use again.
        Assert.Equal(3, await checkContext.Tags.CountAsync());
    }

    [Fact]
    public async Task GetAll_ReturnsEachCardsTagsInNameOrder()
    {
        await using var dbContext = TestDb.Create();
        dbContext.FlashCards.Add(new FlashCard { Spanish = "enero", English = "January", Tags = [new Tag { Name = "Months" }, new Tag { Name = "Calendar" }] });
        await dbContext.SaveChangesAsync();
        dbContext.ChangeTracker.Clear();

        var controller = CreateController(dbContext);

        var result = await controller.GetAll();

        var cards = Assert.IsAssignableFrom<IEnumerable<FlashCard>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(["Calendar", "Months"], Assert.Single(cards).Tags.Select(tag => tag.Name));
    }

    [Fact]
    public async Task Delete_KeepsTheCardsTags()
    {
        await using var dbContext = TestDb.Create();
        var card = new FlashCard { Spanish = "el gato", English = "the cat", Tags = [new Tag { Name = "Animals" }] };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();
        dbContext.ChangeTracker.Clear();

        var controller = CreateController(dbContext);

        Assert.IsType<NoContentResult>(await controller.Delete(card.Id));
        Assert.False(await dbContext.FlashCards.AnyAsync());
        Assert.Equal("Animals", (await dbContext.Tags.SingleAsync()).Name);
    }

    private static void AssertDuplicateProblem(IActionResult? result, string message)
    {
        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status409Conflict, objectResult.StatusCode);
        Assert.Equal(message, Assert.IsType<ProblemDetails>(objectResult.Value).Detail);
    }

    private static FlashCardsController CreateController(FlashCardDbContext dbContext)
    {
        return new FlashCardsController(dbContext, NullLogger<FlashCardsController>.Instance);
    }
}
