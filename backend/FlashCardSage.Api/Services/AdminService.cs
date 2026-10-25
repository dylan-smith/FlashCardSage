using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Contracts.Admin;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Usage;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Services;

/// <summary>
/// What the people using the app have, for the read-only admin pages (see AdminController). It reads every user's
/// rows, so every query ignores the query filters, and it's the only way the admin endpoints reach them. Only people
/// are shown (see UsageSnapshot.IsPerson), never the system user that owns the built-in decks or the service user.
/// </summary>
public class AdminService(FlashCardDbContext dbContext, TimeProvider timeProvider)
{
    // How a card's source is reported when it wasn't recorded, as for cards made before it was.
    public const string UnknownSource = "Unknown";

    // How many of a person's newest practice results their page shows.
    public const int RecentPracticeResults = 20;

    // How many days, up to today, a person's page shows their practice for.
    public const int PracticeDays = 30;

    // Totals over everyone using the app.
    public async Task<AdminOverviewResponse> GetOverviewAsync(CancellationToken cancellationToken = default)
    {
        var now = timeProvider.GetUtcNow();
        var people = await PeopleAsync(null, cancellationToken);
        var summaries = await SummariesAsync(people, null, cancellationToken);
        var personIds = people.Select(user => user.Id).ToHashSet();

        var sources = await SourceCountsAsync(null, cancellationToken);
        var practicedLast7Days = await UsageSnapshot.CountByUserAsync(
            PracticeResults().Where(result => result.PracticedAt >= now.AddDays(-7)).Select(result => result.FlashCard.UserId),
            cancellationToken);
        var practicedLast30Days = await UsageSnapshot.CountByUserAsync(
            PracticeResults().Where(result => result.PracticedAt >= now.AddDays(-30)).Select(result => result.FlashCard.UserId),
            cancellationToken);
        var listenedLast30Days = await UsageSnapshot.CountByUserAsync(
            PracticeResults()
                .Where(result => result.PracticedAt >= now.AddDays(-30) && result.Listening == true)
                .Select(result => result.FlashCard.UserId),
            cancellationToken);

        return new AdminOverviewResponse(
            summaries.Count,
            summaries.Count(user => user.LastSeenAt >= now.AddDays(-7)),
            summaries.Count(user => user.LastSeenAt >= now.AddDays(-30)),
            summaries.Count(user => user.CreatedAt >= now.AddDays(-30)),
            summaries.Sum(user => user.Cards),
            summaries.Sum(user => user.Decks),
            summaries.Sum(user => user.Tags),
            summaries.Sum(user => user.PracticeResults),
            SumFor(personIds, practicedLast7Days),
            SumFor(personIds, practicedLast30Days),
            SumFor(personIds, listenedLast30Days),
            listenedLast30Days.Keys.Count(personIds.Contains),
            CountBySource(sources.Where(item => personIds.Contains(item.UserId))),
            await dbContext.Translations.CountAsync(cancellationToken),
            await dbContext.GeneratedImages.CountAsync(cancellationToken),
            await dbContext.GeneratedAudio.CountAsync(cancellationToken),
            await dbContext.OAuthClients.CountAsync(cancellationToken),
            summaries.Sum(user => user.ConnectedApps));
    }

    // Everyone using the app, last seen first, with those never seen since it was recorded last.
    public async Task<List<AdminUserSummary>> ListUsersAsync(CancellationToken cancellationToken = default)
    {
        var people = await PeopleAsync(null, cancellationToken);
        var summaries = await SummariesAsync(people, null, cancellationToken);

        return summaries
            .OrderBy(user => user.LastSeenAt is null)
            .ThenByDescending(user => user.LastSeenAt)
            .ThenByDescending(user => user.CreatedAt)
            .ThenBy(user => user.Id)
            .ToList();
    }

    // The person with this ID in depth, or null when there's nobody using the app with it.
    public async Task<AdminUserDetail?> GetUserAsync(int id, CancellationToken cancellationToken = default)
    {
        var user = (await PeopleAsync(id, cancellationToken)).SingleOrDefault();
        if (user is null)
        {
            return null;
        }

        var summary = (await SummariesAsync([user], id, cancellationToken)).Single();

        var decks = await dbContext.Decks
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(deck => deck.UserId == id)
            .OrderBy(deck => deck.Name)
            .ThenBy(deck => deck.Id)
            .Select(deck => new AdminDeckSummary(deck.Id, deck.Name, deck.CreatedAt, deck.FlashCards.Count))
            .ToListAsync(cancellationToken);

        var tags = await dbContext.Tags
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(tag => tag.UserId == id)
            .OrderBy(tag => tag.Name)
            .ThenBy(tag => tag.Id)
            .Select(tag => new AdminTagSummary(tag.Id, tag.Name, tag.FlashCards.Count))
            .ToListAsync(cancellationToken);

        var grants = await dbContext.OAuthGrants
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Include(grant => grant.Client)
            .Where(grant => grant.UserId == id)
            .OrderByDescending(grant => grant.CreatedAt)
            .ThenByDescending(grant => grant.Id)
            .ToListAsync(cancellationToken);

        var sources = await SourceCountsAsync(id, cancellationToken);

        return new AdminUserDetail(
            summary,
            new PreferencesResponse(user.ShowPictures, user.ShowSuggestions, user.AutoTranslate),
            decks,
            tags,
            await PracticeSummaryAsync(id, cancellationToken),
            grants.Select(OAuthConnectionResponse.FromGrant).ToList(),
            CountBySource(sources));
    }

