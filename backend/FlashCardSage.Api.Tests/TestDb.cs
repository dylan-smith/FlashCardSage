using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace FlashCardSage.Api.Tests;

internal static class TestDb
{
    // The user the controller tests act as, unless a test signs in as someone else.
    public const int UserId = 1;

    public const int OtherUserId = 2;

    public static FlashCardDbContext Create(string? databaseName = null, int userId = UserId, params IInterceptor[] interceptors)
    {
        return Create(databaseName ?? NewDatabaseName(), new CurrentUser { UserId = userId }, interceptors);
    }

    // For code that changes the current user, as the system deck seeder does.
    public static FlashCardDbContext Create(string databaseName, CurrentUser currentUser, params IInterceptor[] interceptors)
    {
        var options = new DbContextOptionsBuilder<FlashCardDbContext>()
            .UseInMemoryDatabase(databaseName)
            .AddInterceptors(interceptors)
            .Options;

        return new FlashCardDbContext(options, currentUser);
    }

    // The name of a new, empty in-memory database, for a test that opens more than one context on it.
    public static string NewDatabaseName()
    {
        return Guid.NewGuid().ToString();
    }

    // The body that creates a card with one Spanish word and one English word through the API.
    public static object CardBody(string spanish, string english)
    {
        return new { spanish = new[] { spanish }, english = new[] { english } };
    }

    // A new card with one Spanish word and one English word, and new tags with these names.
    public static FlashCard Card(string spanish, string english, IEnumerable<string>? tags = null, string? imageUrl = null)
    {
        return new FlashCard
        {
            Words = Words(spanish, english),
            Tags = [.. (tags ?? []).Select(name => new Tag { Name = name })],
            ImageUrl = imageUrl
        };
    }

    // A new card's words: one Spanish and one English, as most tests' cards have.
    public static List<FlashCardWord> Words(string spanish, string english)
    {
        return Words([spanish], [english]);
    }

    // A new card's words, with any number in each language, in order.
    public static List<FlashCardWord> Words(string[] spanish, string[] english)
    {
        return
        [
            .. spanish.Select((text, position) =>
                new FlashCardWord { Language = Language.Spanish, Text = text, Position = position }),
            .. english.Select((text, position) =>
                new FlashCardWord { Language = Language.English, Text = text, Position = position })
        ];
    }

    // Adds the card through this context and returns it, saved.
    public static async Task<FlashCard> AddCardAsync(FlashCardDbContext dbContext, FlashCard card)
    {
        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();
        return card;
    }

    // Saves the card for the user through a context of its own, as another request would, returning its ID.
    public static async Task<int> SeedCardAsync(string databaseName, FlashCard card, int userId = UserId)
    {
        await using var dbContext = Create(databaseName, userId);
        return (await AddCardAsync(dbContext, card)).Id;
    }

    // Saves cards with one word on each side for the user through a context of their own, returning their IDs in order.
    public static async Task<List<int>> SeedCardsAsync(
        string databaseName, int userId, params (string Spanish, string English)[] cards)
    {
        await using var dbContext = Create(databaseName, userId);
        var added = cards.Select(card => Card(card.Spanish, card.English)).ToList();
        dbContext.FlashCards.AddRange(added);
        await dbContext.SaveChangesAsync();
        return added.Select(card => card.Id).ToList();
    }

    // Adds a tag of the user's, on these of their cards, returning its ID.
    public static async Task<int> SeedTagAsync(string databaseName, int userId, string name, params int[] cardIds)
    {
        await using var dbContext = Create(databaseName, userId);
        var tag = new Tag { Name = name };
        dbContext.Tags.Add(tag);
        foreach (var card in dbContext.FlashCards.Where(card => cardIds.Contains(card.Id)))
        {
            card.Tags.Add(tag);
        }

        await dbContext.SaveChangesAsync();
        return tag.Id;
    }

    // Adds another user's data, which the test user mustn't see, through a context of its own. The entities added get
    // their IDs.
    public static async Task SeedAsOtherUserAsync(string databaseName, Action<FlashCardDbContext> add)
    {
        ArgumentNullException.ThrowIfNull(add);

        await using var dbContext = Create(databaseName, OtherUserId);
        add(dbContext);
        await dbContext.SaveChangesAsync();
    }
}
