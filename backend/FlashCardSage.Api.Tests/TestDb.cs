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
        var options = new DbContextOptionsBuilder<FlashCardDbContext>()
            .UseInMemoryDatabase(databaseName ?? Guid.NewGuid().ToString())
            .AddInterceptors(interceptors)
            .Options;

        return new FlashCardDbContext(options, new CurrentUser { UserId = userId });
    }
}
