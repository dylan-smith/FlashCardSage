using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class DecksControllerTests
{
    [Fact]
    public async Task GetAll_ReturnsTheUsersDecksInNameOrder_WithTheirCardIds()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.Decks.Add(new Deck { Name = "Theirs" }));

        await using var dbContext = TestDb.Create(databaseName);
        var cat = TestDb.Card("el gato", "the cat");
        var dog = TestDb.Card("el perro", "the dog");
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
        var card = TestDb.Card("el gato", "the cat");
        var deck = new Deck { Name = "Animals", FlashCards = [card] };
        dbContext.Decks.Add(deck);
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.GetById(deck.Id);

        var found = ActionResultAssert.Ok<DeckResponse>(result.Result);
        Assert.Equal((deck.Id, "Animals"), (found.Id, found.Name));
        Assert.Equal([card.Id], found.FlashCardIds);
    }

    [Fact]
    public async Task Create_TrimsTheNameAndAddsTheCards()
    {
        await using var dbContext = TestDb.Create();
        var cat = TestDb.Card("el gato", "the cat");
        var dog = TestDb.Card("el perro", "the dog");
        dbContext.FlashCards.AddRange(cat, dog, TestDb.Card("la casa", "the house"));
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.Create(
            new DeckRequest { Name = "  Animals  ", FlashCardIds = [dog.Id, cat.Id, dog.Id] });

        var created = ActionResultAssert.Created<DeckResponse>(result.Result);
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

        ActionResultAssert.ValidationProblem(result.Result, "Name", "Deck name is required.");
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

        ActionResultAssert.ValidationProblem(result.Result, "Name", "There's already a deck with that name.");
    }

    [Fact]
    public async Task Create_ReturnsValidationProblem_ForAnUnknownOrAnotherUsersCard()
    {
        var databaseName = TestDb.NewDatabaseName();
        var other = TestDb.Card("el perro", "the dog");
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.FlashCards.Add(other));

        await using var dbContext = TestDb.Create(databaseName);

        foreach (var cardId in new[] { other.Id, 999 })
        {
            var result = await CreateController(dbContext).Create(new DeckRequest { Name = "Animals", FlashCardIds = [cardId] });

            ActionResultAssert.ValidationProblem(result.Result, "FlashCardIds", "Some of those flash cards no longer exist.");
        }

        Assert.False(await dbContext.Decks.IgnoreQueryFilters().AnyAsync());
    }

    [Fact]
    public async Task Rename_TrimsTheNameAndKeepsTheCards()
    {
        var databaseName = TestDb.NewDatabaseName();
        int deckId, catId;
        await using (var setupContext = TestDb.Create(databaseName))
        {
            var cat = TestDb.Card("el gato", "the cat");
            var deck = new Deck { Name = "Anmals", FlashCards = [cat] };
            setupContext.Decks.Add(deck);
            await setupContext.SaveChangesAsync();
            (deckId, catId) = (deck.Id, cat.Id);
        }

        await using var dbContext = TestDb.Create(databaseName);
        var result = await CreateController(dbContext).Rename(deckId, new DeckNameRequest { Name = "  Animals " });

        var renamed = ActionResultAssert.Ok<DeckResponse>(result.Result);
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

        Assert.Equal("animals", ActionResultAssert.Ok<DeckResponse>(result.Result).Name);
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

        ActionResultAssert.ValidationProblem(result.Result, "Name", message);
    }

    [Fact]
    public async Task ChangeCards_AddsAndRemovesOnlyTheCardsGiven()
    {
        var databaseName = TestDb.NewDatabaseName();
        int deckId, catId, dogId, houseId, bookId;
        await using (var setupContext = TestDb.Create(databaseName))
        {
            var cat = TestDb.Card("el gato", "the cat");
            var dog = TestDb.Card("el perro", "the dog");
            var house = TestDb.Card("la casa", "the house");
            var book = TestDb.Card("el libro", "the book");
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

        var changed = ActionResultAssert.Ok<DeckResponse>(result.Result);
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
        var databaseName = TestDb.NewDatabaseName();
        var other = TestDb.Card("el perro", "the dog");
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.FlashCards.Add(other));

        await using var dbContext = TestDb.Create(databaseName);
        var cat = TestDb.Card("el gato", "the cat");
        var deck = new Deck { Name = "Animals", FlashCards = [cat] };
        dbContext.Decks.Add(deck);
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).ChangeCards(
            deck.Id, new DeckCardsRequest { Add = [other.Id], Remove = [cat.Id] });

        ActionResultAssert.ValidationProblem(result.Result, "Add", "Some of those flash cards no longer exist.");
        await using var checkContext = TestDb.Create(databaseName);
        Assert.Equal(
            [cat.Id],
            (await checkContext.Decks.Include(item => item.FlashCards).ThenInclude(card => card.Words).SingleAsync()).FlashCards.Select(card => card.Id));
    }

    [Fact]
    public async Task Delete_RemovesTheDeck_AndKeepsItsCards()
    {
        var databaseName = TestDb.NewDatabaseName();
        int deckId;
        await using (var setupContext = TestDb.Create(databaseName))
        {
            var deck = new Deck { Name = "Animals", FlashCards = [TestDb.Card("el gato", "the cat")] };
            setupContext.Decks.Add(deck);
            await setupContext.SaveChangesAsync();
            deckId = deck.Id;
        }

        await using var dbContext = TestDb.Create(databaseName);
        Assert.IsType<NoContentResult>(await CreateController(dbContext).Delete(deckId));

        await using var checkContext = TestDb.Create(databaseName);
        Assert.False(await checkContext.Decks.AnyAsync());
        Assert.Equal("el gato", (await checkContext.FlashCards.Include(c => c.Words).SingleAsync()).Spanish.Single());
    }

    [Fact]
    public async Task DeletingACard_RemovesItFromItsDecks()
    {
        var databaseName = TestDb.NewDatabaseName();
        int catId;
        await using (var setupContext = TestDb.Create(databaseName))
        {
            var cat = TestDb.Card("el gato", "the cat");
            var dog = TestDb.Card("el perro", "the dog");
            setupContext.Decks.Add(new Deck { Name = "Animals", FlashCards = [cat, dog] });
            await setupContext.SaveChangesAsync();
            catId = cat.Id;
        }

        await using (var dbContext = TestDb.Create(databaseName))
        {
            var controller = new FlashCardsController(
                dbContext,
                new FlashCardService(dbContext, new FakeImageStore(), NullLogger<FlashCardService>.Instance),
                NullLogger<FlashCardsController>.Instance);
            Assert.IsType<NoContentResult>(await controller.Delete(catId));
        }

        await using var checkContext = TestDb.Create(databaseName);
        var deck = await checkContext.Decks.Include(item => item.FlashCards).ThenInclude(card => card.Words).SingleAsync();
        Assert.Equal(["el perro"], deck.FlashCards.Select(card => card.Spanish.Single()));
    }

    [Fact]
    public async Task OtherUsersDecks_CannotBeReadChangedOrDeleted()
    {
        var databaseName = TestDb.NewDatabaseName();
        var other = new Deck { Name = "Theirs" };
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.Decks.Add(other));

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        Assert.IsType<NotFoundResult>((await controller.GetById(other.Id)).Result);
        Assert.IsType<NotFoundResult>((await controller.Rename(other.Id, new DeckNameRequest { Name = "Mine" })).Result);
        Assert.IsType<NotFoundResult>((await controller.ChangeCards(other.Id, new DeckCardsRequest())).Result);
        Assert.IsType<NotFoundResult>(await controller.Delete(other.Id));
        Assert.Equal("Theirs", (await dbContext.Decks.IgnoreQueryFilters().SingleAsync()).Name);
    }

    private static DecksController CreateController(FlashCardDbContext dbContext)
    {
        return new DecksController(dbContext, NullLogger<DecksController>.Instance);
    }
}
