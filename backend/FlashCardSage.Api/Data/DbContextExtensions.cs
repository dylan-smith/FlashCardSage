using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Data;

public static class DbContextExtensions
{
    /// <summary>
    /// Saves the changes, for a save that a unique index can refuse because a matching row was saved meanwhile (by
    /// another request, say). On a refusal the changes are dropped from the context, so it can be queried afresh to
    /// find what clashed, and the failure is returned for the caller to rethrow when nothing did.
    /// </summary>
    /// <returns>Null when the changes were saved, or else the failure.</returns>
    public static async Task<DbUpdateException?> TrySaveUniqueAsync(
        this DbContext dbContext, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(dbContext);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return null;
        }
        catch (DbUpdateException ex)
        {
            dbContext.ChangeTracker.Clear();
            return ex;
        }
    }
}
