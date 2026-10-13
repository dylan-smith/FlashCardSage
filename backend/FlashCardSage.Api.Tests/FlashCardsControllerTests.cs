using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Translation;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class FlashCardsControllerTests
{
    [Fact]
    public async Task Create_TrimsBothSides_AndPersistsFlashCard()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = ["  el gato  "], English = [" the cat "] });

        var createdResult = Assert.IsType<CreatedAtActionResult>(result.Result);
        var card = Assert.IsType<FlashCard>(createdResult.Value);
        Assert.Equal(("el gato", "the cat"), (card.Spanish.Single(), card.English.Single()));

        var savedCard = await dbContext.FlashCards.Include(c => c.Words).SingleAsync();
        Assert.Equal(("el gato", "the cat"), (savedCard.Spanish.Single(), savedCard.English.Single()));
    }

    [Fact]
    public async Task Create_ReturnsValidationProblem_WhenSpanishIsBlank()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = ["   "], English = ["the cat"] });

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

        var result = await controller.Create(new FlashCardRequest { Spanish = ["el gato"], English = ["   "] });

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

        var result = await controller.Create(new FlashCardRequest { Spanish = [""], English = [""] });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(["Spanish is required."], problem.Errors["Spanish"]);
        Assert.Equal(["English is required."], problem.Errors["English"]);
    }

    [Theory]
    [InlineData("el gato", "the cat", Language.Spanish, "el gato")]
    [InlineData("  El Gato ", "THE CAT", Language.Spanish, "el gato")]
    [InlineData("el gato", "the tomcat", Language.Spanish, "el gato")]
    [InlineData("el gatito", "The Cat", Language.English, "the cat")]
    public async Task Create_ReturnsConflict_WhenEitherSideIsAlreadyOnACard(string spanish, string english, Language language, string word)
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        await controller.Create(new FlashCardRequest { Spanish = ["el gato"], English = ["the cat"] });
        var result = await controller.Create(new FlashCardRequest { Spanish = [spanish], English = [english] });

        AssertDuplicateProblem(result.Result, FlashCardsController.DuplicateMessage(language, word));
        Assert.Equal(1, await dbContext.FlashCards.CountAsync());
    }

    [Fact]
    public async Task Create_AllowsACardAnotherUserAlreadyHas()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            otherContext.FlashCards.Add(new FlashCard { Words = TestDb.Words("el gato", "the cat") });
            await otherContext.SaveChangesAsync();
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = ["el gato"], English = ["the cat"] });

        Assert.IsType<CreatedAtActionResult>(result.Result);
    }

    [Fact]
    public async Task Create_GivesTheFlashCardToTheCurrentUser()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        await controller.Create(new FlashCardRequest { Spanish = ["el gato"], English = ["the cat"] });

        Assert.Equal(TestDb.UserId, (await dbContext.FlashCards.Include(c => c.Words).SingleAsync()).UserId);
    }

    [Fact]
    public async Task GetAll_ReturnsFlashCardsInTheOrderTheyWereMade()
    {
        await using var dbContext = TestDb.Create();
        dbContext.FlashCards.AddRange(
            new FlashCard { Words = TestDb.Words("uno", "one") },
            new FlashCard { Words = TestDb.Words("dos", "two") },
            new FlashCard { Words = TestDb.Words("tres", "three") });
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.GetAll();

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var cards = Assert.IsAssignableFrom<IEnumerable<FlashCard>>(okResult.Value).ToList();
        Assert.Equal(["uno", "dos", "tres"], cards.Select(card => card.Spanish.Single()));
    }

    [Fact]
    public async Task GetById_ReturnsFlashCard_WhenItExists()
    {
        await using var dbContext = TestDb.Create();
        var card = new FlashCard { Words = TestDb.Words("el gato", "the cat") };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.GetById(card.Id);

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var returnedCard = Assert.IsType<FlashCard>(okResult.Value);
        Assert.Equal((card.Id, "el gato"), (returnedCard.Id, returnedCard.Spanish.Single()));
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
        var card = new FlashCard { Words = TestDb.Words("el gato", "the cat") };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.Update(card.Id, new FlashCardRequest { Spanish = ["  el perro  "], English = ["  the dog  "] });

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var updatedCard = Assert.IsType<FlashCard>(okResult.Value);
        Assert.Equal(("el perro", "the dog"), (updatedCard.Spanish.Single(), updatedCard.English.Single()));

        var savedCard = await dbContext.FlashCards.Include(c => c.Words).SingleAsync(item => item.Id == card.Id);
        Assert.Equal(("el perro", "the dog"), (savedCard.Spanish.Single(), savedCard.English.Single()));
    }

    [Fact]
    public async Task Update_ReturnsValidationProblem_WhenEnglishIsBlank()
    {
        await using var dbContext = TestDb.Create();
        var card = new FlashCard { Words = TestDb.Words("el gato", "the cat") };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.Update(card.Id, new FlashCardRequest { Spanish = ["el perro"], English = [""] });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(["English is required."], problem.Errors["English"]);
        var savedCard = await dbContext.FlashCards.Include(c => c.Words).SingleAsync();
        Assert.Equal(("el gato", "the cat"), (savedCard.Spanish.Single(), savedCard.English.Single()));
    }

    [Theory]
    [InlineData("El perro", "the cat", Language.Spanish, "el perro")]
    [InlineData("el gato", "THE DOG", Language.English, "the dog")]
    public async Task Update_ReturnsConflict_WhenEitherSideIsOnAnotherCard(string spanish, string english, Language language, string word)
    {
        await using var dbContext = TestDb.Create();
        var card = new FlashCard { Words = TestDb.Words("el gato", "the cat") };
        dbContext.FlashCards.AddRange(card, new FlashCard { Words = TestDb.Words("el perro", "the dog") });
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.Update(card.Id, new FlashCardRequest { Spanish = [spanish], English = [english] });

        AssertDuplicateProblem(result.Result, FlashCardsController.DuplicateMessage(language, word));
        var savedCard = await dbContext.FlashCards.AsNoTracking().Include(c => c.Words).SingleAsync(item => item.Id == card.Id);
        Assert.Equal(("el gato", "the cat"), (savedCard.Spanish.Single(), savedCard.English.Single()));
    }

    [Fact]
    public async Task Update_AllowsSavingTheCardUnchanged()
    {
        await using var dbContext = TestDb.Create();
        var card = new FlashCard { Words = TestDb.Words("el gato", "the cat") };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.Update(card.Id, new FlashCardRequest { Spanish = ["El gato"], English = ["the cat"] });

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal("El gato", (await dbContext.FlashCards.Include(c => c.Words).SingleAsync()).Spanish.Single());
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenFlashCardDoesNotExist()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Update(999, new FlashCardRequest { Spanish = ["el gato"], English = ["the cat"] });

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_AndRemovesFlashCard()
    {
        await using var dbContext = TestDb.Create();
        var card = new FlashCard { Words = TestDb.Words("el gato", "the cat") };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.Delete(card.Id);

        Assert.IsType<NoContentResult>(result);
        Assert.False(await dbContext.FlashCards.AnyAsync(item => item.Id == card.Id));
    }

    [Fact]
    public async Task Delete_RemovesTheCardsWords_SoTheyCanGoOnANewCard()
    {
        var databaseName = Guid.NewGuid().ToString();
        var cardId = await SaveCardAsync(databaseName, "el gato", "the cat");
        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        Assert.IsType<NoContentResult>(await controller.Delete(cardId));

        Assert.False(await dbContext.FlashCardWords.AnyAsync());
        var result = await controller.Create(new FlashCardRequest { Spanish = ["el gato"], English = ["the cat"] });
        Assert.IsType<CreatedAtActionResult>(result.Result);
    }

    [Fact]
    public async Task Delete_RemovesTheCardsPicture()
    {
        await using var dbContext = TestDb.Create();
        var card = new FlashCard
        {
            Words = TestDb.Words("nadar", "to swim"),
            ImageUrl = "https://images.test/card-images/swim.jpg"
        };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();
        var store = new FakeImageStore();
        var controller = new FlashCardsController(dbContext, store, NullLogger<FlashCardsController>.Instance);

        Assert.IsType<NoContentResult>(await controller.Delete(card.Id));

        Assert.Equal(["https://images.test/card-images/swim.jpg"], store.Deleted);
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
            var other = new FlashCard { Words = TestDb.Words("suyo", "theirs") };
            otherContext.FlashCards.Add(other);
            await otherContext.SaveChangesAsync();
            otherId = other.Id;
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        var all = Assert.IsType<OkObjectResult>((await controller.GetAll()).Result);
        Assert.Empty(Assert.IsAssignableFrom<IEnumerable<FlashCard>>(all.Value));
        Assert.IsType<NotFoundResult>((await controller.GetById(otherId)).Result);
        Assert.IsType<NotFoundResult>((await controller.Update(otherId, new FlashCardRequest { Spanish = ["mío"], English = ["mine"] })).Result);
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
            Spanish = ["la manzana"],
            English = ["the apple"],
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
            Spanish = ["el gato"],
            English = ["the cat"],
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

        var result = await controller.Create(new FlashCardRequest { Spanish = ["el pan"], English = ["the bread"], Tags = ["Food"] });

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
            var card = new FlashCard { Words = TestDb.Words("lunes", "Monday"), Tags = [new Tag { Name = "Days" }, new Tag { Name = "Food" }] };
            setupContext.FlashCards.Add(card);
            await setupContext.SaveChangesAsync();
            cardId = card.Id;
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        var result = await controller.Update(cardId, new FlashCardRequest { Spanish = ["lunes"], English = ["Monday"], Tags = ["days", "Weekdays"] });

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
        dbContext.FlashCards.Add(new FlashCard { Words = TestDb.Words("enero", "January"), Tags = [new Tag { Name = "Months" }, new Tag { Name = "Calendar" }] });
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
        var card = new FlashCard { Words = TestDb.Words("el gato", "the cat"), Tags = [new Tag { Name = "Animals" }] };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();
        dbContext.ChangeTracker.Clear();

        var controller = CreateController(dbContext);

        Assert.IsType<NoContentResult>(await controller.Delete(card.Id));
        Assert.False(await dbContext.FlashCards.AnyAsync());
        Assert.Equal("Animals", (await dbContext.Tags.SingleAsync()).Name);
    }

    [Fact]
    public async Task Create_ReturnsTheSavedCard_WhenAUniqueIndexFailsBecauseItWasAlreadySaved()
    {
        var databaseName = Guid.NewGuid().ToString();
        var interceptor = new UniqueIndexInterceptor(() => SaveCardAsync(databaseName, "el gato", "the cat", "Animals"));
        await using var dbContext = TestDb.Create(databaseName, TestDb.UserId, interceptor);
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = ["el gato"], English = ["the cat"], Tags = ["Animals"] });

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        var card = Assert.IsType<FlashCard>(created.Value);
        Assert.Equal(("el gato", "the cat", "Animals"), (card.Spanish.Single(), card.English.Single(), card.Tags.Single().Name));
        var saved = await dbContext.FlashCards.Include(c => c.Words).SingleAsync();
        Assert.Equal(saved.Id, card.Id);
        Assert.Equal(saved.Id, created.RouteValues?["id"]);
    }

    [Fact]
    public async Task Create_ReturnsConflict_WhenAUniqueIndexFailsBecauseAnotherCardWasSavedFirst()
    {
        var databaseName = Guid.NewGuid().ToString();
        var interceptor = new UniqueIndexInterceptor(() => SaveCardAsync(databaseName, "el gatito", "the cat"));
        await using var dbContext = TestDb.Create(databaseName, TestDb.UserId, interceptor);
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = ["el gato"], English = ["the cat"] });

        AssertDuplicateProblem(result.Result, FlashCardsController.DuplicateMessage(Language.English, "the cat"));
        Assert.Equal("el gatito", (await dbContext.FlashCards.Include(c => c.Words).SingleAsync()).Spanish.Single());
    }

    [Fact]
    public async Task Create_Rethrows_WhenTheSaveFailsWithNoClashingCard()
    {
        await using var dbContext = TestDb.Create(interceptors: new UniqueIndexInterceptor(() => Task.CompletedTask));
        var controller = CreateController(dbContext);

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            controller.Create(new FlashCardRequest { Spanish = ["el gato"], English = ["the cat"] }));
    }

    [Fact]
    public async Task Update_ReturnsConflict_WhenAUniqueIndexFailsBecauseAnotherCardWasSavedFirst()
    {
        var databaseName = Guid.NewGuid().ToString();
        var cardId = await SaveCardAsync(databaseName, "el gato", "the cat");
        var interceptor = new UniqueIndexInterceptor(() => SaveCardAsync(databaseName, "el perro", "the dog"));
        await using var dbContext = TestDb.Create(databaseName, TestDb.UserId, interceptor);
        var controller = CreateController(dbContext);

        var result = await controller.Update(cardId, new FlashCardRequest { Spanish = ["El Perro"], English = ["the cat"] });

        AssertDuplicateProblem(result.Result, FlashCardsController.DuplicateMessage(Language.Spanish, "el perro"));
        var savedCard = await dbContext.FlashCards.Include(c => c.Words).SingleAsync(item => item.Id == cardId);
        Assert.Equal(("el gato", "the cat"), (savedCard.Spanish.Single(), savedCard.English.Single()));
    }

    [Fact]
    public async Task Create_KeepsEveryTranslationInOrder_LeavingOutBlanksAndRepeats()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest
        {
            Spanish = [" solo ", "", "únicamente", "SOLO", "   "],
            English = ["only"]
        });

        var card = Assert.IsType<FlashCard>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.Equal(["solo", "únicamente"], card.Spanish);
        Assert.Equal(["only"], card.English);

        await using var checkContext = TestDb.Create(databaseName);
        var saved = await checkContext.FlashCards.Include(c => c.Words).SingleAsync();
        Assert.Equal(["solo", "únicamente"], saved.Spanish);
        Assert.All(saved.Words, word => Assert.Equal(TestDb.UserId, word.UserId));
    }

    [Fact]
    public async Task Create_ReturnsValidationProblem_ForTooManyTranslations()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest
        {
            Spanish = ["uno"],
            English = [.. Enumerable.Range(1, FlashCard.MaxWordsPerSide + 1).Select(number => $"one {number}")]
        });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(["A flash card can have at most 10 English translations."], problem.Errors["English"]);
        Assert.False(await dbContext.FlashCards.AnyAsync());
    }

    [Fact]
    public async Task Create_ReturnsValidationProblem_ForATranslationThatsTooLong()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest
        {
            Spanish = ["uno", new string('a', FlashCard.MaxWordLength + 1)],
            English = ["one"]
        });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(["Spanish can be at most 200 characters."], problem.Errors["Spanish"]);
    }

    [Fact]
    public async Task Create_ReturnsConflict_WhenAnyTranslationIsOnAnotherCard()
    {
        await using var dbContext = TestDb.Create();
        dbContext.FlashCards.Add(new FlashCard { Words = TestDb.Words("solo", "only") });
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = ["únicamente"], English = ["merely", "Only"] });

        AssertDuplicateProblem(result.Result, FlashCardsController.DuplicateMessage(Language.English, "only"));
        Assert.Equal(1, await dbContext.FlashCards.CountAsync());
    }

    [Fact]
    public async Task Update_AddsReordersAndRemovesTranslations()
    {
        var databaseName = Guid.NewGuid().ToString();
        var cardId = await SaveCardAsync(databaseName, "solo", "only");

        await using (var dbContext = TestDb.Create(databaseName))
        {
            var controller = CreateController(dbContext);
            var result = await controller.Update(cardId, new FlashCardRequest
            {
                Spanish = ["únicamente", "Solo", "sólo"],
                English = ["only"]
            });

            var updated = Assert.IsType<FlashCard>(Assert.IsType<OkObjectResult>(result.Result).Value);
            Assert.Equal(["únicamente", "Solo", "sólo"], updated.Spanish);
        }

        await using (var dbContext = TestDb.Create(databaseName))
        {
            var controller = CreateController(dbContext);
            Assert.IsType<OkObjectResult>((await controller.Update(cardId, new FlashCardRequest
            {
                Spanish = ["sólo", "únicamente"],
                English = ["only", "just"]
            })).Result);
        }

        await using var checkContext = TestDb.Create(databaseName);
        var saved = await checkContext.FlashCards.Include(c => c.Words).SingleAsync();
        Assert.Equal(["sólo", "únicamente"], saved.Spanish);
        Assert.Equal(["only", "just"], saved.English);
        Assert.Equal(4, await checkContext.FlashCardWords.CountAsync());
    }

    [Fact]
    public async Task Create_AllowsATranslationAnotherUserHasOnACard()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            otherContext.FlashCards.Add(new FlashCard { Words = TestDb.Words("solo", "only") });
            await otherContext.SaveChangesAsync();
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = ["únicamente", "solo"], English = ["only"] });

        Assert.IsType<CreatedAtActionResult>(result.Result);
        // Only the current user's words are counted: the new card's three.
        Assert.Equal(3, await dbContext.FlashCardWords.CountAsync());
    }

    // Saves a card for the test user through a context of its own, as another request would.
    private static async Task<int> SaveCardAsync(string databaseName, string spanish, string english, params string[] tags)
    {
        await using var dbContext = TestDb.Create(databaseName);
        var card = new FlashCard { Words = TestDb.Words(spanish, english), Tags = [.. tags.Select(name => new Tag { Name = name })] };
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();
        return card.Id;
    }

    // Fails the first save as a unique index would, after running saveFirst (e.g. another request saving a card in
    // the meantime). The in-memory database has no unique indexes of its own.
    private sealed class UniqueIndexInterceptor(Func<Task> saveFirst) : SaveChangesInterceptor
    {
        private bool failed;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (failed)
            {
                return result;
            }

            failed = true;
            await saveFirst();
            throw new DbUpdateException("Cannot insert duplicate key row in object 'dbo.FlashCards'.");
        }
    }

    private static void AssertDuplicateProblem(IActionResult? result, string message)
    {
        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status409Conflict, objectResult.StatusCode);
        Assert.Equal(message, Assert.IsType<ProblemDetails>(objectResult.Value).Detail);
    }

    private static FlashCardsController CreateController(FlashCardDbContext dbContext)
    {
        return new FlashCardsController(dbContext, new FakeImageStore(), NullLogger<FlashCardsController>.Instance);
    }
}
