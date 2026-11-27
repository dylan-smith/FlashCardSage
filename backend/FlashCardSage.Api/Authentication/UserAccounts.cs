using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Authentication;

// The users' rows, which a user gets on their first request (see CurrentUserMiddleware).
public static class UserAccounts
{
    // How stale a user's LastSeenAt can get, so a request only writes it now and then rather than every time.
    public static readonly TimeSpan LastSeenPrecision = TimeSpan.FromMinutes(15);

    // setUpNewUser, when given, runs with a user's ID just after their row is made, to add what a new user starts with.
    // client, when given, is which of the app's clients the request came from, which is seen now too.
    public static async Task<int> GetOrCreateUserIdAsync(
        FlashCardDbContext dbContext,
        string subject,
        string? name,
        string? email,
        DateTimeOffset now,
        CancellationToken cancellationToken,
        Func<int, CancellationToken, Task>? setUpNewUser = null,
        AppClient? client = null)
    {
        ArgumentNullException.ThrowIfNull(dbContext);

        var user = await dbContext.Users.FirstOrDefaultAsync(item => item.Subject == subject, cancellationToken);

        if (user is null)
        {
            if (setUpNewUser is null || !dbContext.Database.IsRelational())
            {
                return await CreateUserAsync(dbContext, subject, name, email, now, setUpNewUser, client, cancellationToken);
            }

            // The row and what setUpNewUser adds are saved together, so the user's other first requests, which wait for
            // the new row, never find the user without it. Through the execution strategy, which retries the whole
            // transaction, starting over from nothing tracked (this is the request's first use of the context).
            return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(
                async token =>
                {
                    dbContext.ChangeTracker.Clear();
                    await using var transaction = await dbContext.Database.BeginTransactionAsync(token);
                    var id = await CreateUserAsync(dbContext, subject, name, email, now, setUpNewUser, client, token);
                    await transaction.CommitAsync(token);
                    return id;
                },
                cancellationToken);
        }

        // Keep the name and email in step with the account, and when they were last seen, here and on the request's
        // client, without writing on every request.
        if ((name is not null && user.DisplayName != name)
            || (email is not null && user.Email != email)
            || IsStale(user.LastSeenAt, now)
            || (client is { } seenOn && IsStale(LastSeenOn(user, seenOn), now)))
        {
            user.DisplayName = name ?? user.DisplayName;
            user.Email = email ?? user.Email;
            SetLastSeen(user, now, client);
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return user.Id;
    }

    private static bool IsStale(DateTimeOffset? lastSeenAt, DateTimeOffset now)
    {
        return lastSeenAt is not { } seenAt || now - seenAt >= LastSeenPrecision;
    }

    private static DateTimeOffset? LastSeenOn(User user, AppClient client)
    {
        return client == AppClient.Android ? user.LastSeenInAndroidAppAt : user.LastSeenOnWebAt;
    }

    private static void SetLastSeen(User user, DateTimeOffset now, AppClient? client)
    {
        user.LastSeenAt = now;
        if (client == AppClient.Android)
        {
            user.LastSeenInAndroidAppAt = now;
        }
        else if (client == AppClient.Web)
        {
            user.LastSeenOnWebAt = now;
        }
    }

    // Adds the user's row and sets it up, or finds the one another request added first.
    private static async Task<int> CreateUserAsync(
        FlashCardDbContext dbContext,
        string subject,
        string? name,
        string? email,
        DateTimeOffset now,
        Func<int, CancellationToken, Task>? setUpNewUser,
        AppClient? client,
        CancellationToken cancellationToken)
    {
        var user = new User { Subject = subject, DisplayName = name, Email = email, CreatedAt = now };
        SetLastSeen(user, now, client);
        dbContext.Users.Add(user);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
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

        if (setUpNewUser is not null)
        {
            await setUpNewUser(user.Id, cancellationToken);
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
