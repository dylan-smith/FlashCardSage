using System.Net;
using System.Net.Http.Json;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class FlashCardsControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Create_TrimsBothSides_AndPersistsFlashCard()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = ["  el gato  "], English = [" the cat "] });

        var card = ActionResultAssert.Created<FlashCard>(result.Result);
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

        var problem = ActionResultAssert.ValidationProblem(result.Result, "Spanish", "Spanish is required.");
        Assert.False(problem.Errors.ContainsKey("English"));
        Assert.False(await dbContext.FlashCards.AnyAsync());
    }

    [Fact]
    public async Task Create_ReturnsValidationProblem_WhenEnglishIsBlank()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = ["el gato"], English = ["   "] });

        var problem = ActionResultAssert.ValidationProblem(result.Result, "English", "English is required.");
        Assert.False(problem.Errors.ContainsKey("Spanish"));
        Assert.False(await dbContext.FlashCards.AnyAsync());
    }

    [Fact]
    public async Task Create_ReportsBothSides_WhenBothAreBlank()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = [""], English = [""] });

        var problem = ActionResultAssert.ValidationProblem(result.Result, "Spanish", "Spanish is required.");
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

        ActionResultAssert.Conflict(result.Result, FlashCardsController.DuplicateMessage(language, word));
        Assert.Equal(1, await dbContext.FlashCards.CountAsync());
    }

    [Fact]
    public async Task Create_AllowsACardAnotherUserAlreadyHas()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.FlashCards.Add(TestDb.Card("el gato", "the cat")));

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
            TestDb.Card("uno", "one"),
            TestDb.Card("dos", "two"),
            TestDb.Card("tres", "three"));
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
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));

        var controller = CreateController(dbContext);

        var result = await controller.GetById(card.Id);

        var returnedCard = ActionResultAssert.Ok<FlashCard>(result.Result);
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
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));

        var controller = CreateController(dbContext);

        var result = await controller.Update(card.Id, new FlashCardRequest { Spanish = ["  el perro  "], English = ["  the dog  "] });

        var updatedCard = ActionResultAssert.Ok<FlashCard>(result.Result);
        Assert.Equal(("el perro", "the dog"), (updatedCard.Spanish.Single(), updatedCard.English.Single()));

        var savedCard = await dbContext.FlashCards.Include(c => c.Words).SingleAsync(item => item.Id == card.Id);
        Assert.Equal(("el perro", "the dog"), (savedCard.Spanish.Single(), savedCard.English.Single()));
    }

    [Fact]
    public async Task Update_ReturnsValidationProblem_WhenEnglishIsBlank()
    {
        await using var dbContext = TestDb.Create();
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));

        var controller = CreateController(dbContext);

        var result = await controller.Update(card.Id, new FlashCardRequest { Spanish = ["el perro"], English = [""] });

        ActionResultAssert.ValidationProblem(result.Result, "English", "English is required.");
        var savedCard = await dbContext.FlashCards.Include(c => c.Words).SingleAsync();
        Assert.Equal(("el gato", "the cat"), (savedCard.Spanish.Single(), savedCard.English.Single()));
    }

    [Theory]
    [InlineData("El perro", "the cat", Language.Spanish, "el perro")]
    [InlineData("el gato", "THE DOG", Language.English, "the dog")]
    public async Task Update_ReturnsConflict_WhenEitherSideIsOnAnotherCard(string spanish, string english, Language language, string word)
    {
        await using var dbContext = TestDb.Create();
        var card = TestDb.Card("el gato", "the cat");
        dbContext.FlashCards.AddRange(card, TestDb.Card("el perro", "the dog"));
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.Update(card.Id, new FlashCardRequest { Spanish = [spanish], English = [english] });

        ActionResultAssert.Conflict(result.Result, FlashCardsController.DuplicateMessage(language, word));
        var savedCard = await dbContext.FlashCards.AsNoTracking().Include(c => c.Words).SingleAsync(item => item.Id == card.Id);
        Assert.Equal(("el gato", "the cat"), (savedCard.Spanish.Single(), savedCard.English.Single()));
    }

    [Fact]
    public async Task Update_AllowsSavingTheCardUnchanged()
    {
        await using var dbContext = TestDb.Create();
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));

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
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat"));

        var controller = CreateController(dbContext);

        var result = await controller.Delete(card.Id);

        Assert.IsType<NoContentResult>(result);
        Assert.False(await dbContext.FlashCards.AnyAsync(item => item.Id == card.Id));
    }

    [Fact]
    public async Task Delete_RemovesTheCardsWords_SoTheyCanGoOnANewCard()
    {
        var databaseName = TestDb.NewDatabaseName();
        var cardId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"));
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
        var card = await TestDb.AddCardAsync(
            dbContext, TestDb.Card("nadar", "to swim", imageUrl: "https://images.test/card-images/swim.jpg"));
        var store = new FakeImageStore();
        var controller = CreateController(dbContext, store);

        Assert.IsType<NoContentResult>(await controller.Delete(card.Id));

        Assert.Equal(["https://images.test/card-images/swim.jpg"], store.Deleted);
    }

    [Fact]
    public async Task Delete_KeepsAGeneratedPicture_WhichTheCacheShares()
    {
        const string cached = "https://images.test/card-images/cached.jpg";
        await using var dbContext = TestDb.Create();
        dbContext.GeneratedImages.Add(new CachedImage { PromptHash = new string('a', 64), ImageUrl = cached });
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("nadar", "to swim", imageUrl: cached));
        var store = new FakeImageStore();

        Assert.IsType<NoContentResult>(await CreateController(dbContext, store).Delete(card.Id));

        Assert.Empty(store.Deleted);
    }

    [Fact]
    public async Task DeleteMany_KeepsGeneratedPictures_AndRemovesTheOthers()
    {
        const string cached = "https://images.test/card-images/cached.jpg";
        var databaseName = TestDb.NewDatabaseName();
        var catId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat", imageUrl: cached));
        var dogId = await TestDb.SeedCardAsync(
            databaseName, TestDb.Card("el perro", "the dog", imageUrl: "https://images.test/card-images/dog.jpg"));
        await using var dbContext = TestDb.Create(databaseName);
        dbContext.GeneratedImages.Add(new CachedImage { PromptHash = new string('a', 64), ImageUrl = cached });
        await dbContext.SaveChangesAsync();
        var store = new FakeImageStore();

        await CreateController(dbContext, store).DeleteMany(new FlashCardIdsRequest { FlashCardIds = [catId, dogId] });

        Assert.Equal(["https://images.test/card-images/dog.jpg"], store.Deleted);
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
    public async Task DeleteMany_RemovesThePickedCards_AndTheirWordsAndPictures()
    {
        var databaseName = TestDb.NewDatabaseName();
        var catId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat", ["Animals"]));
        var dogId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el perro", "the dog"));
        var keptId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("la casa", "the house"));
        await using var dbContext = TestDb.Create(databaseName);
        var dog = await dbContext.FlashCards.SingleAsync(card => card.Id == dogId);
        dog.ImageUrl = "https://images.test/card-images/dog.jpg";
        await dbContext.SaveChangesAsync();
        var store = new FakeImageStore();
        var controller = CreateController(dbContext, store);

        var result = await controller.DeleteMany(new FlashCardIdsRequest { FlashCardIds = [catId, dogId, catId] });

        Assert.IsType<NoContentResult>(result);
        Assert.Equal([keptId], await dbContext.FlashCards.Select(card => card.Id).ToListAsync());
        Assert.Equal(2, await dbContext.FlashCardWords.CountAsync());
        Assert.True(await dbContext.Tags.AnyAsync(tag => tag.Name == "Animals"));
        Assert.Equal(["https://images.test/card-images/dog.jpg"], store.Deleted);
    }

    [Fact]
    public async Task DeleteMany_SkipsCardsThatAreGone_AndOtherUsersCards()
    {
        var databaseName = TestDb.NewDatabaseName();
        var other = TestDb.Card("suyo", "theirs");
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.FlashCards.Add(other));

        var cardId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"));
        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        var result = await controller.DeleteMany(new FlashCardIdsRequest { FlashCardIds = [cardId, other.Id, 999] });

        Assert.IsType<NoContentResult>(result);
        Assert.False(await dbContext.FlashCards.AnyAsync());
        await using var otherCheck = TestDb.Create(databaseName, TestDb.OtherUserId);
        Assert.True(await otherCheck.FlashCards.AnyAsync(card => card.Id == other.Id));
    }

    [Fact]
    public async Task DeleteMany_DoesNothing_WhenNoCardsArePicked()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"));
        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        Assert.IsType<NoContentResult>(await controller.DeleteMany(new FlashCardIdsRequest()));

        Assert.Equal(1, await dbContext.FlashCards.CountAsync());
    }

    [Fact]
    public async Task OtherUsersFlashCards_AreNotListedOrFound()
    {
        var databaseName = TestDb.NewDatabaseName();
        var other = TestDb.Card("suyo", "theirs");
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.FlashCards.Add(other));

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        var all = Assert.IsType<OkObjectResult>((await controller.GetAll()).Result);
        Assert.Empty(Assert.IsAssignableFrom<IEnumerable<FlashCard>>(all.Value));
        Assert.IsType<NotFoundResult>((await controller.GetById(other.Id)).Result);
        Assert.IsType<NotFoundResult>((await controller.Update(other.Id, new FlashCardRequest { Spanish = ["mío"], English = ["mine"] })).Result);
        Assert.IsType<NotFoundResult>(await controller.Delete(other.Id));
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

        var card = ActionResultAssert.Created<FlashCard>(result.Result);
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

        ActionResultAssert.ValidationProblem(result.Result, "Tags", "Tags can be at most 50 characters.");
        Assert.False(await dbContext.FlashCards.AnyAsync());
        Assert.False(await dbContext.Tags.AnyAsync());
    }

    [Fact]
    public async Task Create_DoesNotReuseAnotherUsersTag()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.Tags.Add(new Tag { Name = "Food" }));

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = ["el pan"], English = ["the bread"], Tags = ["Food"] });

        var card = ActionResultAssert.Created<FlashCard>(result.Result);
        Assert.Equal(TestDb.UserId, Assert.Single(card.Tags).UserId);
        Assert.Equal(2, await dbContext.Tags.IgnoreQueryFilters().CountAsync());
    }

    [Fact]
    public async Task Update_ReplacesTheCardsTags()
    {
        var databaseName = TestDb.NewDatabaseName();
        var cardId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("lunes", "Monday", ["Days", "Food"]));

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        var result = await controller.Update(cardId, new FlashCardRequest { Spanish = ["lunes"], English = ["Monday"], Tags = ["days", "Weekdays"] });

        var updatedCard = ActionResultAssert.Ok<FlashCard>(result.Result);
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
        dbContext.FlashCards.Add(TestDb.Card("enero", "January", ["Months", "Calendar"]));
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
        var card = await TestDb.AddCardAsync(dbContext, TestDb.Card("el gato", "the cat", ["Animals"]));
        dbContext.ChangeTracker.Clear();

        var controller = CreateController(dbContext);

        Assert.IsType<NoContentResult>(await controller.Delete(card.Id));
        Assert.False(await dbContext.FlashCards.AnyAsync());
        Assert.Equal("Animals", (await dbContext.Tags.SingleAsync()).Name);
    }

    [Fact]
    public async Task Create_ReturnsTheSavedCard_WhenAUniqueIndexFailsBecauseItWasAlreadySaved()
    {
        var databaseName = TestDb.NewDatabaseName();
        var interceptor = new UniqueIndexInterceptor(
            () => TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat", ["Animals"])));
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
        var databaseName = TestDb.NewDatabaseName();
        var interceptor = new UniqueIndexInterceptor(() => TestDb.SeedCardAsync(databaseName, TestDb.Card("el gatito", "the cat")));
        await using var dbContext = TestDb.Create(databaseName, TestDb.UserId, interceptor);
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = ["el gato"], English = ["the cat"] });

        ActionResultAssert.Conflict(result.Result, FlashCardsController.DuplicateMessage(Language.English, "the cat"));
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
        var databaseName = TestDb.NewDatabaseName();
        var cardId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"));
        var interceptor = new UniqueIndexInterceptor(() => TestDb.SeedCardAsync(databaseName, TestDb.Card("el perro", "the dog")));
        await using var dbContext = TestDb.Create(databaseName, TestDb.UserId, interceptor);
        var controller = CreateController(dbContext);

        var result = await controller.Update(cardId, new FlashCardRequest { Spanish = ["El Perro"], English = ["the cat"] });

        ActionResultAssert.Conflict(result.Result, FlashCardsController.DuplicateMessage(Language.Spanish, "el perro"));
        var savedCard = await dbContext.FlashCards.Include(c => c.Words).SingleAsync(item => item.Id == cardId);
        Assert.Equal(("el gato", "the cat"), (savedCard.Spanish.Single(), savedCard.English.Single()));
    }

    [Fact]
    public async Task Create_KeepsEveryTranslationInOrder_LeavingOutBlanksAndRepeats()
    {
        var databaseName = TestDb.NewDatabaseName();
        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest
        {
            Spanish = [" solo ", "", "únicamente", "SOLO", "   "],
            English = ["only"]
        });

        var card = ActionResultAssert.Created<FlashCard>(result.Result);
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

        ActionResultAssert.ValidationProblem(result.Result, "English", "A flash card can have at most 10 English translations.");
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

        ActionResultAssert.ValidationProblem(result.Result, "Spanish", "Spanish can be at most 200 characters.");
    }

    [Fact]
    public async Task Create_ReturnsConflict_WhenAnyTranslationIsOnAnotherCard()
    {
        await using var dbContext = TestDb.Create();
        dbContext.FlashCards.Add(TestDb.Card("solo", "only"));
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = ["únicamente"], English = ["merely", "Only"] });

        ActionResultAssert.Conflict(result.Result, FlashCardsController.DuplicateMessage(Language.English, "only"));
        Assert.Equal(1, await dbContext.FlashCards.CountAsync());
    }

    [Fact]
    public async Task Update_AddsReordersAndRemovesTranslations()
    {
        var databaseName = TestDb.NewDatabaseName();
        var cardId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("solo", "only"));

        await using (var dbContext = TestDb.Create(databaseName))
        {
            var controller = CreateController(dbContext);
            var result = await controller.Update(cardId, new FlashCardRequest
            {
                Spanish = ["únicamente", "Solo", "sólo"],
                English = ["only"]
            });

            var updated = ActionResultAssert.Ok<FlashCard>(result.Result);
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
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.FlashCards.Add(TestDb.Card("solo", "only")));

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        var result = await controller.Create(new FlashCardRequest { Spanish = ["únicamente", "solo"], English = ["only"] });

        Assert.IsType<CreatedAtActionResult>(result.Result);
        // Only the current user's words are counted: the new card's three.
        Assert.Equal(3, await dbContext.FlashCardWords.CountAsync());
    }

    [Fact]
    public async Task CreateMany_AddsTheCards_LeavingOutOnesTheUserHas()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat", ["Animals"]));

        await using var dbContext = TestDb.Create(databaseName);
        var result = await CreateController(dbContext).CreateMany(new FlashCardBatchRequest
        {
            Cards =
            [
                new FlashCardRequest { Spanish = [" el perro "], English = ["the dog"], Tags = ["animals"] },
                new FlashCardRequest { Spanish = ["El Gato"], English = ["the kitty"] },
                new FlashCardRequest { Spanish = ["el felino"], English = ["The Cat"] },
                new FlashCardRequest { Spanish = ["el can"], English = ["The Dog"] },
                new FlashCardRequest { Spanish = ["la vaca"], English = ["the cow"], Tags = ["Farm"] },
                new FlashCardRequest { Spanish = ["el toro"], English = ["the bull"], Tags = ["farm"] }
            ]
        });

        var response = ActionResultAssert.Ok<FlashCardBatchResponse>(result.Result);
        Assert.Equal(["el perro", "la vaca", "el toro"], response.Cards.Select(card => card.Spanish.Single()));
        Assert.Equal(3, response.SkippedCount);

        await using var checkContext = TestDb.Create(databaseName);
        var saved = await checkContext.FlashCards.Include(card => card.Words).Include(card => card.Tags).ToListAsync();
        Assert.Equal(4, saved.Count);
        // The user's tag is used whatever its case, and a new tag is made once for every card that has it.
        Assert.Equal("Animals", saved.Single(card => card.Spanish.Single() == "el perro").Tags.Single().Name);
        Assert.Equal(["Animals", "Farm"], await checkContext.Tags.OrderBy(tag => tag.Name).Select(tag => tag.Name).ToListAsync());
    }

    [Fact]
    public async Task CreateMany_ReturnsValidationProblem_NamingTheCard()
    {
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext).CreateMany(new FlashCardBatchRequest
        {
            Cards =
            [
                new FlashCardRequest { Spanish = ["el perro"], English = ["the dog"] },
                new FlashCardRequest { Spanish = ["la vaca"], English = [" "] }
            ]
        });

        var problem = ActionResultAssert.ValidationProblem(result.Result, "Cards[1].English", "English is required.");
        Assert.Single(problem.Errors);
        Assert.False(await dbContext.FlashCards.AnyAsync());
    }

    [Fact]
    public async Task CreateMany_ReturnsConflict_WhenACardIsSavedMeanwhile()
    {
        var databaseName = TestDb.NewDatabaseName();
        var interceptor = new UniqueIndexInterceptor(() => TestDb.SeedCardAsync(databaseName, TestDb.Card("el perro", "the dog")));
        await using var dbContext = TestDb.Create(databaseName, TestDb.UserId, interceptor);

        var result = await CreateController(dbContext).CreateMany(new FlashCardBatchRequest
        {
            Cards = [new FlashCardRequest { Spanish = ["el perro"], English = ["the dog"] }]
        });

        ActionResultAssert.Conflict(result.Result, FlashCardsController.BatchClashMessage);
    }

    [Fact]
    public async Task Create_And_CreateMany_RecordTheSourceSent_OrManual()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        await controller.Create(new FlashCardRequest { Spanish = ["el gato"], English = ["the cat"] });
        await controller.Create(
            new FlashCardRequest { Spanish = ["el perro"], English = ["the dog"], Source = CardSource.Suggested });
        await controller.CreateMany(new FlashCardBatchRequest
        {
            Cards = [new FlashCardRequest { Spanish = ["la casa"], English = ["the house"] }],
            Source = CardSource.Preply
        });
        await controller.CreateMany(new FlashCardBatchRequest
        {
            Cards = [new FlashCardRequest { Spanish = ["la vaca"], English = ["the cow"] }]
        });

        var sources = await dbContext.FlashCards.OrderBy(card => card.Id).Select(card => card.Source).ToListAsync();
        Assert.Equal([CardSource.Manual, CardSource.Suggested, CardSource.Preply, CardSource.Manual], sources);
    }

    [Fact]
    public async Task Update_KeepsTheCardsSource()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);
        var created = ActionResultAssert.Created<FlashCard>((await controller.Create(
            new FlashCardRequest { Spanish = ["el gato"], English = ["the cat"], Source = CardSource.Document })).Result);

        await controller.Update(
            created.Id, new FlashCardRequest { Spanish = ["el gato"], English = ["the cat"], Source = CardSource.Preply });

        Assert.Equal(CardSource.Document, (await dbContext.FlashCards.SingleAsync()).Source);
    }

    [Fact]
    public async Task Create_And_CreateMany_TakeTheSourceByName()
    {
        using var client = TestApp.CreateSignedInClient(factory);

        var created = await PostJsonAsync(
            client, "/api/flashcards", """{ "spanish": ["el gato"], "english": ["the cat"], "source": "Document" }""");
        var batch = await PostJsonAsync(
            client,
            "/api/flashcards/batch",
            """{ "cards": [{ "spanish": ["el perro"], "english": ["the dog"] }], "source": "Duolingo" }""");

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(CardSource.Document, (await created.Content.ReadFromJsonAsync<SourceResponse>())?.Source);
        Assert.Equal(HttpStatusCode.OK, batch.StatusCode);
        Assert.Equal(CardSource.Duolingo, (await batch.Content.ReadFromJsonAsync<BatchSourceResponse>())?.Cards.Single().Source);
    }

    [Theory]
    [InlineData("/api/flashcards", "\"Fax\"")]
    [InlineData("/api/flashcards", "99")]
    [InlineData("/api/flashcards/batch", "\"Fax\"")]
    public async Task Create_ReturnsBadRequest_ForAnUnknownSource(string path, string source)
    {
        using var client = TestApp.CreateSignedInClient(factory);
        var body = path.EndsWith("/batch", StringComparison.Ordinal)
            ? $$"""{ "cards": [{ "spanish": ["el gato"], "english": ["the cat"] }], "source": {{source}} }"""
            : $$"""{ "spanish": ["el gato"], "english": ["the cat"], "source": {{source}} }""";

        var response = await PostJsonAsync(client, path, body);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private static async Task<HttpResponseMessage> PostJsonAsync(HttpClient client, string path, string json)
    {
        using var content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");
        return await client.PostAsync(path, content);
    }

    private static FlashCardsController CreateController(FlashCardDbContext dbContext, FakeImageStore? store = null)
    {
        return new FlashCardsController(
            new FlashCardService(dbContext, store ?? new FakeImageStore(), NullLogger<FlashCardService>.Instance),
            NullLogger<FlashCardsController>.Instance);
    }

    private sealed record SourceResponse(CardSource? Source);

    private sealed record BatchSourceResponse(List<SourceResponse> Cards);
}
