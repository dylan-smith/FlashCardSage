using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Authentication;

// The users' rows, which a user gets on their first request (see CurrentUserMiddleware).
public static class UserAccounts
{
    // How stale a user's LastSeenAt can get, so a request only writes it now and then rather than every time.
    public static readonly TimeSpan LastSeenPrecision = TimeSpan.FromMinutes(15);

    public static async Task<int> GetOrCreateUserIdAsync(
        FlashCardDbContext dbContext,
        string subject,
        string? name,
        string? email,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(dbContext);

        var user = await dbContext.Users.FirstOrDefaultAsync(item => item.Subject == subject, cancellationToken);

        if (user is null)
        {
            user = new User { Subject = subject, DisplayName = name, Email = email, CreatedAt = now, LastSeenAt = now };
            dbContext.Users.Add(user);

            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
                return user.Id;
            }
            catch (DbUpdateException)
            {
                // Another request from the same user created the row first, which fails the unique Subject index.
                dbContext.Entry(user).State = EntityState.Detached;
                return await dbContext.Users
                    .AsNoTracking()
                    .Where(item => item.Subject == subject)
                    .Select(item => item.Id)
                    .SingleAsync(cancellationToken);
            }
        }

        // Keep the name and email in step with the account, and when they were last seen, without writing on every
        // request.
        if ((name is not null && user.DisplayName != name)
            || (email is not null && user.Email != email)
            || user.LastSeenAt is not { } lastSeenAt
            || now - lastSeenAt >= LastSeenPrecision)
        {
            user.DisplayName = name ?? user.DisplayName;
            user.Email = email ?? user.Email;
            user.LastSeenAt = now;
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return user.Id;
    }

    /// <summary>
    /// Makes the system user, which owns the built-in decks, the current user, so the context's query filters and owner
    /// work for its rows as they do for anyone's. The context shouldn't be used for anything else afterwards.
    /// </summary>
    public static async Task BecomeSystemUserAsync(
        FlashCardDbContext dbContext, CurrentUser currentUser, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(currentUser);

        currentUser.UserId = await GetOrCreateUserIdAsync(
            dbContext, User.SystemSubject, "FlashCardSage", email: null, DateTimeOffset.UtcNow, cancellationToken);
    }
}
