using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class DecksControllerTests
{
    [Fact]
    public async Task GetAll_ReturnsTheUsersDecksInNameOrder_WithTheirCardIds()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            otherContext.Decks.Add(new Deck { Name = "Theirs" });
            await otherContext.SaveChangesAsync();
        }

        await using var dbContext = TestDb.Create(databaseName);
        var cat = new FlashCard { Spanish = "el gato", English = "the cat" };
        var dog = new FlashCard { Spanish = "el perro", English = "the dog" };
        dbContext.Decks.AddRange(new Deck { Name = "Week 1" }, new Deck { Name = "Animals", FlashCards = [dog, cat] });
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.GetAll();

        var decks = Assert.IsAssignableFrom<IEnumerable<DeckResponse>>(Assert.IsType<OkObjectResult>(result.Result).Value)
            .ToList();
        Assert.Equal(["Animals", "Week 1"], decks.Select(deck => deck.Name));
        Assert.Equal(new[] { cat.Id, dog.Id }.Order(), decks[0].FlashCardIds);
        Assert.Empty(decks[1].FlashCardIds);
    }

    [Fact]
    public async Task GetById_ReturnsTheDeck()
    {
        await using var dbContext = TestDb.Create();
        var card = new FlashCard { Spanish = "el gato", English = "the cat" };
        var deck = new Deck { Name = "Animals", FlashCards = [card] };
        dbContext.Decks.Add(deck);
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.GetById(deck.Id);

        var found = Assert.IsType<DeckResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal((deck.Id, "Animals"), (found.Id, found.Name));
        Assert.Equal([card.Id], found.FlashCardIds);
    }

    [Fact]
    public async Task Create_TrimsTheNameAndAddsTheCards()
    {
        await using var dbContext = TestDb.Create();
        var cat = new FlashCard { Spanish = "el gato", English = "the cat" };
        var dog = new FlashCard { Spanish = "el perro", English = "the dog" };
        dbContext.FlashCards.AddRange(cat, dog, new FlashCard { Spanish = "la casa", English = "the house" });
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.Create(
            new DeckRequest { Name = "  Animals  ", FlashCardIds = [dog.Id, cat.Id, dog.Id] });

        var created = Assert.IsType<DeckResponse>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.Equal("Animals", created.Name);
        Assert.Equal(new[] { cat.Id, dog.Id }.Order(), created.FlashCardIds);
        var saved = await dbContext.Decks.Include(deck => deck.FlashCards).SingleAsync();
        Assert.Equal((TestDb.UserId, "Animals"), (saved.UserId, saved.Name));
        Assert.Equal(new[] { cat.Id, dog.Id }.Order(), saved.FlashCards.Select(card => card.Id).Order());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Create_ReturnsValidationProblem_WhenTheNameIsBlank(string name)
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new DeckRequest { Name = name });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(["Deck name is required."], problem.Errors["Name"]);
        Assert.False(await dbContext.Decks.AnyAsync());
    }

    [Fact]
    public async Task Create_ReturnsValidationProblem_WhenTheNameIsTakenInAnyCase()
    {
        await using var dbContext = TestDb.Create();
        dbContext.Decks.Add(new Deck { Name = "Animals" });
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new DeckRequest { Name = "animals" });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(["There's already a deck with that name."], problem.Errors["Name"]);
    }

    [Fact]
    public async Task Create_ReturnsValidationProblem_ForAnUnknownOrAnotherUsersCard()
    {
        var databaseName = Guid.NewGuid().ToString();
        var other = new FlashCard { Spanish = "el perro", English = "the dog" };
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            otherContext.FlashCards.Add(other);
            await otherContext.SaveChangesAsync();
        }

        await using var dbContext = TestDb.Create(databaseName);

        foreach (var cardId in new[] { other.Id, 999 })
        {
            var result = await CreateController(dbContext).Create(new DeckRequest { Name = "Animals", FlashCardIds = [cardId] });

            var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
            Assert.Equal(["Some of those flash cards no longer exist."], problem.Errors["FlashCardIds"]);
        }

        Assert.False(await dbContext.Decks.IgnoreQueryFilters().AnyAsync());
    }

    [Fact]
    public async Task Rename_TrimsTheNameAndKeepsTheCards()
    {
        var databaseName = Guid.NewGuid().ToString();
        int deckId, catId;
        await using (var setupContext = TestDb.Create(databaseName))
        {
            var cat = new FlashCard { Spanish = "el gato", English = "the cat" };
            var deck = new Deck { Name = "Anmals", FlashCards = [cat] };
            setupContext.Decks.Add(deck);
            await setupContext.SaveChangesAsync();
            (deckId, catId) = (deck.Id, cat.Id);
        }

        await using var dbContext = TestDb.Create(databaseName);
        var result = await CreateController(dbContext).Rename(deckId, new DeckNameRequest { Name = "  Animals " });

        var renamed = Assert.IsType<DeckResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("Animals", renamed.Name);
        Assert.Equal([catId], renamed.FlashCardIds);
        await using var checkContext = TestDb.Create(databaseName);
        var saved = await checkContext.Decks.Include(deck => deck.FlashCards).SingleAsync();
        Assert.Equal("Animals", saved.Name);
        Assert.Equal([catId], saved.FlashCards.Select(card => card.Id));
    }

    [Fact]
    public async Task Rename_AllowsChangingOnlyTheCase()
    {
        await using var dbContext = TestDb.Create();
        var deck = new Deck { Name = "Animals" };
        dbContext.Decks.Add(deck);
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).Rename(deck.Id, new DeckNameRequest { Name = "animals" });

        Assert.Equal("animals", Assert.IsType<DeckResponse>(Assert.IsType<OkObjectResult>(result.Result).Value).Name);
    }

    [Theory]
    [InlineData("FOOD", "There's already a deck with that name.")]
    [InlineData("  ", "Deck name is required.")]
    public async Task Rename_ReturnsValidationProblem_ForATakenOrBlankName(string name, string message)
    {
        await using var dbContext = TestDb.Create();
        var deck = new Deck { Name = "Animals" };
        dbContext.Decks.AddRange(deck, new Deck { Name = "Food" });
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).Rename(deck.Id, new DeckNameRequest { Name = name });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal([message], problem.Errors["Name"]);
    }

    [Fact]
    public async Task ChangeCards_AddsAndRemovesOnlyTheCardsGiven()
    {
        var databaseName = Guid.NewGuid().ToString();
        int deckId, catId, dogId, houseId, bookId;
        await using (var setupContext = TestDb.Create(databaseName))
        {
            var cat = new FlashCard { Spanish = "el gato", English = "the cat" };
            var dog = new FlashCard { Spanish = "el perro", English = "the dog" };
            var house = new FlashCard { Spanish = "la casa", English = "the house" };
            var book = new FlashCard { Spanish = "el libro", English = "the book" };
            var deck = new Deck { Name = "Animals", FlashCards = [cat, dog] };
            setupContext.FlashCards.AddRange(house, book);
            setupContext.Decks.Add(deck);
            await setupContext.SaveChangesAsync();
            (deckId, catId, dogId, houseId, bookId) = (deck.Id, cat.Id, dog.Id, house.Id, book.Id);
        }

        await using var dbContext = TestDb.Create(databaseName);
        // The cat is added again and the book removed without being in the deck, which changes nothing.
        var result = await CreateController(dbContext).ChangeCards(
            deckId, new DeckCardsRequest { Add = [houseId, catId, houseId], Remove = [dogId, bookId] });

        var changed = Assert.IsType<DeckResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var expected = new[] { catId, houseId }.Order();
        Assert.Equal(expected, changed.FlashCardIds);
        await using var checkContext = TestDb.Create(databaseName);
        var saved = await checkContext.Decks.Include(deck => deck.FlashCards).SingleAsync();
        Assert.Equal(expected, saved.FlashCards.Select(card => card.Id).Order());
        // The card taken out of the deck is still there.
        Assert.Equal(4, await checkContext.FlashCards.CountAsync());
    }

    [Fact]
    public async Task ChangeCards_ReturnsValidationProblem_ForAnotherUsersCard_AndChangesNothing()
    {
        var databaseName = Guid.NewGuid().ToString();
        var other = new FlashCard { Spanish = "el perro", English = "the dog" };
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            otherContext.FlashCards.Add(other);
            await otherContext.SaveChangesAsync();
        }

        await using var dbContext = TestDb.Create(databaseName);
        var cat = new FlashCard { Spanish = "el gato", English = "the cat" };
        var deck = new Deck { Name = "Animals", FlashCards = [cat] };
        dbContext.Decks.Add(deck);
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).ChangeCards(
            deck.Id, new DeckCardsRequest { Add = [other.Id], Remove = [cat.Id] });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(["Some of those flash cards no longer exist."], problem.Errors["Add"]);
        await using var checkContext = TestDb.Create(databaseName);
        Assert.Equal(
            [cat.Id],
            (await checkContext.Decks.Include(item => item.FlashCards).SingleAsync()).FlashCards.Select(card => card.Id));
    }

    [Fact]
    public async Task Delete_RemovesTheDeck_AndKeepsItsCards()
    {
        var databaseName = Guid.NewGuid().ToString();
        int deckId;
        await using (var setupContext = TestDb.Create(databaseName))
        {
            var deck = new Deck { Name = "Animals", FlashCards = [new FlashCard { Spanish = "el gato", English = "the cat" }] };
            setupContext.Decks.Add(deck);
            await setupContext.SaveChangesAsync();
            deckId = deck.Id;
        }

        await using var dbContext = TestDb.Create(databaseName);
        Assert.IsType<NoContentResult>(await CreateController(dbContext).Delete(deckId));

        await using var checkContext = TestDb.Create(databaseName);
        Assert.False(await checkContext.Decks.AnyAsync());
        Assert.Equal("el gato", (await checkContext.FlashCards.SingleAsync()).Spanish);
    }

    [Fact]
    public async Task DeletingACard_RemovesItFromItsDecks()
    {
        var databaseName = Guid.NewGuid().ToString();
        int catId;
        await using (var setupContext = TestDb.Create(databaseName))
        {
            var cat = new FlashCard { Spanish = "el gato", English = "the cat" };
            var dog = new FlashCard { Spanish = "el perro", English = "the dog" };
            setupContext.Decks.Add(new Deck { Name = "Animals", FlashCards = [cat, dog] });
            await setupContext.SaveChangesAsync();
            catId = cat.Id;
        }

        await using (var dbContext = TestDb.Create(databaseName))
        {
            var controller = new FlashCardsController(dbContext, new FakeImageStore(), NullLogger<FlashCardsController>.Instance);
            Assert.IsType<NoContentResult>(await controller.Delete(catId));
        }

        await using var checkContext = TestDb.Create(databaseName);
        var deck = await checkContext.Decks.Include(item => item.FlashCards).SingleAsync();
        Assert.Equal(["el perro"], deck.FlashCards.Select(card => card.Spanish));
    }

    [Fact]
    public async Task OtherUsersDecks_CannotBeReadChangedOrDeleted()
    {
        var databaseName = Guid.NewGuid().ToString();
        int otherId;
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            var other = new Deck { Name = "Theirs" };
            otherContext.Decks.Add(other);
            await otherContext.SaveChangesAsync();
            otherId = other.Id;
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        Assert.IsType<NotFoundResult>((await controller.GetById(otherId)).Result);
        Assert.IsType<NotFoundResult>((await controller.Rename(otherId, new DeckNameRequest { Name = "Mine" })).Result);
        Assert.IsType<NotFoundResult>((await controller.ChangeCards(otherId, new DeckCardsRequest())).Result);
        Assert.IsType<NotFoundResult>(await controller.Delete(otherId));
        Assert.Equal("Theirs", (await dbContext.Decks.IgnoreQueryFilters().SingleAsync()).Name);
    }

    private static DecksController CreateController(FlashCardDbContext dbContext)
    {
        return new DecksController(dbContext, NullLogger<DecksController>.Instance);
    }
}
