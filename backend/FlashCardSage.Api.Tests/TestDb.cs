using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Data;
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
}
