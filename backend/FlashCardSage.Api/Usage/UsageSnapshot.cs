using System.Globalization;
using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Usage;

/// <summary>
/// How many cards, decks, tags and practice results each user has, logged one user at a time so the FlashCardSage Usage
/// workbook can average them over users (infra/workbooks/usage.workbook.json). Requests only say what users did while
/// telemetry is kept, so totals like these come from the database.
/// </summary>
/// <remarks>
/// It reads every user's rows, so it's the one place besides SystemDecksController that reads past the query filters.
/// Users are logged by their ID, never their name or email.
/// </remarks>
public static class UsageSnapshot
{
    // Whether a subject is a person using the app, rather than the system user that owns the built-in decks or the
    // service user the smoke tests and load test sign in as.
    public static bool IsPerson(string subject)
    {
        return subject is not (User.SystemSubject or LocalTokenHandler.ServiceSubject);
    }

    public static async Task<IReadOnlyList<UserUsage>> TakeAsync(
        FlashCardDbContext dbContext, ILogger logger, DateTimeOffset takenAt, CancellationToken cancellationToken)
    {
        var users = await dbContext.Users
            .AsNoTracking()
            .Select(user => new { user.Id, user.Subject, user.CreatedAt })
            .ToListAsync(cancellationToken);
        var cards = await CountByUserAsync(
            dbContext.FlashCards.IgnoreQueryFilters().Select(card => card.UserId), cancellationToken);
        var decks = await CountByUserAsync(
            dbContext.Decks.IgnoreQueryFilters().Select(deck => deck.UserId), cancellationToken);
        var tags = await CountByUserAsync(
            dbContext.Tags.IgnoreQueryFilters().Select(tag => tag.UserId), cancellationToken);
        var practiceResults = await CountByUserAsync(
            dbContext.PracticeResults.IgnoreQueryFilters().Select(result => result.FlashCard.UserId), cancellationToken);

        var usage = users
            .Where(user => IsPerson(user.Subject))
            .OrderBy(user => user.Id)
            .Select(user => new UserUsage(
                user.Id,
                user.CreatedAt,
                cards.GetValueOrDefault(user.Id),
                decks.GetValueOrDefault(user.Id),
                tags.GetValueOrDefault(user.Id),
                practiceResults.GetValueOrDefault(user.Id)))
            .ToList();

        // The workbook finds this snapshot's rows by when it was taken, so each row has it. Times are logged as ISO 8601
        // text, which KQL reads with todatetime.
        var snapshotAt = takenAt.ToString("O", CultureInfo.InvariantCulture);
        foreach (var user in usage)
        {
            logger.LogInformation(
                "Usage snapshot {UsageSnapshotAt} of user {UsageUserId}, signed up {UserCreatedAt}: {CardCount} cards, {DeckCount} decks, {TagCount} tags, {PracticeResultCount} practice results",
                snapshotAt,
                user.UserId,
                user.CreatedAt.ToString("O", CultureInfo.InvariantCulture),
                user.Cards,
                user.Decks,
                user.Tags,
                user.PracticeResults);
        }

        logger.LogInformation("Took usage snapshot {UsageSnapshotAt} of {UserCount} users", snapshotAt, usage.Count);
        return usage;
    }

    private static async Task<Dictionary<int, int>> CountByUserAsync(
        IQueryable<int> userIds, CancellationToken cancellationToken)
    {
        return await userIds
            .GroupBy(userId => userId)
            .Select(group => new { UserId = group.Key, Count = group.Count() })
            .ToDictionaryAsync(item => item.UserId, item => item.Count, cancellationToken);
    }
}

public record UserUsage(int UserId, DateTimeOffset CreatedAt, int Cards, int Decks, int Tags, int PracticeResults);
