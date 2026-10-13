using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Translation;
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
        return Create(databaseName ?? Guid.NewGuid().ToString(), new CurrentUser { UserId = userId }, interceptors);
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

    // The body that creates a card with one Spanish word and one English word through the API.
    public static object CardBody(string spanish, string english)
    {
        return new { spanish = new[] { spanish }, english = new[] { english } };
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
}