    // The person's cards, in the order they were added, or null when there's nobody using the app with this ID.
    public async Task<List<AdminCardSummary>?> ListUserCardsAsync(int id, CancellationToken cancellationToken = default)
    {
        if ((await PeopleAsync(id, cancellationToken)).Count == 0)
        {
            return null;
        }

        var cards = await Cards()
            .Where(card => card.UserId == id)
            .WithWordsAndTags()
            .Include(card => card.Decks.OrderBy(deck => deck.Name))
            .OrderBy(card => card.Id)
            .ToListAsync(cancellationToken);

        // Newest first, as FlashCardScoring scores them.
        var results = await PracticeResults()
            .Where(result => result.FlashCard.UserId == id)
            .OrderByDescending(result => result.Id)
            .Select(result => new { result.FlashCardId, result.Outcome, result.PracticedAt })
            .ToListAsync(cancellationToken);
        var resultsByCard = results.ToLookup(result => result.FlashCardId);

        return cards
            .Select(card => new AdminCardSummary(
                card.Id,
                card.Spanish,
                card.English,
                card.Tags.Select(tag => tag.Name).ToList(),
                card.Decks.Select(deck => deck.Name).ToList(),
                card.ImageUrl,
                card.CreatedAt,
                SourceName(card.Source),
                PracticeScore.FromOutcomes(resultsByCard[card.Id].Select(result => result.Outcome)),
                resultsByCard[card.Id].Count(result => result.Outcome == PracticeOutcome.GotIt),
                resultsByCard[card.Id].Count(result => result.Outcome == PracticeOutcome.WasClose),
                resultsByCard[card.Id].Count(result => result.Outcome == PracticeOutcome.Failed),
                resultsByCard[card.Id].FirstOrDefault()?.PracticedAt))
            .ToList();
    }

    // The people using the app, or just the one with this ID if they are one.
    private async Task<List<User>> PeopleAsync(int? userId, CancellationToken cancellationToken)
    {
        var users = await dbContext.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => userId == null || user.Id == userId)
            .ToListAsync(cancellationToken);

