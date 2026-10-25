using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts.Admin;

// One person in depth, for the admin user page: their decks and tags by name, their practice, the apps they've
// connected (newest first) and how their cards were added, with "Unknown" for cards made before it was recorded.
public record AdminUserDetail(
    AdminUserSummary User,
    PreferencesResponse Preferences,
    IReadOnlyList<AdminDeckSummary> Decks,
    IReadOnlyList<AdminTagSummary> Tags,
    AdminPracticeSummary Practice,
    IReadOnlyList<OAuthConnectionResponse> ConnectedApps,
    IReadOnlyDictionary<string, int> CardsBySource);

// CreatedAt is null for a deck made before it was recorded.
public record AdminDeckSummary(int Id, string Name, DateTimeOffset? CreatedAt, int CardCount);

public record AdminTagSummary(int Id, string Name, int CardCount);

// How many times the person answered with each outcome, how many of their results were practiced in listening mode,
// when they first and last practiced (null if they never have), how many results they had on each of the last 30 days
// (UTC, oldest first, including days with none), and their 20 newest results, newest first.
public record AdminPracticeSummary(
    int GotIt,
    int WasClose,
    int Failed,
    int Listening,
    DateTimeOffset? FirstPracticedAt,
    DateTimeOffset? LastPracticedAt,
    IReadOnlyList<AdminPracticeDay> ByDay,
    IReadOnlyList<AdminPracticeResult> Recent);

public record AdminPracticeDay(DateOnly Date, int Results);

// A practice result, with the Spanish words of the card practiced. Listening is null for a result recorded before
// listening mode was.
public record AdminPracticeResult(
    int FlashCardId,
    IReadOnlyList<string> Spanish,
    PracticeOutcome Outcome,
    DateTimeOffset PracticedAt,
    bool? Listening);
