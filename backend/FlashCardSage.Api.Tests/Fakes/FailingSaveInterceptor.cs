using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace FlashCardSage.Api.Tests.Fakes;

// Fails every save with the exception, as the database would if it were away.
internal sealed class FailingSaveInterceptor(Func<Exception> failure) : SaveChangesInterceptor
{
    // Fails every save with this same exception.
    public FailingSaveInterceptor(Exception failure)
        : this(() => failure)
    {
    }

    // Fails every save as a unique index on the table would. The in-memory database has no unique indexes of its own.
    public static FailingSaveInterceptor DuplicateKey(string table)
    {
        return new FailingSaveInterceptor(() => new DbUpdateException($"Cannot insert duplicate key row in object 'dbo.{table}'."));
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        throw failure();
    }
}