        return users.Where(user => UsageSnapshot.IsPerson(user.Subject)).ToList();
    }

    // What each of these people has, counted for everyone (or just the user with this ID) as UsageSnapshot does.
    private async Task<List<AdminUserSummary>> SummariesAsync(
        IReadOnlyList<User> people, int? userId, CancellationToken cancellationToken)
    {
        var cards = await UsageSnapshot.CountByUserAsync(
            Cards().Where(card => userId == null || card.UserId == userId).Select(card => card.UserId),
            cancellationToken);
        var decks = await UsageSnapshot.CountByUserAsync(
            dbContext.Decks.IgnoreQueryFilters()
                .Where(deck => userId == null || deck.UserId == userId)
                .Select(deck => deck.UserId),
            cancellationToken);
        var tags = await UsageSnapshot.CountByUserAsync(
            dbContext.Tags.IgnoreQueryFilters()
                .Where(tag => userId == null || tag.UserId == userId)
                .Select(tag => tag.UserId),
            cancellationToken);
        var practiceResults = await UsageSnapshot.CountByUserAsync(
            PracticeResults()
                .Where(result => userId == null || result.FlashCard.UserId == userId)
                .Select(result => result.FlashCard.UserId),
            cancellationToken);
        var connectedApps = await UsageSnapshot.CountByUserAsync(
            dbContext.OAuthGrants.IgnoreQueryFilters()
                .Where(grant => userId == null || grant.UserId == userId)
                .Select(grant => grant.UserId),
            cancellationToken);
        var lastPracticedAt = await PracticeResults()
            .Where(result => userId == null || result.FlashCard.UserId == userId)
            .GroupBy(result => result.FlashCard.UserId)
            .Select(group => new { UserId = group.Key, LastPracticedAt = group.Max(result => result.PracticedAt) })
            .ToDictionaryAsync(item => item.UserId, item => item.LastPracticedAt, cancellationToken);
        var scores = await ScoresByUserAsync(userId, cancellationToken);

        return people
            .Select(user => new AdminUserSummary(
                user.Id,
                user.Subject,
                Provider(user.Subject),
                user.DisplayName,
                user.Email,
                user.CreatedAt,
                user.LastSeenAt,
                cards.GetValueOrDefault(user.Id),
                decks.GetValueOrDefault(user.Id),
                tags.GetValueOrDefault(user.Id),
                practiceResults.GetValueOrDefault(user.Id),
                lastPracticedAt.TryGetValue(user.Id, out var practicedAt) ? practicedAt : null,
                connectedApps.GetValueOrDefault(user.Id),
                scores.GetValueOrDefault(user.Id),
                cards.GetValueOrDefault(user.Id) * PracticeScore.Maximum))
            .ToList();
    }

    // The total of each user's (or just the user with this ID's) card scores, as FlashCardScoring scores them. A card
    // that's never been practiced scores nothing, so only the practiced ones are needed. Every result's outcome is
    // loaded, newest first, and grouped in memory, as each person's scores are.
    private async Task<Dictionary<int, int>> ScoresByUserAsync(int? userId, CancellationToken cancellationToken)
    {
        var results = await PracticeResults()
            .Where(result => userId == null || result.FlashCard.UserId == userId)
            .OrderByDescending(result => result.Id)
            .Select(result => new { result.FlashCard.UserId, result.FlashCardId, result.Outcome })
            .ToListAsync(cancellationToken);

        return results
            .GroupBy(result => result.UserId)
            .ToDictionary(
                user => user.Key,
                user => user
                    .GroupBy(result => result.FlashCardId)
                    .Sum(card => PracticeScore.FromOutcomes(card.Select(result => result.Outcome))));
    }

    // The person's practice. A person's results are few enough to group in memory.
    private async Task<AdminPracticeSummary> PracticeSummaryAsync(int userId, CancellationToken cancellationToken)
    {
        var results = await PracticeResults()
            .Where(result => result.FlashCard.UserId == userId)
            .OrderByDescending(result => result.Id)
            .Select(result => new { result.FlashCardId, result.Outcome, result.PracticedAt, result.Listening })
            .ToListAsync(cancellationToken);

        var recent = results.Take(RecentPracticeResults).ToList();
        var recentCardIds = recent.Select(result => result.FlashCardId).Distinct().ToList();
        var spanish = (await Cards().Where(card => recentCardIds.Contains(card.Id)).WithWords().ToListAsync(cancellationToken))
            .ToDictionary(card => card.Id, card => card.Spanish);

        var today = DateOnly.FromDateTime(timeProvider.GetUtcNow().UtcDateTime);
        var resultsByDay = results
            .GroupBy(result => DateOnly.FromDateTime(result.PracticedAt.UtcDateTime))
            .ToDictionary(group => group.Key, group => group.Count());

        return new AdminPracticeSummary(
            results.Count(result => result.Outcome == PracticeOutcome.GotIt),
            results.Count(result => result.Outcome == PracticeOutcome.WasClose),
            results.Count(result => result.Outcome == PracticeOutcome.Failed),
            results.Count(result => result.Listening == true),
            results.Count == 0 ? null : results.Min(result => result.PracticedAt),
            results.Count == 0 ? null : results.Max(result => result.PracticedAt),
            Enumerable.Range(1 - PracticeDays, PracticeDays)
                .Select(offset => today.AddDays(offset))
                .Select(day => new AdminPracticeDay(day, resultsByDay.GetValueOrDefault(day)))
                .ToList(),
            recent
                .Select(result => new AdminPracticeResult(
                    result.FlashCardId,
                    spanish.GetValueOrDefault(result.FlashCardId, []),
                    result.Outcome,
                    result.PracticedAt,
                    result.Listening))
                .ToList());
    }

    // How many cards each user (or just the user with this ID) has from each source.
    private async Task<List<SourceCount>> SourceCountsAsync(int? userId, CancellationToken cancellationToken)
    {
        return await Cards()
            .Where(card => userId == null || card.UserId == userId)
            .GroupBy(card => new { card.UserId, card.Source })
            .Select(group => new SourceCount(group.Key.UserId, group.Key.Source, group.Count()))
            .ToListAsync(cancellationToken);
    }

    private IQueryable<FlashCard> Cards()
    {
        return dbContext.FlashCards.IgnoreQueryFilters().AsNoTracking();
    }

    private IQueryable<PracticeResult> PracticeResults()
    {
        return dbContext.PracticeResults.IgnoreQueryFilters().AsNoTracking();
    }

    // Every source, in order, then Unknown, with how many of the cards came from it.
    private static Dictionary<string, int> CountBySource(IEnumerable<SourceCount> counts)
    {
        var bySource = Enum.GetValues<CardSource>().ToDictionary(source => source.ToString(), _ => 0);
        bySource[UnknownSource] = 0;
        foreach (var count in counts)
        {
            bySource[SourceName(count.Source)] += count.Count;
        }

        return bySource;
    }

    private static string SourceName(CardSource? source)
    {
        return source?.ToString() ?? UnknownSource;
    }

    // Where the user signed in from: their subject's prefix, such as "google" in "google:<sub>".
    private static string Provider(string subject)
    {
        var colon = subject.IndexOf(':', StringComparison.Ordinal);
        return colon < 0 ? subject : subject[..colon];
    }

    private static int SumFor(HashSet<int> userIds, Dictionary<int, int> counts)
    {
        return counts.Where(item => userIds.Contains(item.Key)).Sum(item => item.Value);
    }

    private sealed record SourceCount(int UserId, CardSource? Source, int Count);
}
