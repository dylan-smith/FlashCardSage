using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace FlashCardSage.Api.Tests.Fakes;

// Fails the first save as a unique index would, after running saveFirst (e.g. another request saving a card in the
// meantime). The in-memory database has no unique indexes of its own.
internal sealed class UniqueIndexInterceptor(Func<Task> saveFirst) : SaveChangesInterceptor
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
        throw new DbUpdateException("Cannot insert duplicate key row in object 'dbo.FlashCardWords'.");
    }
}
